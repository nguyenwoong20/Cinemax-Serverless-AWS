// Drop-in replacement for the old Express bookmark / saved-movie / comment APIs.
// Routes:
//   GET    /api/bookmarks                     -> {success, bookmarks}
//   POST   /api/bookmarks                     -> {success, message}
//   DELETE /api/bookmarks/{movieId}           -> {success, message}
//   GET    /api/bookmarks/check/{movieId}     -> {success, isBookmarked}
//   GET    /api/saved-movies                  -> {success, data}
//   POST   /api/saved-movies  {movieID}       -> {success, message}
//   DELETE /api/saved-movies/{movieSlug}      -> {success, message}
//   GET    /api/comments/{movieId}            -> {success, data}
//   POST   /api/comments/add  {movieId,content} -> 201 {success, data}
//   PUT    /api/comments/{movieId}/{commentId}  -> {success}
//   DELETE /api/comments/{movieId}/{commentId}  -> {success}
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  GetCommand,
} = require('@aws-sdk/lib-dynamodb');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const BOOKMARKS = process.env.BOOKMARKS_TABLE;
const SAVED = process.env.SAVED_TABLE;
const COMMENTS = process.env.COMMENTS_TABLE;
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
  return { _id: u.id, id: u.id, name: u.name, email: u.email, avatar: u.avatar || null };
}

// ---- Profanity filter: mask banned words with asterisks ----
const BANNED = [
  // Vietnamese
  'đụ', 'địt', 'đм', 'đĩ', 'cặc', 'lồn', 'buồi', 'dái', 'đéo', 'vãi lồn',
  'đm', 'dm', 'đmm', 'vcl', 'vl', 'clgt', 'cc', 'cmm', 'cmnr', 'óc chó',
  'chó đẻ', 'mẹ mày', 'bố mày', 'con đĩ', 'thằng chó', 'súc vật', 'ngu lồn',
  // English
  'fuck', 'fucking', 'fucker', 'shit', 'bitch', 'asshole', 'dick', 'cunt',
  'bastard', 'motherfucker', 'wtf', 'stfu',
];

function censor(text) {
  let out = text;
  for (const word of BANNED) {
    // match whole word, case-insensitive, unicode-aware
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, (m) => '*'.repeat(m.length));
  }
  return out;
}

exports.handler = async (event) => {
  console.log('Request:', event.httpMethod, event.path);
  try {
    const path = event.path || '';
    const method = event.httpMethod;
    const sub = (event.pathParameters && event.pathParameters.proxy) || '';
    const parts = sub.split('/').filter(Boolean);

    if (path.startsWith('/api/bookmarks')) return bookmarks(event, method, parts);
    if (path.startsWith('/api/saved-movies')) return savedMovies(event, method, parts);
    if (path.startsWith('/api/comments')) return comments(event, method, parts);

    return response(404, { success: false, message: 'Not found' });
  } catch (err) {
    console.error('Error:', err);
    return response(500, { success: false, message: 'Internal server error' });
  }
};

// ---------- Bookmarks ----------
async function bookmarks(event, method, parts) {
  const authId = authIdFrom(event);
  if (!authId) return response(401, { success: false, message: 'Chưa đăng nhập' });

  if (method === 'GET' && parts.length === 0) {
    const result = await db.send(new QueryCommand({
      TableName: BOOKMARKS,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': authId },
    }));
    const items = (result.Items || [])
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map((b) => ({ _id: b.movieId, ...b }));
    return response(200, { success: true, bookmarks: items });
  }

  if (method === 'GET' && parts[0] === 'check' && parts[1]) {
    const result = await db.send(new GetCommand({
      TableName: BOOKMARKS,
      Key: { userId: authId, movieId: parts[1] },
    }));
    return response(200, { success: true, isBookmarked: !!result.Item });
  }

  if (method === 'POST' && parts.length === 0) {
    const body = JSON.parse(event.body || '{}');
    if (!body.movieId) return response(400, { success: false, message: 'movieId is required' });
    await db.send(new PutCommand({
      TableName: BOOKMARKS,
      Item: {
        userId: authId,
        movieId: body.movieId,
        movieSlug: body.movieSlug || '',
        movieName: body.movieName || '',
        posterUrl: body.posterUrl || '',
        year: body.year || 0,
        category: body.category || [],
        createdAt: new Date().toISOString(),
      },
    }));
    return response(200, { success: true, message: 'Đã thêm vào yêu thích' });
  }

  if (method === 'DELETE' && parts[0]) {
    await db.send(new DeleteCommand({
      TableName: BOOKMARKS,
      Key: { userId: authId, movieId: parts[0] },
    }));
    return response(200, { success: true, message: 'Đã xóa khỏi yêu thích' });
  }

  return response(404, { success: false, message: 'Not found' });
}

// ---------- Saved movies ----------
async function savedMovies(event, method, parts) {
  const authId = authIdFrom(event);
  if (!authId) return response(401, { success: false, message: 'Chưa đăng nhập' });

  if (method === 'GET' && parts.length === 0) {
    const result = await db.send(new QueryCommand({
      TableName: SAVED,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': authId },
    }));
    const items = (result.Items || [])
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map((s) => ({ _id: s.movieSlug, movieSlug: s.movieSlug, createdAt: s.createdAt }));
    return response(200, { success: true, data: items });
  }

  if (method === 'POST' && parts.length === 0) {
    const body = JSON.parse(event.body || '{}');
    const slug = body.movieID || body.movieSlug;
    if (!slug) return response(400, { success: false, message: 'movieID is required' });
    await db.send(new PutCommand({
      TableName: SAVED,
      Item: { userId: authId, movieSlug: slug, createdAt: new Date().toISOString() },
    }));
    return response(200, { success: true, message: 'Đã lưu phim' });
  }

  if (method === 'DELETE' && parts[0]) {
    await db.send(new DeleteCommand({
      TableName: SAVED,
      Key: { userId: authId, movieSlug: parts[0] },
    }));
    return response(200, { success: true, message: 'Đã bỏ lưu phim' });
  }

  return response(404, { success: false, message: 'Not found' });
}

// ---------- Comments ----------
async function comments(event, method, parts) {
  // GET /api/comments/{movieId} is public
  if (method === 'GET' && parts.length === 1) {
    const result = await db.send(new QueryCommand({
      TableName: COMMENTS,
      KeyConditionExpression: 'movieId = :m',
      ExpressionAttributeValues: { ':m': parts[0] },
      ScanIndexForward: false, // newest first
    }));
    return response(200, { success: true, data: result.Items || [] });
  }

  const authId = authIdFrom(event);
  if (!authId) return response(401, { success: false, message: 'Chưa đăng nhập' });

  if (method === 'POST' && parts[0] === 'add') {
    const body = JSON.parse(event.body || '{}');
    if (!body.movieId || !body.content || !body.content.trim()) {
      return response(400, { success: false, message: 'movieId and content are required' });
    }
    const user = await getUserInfo(authId);
    if (!user) return response(401, { success: false, message: 'User not found' });

    const comment = {
      movieId: body.movieId,
      _id: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      userId: user, // populated user object, same shape the old API returned
      authId,
      content: censor(body.content.trim()).slice(0, 1000),
      createdAt: new Date().toISOString(),
    };
    await db.send(new PutCommand({ TableName: COMMENTS, Item: comment }));
    return response(201, { success: true, data: comment });
  }

  if ((method === 'DELETE' || method === 'PUT') && parts.length === 2) {
    const [movieId, commentId] = parts;
    const existing = await db.send(new GetCommand({
      TableName: COMMENTS,
      Key: { movieId, _id: commentId },
    }));
    if (!existing.Item) return response(404, { success: false, message: 'Comment not found' });
    if (existing.Item.authId !== authId) {
      return response(403, { success: false, message: 'Not your comment' });
    }

    if (method === 'DELETE') {
      await db.send(new DeleteCommand({ TableName: COMMENTS, Key: { movieId, _id: commentId } }));
      return response(200, { success: true, message: 'Comment deleted' });
    }

    const body = JSON.parse(event.body || '{}');
    if (!body.content || !body.content.trim()) {
      return response(400, { success: false, message: 'content is required' });
    }
    await db.send(new UpdateCommand({
      TableName: COMMENTS,
      Key: { movieId, _id: commentId },
      UpdateExpression: 'SET content = :c',
      ExpressionAttributeValues: { ':c': censor(body.content.trim()).slice(0, 1000) },
    }));
    return response(200, { success: true, message: 'Comment updated' });
  }

  return response(404, { success: false, message: 'Not found' });
}
