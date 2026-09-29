#!/usr/bin/env node
'use strict';

/**
 * Diagnóstico pós-teste PIX E2E SMM.
 * Uso: node scripts/smm-e2e-check.js [--last=5] [--order=UUID]
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const args = process.argv.slice(2);
const lastN = parseInt(args.find((a) => a.startsWith('--last='))?.split('=')[1] || '5', 10);
const orderFilter = args.find((a) => a.startsWith('--order='))?.split('=')[1] || null;

const { connect, prisma } = require('../src/config/database-sqlite');
const SmmOrderRepository = require('../src/modules/smm/repositories/smmOrderRepository');

function row(label, value) {
    const v = value == null || value === '' ? '—' : String(value);
    console.log(`  ${label.padEnd(22)} ${v}`);
}

function printSmmOrder(o, hanork) {
    console.log(`\n── smm_orders #${o.id} ──`);
    row('status', o.status);
    row('hanork_order_id', o.hanork_order_id);
    row('provider_order_id', o.provider_order_id);
    row('telegram_id', o.telegram_id);
    row('service_id', o.service_id);
    row('quantity', o.quantity);
    row('link', (o.link || '').slice(0, 60));
    row('sale_total', o.sale_total);
    row('cost_total', o.cost_total);
    row('created_at', o.created_at);
    row('updated_at', o.updated_at);
    if (hanork) {
        console.log('  ── orders (Hanork) ──');
        row('orders.status', hanork.status);
        row('orders.total', hanork.total);
        row('orders.payment_id', hanork.payment_id);
    }
    const ok =
        o.provider_order_id &&
        ['submitted', 'processing', 'partial', 'completed'].includes(o.status);
    console.log(ok ? '  ✅ E2E OK (fornecedor recebeu pedido)' : '  ⏳ Aguardando fulfill ou PIX');
}

(async () => {
    console.log('\n=== SMM PIX E2E — diagnóstico ===\n');
    console.log('SMM_ENABLED=', process.env.SMM_ENABLED || '0');

    connect();

    if (process.env.SMM_ENABLED !== '1') {
        console.warn('\n⚠️  SMM_ENABLED≠1 — módulo pode estar desligado.\n');
    }

    if (process.env.FORNECEDOR_BRASIL_API_KEY) {
        try {
            const { getProvider } = require('../src/modules/smm/providers/providerRegistry');
            const provider = getProvider();
            const bal = await provider.getBalance();
            const amount = bal?.balance ?? bal?.amount ?? JSON.stringify(bal).slice(0, 80);
            console.log(`Saldo fornecedor: ${amount} ${bal?.currency || 'BRL'}\n`);
        } catch (e) {
            console.warn('Saldo fornecedor: erro —', e.message, '\n');
        }
    } else {
        console.warn('FORNECEDOR_BRASIL_API_KEY ausente no .env\n');
    }

    const stats = SmmOrderRepository.stats();
    const db = connect();
    const withProvider = db
        .prepare('SELECT COUNT(*) as c FROM smm_orders WHERE provider_order_id IS NOT NULL')
        .get().c;
    console.log(`Pedidos SMM: total=${stats.total} · com provider_id=${withProvider}`);

    let rows;
    if (orderFilter) {
        const one = SmmOrderRepository.findByHanorkOrderId(orderFilter);
        rows = one ? [one] : [];
        if (!rows.length) {
            const byId = SmmOrderRepository.findById(parseInt(orderFilter, 10));
            if (byId) rows = [byId];
        }
    } else {
        rows = connect()
            .prepare(`SELECT * FROM smm_orders ORDER BY id DESC LIMIT ?`)
            .all(lastN);
    }

    if (!rows.length) {
        console.log('\nNenhum pedido SMM encontrado. Faça o teste no Telegram primeiro.\n');
        process.exit(0);
    }

    for (const o of rows) {
        let hanork = null;
        try {
            hanork = await prisma.order.findUnique({ where: { id: o.hanork_order_id } });
        } catch {
            /* ignore */
        }
        printSmmOrder(o, hanork);
    }

    console.log('\nLogs úteis (produção):');
    console.log('  tail -F ~/.hanork/terminal.log | grep -E "WEBHOOK|SMM:fulfill|smm:fulfill"');
    console.log('\n');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
