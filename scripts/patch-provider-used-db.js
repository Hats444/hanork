'use strict';

const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '../src/config/database-sqlite.js');
let text = fs.readFileSync(file, 'utf8');

if (!text.includes('provider_used')) {
    text = text.replace(
        "'CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_tenant ON affiliate_commissions(tenant_id)',\n    ];",
        "'CREATE INDEX IF NOT EXISTS idx_affiliate_commissions_tenant ON affiliate_commissions(tenant_id)',\n        \"ALTER TABLE smm_orders ADD COLUMN provider_used TEXT DEFAULT NULL\",\n    ];"
    );

    text = text.replace(
        `            INSERT INTO smm_orders (
                telegram_id, hanork_order_id, provider, provider_order_id, service_id,
                link, quantity, cost, sale_price, profit, status, refill_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        \`).run(
            String(row.telegram_id), row.hanork_order_id || null, row.provider || 'fornecedorbrasil',
            row.provider_order_id || null, row.service_id, row.link || '', row.quantity || 0,
            row.cost || 0, row.sale_price || 0, row.profit || 0, row.status || 'pending',
            row.refill_id || null
        );`,
        `            INSERT INTO smm_orders (
                telegram_id, hanork_order_id, provider, provider_used, provider_order_id, service_id,
                link, quantity, cost, sale_price, profit, status, refill_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        \`).run(
            String(row.telegram_id), row.hanork_order_id || null, row.provider || 'fornecedorbrasil',
            row.provider_used || null, row.provider_order_id || null, row.service_id, row.link || '',
            row.quantity || 0, row.cost || 0, row.sale_price || 0, row.profit || 0,
            row.status || 'pending', row.refill_id || null
        );`
    );

    text = text.replace(
        "if (extra.provider_order_id != null) { sets.push('provider_order_id = ?'); vals.push(extra.provider_order_id); }\n        if (extra.refill_id != null)",
        "if (extra.provider_order_id != null) { sets.push('provider_order_id = ?'); vals.push(extra.provider_order_id); }\n        if (extra.provider_used != null) { sets.push('provider_used = ?'); vals.push(extra.provider_used); }\n        if (extra.refill_id != null)"
    );

    fs.writeFileSync(file, text);
    console.log('patched', file);
} else {
    console.log('already has provider_used', file);
}
