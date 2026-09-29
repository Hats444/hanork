#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    localReportDate,
    msUntilNextRun,
    enqueueDailyReport,
    DAY_MS,
} = require('../src/jobs/schedulers/dailyReportScheduler');

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
    console.log('\n=== Daily report scheduler ===\n');

    await test('DAY_MS = 24h', async () => {
        assert.strictEqual(DAY_MS, 24 * 60 * 60 * 1000);
    });

    await test('localReportDate respeita offset', async () => {
        const d = localReportDate(-3);
        assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
    });

    await test('msUntilNextRun retorna valor positivo', async () => {
        const ms = msUntilNextRun(21, -3);
        assert.ok(ms > 0 && ms <= 24 * 60 * 60 * 1000);
    });

    await test('enqueueDailyReport chama QueueService por admin', async () => {
        const added = [];
        const log = { info: () => {}, warn: () => {} };
        const r = await enqueueDailyReport({
            QueueService: {
                add: async (name, data, opts) => {
                    added.push({ name, data, opts });
                    return { id: '1' };
                },
            },
            adminIds: [111, 222],
            log,
            tzOffset: -3,
        });
        assert.strictEqual(added.length, 2);
        assert.strictEqual(added[0].name, 'report:daily');
        assert.strictEqual(r.enqueued, 2);
    });

    await test('enqueue ignora job duplicado', async () => {
        const log = { info: () => {}, warn: () => {} };
        const r = await enqueueDailyReport({
            QueueService: {
                add: async () => {
                    throw new Error('Job report-daily-2020-01-01-111 already exists');
                },
            },
            adminIds: [111],
            log,
            tzOffset: 0,
        });
        assert.strictEqual(r.enqueued, 0);
    });

    console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — daily report scheduler\n');
    process.exit(failed ? 1 : 0);
}

run();
