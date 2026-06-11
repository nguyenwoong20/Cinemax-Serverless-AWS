/**
 * End-to-end watch room test: simulates two users watching together.
 * 1. Login (REST) -> JWT
 * 2. Create room (REST) -> room code
 * 3. Two WebSocket clients join, exchange play/seek events
 *
 * Usage: node scripts/test-watchroom.js <email> <password>
 */
const API = 'https://c0ocqpmzj9.execute-api.ap-southeast-1.amazonaws.com/prod';
const WS = 'wss://n5hhh58ty7.execute-api.ap-southeast-1.amazonaws.com/prod';

const [email, password] = process.argv.slice(2);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function wsClient(name) {
  const ws = new WebSocket(WS);
  const events = [];
  ws.onmessage = (m) => {
    const data = JSON.parse(m.data);
    events.push(data);
    console.log(`  [${name}] <- ${data.event}: ${JSON.stringify(data)}`);
  };
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (e) => reject(new Error(`${name} ws error`));
  });
  return { ws, events, opened, send: (o) => ws.send(JSON.stringify(o)) };
}

async function main() {
  // 1. login
  const login = await (await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })).json();
  if (!login.success) throw new Error('login failed: ' + login.message);
  console.log(`login OK: ${login.auth.name} (${login.auth.id})`);

  // 2. create room
  const created = await (await fetch(`${API}/api/watch-rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ movieSlug: '366-ngay', movieName: '366 Ngày', moviePoster: '' }),
  })).json();
  if (!created.success) throw new Error('create room failed: ' + created.message);
  const code = created.data.roomCode;
  console.log(`room created: ${code}`);

  // 3. two websocket clients
  const alice = wsClient('ALICE');
  const bob = wsClient('BOB');
  await Promise.all([alice.opened, bob.opened]);
  console.log('both sockets connected');

  alice.send({ action: 'join-room', roomCode: code, userId: login.auth.id, userName: 'Alice' });
  await wait(1500);
  bob.send({ action: 'join-room', roomCode: code, userId: 'guest-bob', userName: 'Bob' });
  await wait(1500);

  console.log('-- Alice presses PLAY at 12.5s --');
  alice.send({ action: 'video-play', roomCode: code, currentTime: 12.5, userId: login.auth.id });
  await wait(1500);

  console.log('-- Bob seeks to 99s --');
  bob.send({ action: 'video-seek', roomCode: code, currentTime: 99, userId: 'guest-bob' });
  await wait(1500);

  console.log('-- Bob requests sync --');
  bob.send({ action: 'sync-request', roomCode: code });
  await wait(1500);

  console.log('-- Alice (host) closes room --');
  alice.send({ action: 'close-room', roomCode: code });
  await wait(1500);

  alice.ws.close();
  bob.ws.close();

  // verdict
  const got = (c, ev) => c.events.some((e) => e.event === ev);
  const checks = {
    'Alice got sync-state on join': got(alice, 'sync-state'),
    'Alice saw Bob join (user-joined)': got(alice, 'user-joined'),
    'Bob received video-play from Alice': got(bob, 'video-play'),
    'Alice received video-seek from Bob': got(alice, 'video-seek'),
    'Bob sync-request answered (currentTime=99)': bob.events.some((e) => e.event === 'sync-state' && e.currentTime === 99),
    'Both received room-closed': got(alice, 'room-closed') && got(bob, 'room-closed'),
  };
  console.log('\n=== RESULTS ===');
  let pass = true;
  for (const [name, ok] of Object.entries(checks)) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) pass = false;
  }
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
