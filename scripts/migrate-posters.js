/**
 * Migrate movie poster/thumbnail images from third-party hosting (phimimg.com)
 * to the project's S3 bucket, then point DynamoDB records at the S3 URLs.
 *
 * Usage: node scripts/migrate-posters.js
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const TABLE = process.env.MOVIES_TABLE || 'cinemax-movies';
const BUCKET = process.env.POSTERS_BUCKET || 'cinemax-posters-080705554161';
const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const PUBLIC_BASE = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3 = new S3Client({ region: REGION });

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

async function migrateMovie(item) {
  const updates = {};

  if (item.posterUrl && !item.posterUrl.startsWith(PUBLIC_BASE)) {
    updates.posterUrl = await mirrorImage(item.posterUrl, `posters/${item.slug}-poster.jpg`);
  }
  const thumbSrc = item.thumbUrl;
  if (thumbSrc && !thumbSrc.startsWith(PUBLIC_BASE)) {
    updates.thumbUrl = await mirrorImage(thumbSrc, `posters/${item.slug}-thumb.jpg`);
  }
  if (Object.keys(updates).length === 0) return false;

  // keep both the list-card fields and the original detail document in sync
  const names = { '#doc': 'doc' };
  const values = {};
  const sets = [];
  if (updates.posterUrl) {
    sets.push('posterUrl = :p', '#doc.poster_url = :p');
    values[':p'] = updates.posterUrl;
  }
  if (updates.thumbUrl) {
    sets.push('thumbUrl = :t', '#doc.thumb_url = :t');
    values[':t'] = updates.thumbUrl;
  }
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { id: item.id },
    UpdateExpression: 'SET ' + sets.join(', '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
  return true;
}

async function main() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: 'id, slug, posterUrl, thumbUrl',
      ExclusiveStartKey,
    }));
    items.push(...page.Items);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  console.log(`Found ${items.length} movies. Mirroring images to s3://${BUCKET}/posters/ ...`);

  let done = 0, failed = 0, skipped = 0;
  const queue = [...items];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        const changed = await migrateMovie(item);
        changed ? done++ : skipped++;
      } catch (err) {
        failed++;
        console.error(`  FAIL ${item.slug}: ${err.message}`);
      }
      const total = done + failed + skipped;
      if (total % 25 === 0) console.log(`  progress: ${total}/${items.length}`);
    }
  });
  await Promise.all(workers);

  console.log(`Done. migrated=${done} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
