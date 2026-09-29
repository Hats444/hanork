'use strict';

/**
 * Utilitários compartilhados — webhook MP e callback check_ (legado).
 */

function mpAmountMatchesOrder(mpPayment, order) {
    const paid = Number(mpPayment?.transaction_amount);
    const expected = Number(order?.total);
    if (!Number.isFinite(paid) || !Number.isFinite(expected)) return false;
    return Math.abs(paid - expected) <= 0.02;
}

async function orderBelongsToUser(prisma, order, telegramId) {
    const user = await prisma.user.findUnique({ where: { telegram_id: String(telegramId) } });
    return !!(user && order.user_id === user.id);
}

async function _enrichPayment(mpApi, mpPayment) {
    if (mpPayment?.id && !mpPayment.transaction_amount) {
        return mpApi.status(mpPayment.id);
    }
    return mpPayment;
}

async function _readMpPreferenceFromKv(orderId) {
    if (!orderId) return null;
    try {
        const { connect } = require('../../config/database-sqlite');
        const row = connect()
            .prepare('SELECT value FROM kv_store WHERE key=?')
            .get(`order_mp_pref:${orderId}`);
        return row?.value ? String(row.value) : null;
    } catch {
        return null;
    }
}

/** Busca pagamento MP vinculado ao pedido (approved, in_process ou pending). */
async function resolveMpPaymentForOrder(order, pending, mpApi) {
    let mpPayment = null;
    if (order.payment_id) {
        mpPayment = await mpApi.status(order.payment_id);
    }
    if (!mpPayment && pending?.paymentId) {
        mpPayment = await mpApi.status(pending.paymentId);
    }
    let prefId = pending?.mpPreferenceId || null;
    if (!prefId && order?.id) {
        prefId = await _readMpPreferenceFromKv(order.id);
    }
    if (!mpPayment && prefId && typeof mpApi.searchByPreference === 'function') {
        mpPayment = await _enrichPayment(mpApi, await mpApi.searchByPreference(prefId));
    }
    if (!mpPayment && order.external_reference) {
        mpPayment = await _enrichPayment(mpApi, await mpApi.search(order.external_reference));
    }
    if (!mpPayment && order.id && order.id !== order.external_reference) {
        mpPayment = await _enrichPayment(mpApi, await mpApi.search(order.id));
    }
    return mpPayment;
}

module.exports = {
    mpAmountMatchesOrder,
    orderBelongsToUser,
    resolveMpPaymentForOrder,
};
