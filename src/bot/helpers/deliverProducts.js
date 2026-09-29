'use strict';

/**
 * Reenvio manual de produtos (admin) — extraído de bot.js (move-only).
 */
async function deliverProducts(ctxOrTelegram, chatId, items, deps) {
    const { CONFIG, logger, UserEmailService, monitor } = deps;
    const tg = ctxOrTelegram?.telegram || ctxOrTelegram;
    const DeliveryService = require('../../modules/delivery/DeliveryService');

    try {
        const results = await DeliveryService.deliver(tg, chatId, items, { resend: true });
        for (const r of results) {
            if (!r.success) {
                monitor.alertDeliveryFailure(chatId, items[0]?.order_id || 'N/A', r.name || 'Produto', r.error || 'falha');
            }
        }
        if (results.some((r) => r.success)) {
            await tg.sendMessage(chatId, '🔄 <b>Produto reenviado!</b>', { parse_mode: 'HTML' });
        }
    } catch (e) {
        logger.error('[DELIVERY] deliverProducts:', e.message);
        await tg.sendMessage(
            chatId,
            `<b>❌ Erro na entrega</b>\n\nPagamento confirmado, mas houve falha ao enviar.\nEntre em contato: ${CONFIG.CONTATO_ESPECIALISTA}`,
            { parse_mode: 'HTML' }
        );
        throw e;
    }

    const orderRef = items[0]?.order_id ? String(items[0].order_id).slice(-8) : '';
    UserEmailService.sendDeliveryEmail(chatId, items, orderRef).catch((e) => {
        logger.warn('[Email] delivery copy failed:', e.message);
    });
}

module.exports = { deliverProducts };
