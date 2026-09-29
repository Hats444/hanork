const db = require('/home/vendetta/hanork/src/config/database-sqlite').connect();
const rows = db.prepare(
  "SELECT id, name, price FROM products WHERE category='wa_divulgacao' AND active=1 ORDER BY price"
).all();
console.log('plans:', rows.length);
rows.forEach((r) => console.log(r.id, r.name, r.price));
