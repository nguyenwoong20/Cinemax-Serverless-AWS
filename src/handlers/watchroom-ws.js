// Real-time watch-room sync over API Gateway WebSocket API.
// Replaces the old Socket.IO server. Clients send JSON: { action, ...data }
// Server pushes JSON: { event, ...payload } — same event names as before:
// sync-state, user-joined, user-left, video-play, video-pause, video-seek,
// episode-change, room-closed, error.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} = require('@aws-sdk/client-apigatewaymanagementapi');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ROOMS = process.env.ROOMS_TABLE;
const CONNECTIONS = process.env.CONNECTIONS_TABLE;

function mgmtClient(event) {
  const { domainName, stage } = event.requestContext;
  return new ApiGatewayManagementApiClient({ endpoint: `https://${domainName}/${stage}` });
}

async function send(mgmt, connectionId, payload) {
  try {
    await mgmt.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(payload),
    }));
  } catch (err) {
    if (err.name === 'GoneException') {
      await db.send(new DeleteCommand({ TableName: CONNECTIONS, Key: { connectionId } }));
    } else {
      console.error(`post to ${connectionId} failed:`, err.message);
    }
  }
}

async function roomConnections(roomCode) {
  const result = await db.send(new QueryCommand({
    TableName: CONNECTIONS,
    IndexName: 'room-index',
    KeyConditionExpression: 'roomCode = :r',
    ExpressionAttributeValues: { ':r': roomCode },
  }));
  return result.Items || [];
}

async function broadcast(mgmt, roomCode, payload, excludeConnectionId) {
  const conns = await roomConnections(roomCode);
  await Promise.all(
    conns
      .filter((c) => c.connectionId !== excludeConnectionId)
      .map((c) => send(mgmt, c.connectionId, payload)),
  );
  return conns.length;
}

async function getActiveRoom(code) {
  const result = await db.send(new GetCommand({ TableName: ROOMS, Key: { roomCode: code.toUpperCase() } }));
  return result.Item && result.Item.isActive ? result.Item : null;
}

async function updateRoomState(roomCode, fields) {
  const sets = Object.keys(fields).map((k, i) => `#k${i} = :v${i}`);
  await db.send(new UpdateCommand({
    TableName: ROOMS,
    Key: { roomCode: roomCode.toUpperCase() },
    UpdateExpression: 'SET ' + sets.join(', '),
    ExpressionAttributeNames: Object.fromEntries(Object.keys(fields).map((k, i) => [`#k${i}`, k])),
    ExpressionAttributeValues: Object.fromEntries(Object.values(fields).map((v, i) => [`:v${i}`, v])),
    ConditionExpression: 'attribute_exists(roomCode)',
  })).catch((err) => {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  });
}

exports.handler = async (event) => {
  const { routeKey, connectionId } = event.requestContext;

  if (routeKey === '$connect') return { statusCode: 200 };

  if (routeKey === '$disconnect') {
    const existing = await db.send(new GetCommand({ TableName: CONNECTIONS, Key: { connectionId } }));
    if (existing.Item) {
      await db.send(new DeleteCommand({ TableName: CONNECTIONS, Key: { connectionId } }));
      const mgmt = mgmtClient(event);
      const remaining = await roomConnections(existing.Item.roomCode);
      await broadcast(mgmt, existing.Item.roomCode, {
        event: 'user-left',
        userName: existing.Item.userName,
        participantCount: remaining.length,
      });
    }
    return { statusCode: 200 };
  }

  // $default — dispatch by action
  const mgmt = mgmtClient(event);
  let msg = {};
  try { msg = JSON.parse(event.body || '{}'); } catch { /* ignore */ }
  const action = msg.action || '';
  const roomCode = (msg.roomCode || '').toUpperCase();

  try {
    switch (action) {
      case 'join-room': {
        const room = await getActiveRoom(roomCode);
        if (!room) {
          await send(mgmt, connectionId, { event: 'error', message: 'Failed to join room' });
          break;
        }
        await db.send(new PutCommand({
          TableName: CONNECTIONS,
          Item: {
            connectionId,
            roomCode,
            userId: msg.userId || '',
            userName: msg.userName || '',
            joinedAt: new Date().toISOString(),
          },
        }));
        await send(mgmt, connectionId, {
          event: 'sync-state',
          currentTime: room.currentTime,
          isPlaying: room.isPlaying,
          currentServer: room.currentServer,
          currentEpisode: room.currentEpisode,
        });
        const count = (await roomConnections(roomCode)).length;
        await broadcast(mgmt, roomCode, {
          event: 'user-joined',
          userId: msg.userId,
          userName: msg.userName,
          participantCount: count,
        }, connectionId);
        break;
      }

      case 'leave-room': {
        await db.send(new DeleteCommand({ TableName: CONNECTIONS, Key: { connectionId } }));
        const count = (await roomConnections(roomCode)).length;
        await broadcast(mgmt, roomCode, { event: 'user-left', participantCount: count }, connectionId);
        break;
      }

      case 'video-play':
      case 'video-pause': {
        await updateRoomState(roomCode, {
          isPlaying: action === 'video-play',
          currentTime: msg.currentTime || 0,
        });
        await broadcast(mgmt, roomCode, {
          event: action,
          currentTime: msg.currentTime || 0,
          triggeredBy: msg.userId,
        }, connectionId);
        break;
      }

      case 'video-seek': {
        await updateRoomState(roomCode, { currentTime: msg.currentTime || 0 });
        await broadcast(mgmt, roomCode, {
          event: 'video-seek',
          currentTime: msg.currentTime || 0,
          triggeredBy: msg.userId,
        }, connectionId);
        break;
      }

      case 'episode-change': {
        await updateRoomState(roomCode, {
          currentServer: msg.currentServer || 0,
          currentEpisode: msg.currentEpisode || 0,
          currentTime: 0,
          isPlaying: false,
        });
        await broadcast(mgmt, roomCode, {
          event: 'episode-change',
          currentServer: msg.currentServer || 0,
          currentEpisode: msg.currentEpisode || 0,
          triggeredBy: msg.userId,
        }, connectionId);
        break;
      }

      case 'sync-request': {
        const room = await getActiveRoom(roomCode);
        if (room) {
          await send(mgmt, connectionId, {
            event: 'sync-state',
            currentTime: room.currentTime,
            isPlaying: room.isPlaying,
            currentServer: room.currentServer,
            currentEpisode: room.currentEpisode,
          });
        }
        break;
      }

      case 'close-room': {
        await updateRoomState(roomCode, { isActive: false });
        await broadcast(mgmt, roomCode, { event: 'room-closed', message: 'Host closed the room' });
        break;
      }

      default:
        await send(mgmt, connectionId, { event: 'error', message: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error(`action ${action} failed:`, err);
    await send(mgmt, connectionId, { event: 'error', message: 'Internal error' });
  }

  return { statusCode: 200 };
};
