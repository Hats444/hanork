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

const { connect } = require('../src/config/database-sqlite');
const CatalogService = require('../src/modules/smm/services/catalogService');
const SmmCheckoutService = require('../src/modules/smm/services/checkoutService');
const { isSmmHanorkOrder } = require('../src/modules/smm/helpers/smmPendingHelper');
const { assertCheckoutInput } = require('../src/modules/smm/validators/smmOrderValidator');
const { effectiveMinQuantity } = require('../src/modules/smm/services/pricingService');
const { CB } = require('../src/modules/smm/utils/smmCallbackData');

const pendingStore = new Map();

function mockCtx(telegramId = 999001) {
    return { from: { id: telegramId }, chat: { type: 'private', id: telegramId } };
}

(async () => {
    console.log('\n=== SMM Checkout (Onda C) ===\n');

    connect();
    await CatalogService.warmCache?.();

    assert(CB.confirmPay === 'smm:cp', 'confirmPay callback');

    const list = CatalogService.listServices('Instagram', 'Seguidores', 0);
    const svc = list.items.find((s) => {
        const qty = effectiveMinQuantity(s);
        return qty <= Number(s.max_quantity);
    }) || list.items[0];
    assert(!!svc, 'sample service for checkout');

    const checkoutQty = effectiveMinQuantity(svc);

    const badLink = assertCheckoutInput(svc, 'not-a-url', svc.min_quantity);
    assert(!badLink.ok, 'reject invalid link');

    const badQty = assertCheckoutInput(svc, 'https://instagram.com/test', 1);
    assert(!badQty.ok || checkoutQty <= 1, 'quantity validation');

    const uniqueLink = `https://instagram.com/testuser_${Date.now()}`;
    const good = assertCheckoutInput(svc, uniqueLink, checkoutQty);
    assert(good.ok, 'valid checkout input');

    const ctx = mockCtx();
    const cartKey = (c) => c.from.id;
    const comprasPendentes = {
        async get(k) { return pendingStore.get(String(k)) || null; },
        async set(k, v) { pendingStore.set(String(k), v); },
        async delete(k) { pendingStore.delete(String(k)); },
    };

    const result = await SmmCheckoutService.createPaymentSession(
        ctx,
        {
            cartKey,
            comprasPendentes,
            Menu: { pagamento: (oid) => ({ reply_markup: { inline_keyboard: [[{ callback_data: `pp_${oid}` }]] } }) },
            getAffSaldo: async () => 0,
            checkCheckoutCooldown: async () => ({ allowed: true }),
            cuponsAplicados: { async get() { return null; } },
        },
        {
            serviceId: svc.id,
            link: uniqueLink,
            quantity: checkoutQty,
        }
    );

    assert(result.ok === true, `createPaymentSession ok${result.ok ? '' : ` (${result.error})`}`);
    assert(!!result.orderId, 'orderId returned');
    assert(isSmmHanorkOrder(result.orderId), 'isSmmHanorkOrder true');

    const pending = await comprasPendentes.get(cartKey(ctx));
    assert(pending?.orderKind === 'smm', 'pending orderKind smm');
    assert(pending?.orderId === result.orderId, 'pending orderId match');

    const msg = SmmCheckoutService.buildPaymentMessage(result.orderId, svc, checkoutQty, result.total);
    assert(msg.includes('pagamento') || msg.includes('Pedido'), 'payment message');

    console.log(`\n${ok} ok, ${fail} fail\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
