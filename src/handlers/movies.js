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
  GetCommand,
} = require('@aws-sdk/lib-dynamodb');
const { toMovieItem } = require('../lib/movie-mapper');
const { mirrorImage } = require('../lib/images');

// Domain nguồn phim cấu hình được (đổi domain kkphim chỉ cần đổi 1 parameter, không sửa code)
const SOURCE = process.env.SOURCE_API || 'https://phimapi.com';
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
    rating: item.rating || 0,
    category: (item.categoryNames || []).map((name) => ({ name })),
    country: (item.countryNames || []).map((name) => ({ name })),
  };
}

// Cache kết quả scan trong bộ nhớ container Lambda 60 giây:
// trang chủ app gọi 9-10 danh sách cùng lúc -> chỉ tốn 1 lần quét bảng,
// các mục không còn lúc có lúc không do nghẽn scan song song.
let _scanCache = null;
let _scanCacheAt = 0;
let _scanInflight = null;

async function scanAll() {
  if (_scanCache && Date.now() - _scanCacheAt < 60000) return _scanCache;
  if (_scanInflight) return _scanInflight;

  _scanInflight = (async () => {
    const items = [];
    let ExclusiveStartKey;
    do {
      const result = await client.send(new ScanCommand({
        TableName: TABLE,
        ProjectionExpression: LIST_ATTRS,
        ExpressionAttributeNames: LIST_NAMES,
        ExclusiveStartKey,
      }));
      items.push(...result.Items);
      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    const visible = items.filter((m) => !(m.id || '').startsWith('__'));
    visible.sort((a, b) =>
      (b.modifiedAt || b.createdAt || '').localeCompare(a.modifiedAt || a.createdAt || ''));

    _scanCache = visible;
    _scanCacheAt = Date.now();
    return visible;
  })();

  try {
    return await _scanInflight;
  } finally {
    _scanInflight = null;
  }
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
      const items = (await scanAll()).filter((m) => (m[attr] || '').includes(seg2 || ''));
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
      const limitHot = Math.min(parseInt(params.limit || '12', 10) || 12, 50);
      return response(200, { success: true, data: await getHotCards(limitHot) });
    }

    // /api/movies/home — TOÀN BỘ dữ liệu trang chủ trong 1 lần gọi
    // (1 lần quét bảng thay vì app bắn ~10 request song song gây nghẽn,
    //  đây là lý do các section trước đây lúc hiện lúc không)
    if (seg1 === 'home') {
      const items = await scanAll();
      const pick = (pred, n = 12) => items.filter(pred).slice(0, n).map(toCard);

      return response(200, {
        success: true,
        data: {
          hot: await getHotCards(12),
          latest: items.slice(0, 12).map(toCard),
          korean: pick((m) => (m.countrySlugs || '').includes('han-quoc')),
          chinese: pick((m) => (m.countrySlugs || '').includes('trung-quoc')),
          vietnam: pick((m) => (m.countrySlugs || '').includes('viet-nam')),
          animation: pick((m) => m.type === 'hoathinh'),
          single: pick((m) => m.type === 'single'),
          series: pick((m) => m.type === 'series'),
        },
      });
    }

    if (seg1 === 'type') {
      // single | series | hoathinh | tvshows
      const items = (await scanAll()).filter((m) => m.type === (seg2 || ''));
      return response(200, { success: true, data: paginate(items, params).map(toCard) });
    }

    if (seg1 === 'year') {
      const y = parseInt(seg2, 10) || 0;
      const items = (await scanAll()).filter((m) => m.year === y);
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

// Slide "hot": ưu tiên bảng TMDB Trending (sync khớp sang kkphim mỗi đêm);
// thiếu thì rơi về pool phim mới cập nhật có điểm cao, xáo trộn theo ngày.
async function getHotCards(limit) {
  try {
    const meta = await client.send(new GetCommand({
      TableName: TABLE,
      Key: { id: '__trending__' },
      ProjectionExpression: 'trendingSlugs',
    }));
    const slugs = (meta.Item && meta.Item.trendingSlugs) || [];
    if (slugs.length > 0) {
      const bySlug = new Map((await scanAll()).map((m) => [m.slug, m]));
      const hot = slugs.map((s) => bySlug.get(s)).filter(Boolean);
      if (hot.length > 0) return hot.slice(0, limit).map(toCard);
    }
  } catch (err) {
    console.warn('trending read failed:', err.message);
  }

  const items = await scanAll();
  const currentYear = new Date().getFullYear();
  const recentCutoff = new Date(Date.now() - 45 * 86400000).toISOString();
  const pool = items
    .filter((m) =>
      (m.year || 0) >= currentYear - 1 &&
      (m.votes || 0) > 0 &&
      (m.modifiedAt || m.createdAt || '') >= recentCutoff)
    .sort((a, b) => {
      const score = (m) => (m.rating || 0) * Math.log10((m.votes || 0) + 1);
      return score(b) - score(a);
    })
    .slice(0, 50);

  // xáo trộn theo ngày (giờ VN): cả ngày ổn định, qua đêm đổi bộ mới
  let state = Math.floor((Date.now() + 7 * 3600 * 1000) / 86400000);
  const rand = () => {
    state |= 0; state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, limit).map(toCard);
}

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
