const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.BOOKMARKS_TABLE;

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  console.log('Request:', event.httpMethod, event.path);

  try {
    const { httpMethod, pathParameters } = event;
    const userId = pathParameters && pathParameters.userId;
    const movieId = pathParameters && pathParameters.movieId;

    if (!userId) return response(400, { message: 'userId is required' });

    if (httpMethod === 'GET') return listBookmarks(userId);
    if (httpMethod === 'POST') return addBookmark(userId, JSON.parse(event.body || '{}'));
    if (httpMethod === 'DELETE' && movieId) return removeBookmark(userId, movieId);

    return response(405, { message: 'Method not allowed' });
  } catch (err) {
    console.error('Error:', err);
    return response(500, { message: 'Internal server error' });
  }
};

// GET /users/{userId}/bookmarks
async function listBookmarks(userId) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'userId = :u',
    ExpressionAttributeValues: { ':u': userId },
  }));
  return response(200, { items: result.Items, count: result.Count });
}

// POST /users/{userId}/bookmarks  body: { movieId, title, posterUrl }
async function addBookmark(userId, body) {
  if (!body.movieId) return response(400, { message: 'movieId is required' });

  const bookmark = {
    userId,
    movieId: body.movieId,
    title: body.title || '',
    posterUrl: body.posterUrl || '',
    createdAt: new Date().toISOString(),
  };

  await client.send(new PutCommand({ TableName: TABLE, Item: bookmark }));
  return response(201, bookmark);
}

// DELETE /users/{userId}/bookmarks/{movieId}
async function removeBookmark(userId, movieId) {
  await client.send(new DeleteCommand({ TableName: TABLE, Key: { userId, movieId } }));
  return response(200, { message: 'Bookmark removed', userId, movieId });
}
