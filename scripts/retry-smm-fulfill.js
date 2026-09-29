'use strict';

const path = require('path');
const hanorkRoot = path.join(__dirname, '..');
process.chdir(hanorkRoot);

require('dotenv').config({ path: path.join(hanorkRoot, '.env') });

const hanorkOrderId = process.argv[2] || 'dfe8dc46-d512-43bd-9cb0-7dee7872b5b6';

const Database = require('better-sqlite3');
const dbPath = process.env.HANORK_DB_PATH
    ? process.env.HANORK_DB_PATH.replace(/^~/, require('os').homedir())
    : path.join(require('os').homedir(), '.hanork', 'hanork.db');
process.env.HANORK_DB_PATH = dbPath;
const db = new Database(dbPath);

const smm = db.prepare('SELECT * FROM smm_orders WHERE hanork_order_id = ?').get(hanorkOrderId);
if (!smm) {
  console.error('SMM order not found for', hanorkOrderId);
  process.exit(1);
}
console.log('Before:', { id: smm.id, status: smm.status, provider_order_id: smm.provider_order_id });

if (smm.provider_order_id) {
  console.log('Already has provider order — nothing to do');
  process.exit(0);
}

db.prepare("UPDATE smm_orders SET status = 'paid', updated_at = datetime('now') WHERE id = ?").run(smm.id);
db.close();

const SmmFulfillmentService = require(path.join(hanorkRoot, 'src/modules/smm/services/fulfillmentService'));

(async () => {
  const result = await SmmFulfillmentService.fulfillHanorkOrder(hanorkOrderId, null);
  console.log('Fulfill result:', JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
