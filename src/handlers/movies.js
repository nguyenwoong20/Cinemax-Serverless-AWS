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
  PutCommand,
} = require('@aws-sdk/lib-dynamodb');
const { toMovieItem } = require('../lib/movie-mapper');
const { mirrorImage } = require('../lib/images');

const SOURCE = 'https://phimapi.com';
const IMG_BASE = 'https://phimimg.com';
const absImg = (u) => (u && !u.startsWith('http') ? `${IMG_BASE}/${u.replace(/^\//, '')}` : u || '');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.MOVIES_TABLE;

// Small attributes used for list cards (the big `doc` is only fetched for detail)
const LIST_ATTRS =
  'id, slug, #nm, originName, posterUrl, thumbUrl, #yr, #tp, episodeCurrent, quality, lang, #tm, categoryNames, countryNames, categorySlugs, countrySlugs, createdAt, rating, votes';
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
        // Not in our catalog? Fall back to the live kkphim (phimapi) search
        // so users can still find anything — opening the movie ingests it.
        if (items.length === 0) {
          const external = await externalSearch(params.search);
          return response(200, { success: true, data: external, source: 'kkphim' });
        }
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

    // /api/movies/filter?category=&country=&type=&year=&yearFrom=&yearTo=&lang=&sort=&page=&limit=
    // Generic multi-criteria filter, like the kkphim website filter bar.
    if (seg1 === 'filter') {
      let items = await scanAll();

      if (params.category) {
        items = items.filter((m) => (m.categorySlugs || '').includes(params.category));
      }
      if (params.country) {
        items = items.filter((m) => (m.countrySlugs || '').includes(params.country));
      }
      if (params.type) items = items.filter((m) => m.type === params.type);
      if (params.year) items = items.filter((m) => m.year === parseInt(params.year, 10));
      if (params.yearFrom) items = items.filter((m) => (m.year || 0) >= parseInt(params.yearFrom, 10));
      if (params.yearTo) items = items.filter((m) => (m.year || 0) <= parseInt(params.yearTo, 10));
      if (params.lang) {
        const q = params.lang.toLowerCase();
        items = items.filter((m) => (m.lang || '').toLowerCase().includes(q));
      }

      switch (params.sort) {
        case 'rating':
          items.sort((a, b) => (b.rating || 0) - (a.rating || 0));
          break;
        case 'votes':
          items.sort((a, b) => (b.votes || 0) - (a.votes || 0));
          break;
        case 'year':
          items.sort((a, b) => (b.year || 0) - (a.year || 0));
          break;
        default: // newest first (createdAt) — already sorted by scanAll
          break;
      }

      return response(200, { success: true, data: paginate(items, params).map(toCard) });
    }

    if (seg1 === 'hot') {
      // "Hot" = recent movies ranked by TMDB audience score (rating × popularity)
      const items = await scanAll();
      const currentYear = new Date().getFullYear();
      const hot = items
        .filter((m) => (m.year || 0) >= currentYear - 1 && (m.votes || 0) > 0)
        .sort((a, b) => {
          const score = (m) => (m.rating || 0) * Math.log10((m.votes || 0) + 1);
          return score(b) - score(a);
        });
      const limit = Math.min(parseInt(params.limit || '12', 10) || 12, 50);
      return response(200, { success: true, data: hot.slice(0, limit).map(toCard) });
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

    // /api/movies/{slug}/cast — real actor photos via TMDB (movie docs carry tmdb ids)
    if (seg2 === 'cast') return getCast(seg1);

    // /api/movies/{slug} — full detail (original document, includes episodes)
    const result = await client.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'slug-index',
      KeyConditionExpression: 'slug = :s',
      ExpressionAttributeValues: { ':s': seg1 },
      Limit: 1,
    }));
    const item = result.Items && result.Items[0];
    if (item && item.doc) {
      return response(200, { success: true, status: true, data: item.doc, movie: item.doc });
    }

    // Unknown locally — ingest on demand from kkphim, then serve it.
    const doc = await ingestFromSource(seg1);
    if (!doc) return response(404, { success: false, message: 'Movie not found' });
    return response(200, { success: true, status: true, data: doc, movie: doc });
  } catch (err) {
    console.error('Error:', err);
    return response(500, { success: false, message: 'Internal server error' });
  }
};

// Actor list with real photos from TMDB. Returns [] when no key / no tmdb id,
// so the app can fall back to its local placeholder avatars.
async function getCast(slug) {
  const KEY = process.env.TMDB_API_KEY;
  if (!KEY) return response(200, { success: true, data: [] });

  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'slug-index',
    KeyConditionExpression: 'slug = :s',
    ExpressionAttributeValues: { ':s': slug },
    ProjectionExpression: '#doc.tmdb',
    ExpressionAttributeNames: { '#doc': 'doc' },
    Limit: 1,
  }));
  const tmdb = result.Items && result.Items[0] && result.Items[0].doc && result.Items[0].doc.tmdb;
  if (!tmdb || !tmdb.id) return response(200, { success: true, data: [] });

  try {
    const kind = tmdb.type === 'tv' ? 'tv' : 'movie';
    const res = await fetch(
      `https://api.themoviedb.org/3/${kind}/${tmdb.id}/credits?api_key=${KEY}&language=en-US`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return response(200, { success: true, data: [] });
    const json = await res.json();
    const cast = (json.cast || []).slice(0, 15).map((p) => ({
      name: p.name,
      character: p.character || '',
      profileUrl: p.profile_path ? `https://image.tmdb.org/t/p/w185${p.profile_path}` : '',
    }));
    return response(200, { success: true, data: cast });
  } catch (err) {
    console.error('tmdb credits failed:', err.message);
    return response(200, { success: true, data: [] });
  }
}

// Live search against kkphim (phimapi) when our catalog has no match
async function externalSearch(keyword) {
  try {
    const res = await fetch(
      `${SOURCE}/v1/api/tim-kiem?keyword=${encodeURIComponent(keyword)}&limit=20`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return [];
    const json = await res.json();
    const list = (json.data && json.data.items) || [];
    return list.map((m) => ({
      _id: m._id,
      name: m.name || '',
      slug: m.slug || '',
      origin_name: m.origin_name || '',
      content: '',
      type: m.type || '',
      status: '',
      year: m.year || 0,
      poster_url: absImg(m.poster_url),
      thumb_url: absImg(m.thumb_url),
      time: m.time || '',
      episode_current: m.episode_current || '',
      quality: m.quality || '',
      lang: m.lang || '',
      category: (m.category || []).map((c) => ({ name: c.name })),
      country: (m.country || []).map((c) => ({ name: c.name })),
    }));
  } catch (err) {
    console.error('external search failed:', err.message);
    return [];
  }
}

// Fetch a movie from kkphim, save it into our catalog (self-growing library)
async function ingestFromSource(slug) {
  try {
    const res = await fetch(`${SOURCE}/phim/${slug}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const detail = await res.json();
    if (!detail.status || !detail.movie) return null;

    const doc = { ...detail.movie, episodes: detail.episodes || [] };
    const movieItem = toMovieItem(doc);

    // best-effort: mirror images to S3 so the new movie matches the rest
    try {
      if (movieItem.posterUrl) {
        movieItem.posterUrl = await mirrorImage(movieItem.posterUrl, `posters/${slug}-poster.jpg`);
        movieItem.doc.poster_url = movieItem.posterUrl;
      }
      if (movieItem.thumbUrl) {
        movieItem.thumbUrl = await mirrorImage(movieItem.thumbUrl, `posters/${slug}-thumb.jpg`);
        movieItem.doc.thumb_url = movieItem.thumbUrl;
      }
    } catch (err) {
      console.warn(`image mirror failed for ${slug}: ${err.message}`);
    }

    await client.send(new PutCommand({ TableName: TABLE, Item: movieItem }));
    console.log(`ingested on demand: ${slug}`);
    return movieItem.doc;
  } catch (err) {
    console.error(`ingest failed for ${slug}:`, err.message);
    return null;
  }
}
