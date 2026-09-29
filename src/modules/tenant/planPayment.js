'use strict';

const TenantService = require('./TenantService');
const logger = require('../../config/logger');
const { connect: dbConnect } = require('../../config/database-sqlite');

function planPaymentDedupeKey(paymentId) {
    return `plan_payment:${paymentId}`;
}

function isPlanPaymentProcessed(paymentId) {
    const db = dbConnect();
    if (!db || !paymentId) return false;
    return !!db.prepare('SELECT key FROM kv_store WHERE key = ?').get(planPaymentDedupeKey(paymentId));
}

function markPlanPaymentProcessed(paymentId, tenantId, planName) {
    const db = dbConnect();
    if (!db || !paymentId) return;
    db.prepare(
        `INSERT OR IGNORE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    ).run(planPaymentDedupeKey(paymentId), JSON.stringify({ tenantId, planName }));
}

/**
 * Webhook: external_reference plan_{tenantId}_{planName}
 */
async function processPlanPayment(paymentId, paymentData, bot) {
    if (paymentData.status !== 'approved') {
        return { processed: false, reason: 'not_approved' };
    }

    if (isPlanPaymentProcessed(paymentId)) {
        logger.info(`[PLAN] Payment ${paymentId} já processado — skip`);
        return { processed: false, reason: 'already_processed' };
    }

    const ref = paymentData.external_reference || '';
    const m = ref.match(/^plan_(\d+)_([a-zA-Z0-9_]+)$/);
    if (!m) return { processed: false, reason: 'invalid_plan_ref' };

    const tenantId = Number(m[1]);
    const planName = m[2];
    const tenant = TenantService.getById(tenantId);
    if (!tenant) return { processed: false, reason: 'tenant_not_found' };

    const plan = TenantService.getPlan(planName);
    if (!plan) return { processed: false, reason: 'plan_not_found' };

    const paid = Number(paymentData.transaction_amount);
    if (plan.price > 0 && Math.abs(paid - plan.price) > 0.05) {
        logger.error(`[PLAN] Valor divergente tenant=${tenantId}: esperado ${plan.price}, recebido ${paid}`);
        return { processed: false, reason: 'amount_mismatch' };
    }

    const expires = new Date();
    expires.setMonth(expires.getMonth() + 1);
    TenantService.assignPlan(tenantId, planName, expires.toISOString());
    markPlanPaymentProcessed(paymentId, tenantId, planName);

    try {
        await bot.telegram.sendMessage(
            tenant.owner_telegram_id,
            `✅ <b>Plano ${plan.label} ativado!</b>\n\n` +
                `Válido até: <code>${expires.toLocaleDateString('pt-BR')}</code>\n\n` +
                `Use /admin_loja para gerenciar sua loja.`,
            { parse_mode: 'HTML' }
        );
    } catch {
        /* ignore */
    }

    logger.info(`[PLAN] Tenant ${tenantId} upgraded to ${planName} via payment ${paymentId}`);
    return { processed: true, tenantId, plan: planName };
}

async function resolveTenantForWebhook(externalReference, order) {
    const TenantService = require('./TenantService');
    if (externalReference?.startsWith('plan_')) {
        const m = externalReference.match(/^plan_(\d+)_/);
        if (m) return TenantService.getById(Number(m[1]));
    }
    if (order?.tenant_id) return TenantService.getById(order.tenant_id);
    return null;
}

module.exports = { processPlanPayment, resolveTenantForWebhook };
