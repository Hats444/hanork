#!/usr/bin/env node
'use strict';

const assert = require('assert');
const secretCrypto = require('../src/modules/security/secretCrypto');
const CouponAttemptLimiter = require('../src/modules/security/couponAttemptLimiter');
const { validateSecurityEnv, isStrict } = require('../src/config/securityEnv');

let failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('  OK', name);
    } catch (e) {
        failed++;
        console.error('  FAIL', name + ':', e.message);
    }
}

const saved = { ...process.env };

function restore() {
    process.env = { ...saved };
}

console.log('\n=== Security suite ===\n');

test('encrypt/decrypt roundtrip', () => {
    process.env.ENCRYPTION_KEY = 'test-key-32-chars-minimum!!!!!!';
    const plain = 'APP_USR-fake-token-12345';
    const enc = secretCrypto.encrypt(plain);
    assert.ok(secretCrypto.isEncrypted(enc));
    assert.strictEqual(secretCrypto.decrypt(enc), plain);
});

test('sem ENCRYPTION_KEY devolve plain', () => {
    delete process.env.ENCRYPTION_KEY;
    assert.strictEqual(secretCrypto.encrypt('hello'), 'hello');
});

test('coupon limiter bloqueia após falhas', () => {
    const lim = new CouponAttemptLimiter({ maxFails: 3, lockMs: 5000, windowMs: 60000 });
    assert.strictEqual(lim.check(99).allowed, true);
    lim.recordFail(99);
    lim.recordFail(99);
    lim.recordFail(99);
    const r = lim.check(99);
    assert.strictEqual(r.allowed, false);
    assert.ok(r.retryAfter > 0);
});

test('coupon success limpa estado', () => {
    const lim = new CouponAttemptLimiter({ maxFails: 2 });
    lim.recordFail(1);
    lim.recordSuccess(1);
    assert.strictEqual(lim.check(1).allowed, true);
});

test('isStrict em produção por padrão', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SECURITY_STRICT;
    assert.strictEqual(isStrict(), true);
});

test('SECURITY_STRICT=false relaxa', () => {
    process.env.SECURITY_STRICT = 'false';
    assert.strictEqual(isStrict(), false);
});

test('QW-6 JWT não aceita query token', () => {
    const { extractToken } = require('../src/modules/auth/authMiddleware');
    process.env.ALLOW_JWT_QUERY = '1';
    const req = { headers: {}, cookies: {}, query: { token: 'leaked-secret' } };
    assert.strictEqual(extractToken(req), null);
});

test('produção + Zero Divu exige IPC auth', () => {
    const prev = { ...process.env };
    process.env.NODE_ENV = 'production';
    process.env.SECURITY_STRICT = 'false';
    process.env.ZERO_DIVU_ENABLED = 'true';
    delete process.env.ZERO_IPC_AUTH_REQUIRED;
    delete process.env.ZERO_IPC_TOKEN;
    const r = validateSecurityEnv();
    assert.ok(r.errors.some((e) => e.includes('ZERO_IPC_AUTH_REQUIRED')));
    assert.ok(r.errors.some((e) => e.includes('ZERO_IPC_TOKEN')));
    process.env = prev;
});

test('produção WSL baixa RAM bloqueia USE_LOCAL_AI=1', () => {
    const prev = { ...process.env };
    const localAiPolicy = require('../src/config/localAiPolicy');
    const origIsWsl = localAiPolicy.isWsl;
    const origMem = localAiPolicy.memStatsMb;
    localAiPolicy.isWsl = () => true;
    localAiPolicy.memStatsMb = () => ({ total: 3800, free: 900 });
    process.env.NODE_ENV = 'production';
    process.env.SECURITY_STRICT = 'false';
    process.env.USE_LOCAL_AI = 'true';
    const r = validateSecurityEnv();
    assert.ok(r.errors.some((e) => e.includes('USE_LOCAL_AI deve ser false')));
    localAiPolicy.isWsl = origIsWsl;
    localAiPolicy.memStatsMb = origMem;
    process.env = prev;
});

test('produção com painel exige DASHBOARD_TENANT_ENFORCE=1', () => {
    const prev = { ...process.env };
    process.env.NODE_ENV = 'production';
    process.env.SECURITY_STRICT = 'false';
    process.env.DASHBOARD_PASS_HASH = '$2b$10$abcdefghijklmnopqrstuv';
    process.env.DASHBOARD_JWT_SECRET = 'x'.repeat(32);
    process.env.ENCRYPTION_KEY = 'y'.repeat(32);
    delete process.env.DASHBOARD_TENANT_ENFORCE;
    const r = validateSecurityEnv();
    assert.ok(r.errors.some((e) => e.includes('DASHBOARD_TENANT_ENFORCE')));
    process.env = prev;
});

restore();

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — security suite\n');
process.exit(failed ? 1 : 0);
