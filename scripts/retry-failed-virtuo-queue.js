#!/usr/bin/env node
'use strict';
const root = require('path').join(__dirname, '..');
process.chdir(root);
require('dotenv').config({ path: require('path').join(root, '.env') });

const Queue = require('bull');
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const filter = new Set(process.argv.slice(2));

(async () => {
    const q = new Queue('virtuo:fulfill', REDIS_URL);
    const failed = await q.getFailed();
    let retried = 0;
    for (const job of failed) {
        const oid = job?.data?.orderId;
        if (filter.size && !filter.has(oid)) continue;
        await job.retry();
        console.log('retried', job.id, oid);
        retried++;
    }
    console.log('done', { retried, totalFailed: failed.length });
    await q.close();
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
