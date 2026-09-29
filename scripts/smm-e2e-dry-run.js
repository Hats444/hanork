#!/usr/bin/env node
'use strict';

/**
 * Simula pagamento confirmado + fulfill com provider mock (sem API real).
 * Uso: node scripts/smm-e2e-dry-run.js [--telegram-id=999001]
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

process.env.SMM_ENABLED = '1';

const args = process.argv.slice(2);
const telegramId = args.find((a) => a.startsWith('--telegram-id='))?.split('=')[1] || '999001';

let ok = 0;
let fail = 0;
function assert(cond, msg) {
    if (cond) { ok++; console.log('  OK', msg); }
    else { fail++; console.log('  FAIL', msg); }
}

const mockProvider = {
    name: 'mock-dry-run',
    async createOrder({ serviceId, link, quantity }) {
        return { order: `DRY${Date.now()}`, serviceId, link, quantity };
    },
    async getBalance() {
        return { balance: 999, currency: 'BRL' };
    },
};

(async () => {
    console.log('\n=== SMM E2E dry-run (mock provider) ===\n');

    const { connect, prisma } = require('../src/config/database-sqlite');
    connect();

    const CatalogService = require('../src/modules/smm/services/catalogService');
    const { effectiveMinQuantity } = require('../src/modules/smm/services/pricingService');
    const SmmCheckoutService = require('../src/modules/smm/services/checkoutService');
    const SmmFulfillmentService = require('../src/modules/smm/services/fulfillmentService');
    const SmmOrderRepository = require('../src/modules/smm/repositories/smmOrderRepository');

    await CatalogService.warmCache?.();

    const list = CatalogService.listServices('Instagram', 'Seguidores', 0);
    const svc = list.items[0];
    assert(!!svc, 'serviço de amostra');
    const checkoutQty = effectiveMinQuantity(svc);

    const pendingStore = new Map();
    const ctx = { from: { id: Number(telegramId) }, chat: { type: 'private', id: Number(telegramId) } };
    const cartKey = (c) => c.from.id;

    const result = await SmmCheckoutService.createPaymentSession(
        ctx,
        {
            cartKey,
            comprasPendentes: {
                async get(k) { return pendingStore.get(String(k)) || null; },
                async set(k, v) { pendingStore.set(String(k), v); },
                async delete(k) { pendingStore.delete(String(k)); },
            },
            Menu: { pagamento: () => ({}) },
            getAffSaldo: async () => 0,
            checkCheckoutCooldown: async () => ({ allowed: true }),
            cuponsAplicados: { async get() { return null; } },
        },
        {
            serviceId: svc.id,
            link: 'https://instagram.com/dryrun_test',
            quantity: checkoutQty,
        }
    );

    assert(result.ok, 'checkout criado');
    const orderId = result.orderId;

    await prisma.order.update({
        where: { id: orderId },
        data: { status: 'PAID', payment_method: 'dry_run', paid_at: new Date().toISOString() },
    });

    const fulfill = await SmmFulfillmentService.fulfillHanorkOrder(orderId, null, {
        providerOverride: mockProvider,
    });

    assert(fulfill.ok, 'fulfill mock OK');
    assert(!!fulfill.providerOrderId, 'provider_order_id retornado');

    const row = SmmOrderRepository.findByHanorkOrderId(orderId);
    assert(!!row?.provider_order_id, 'provider_order_id no SQLite');
    assert(['submitted', 'processing', 'paid'].includes(row.status), `status=${row.status}`);

    console.log(`\n${ok} ok, ${fail} fail`);
    console.log(`Pedido: ${orderId}`);
    console.log(`Fornecedor (mock): ${row.provider_order_id}\n`);

    process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
