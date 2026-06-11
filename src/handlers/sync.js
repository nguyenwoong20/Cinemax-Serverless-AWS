// Nightly movie sync. Triggered by EventBridge Scheduler.
// 1. Asks phimapi.com for recently updated movies
// 2. Upserts new/changed movies into DynamoDB (same mapping as the seed import)
// 3. Mirrors poster/thumbnail images into the project's S3 bucket
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { toMovieItem } = require('../lib/movie-mapper');

const TABLE = process.env.MOVIES_TABLE;
const BUCKET = process.env.POSTERS_BUCKET;
const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const PUBLIC_BASE = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;
const SOURCE = 'https://phimapi.com';
const PAGES = parseInt(process.env.SYNC_PAGES || '2', 10);

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'cinemax-sync/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function existingModifiedAt(slug) {
  const result = await db.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'slug-index',
    KeyConditionExpression: 'slug = :s',
    ExpressionAttributeValues: { ':s': slug },
    ProjectionExpression: 'modifiedAt',
    Limit: 1,
  }));
  const item = result.Items && result.Items[0];
  return item ? item.modifiedAt || '1970' : null;
}

async function mirrorImage(sourceUrl, key) {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${sourceUrl}`);
  const body = Buffer.from(await res.arrayBuffer());
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: res.headers.get('content-type') || 'image/jpeg',
    CacheControl: 'public, max-age=86400',
  }));
  return `${PUBLIC_BASE}/${key}`;
}

async function upsertMovie(slug) {
  const detail = await fetchJson(`${SOURCE}/phim/${slug}`);
  if (!detail.status || !detail.movie) throw new Error(`no detail for ${slug}`);

  // phimapi returns movie + episodes side by side; our document keeps them together
  const doc = { ...detail.movie, episodes: detail.episodes || [] };
  const item = toMovieItem(doc);

  // mirror images to S3 (best-effort: a dead source image must not block the sync)
  try {
    if (item.posterUrl) {
      item.posterUrl = await mirrorImage(item.posterUrl, `posters/${slug}-poster.jpg`);
      item.doc.poster_url = item.posterUrl;
    }
    if (item.thumbUrl) {
      item.thumbUrl = await mirrorImage(item.thumbUrl, `posters/${slug}-thumb.jpg`);
      item.doc.thumb_url = item.thumbUrl;
    }
  } catch (err) {
    console.warn(`image mirror failed for ${slug}: ${err.message}`);
  }

  await db.send(new PutCommand({ TableName: TABLE, Item: item }));
}

exports.handler = async () => {
  let added = 0, updated = 0, unchanged = 0, failed = 0;

  for (let page = 1; page <= PAGES; page++) {
    const list = await fetchJson(`${SOURCE}/danh-sach/phim-moi-cap-nhat?page=${page}`);
    for (const entry of list.items || []) {
      try {
        const sourceModified = (entry.modified && entry.modified.time) || '';
        const known = await existingModifiedAt(entry.slug);
        if (known === null) {
          await upsertMovie(entry.slug);
          added++;
          console.log(`added: ${entry.slug}`);
        } else if (sourceModified && sourceModified > known) {
          await upsertMovie(entry.slug);
          updated++;
          console.log(`updated: ${entry.slug}`);
        } else {
          unchanged++;
        }
      } catch (err) {
        failed++;
        console.error(`failed: ${entry.slug}: ${err.message}`);
      }
    }
  }

  const summary = { added, updated, unchanged, failed };
  console.log('Sync summary:', JSON.stringify(summary));
  return summary;
};
