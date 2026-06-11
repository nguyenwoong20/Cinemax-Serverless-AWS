// Mirror an external image into the project's S3 posters bucket.
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.POSTERS_BUCKET;
const REGION = process.env.AWS_REGION || 'ap-southeast-1';
const PUBLIC_BASE = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;

const s3 = new S3Client({});

async function mirrorImage(sourceUrl, key) {
  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(5000) });
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

module.exports = { mirrorImage, PUBLIC_BASE };
