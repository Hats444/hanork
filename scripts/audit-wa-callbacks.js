'use strict';
const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '../src/plugins/zero-divu'),
  path.join(__dirname, '../src/telegram/menus'),
  path.join(__dirname, '../src/telegram/admin'),
  path.join(__dirname, '../src/modules/wa-divulgacao/handlers'),
];

const callbacks = new Set();
const handlers = new Set();

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) scanDir(p);
    else if (ent.name.endsWith('.js')) scanFile(p);
  }
}

function scanFile(file) {
  const s = fs.readFileSync(file, 'utf8');
  let m;
  const cbRe = /callback_data:\s*['"]([^'"]+)['"]/g;
  while ((m = cbRe.exec(s))) callbacks.add(m[1]);
  const actRe = /bot\.action\(\s*(?:['"]([^'"]+)['"]|\/(\^[^$]+\$)\/[gimsuy]*)/g;
  while ((m = actRe.exec(s))) {
    if (m[1]) handlers.add(m[1]);
    else if (m[2]) handlers.add(m[2]);
  }
}

for (const r of roots) scanDir(r);

const prefixes = ['a_wa', 'a_divulgacao', 'a_foto_promo', 'a_ops', 'a_wadv'];
const waCallbacks = [...callbacks].filter((c) => prefixes.some((p) => c.startsWith(p))).sort();

function hasHandler(cb) {
  if (handlers.has(cb)) return true;
  if (cb.startsWith('a_wa_help')) return true;
  if (cb.startsWith('a_wadv_')) {
    for (const h of handlers) {
      if (!h.startsWith('^')) continue;
      try {
        if (new RegExp(h).test(cb)) return true;
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

const missing = waCallbacks.filter((c) => !hasHandler(c));

console.log('Handlers registered:', [...handlers].filter((h) => prefixes.some((p) => h.startsWith(p))).sort().join('\n  '));
console.log('\nCallbacks without handler:');
for (const c of missing) console.log('  -', c);

process.exit(missing.length ? 1 : 0);
