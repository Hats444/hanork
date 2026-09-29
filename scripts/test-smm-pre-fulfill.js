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
const { assertFulfillAllowed } = require('../src/modules/smm/services/preFulfillGuard');
const SmmFulfillmentService = require('../src/modules/smm/services/fulfillmentService');
const SmmCheckoutService = require('../src/modules/smm/services/checkoutService');
const SmmOrderRepository = require('../src/modules/smm/repositories/smmOrderRepository');
const SmmServiceRepository = require('../src/modules/smm/repositories/smmServiceRepository');
const { effectiveMinQuantity } = require('../src/modules/smm/services/pricingService');

const mockLowBalance = {
    name: 'mock-low-balance',
    async getBalance() {
        return { balance: 0.01 };
    },
    async createOrder() {
        return { order: 'should-not-run' };
    },
};

(async () => {
    console.log('\n=== SMM pre-fulfill guard (V2 onda E) ===\n');

    connect();

    const svc = SmmServiceRepository.listAllByPlatformSub('Instagram', 'Seguidores')[0];
    assert(!!svc, 'fixture service');

    const blocked = await assertFulfillAllowed({
        provider: mockLowBalance,
        candidates: [svc],
        quantity: svc.min_quantity,
    });
    assert(!blocked.ok && blocked.reason === 'insufficient_provider_balance', 'blocks low balance');

    const mockOkBalance = {
        async getBalance() { return { balance: 50 }; },
    };
    const expensiveTail = { ...svc, id: 99999999, cost_price: 999 };
    const withOutlier = await assertFulfillAllowed({
        provider: mockOkBalance,
        candidates: [svc, expensiveTail],
        quantity: svc.min_quantity,
    });
    assert(withOutlier.ok, 'balance check uses first candidate only (not max family)');

    const pendingStore = new Map();
    const telegramId = '999003';
    const ctx = { from: { id: Number(telegramId) }, chat: { type: 'private', id: Number(telegramId) } };
    const qty = effectiveMinQuantity(svc);

    const checkout = await SmmCheckoutService.createPaymentSession(
        ctx,
        {
            cartKey: (c) => c.from.id,
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
        { serviceId: svc.id, link: 'https://instagram.com/prefulfill_test', quantity: qty }
    );
    assert(checkout.ok, 'checkout ok');

    await prisma.order.update({
        where: { id: checkout.orderId },
        data: { status: 'PAID', payment_method: 'test', paid_at: new Date().toISOString() },
    });

    const bot = { telegram: { sendMessage: async () => {} } };
    const result = await SmmFulfillmentService.fulfillHanorkOrder(checkout.orderId, bot, {
        providerOverride: mockLowBalance,
    });
    assert(!result.ok && result.reason === 'insufficient_provider_balance', 'fulfill blocked by guard');

    const row = SmmOrderRepository.findByHanorkOrderId(checkout.orderId);
    assert(row.status === 'failed', 'order marked failed');

    const events = prisma.smmOrderEvent.listByOrder(row.id, 10);
    assert(events.some((e) => e.event_type === 'SMM_BALANCE_BLOCK'), 'SMM_BALANCE_BLOCK event logged');

    console.log(`\n${ok} ok, ${fail} fail\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
