// Drop-in replacement for the old Express watch-room REST API.
// Routes: GET /api/watch-rooms, POST /api/watch-rooms,
//         GET/POST/DELETE /api/watch-rooms/{code}[/join|/leave]
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const jwt = require('jsonwebtoken');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ROOMS = process.env.ROOMS_TABLE;
const USERS = process.env.USERS_TABLE;
const JWT_SECRET = process.env.JWT_SECRET;

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

function authIdFrom(event) {
  const header = (event.headers && (event.headers.Authorization || event.headers.authorization)) || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET).authID;
  } catch {
    return null;
  }
}

async function getUserInfo(authId) {
  const result = await db.send(new QueryCommand({
    TableName: USERS,
    IndexName: 'id-index',
    KeyConditionExpression: 'id = :i',
    ExpressionAttributeValues: { ':i': authId },
    Limit: 1,
  }));
  const u = result.Items && result.Items[0];
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, avatar: u.avatar || null };
}

async function getActiveRoom(code) {
  const result = await db.send(new GetCommand({ TableName: ROOMS, Key: { roomCode: code.toUpperCase() } }));
  return result.Item && result.Item.isActive ? result.Item : null;
}

// Shape the item like the old Mongo document the app expects
const roomJson = (room) => ({ _id: room.roomCode, ...room });

async function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    if (!(await getActiveRoom(code))) return code;
  }
}

exports.handler = async (event) => {
  console.log('Request:', event.httpMethod, event.path);
  try {
    const sub = (event.pathParameters && event.pathParameters.proxy) || '';
    const [code, action] = sub.split('/');
    const method = event.httpMethod;

    if (!code && method === 'GET') return listRooms();
    if (!code && method === 'POST') return createRoom(event);
    if (code && !action && method === 'GET') return getRoom(code);
    if (code && action === 'join' && method === 'POST') return joinRoom(event, code);
    if (code && action === 'leave' && method === 'POST') return leaveRoom(event, code);
    if (code && !action && method === 'DELETE') return closeRoom(event, code);

    return response(404, { success: false, message: 'Not found' });
  } catch (err) {
    console.error('Error:', err);
    return response(500, { success: false, message: 'Internal server error' });
  }
};

async function listRooms() {
  const result = await db.send(new ScanCommand({
    TableName: ROOMS,
    FilterExpression: 'isActive = :t',
    ExpressionAttributeValues: { ':t': true },
  }));
  const rooms = (result.Items || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return response(200, { success: true, data: rooms.map(roomJson) });
}

async function createRoom(event) {
  const authId = authIdFrom(event);
  if (!authId) return response(401, { success: false, message: 'User not found' });
  const user = await getUserInfo(authId);
  if (!user) return response(401, { success: false, message: 'User not found' });

  const { movieSlug, movieName, moviePoster } = JSON.parse(event.body || '{}');
  if (!movieSlug || !movieName) {
    return response(400, { success: false, message: 'Movie slug and name are required' });
  }

  const now = new Date().toISOString();
  const room = {
    roomCode: await generateRoomCode(),
    movieSlug,
    movieName,
    moviePoster: moviePoster || '',
    host: user.id,
    hostName: user.name || user.email,
    participants: [{ user: user.id, name: user.name || user.email, avatar: user.avatar, joinedAt: now }],
    maxParticipants: 30,
    isActive: true,
    currentTime: 0,
    isPlaying: false,
    currentServer: 0,
    currentEpisode: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.send(new PutCommand({ TableName: ROOMS, Item: room }));
  return response(201, { success: true, message: 'Room created successfully', data: roomJson(room) });
}

async function getRoom(code) {
  const room = await getActiveRoom(code);
  if (!room) return response(404, { success: false, message: 'Room not found' });
  return response(200, { success: true, data: roomJson(room) });
}

async function joinRoom(event, code) {
  const authId = authIdFrom(event);
  if (!authId) return response(401, { success: false, message: 'User not found' });
  const user = await getUserInfo(authId);
  if (!user) return response(401, { success: false, message: 'User not found' });

  const room = await getActiveRoom(code);
  if (!room) return response(404, { success: false, message: 'Room not found' });

  if (room.participants.some((p) => p.user === user.id)) {
    return response(200, { success: true, message: 'Already in room', data: roomJson(room) });
  }
  if (room.participants.length >= room.maxParticipants) {
    return response(400, { success: false, message: 'Room is full' });
  }

  room.participants.push({ user: user.id, name: user.name || user.email, avatar: user.avatar, joinedAt: new Date().toISOString() });
  await db.send(new UpdateCommand({
    TableName: ROOMS,
    Key: { roomCode: room.roomCode },
    UpdateExpression: 'SET participants = :p, updatedAt = :u',
    ExpressionAttributeValues: { ':p': room.participants, ':u': new Date().toISOString() },
  }));
  return response(200, { success: true, message: 'Joined room successfully', data: roomJson(room) });
}

async function leaveRoom(event, code) {
  const authId = authIdFrom(event);
  if (!authId) return response(401, { success: false, message: 'User not found' });

  const room = await getActiveRoom(code);
  if (!room) return response(404, { success: false, message: 'Room not found' });

  const participants = room.participants.filter((p) => p.user !== authId);
  const isActive = room.host !== authId; // host leaving closes the room

  await db.send(new UpdateCommand({
    TableName: ROOMS,
    Key: { roomCode: room.roomCode },
    UpdateExpression: 'SET participants = :p, isActive = :a, updatedAt = :u',
    ExpressionAttributeValues: { ':p': participants, ':a': isActive, ':u': new Date().toISOString() },
  }));
  return response(200, { success: true, message: isActive ? 'Left room successfully' : 'Room closed' });
}

async function closeRoom(event, code) {
  const authId = authIdFrom(event);
  if (!authId) return response(401, { success: false, message: 'User not found' });

  const room = await getActiveRoom(code);
  if (!room) return response(404, { success: false, message: 'Room not found' });
  if (room.host !== authId) return response(403, { success: false, message: 'Only host can close the room' });

  await db.send(new UpdateCommand({
    TableName: ROOMS,
    Key: { roomCode: room.roomCode },
    UpdateExpression: 'SET isActive = :f, updatedAt = :u',
    ExpressionAttributeValues: { ':f': false, ':u': new Date().toISOString() },
  }));
  return response(200, { success: true, message: 'Room closed successfully' });
}
