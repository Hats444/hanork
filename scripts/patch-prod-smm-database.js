'use strict';

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '../src/config/database-sqlite.js');
const DST = process.argv[3] || '/home/vendetta/hanork/src/config/database-sqlite.js';

function slice(text, start, end) {
    const a = text.indexOf(start);
    const b = text.indexOf(end, a);
    if (a < 0 || b < 0) throw new Error(`slice failed: ${start}`);
    return text.slice(a, b);
}

const src = fs.readFileSync(SRC, 'utf8');
let dst = fs.readFileSync(DST, 'utf8');

if (dst.includes('prisma.smmService')) {
    console.log('✓ já tem prisma.smmService');
    process.exit(0);
}

const block = slice(
    src,
    '// ─── SMM (FornecedorBrasil) ─────────────────────────────────────────────────',
    '// Estado em memória entre restarts (carrinhos legados em Map, compras pendentes, bans)'
);

const exportLine = 'module.exports = { prisma, connect, backup, migrateFromJSON, state, DB_PATH };';
dst = dst.replace(exportLine, `${block}${exportLine}`);

if (!dst.includes('provider_used')) {
    dst = dst.replace(
        "'CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_tenant ON affiliate_commissions(tenant_id)',\n    ];",
        "'CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_tenant ON affiliate_commissions(tenant_id)',\n        \"ALTER TABLE smm_orders ADD COLUMN provider_used TEXT DEFAULT NULL\",\n    ];"
    );
}

fs.writeFileSync(DST, dst, 'utf8');
console.log(`✅ patched ${DST}`);
