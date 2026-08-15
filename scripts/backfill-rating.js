// One-off: copy doc.tmdb.vote_average/vote_count up to top-level rating/votes
// so the /hot endpoint can rank movies by audience score.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.MOVIES_TABLE || 'cinemax-movies';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-southeast-1' }));

async function main() {
  let ExclusiveStartKey;
  let updated = 0;
  do {
    const page = await db.send(new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: 'id, rating, #doc.tmdb',
      ExpressionAttributeNames: { '#doc': 'doc' },
      ExclusiveStartKey,
    }));
    for (const item of page.Items) {
      const tmdb = item.doc && item.doc.tmdb;
      const rating = (tmdb && tmdb.vote_average) || 0;
      const votes = (tmdb && tmdb.vote_count) || 0;
      if (item.rating === rating) continue;
      await db.send(new UpdateCommand({
        TableName: TABLE,
        Key: { id: item.id },
        UpdateExpression: 'SET rating = :r, votes = :v',
        ExpressionAttributeValues: { ':r': rating, ':v': votes },
      }));
      updated++;
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  console.log(`Done. updated=${updated}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
