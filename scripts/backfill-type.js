// One-off: copy doc.type up to a top-level `type` attribute on every movie
// so list endpoints can filter by movie type (single/series/hoathinh).
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
      ProjectionExpression: 'id, #tp, #doc.#tp',
      ExpressionAttributeNames: { '#tp': 'type', '#doc': 'doc' },
      ExclusiveStartKey,
    }));
    for (const item of page.Items) {
      const docType = item.doc && item.doc.type;
      if (docType && item.type !== docType) {
        await db.send(new UpdateCommand({
          TableName: TABLE,
          Key: { id: item.id },
          UpdateExpression: 'SET #tp = :t',
          ExpressionAttributeNames: { '#tp': 'type' },
          ExpressionAttributeValues: { ':t': docType },
        }));
        updated++;
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  console.log(`Done. updated=${updated}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
