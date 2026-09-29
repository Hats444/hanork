#!/usr/bin/env node
'use strict';

/**
 * Smoke: createExpressApp monta rotas sem subir listen.
 */
const assert = require('assert');

process.env.NODE_ENV = 'development';

const { createExpressApp } = require('../src/app/createServer');

const app = createExpressApp({
    bot: { telegram: {} },
    prisma: {},
    logger: {
        info() {},
        warn() {},
        error() {},
        webhook() {},
        webhookRejected() {},
    },
    deferBackground: (_name, fn) => fn().catch(() => {}),
    webhookPaymentDedup: { has: () => false, markProcessed() {}, recordMemoryDedup() {} },
});

assert.ok(app && typeof app.listen === 'function', 'express app');
assert.ok(typeof app.handle === 'function', 'express handler');

console.log('OK — createServer smoke');
process.exit(0);
