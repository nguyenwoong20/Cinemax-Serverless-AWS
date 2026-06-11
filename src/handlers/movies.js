// Drop-in serverless replacement for the original cinemax-backend movie API.
// Routes (same paths and response shapes the Flutter app already uses):
//   GET /api/movies?search=&page=&limit=      -> {success, data: [movies]}
//   GET /api/movies/limit/{n}                 -> {success, data: [movies]}
//   GET /api/movies/category/{slug}?page&limit-> {success, data: [movies]}
//   GET /api/movies/country/{slug}?page&limit -> {success, data: [movies]}
//   GET /api/movies/year/{year}?page&limit    -> {success, data: [movies]}
//   GET /api/movies/{slug}                    -> {success, data: fullDoc, movie: fullDoc}
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.MOVIES_TABLE;

// Small attributes used for list cards (the big `doc` is only fetched for detail)
const LIST_ATTRS =
  'id, slug, #nm, originName, posterUrl, thumbUrl, #yr, #tp, episodeCurrent, quality, lang, #tm, categoryNames, countryNames, createdAt';
const LIST_NAMES = { '#nm': 'name', '#yr': 'year', '#tm': 'time', '#tp': 'type' };

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify(body),
});

// Shape a slim DynamoDB item like the phimapi-format JSON the app expects
function toCard(item) {
  return {
    _id: item.id,
    name: item.name || '',
    slug: item.slug || '',
    origin_name: item.originName || '',
    content: '',
    type: item.type || '',
    status: '',
    year: item.year || 0,
    poster_url: item.posterUrl || '',
    thumb_url: item.thumbUrl || '',
    time: item.time || '',
    episode_current: item.episodeCurrent || '',
    quality: item.quality || '',
    lang: item.lang || '',
    category: (item.categoryNames || []).map((name) => ({ name })),
    country: (item.countryNames || []).map((name) => ({ name })),
  };
}

async function scanAll(extra = {}) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await client.send(new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: LIST_ATTRS,
      ExpressionAttributeNames: { ...LIST_NAMES, ...(extra.names || {}) },
      ...(extra.filter ? { FilterExpression: extra.filter } : {}),
      ...(extra.values ? { ExpressionAttributeValues: extra.values } : {}),
      ExclusiveStartKey,
    }));
    items.push(...result.Items);
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  // newest first
  items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return items;
}

function paginate(items, params) {
  const limit = Math.min(parseInt(params.limit || '20', 10) || 20, 100);
  const page = Math.max(parseInt(params.page || '1', 10) || 1, 1);
  return items.slice((page - 1) * limit, page * limit);
}

exports.handler = async (event) => {
  console.log('Request:', event.httpMethod, event.path);

  try {
    const params = event.queryStringParameters || {};
    // path after /api/movies, e.g. "limit/20", "category/hanh-dong", "366-ngay"
    const sub = (event.pathParameters && event.pathParameters.proxy) || '';
    const [seg1, seg2] = sub.split('/');

    if (event.httpMethod !== 'GET') return response(405, { success: false, message: 'Method not allowed' });

    if (!seg1) {
      // /api/movies — list, optional ?search=
      let items = await scanAll();
      if (params.search) {
        const q = params.search.toLowerCase();
        items = items.filter(
          (m) => (m.name || '').toLowerCase().includes(q) || (m.originName || '').toLowerCase().includes(q),
        );
      }
      return response(200, { success: true, data: paginate(items, params).map(toCard) });
    }

    if (seg1 === 'limit') {
      const items = await scanAll();
      const n = Math.min(parseInt(seg2 || '20', 10) || 20, 100);
      return response(200, { success: true, data: items.slice(0, n).map(toCard) });
    }

    if (seg1 === 'category' || seg1 === 'country') {
      const attr = seg1 === 'category' ? 'categorySlugs' : 'countrySlugs';
      const items = await scanAll({
        filter: `contains(${attr}, :s)`,
        values: { ':s': seg2 || '' },
      });
      return response(200, { success: true, data: paginate(items, params).map(toCard) });
    }

    if (seg1 === 'type') {
      // single | series | hoathinh | tvshows
      const items = await scanAll({
        filter: '#tp = :s',
        values: { ':s': seg2 || '' },
      });
      return response(200, { success: true, data: paginate(items, params).map(toCard) });
    }

    if (seg1 === 'year') {
      const items = await scanAll({
        filter: '#yr = :y',
        values: { ':y': parseInt(seg2, 10) || 0 },
      });
      return response(200, { success: true, data: paginate(items, params).map(toCard) });
    }

    // /api/movies/{slug} — full detail (original document, includes episodes)
    const result = await client.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'slug-index',
      KeyConditionExpression: 'slug = :s',
      ExpressionAttributeValues: { ':s': seg1 },
      Limit: 1,
    }));
    const item = result.Items && result.Items[0];
    if (!item || !item.doc) return response(404, { success: false, message: 'Movie not found' });
    return response(200, { success: true, status: true, data: item.doc, movie: item.doc });
  } catch (err) {
    console.error('Error:', err);
    return response(500, { success: false, message: 'Internal server error' });
  }
};
