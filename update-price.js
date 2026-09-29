const sqlite3 = require('better-sqlite3');
const db = sqlite3('./hanork.db');

console.log('💰 Corrigindo preço da assinatura...\n');

const correctPrice = 29.90;
const id = 15;

const before = db.prepare('SELECT id, name, price FROM products WHERE id = ?').get(id);
console.log(`Antes: ${before.name} - R$ ${before.price}`);

db.prepare('UPDATE products SET price = ? WHERE id = ?').run(correctPrice, id);

const after = db.prepare('SELECT id, name, price FROM products WHERE id = ?').get(id);
console.log(`Depois: ${after.name} - R$ ${after.price}`);

console.log('\n✅ Preço corrigido para R$ 29,90/mês!');

db.close();
