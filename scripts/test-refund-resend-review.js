#!/usr/bin/env node
'use strict';

const assert = require('assert');
const RefundService = require('../src/services/RefundService');
const ResendService = require('../src/services/ResendService');
const ReviewService = require('../src/services/ReviewService');

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

console.log('\n=== Refund ===\n');

test('isRefundedStatus FAILED e REFUNDED', () => {
    assert.strictEqual(RefundService.isRefundedStatus('FAILED'), true);
    assert.strictEqual(RefundService.isRefundedStatus('REFUNDED'), true);
    assert.strictEqual(RefundService.isRefundedStatus('PAID'), false);
});

test('buildConfirmKeyboard inclui refund_', () => {
    const kb = RefundService.buildConfirmKeyboard('order-xyz');
    const data = kb.reply_markup.inline_keyboard[0][0].callback_data;
    assert.strictEqual(data, 'refund_order-xyz');
});

console.log('\n=== Resend ===\n');

test('formatCooldownMessage inclui horas', () => {
    const msg = ResendService.formatCooldownMessage(3660000, new Date(Date.now() + 3660000));
    assert.ok(msg.includes('Disponível'));
    assert.ok(msg.includes('24h'));
});

test('buildResendListKeyboard respeita cooldown', () => {
    const orderId = 'ord-resend-test-001';
    const kb = ResendService.buildResendListKeyboard([
        { id: orderId, total: 10, created_at: new Date().toISOString() },
    ]);
    const row = kb.reply_markup.inline_keyboard[0][0];
    const onCd = ResendService.getCooldownInfo(orderId).onCooldown;
    if (onCd) {
        assert.ok(row.callback_data.startsWith('resend_cd_'));
    } else {
        assert.strictEqual(row.callback_data, `resend_${orderId}`);
    }
});

console.log('\n=== Review ===\n');

test('starsLabel limita 1-5', () => {
    assert.ok(ReviewService.starsLabel(5).startsWith('⭐⭐⭐⭐⭐'));
    assert.ok(ReviewService.starsLabel(0).includes('⭐'));
    assert.ok(ReviewService.starsLabel(99).startsWith('⭐⭐⭐⭐⭐'));
});

test('buildReviewKeyboard rate_*', () => {
    const kb = ReviewService.buildReviewKeyboard('ord-1');
    const flat = kb.reply_markup.inline_keyboard.flat();
    assert.ok(flat.some((b) => b.callback_data === 'rate_ord-1_5'));
    assert.ok(flat.some((b) => b.callback_data === 'rate_ord-1_1'));
});

test('buildPromptText menciona pedido', () => {
    const t = ReviewService.buildPromptText('abcdefghijklmnop');
    assert.ok(t.includes('klmnop'));
});

console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — refund / resend / review\n');
process.exit(failed ? 1 : 0);
