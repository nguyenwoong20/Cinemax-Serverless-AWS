/**
 * Seed DynamoDB with movie data exported from the original
 * cinemax-backend MongoDB database (appxemphim.movies.json).
 *
 * Usage:
 *   node scripts/seed.js path/to/appxemphim.movies.json
 *
 * Requires AWS credentials configured (aws configure) and the
 * cinemax-movies table already deployed (sam deploy).
 */
const fs = require('fs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const TABLE = process.env.MOVIES_TABLE || 'cinemax-movies';
const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/seed.js <movies.json>');
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Remove empty strings/nulls deeply (DynamoDB rejects empty string keys in sets, keep items lean)
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

function toMovieItem(doc) {
  // Data follows the phimapi.com export format used by cinemax-backend:
  // category/country are arrays of {name, slug}, video links live in episodes[].server_data[]
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
    // comma-joined slugs so Lambda can filter with contains()
    categorySlugs: categories.map((c) => c.slug).filter(Boolean).join(','),
    countrySlugs: countries.map((c) => c.slug).filter(Boolean).join(','),
    // GSI category-createdAt-index uses the first category slug
    category: (categories[0] && categories[0].slug) || 'uncategorized',
    createdAt: (doc.created && doc.created.time) || new Date().toISOString(),
    // full original document — served as-is on the detail endpoint (includes episodes)
    doc: compact(clean(doc)),
  };
}

// DynamoDB items max out at 400 KB. Long series blow past that through the
// episodes array, so progressively shrink it while keeping playback working.
function compact(doc) {
  const size = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
  if (size(doc) <= 350000) return doc;

  // 1) drop bulky non-essential episode fields
  for (const server of doc.episodes || []) {
    for (const ep of server.server_data || []) {
      delete ep.filename;
      delete ep.link_embed; // app plays link_m3u8
    }
  }
  if (size(doc) <= 350000) return doc;

  // 2) keep only the first server
  if (Array.isArray(doc.episodes) && doc.episodes.length > 1) {
    doc.episodes = [doc.episodes[0]];
  }
  return doc;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const docs = Array.isArray(raw) ? raw : [raw];
  const items = docs.map(toMovieItem);
  console.log(`Seeding ${items.length} movies into ${TABLE}...`);

  // DynamoDB BatchWrite accepts max 25 items per request
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    await client.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE]: batch.map((Item) => ({ PutRequest: { Item } })),
      },
    }));
    console.log(`  wrote ${Math.min(i + 25, items.length)}/${items.length}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
