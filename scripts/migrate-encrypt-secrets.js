#!/usr/bin/env node
'use strict';

/**
 * Criptografa token_mp e token_telegram dos tenants que ainda estão em texto claro.
 * Requer ENCRYPTION_KEY no .env (mín. 16 chars; produção: 32+).
 */
require('../src/config/env');

const secretCrypto = require('../src/modules/security/secretCrypto');

if (!secretCrypto.hasEncryptionKey()) {
    console.error('Defina ENCRYPTION_KEY no .env (mín. 16 caracteres) antes de migrar.');
    process.exit(1);
}

const db = require('../src/config/database-sqlite').connect();
const rows = db.prepare('SELECT id, slug, token_mp, token_telegram FROM tenants').all();
let updated = 0;

for (const row of rows) {
    const fields = {};
    if (row.token_mp && !secretCrypto.isEncrypted(row.token_mp)) {
        fields.token_mp = secretCrypto.encrypt(row.token_mp);
    }
    if (row.token_telegram && !secretCrypto.isEncrypted(row.token_telegram)) {
        fields.token_telegram = secretCrypto.encrypt(row.token_telegram);
    }
    if (!Object.keys(fields).length) continue;
    const sets = Object.keys(fields).map((k) => `${k}=?`).join(', ');
    db.prepare(`UPDATE tenants SET ${sets}, updated_at=datetime('now') WHERE id=?`).run(
        ...Object.values(fields),
        row.id
    );
    console.log(`  OK tenant #${row.id} (${row.slug})`);
    updated++;
}

console.log(updated ? `\nMigrados: ${updated} tenant(s)\n` : '\nNada a migrar — tokens já criptografados ou vazios.\n');
