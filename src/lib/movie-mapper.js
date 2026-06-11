// Shared mapping from a phimapi.com-format movie document to a DynamoDB item.
// Used by both scripts/seed.js (bulk import) and the sync Lambda (nightly updates).
const crypto = require('crypto');

// Remove nulls/undefined deeply (DynamoDB-friendly, keeps items lean)
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return value;
}

// DynamoDB items max out at 400 KB. Long series blow past that through the
// episodes array, so progressively shrink it while keeping playback working.
function compact(doc) {
  const size = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
  if (size(doc) <= 350000) return doc;

  for (const server of doc.episodes || []) {
    for (const ep of server.server_data || []) {
      delete ep.filename;
      delete ep.link_embed; // app plays link_m3u8
    }
  }
  if (size(doc) <= 350000) return doc;

  if (Array.isArray(doc.episodes) && doc.episodes.length > 1) {
    doc.episodes = [doc.episodes[0]];
  }
  return doc;
}

function toMovieItem(doc) {
  const categories = Array.isArray(doc.category) ? doc.category : [];
  const countries = Array.isArray(doc.country) ? doc.country : [];

  return {
    id: (doc._id && (doc._id.$oid || doc._id)) || crypto.randomUUID(),
    slug: doc.slug || '',
    name: doc.name || 'Untitled',
    originName: doc.origin_name || '',
    posterUrl: doc.poster_url || '',
    thumbUrl: doc.thumb_url || '',
    year: doc.year || 0,
    time: doc.time || '',
    episodeCurrent: doc.episode_current || '',
    quality: doc.quality || '',
    lang: doc.lang || '',
    categoryNames: categories.map((c) => c.name).filter(Boolean),
    countryNames: countries.map((c) => c.name).filter(Boolean),
    categorySlugs: categories.map((c) => c.slug).filter(Boolean).join(','),
    countrySlugs: countries.map((c) => c.slug).filter(Boolean).join(','),
    category: (categories[0] && categories[0].slug) || 'uncategorized',
    createdAt: (doc.created && doc.created.time) || new Date().toISOString(),
    modifiedAt: (doc.modified && doc.modified.time) || new Date().toISOString(),
    doc: compact(clean(doc)),
  };
}

module.exports = { toMovieItem, clean, compact };
