#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    runPostSaleFollowUpCycle,
    DEFAULT_INTERVAL_MS,
} = require('../src/jobs/schedulers/postSaleFollowUpScheduler');

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
    console.log('\n=== Post-sale follow-up scheduler ===\n');

    await test('intervalo padrão 15 min', async () => {
        assert.strictEqual(DEFAULT_INTERVAL_MS, 15 * 60 * 1000);
    });

    await test('skip se bot não pronto', async () => {
        const r = await runPostSaleFollowUpCycle({
            bot: {},
            dbRaw: () => ({ prepare: () => ({ all: () => [] }) }),
            Markup: { inlineKeyboard: () => ({ reply_markup: {} }) },
            config: { LINKGP: 'x' },
            bannedUsers: new Set(),
            log: { info: () => {}, error: () => {} },
        });
        assert.strictEqual(r.skipped, 'bot_not_ready');
    });

    await test('marca post_sale_sent e envia', async () => {
        const updates = [];
        const sends = [];
        const db = {
            prepare(sql) {
                if (sql.includes('SELECT')) {
                    return { all: () => [{ id: 'o1', telegram_id: '99' }] };
                }
                return {
                    run(id) {
                        updates.push(id);
                    },
                };
            },
        };
        const r = await runPostSaleFollowUpCycle({
            bot: {
                botInfo: { id: 1 },
                telegram: {
                    sendMessage: async (tid, _text, _opts) => {
                        sends.push(tid);
                    },
                },
            },
            dbRaw: () => db,
            Markup: { inlineKeyboard: () => ({ reply_markup: {} }) },
            config: { LINKGP: 'https://t.me/g' },
            bannedUsers: new Set(),
            log: { info: () => {}, error: () => {} },
        });
        assert.strictEqual(r.sent, 1);
        assert.deepStrictEqual(updates, ['o1']);
        assert.deepStrictEqual(sends, [99]);
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — post-sale scheduler\n');
    process.exit(failed ? 1 : 0);
}

run();
