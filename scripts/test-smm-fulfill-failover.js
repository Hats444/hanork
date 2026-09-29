#!/usr/bin/env node
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

process.env.SMM_ENABLED = '1';

let ok = 0;
let fail = 0;

function assert(cond, msg) {
    if (cond) { ok++; console.log('  OK', msg); }
    else { fail++; console.log('  FAIL', msg); }
}

const { connect, prisma } = require('../src/config/database-sqlite');
const { resolveFulfillCandidates } = require('../src/modules/smm/services/familyResolverService');
const SmmFulfillmentService = require('../src/modules/smm/services/fulfillmentService');
const SmmCheckoutService = require('../src/modules/smm/services/checkoutService');
const SmmOrderRepository = require('../src/modules/smm/repositories/smmOrderRepository');
const SmmServiceRepository = require('../src/modules/smm/repositories/smmServiceRepository');
const { effectiveMinQuantity } = require('../src/modules/smm/services/pricingService');

const FAIL_PROVIDER_ID = 99999901;
const OK_PROVIDER_ID = 99999902;

const mockProvider = {
    name: 'mock-failover',
    async createOrder({ serviceId, link, quantity }) {
        if (String(serviceId) === String(FAIL_PROVIDER_ID)) {
            return { error: true, message: 'mock reject first' };
        }
        return { order: `FO${Date.now()}`, serviceId, link, quantity };
    },
};

(async () => {
    console.log('\n=== SMM fulfill failover (V2 onda B) ===\n');

    connect();

    const family = 'test_failover_family_b';
    const db = connect();
    const del = db.prepare('DELETE FROM smm_services WHERE provider_service_id IN (?, ?)').run(
        FAIL_PROVIDER_ID,
        OK_PROVIDER_ID
    );

    const insert = db.prepare(`
        INSERT INTO smm_services (
            provider, provider_service_id, platform, subcategory, name, service_type,
            cost_price, sale_price, min_quantity, max_quantity, refill, cancel, dripfeed,
            active, service_family, service_score
        ) VALUES ('fornecedorbrasil', ?, 'Instagram', 'Seguidores', ?, 'Default',
            ?, ?, 10, 5000, 1, 0, 0, 1, ?, ?)
    `);

    insert.run(FAIL_PROVIDER_ID, 'Failover Test Low', 5, 12, family, 90);
    insert.run(OK_PROVIDER_ID, 'Failover Test Best', 4, 11, family, 60);

    const ordered = SmmServiceRepository.findByProviderId('fornecedorbrasil', FAIL_PROVIDER_ID);
    const backup = SmmServiceRepository.findByProviderId('fornecedorbrasil', OK_PROVIDER_ID);
    assert(!!ordered && !!backup, 'fixture services');

    const candidates = resolveFulfillCandidates(ordered, 50);
    assert(candidates.length >= 2, 'two family candidates');
    assert(candidates[0].id === ordered.id, 'ordered service tried first');

    const pendingStore = new Map();
    const telegramId = '999002';
    const ctx = { from: { id: Number(telegramId) }, chat: { type: 'private', id: Number(telegramId) } };
    const cartKey = (c) => c.from.id;
    const qty = effectiveMinQuantity(ordered);

    const checkout = await SmmCheckoutService.createPaymentSession(
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
            serviceId: ordered.id,
            link: 'https://instagram.com/failover_test',
            quantity: qty,
        }
    );
    assert(checkout.ok, 'checkout ok');

    await prisma.order.update({
        where: { id: checkout.orderId },
        data: { status: 'PAID', payment_method: 'test', paid_at: new Date().toISOString() },
    });

    const fulfill = await SmmFulfillmentService.fulfillHanorkOrder(checkout.orderId, null, {
        providerOverride: mockProvider,
    });

    assert(fulfill.ok, 'failover fulfill ok');
    assert(fulfill.usedServiceId === backup.id, 'used backup service');

    const row = SmmOrderRepository.findByHanorkOrderId(checkout.orderId);
    assert(row.service_id === backup.id, 'smm_orders.service_id updated');
    assert(!!row.provider_order_id, 'provider_order_id set');

    const events = prisma.smmOrderEvent.listByOrder(row.id, 10);
    assert(events.some((e) => e.event_type === 'SMM_FAILOVER'), 'SMM_FAILOVER event logged');
    assert(events.some((e) => e.event_type === 'SMM_ORDER'), 'SMM_ORDER event logged');

    db.prepare('DELETE FROM smm_services WHERE provider_service_id IN (?, ?)').run(
        FAIL_PROVIDER_ID,
        OK_PROVIDER_ID
    );

    console.log(`\n${ok} ok, ${fail} fail\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
