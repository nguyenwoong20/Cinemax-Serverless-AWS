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
const { toMovieItem } = require('../src/lib/movie-mapper');

const TABLE = process.env.MOVIES_TABLE || 'cinemax-movies';
const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/seed.js <movies.json>');
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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
