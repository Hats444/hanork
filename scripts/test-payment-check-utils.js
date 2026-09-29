#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    mpAmountMatchesOrder,
    orderBelongsToUser,
    resolveMpPaymentForOrder,
} = require('../src/modules/payment/paymentCheckUtils');

let failed = 0;
async function test(name, fn) {
    try {
        await fn();
        console.log('  OK', name);
    } catch (e) {
        failed++;
        console.error('  FAIL', name + ':', e.message);
    }
}

async function run() {
    console.log('\n=== Payment check utils ===\n');

    await test('mpAmountMatchesOrder tolera 0.02', async () => {
        assert.strictEqual(mpAmountMatchesOrder({ transaction_amount: 10 }, { total: 10.01 }), true);
        assert.strictEqual(mpAmountMatchesOrder({ transaction_amount: 10 }, { total: 10.03 }), false);
        assert.strictEqual(mpAmountMatchesOrder({ transaction_amount: NaN }, { total: 10 }), false);
    });

    await test('orderBelongsToUser', async () => {
        const prisma = {
            user: {
                findUnique: async ({ where }) =>
                    where.telegram_id === '99' ? { id: 7 } : null,
            },
        };
        assert.strictEqual(await orderBelongsToUser(prisma, { user_id: 7 }, 99), true);
        assert.strictEqual(await orderBelongsToUser(prisma, { user_id: 8 }, 99), false);
    });

    await test('resolveMpPaymentForOrder tenta payment_id e search', async () => {
        const calls = [];
        const mpApi = {
            status: async (id) => {
                calls.push(['status', id]);
                return id === 'pay-1' ? { id: 'pay-1', status: 'approved', transaction_amount: 50 } : null;
            },
            search: async (ref) => {
                calls.push(['search', ref]);
                return null;
            },
        };
        const pay = await resolveMpPaymentForOrder(
            { payment_id: 'pay-1', external_reference: 'ord-1', id: 'ord-1' },
            null,
            mpApi
        );
        assert.strictEqual(pay.status, 'approved');
        assert.ok(calls.some((c) => c[0] === 'status' && c[1] === 'pay-1'));
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — payment check utils\n');
    process.exit(failed ? 1 : 0);
}

run();
