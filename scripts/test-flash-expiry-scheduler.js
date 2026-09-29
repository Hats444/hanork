#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    runFlashSaleExpiryCycle,
    _lastExpiredSales,
    DEFAULT_INTERVAL_MS,
} = require('../src/jobs/schedulers/flashSaleExpiryScheduler');

let failed = 0;
function test(name, fn) {
    return (async () => {
        try {
            await fn();
            console.log('  OK', name);
        } catch (e) {
            failed++;
            console.error('  FAIL', name + ':', e.message);
        }
    })();
}

async function run() {
    console.log('\n=== Flash sale expiry scheduler ===\n');
    _lastExpiredSales.clear();

    await test('intervalo padrão 5 min', async () => {
        assert.strictEqual(DEFAULT_INTERVAL_MS, 5 * 60 * 1000);
    });

    await test('notifica admin quando oferta expira', async () => {
        const messages = [];
        const prisma = {
            flashSale: {
                findAllActive: (() => {
                    let call = 0;
                    return () => {
                        call++;
                        return call === 1 ? [{ id: 7 }] : [];
                    };
                })(),
                expire: () => {},
            },
        };
        const r = await runFlashSaleExpiryCycle({
            bot: {
                botInfo: { id: 1 },
                telegram: {
                    sendMessage: async (aid, text) => {
                        messages.push({ aid, text });
                    },
                },
            },
            prisma,
            config: { ID_DONO: [111, 222] },
            log: { debug: () => {}, error: () => {} },
        });
        assert.strictEqual(r.notified, 2);
        assert.ok(messages[0].text.includes('#7'));
        _lastExpiredSales.clear();
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — flash expiry scheduler\n');
    process.exit(failed ? 1 : 0);
}

run();
