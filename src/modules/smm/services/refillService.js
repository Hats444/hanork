'use strict';

const ProviderManager = require('../providers/ProviderManager');
const SmmOrderRepository = require('../repositories/smmOrderRepository');
const SmmOrderEventsRepository = require('../repositories/smmOrderEventsRepository');
const SmmServiceRepository = require('../repositories/smmServiceRepository');
const { canRequestRefill } = require('../validators/smmActionValidator');
const { ORDER_STATUS } = require('../constants/orderStatuses');
const logger = require('../../../config/logger');
const { orderStatusNoticeKeyboard } = require('../keyboards/smmNoticeKeyboards');

function mapRefillStatus(raw) {
    if (!raw || raw.error) return null;
    const key = String(raw.status ?? raw.refill_status ?? raw.state ?? '').toLowerCase();
    if (key.includes('complete') || key === 'success') return 'completed';
    if (key.includes('reject') || key.includes('fail') || key.includes('cancel')) return 'rejected';
    return 'pending';
}

const SmmRefillService = {
    async requestRefill(smmOrder, service) {
        const check = canRequestRefill(smmOrder, service);
        if (!check.ok) return check;

        const provider = ProviderManager.getProviderForOrder(smmOrder);
        if (!provider?.createRefill) return { ok: false, error: 'provider_sem_refill' };

        SmmOrderEventsRepository.record(smmOrder.id, 'refill_request', smmOrder.provider_order_id);

        const raw = await provider.createRefill(smmOrder.provider_order_id);
        if (raw?.error) {
            SmmOrderEventsRepository.record(smmOrder.id, 'refill_denied', String(raw.message).slice(0, 200));
            return { ok: false, error: 'provider_rejected', raw };
        }

        const refillId = raw.refill ?? raw.refill_id ?? raw.order ?? null;
        if (!refillId) {
            return { ok: false, error: 'provider_rejected', raw };
        }

        SmmOrderRepository.updateStatus(smmOrder.id, ORDER_STATUS.REFILL_PENDING, {
            refill_id: String(refillId),
        });
        SmmOrderEventsRepository.record(smmOrder.id, 'refill_submitted', String(refillId));
        logger.info('[SMM:refill] Solicitado', { orderId: smmOrder.id, refillId });
        return { ok: true, refillId, raw };
    },

    async pollRefill(smmOrder, bot) {
        if (!smmOrder?.refill_id || smmOrder.status !== ORDER_STATUS.REFILL_PENDING) {
            return { updated: false };
        }
        const provider = ProviderManager.getProviderForOrder(smmOrder);
        if (!provider?.getRefillStatus) return { updated: false };

        const raw = await provider.getRefillStatus(smmOrder.refill_id);
        const mapped = mapRefillStatus(raw);
        if (!mapped || mapped === 'pending') return { updated: false, status: mapped, raw };

        if (mapped === 'completed') {
            SmmOrderRepository.updateStatus(smmOrder.id, ORDER_STATUS.COMPLETED);
            SmmOrderEventsRepository.record(smmOrder.id, 'refill_done', smmOrder.refill_id);
            await this._notifyUser(
                bot,
                smmOrder.telegram_id,
                `<b>Reposição concluída</b>\n\nPedido #${smmOrder.id}, refill <code>${smmOrder.refill_id}</code>`,
                orderStatusNoticeKeyboard(smmOrder.id)
            );
            return { updated: true, status: ORDER_STATUS.COMPLETED, raw };
        }

        SmmOrderRepository.updateStatus(smmOrder.id, ORDER_STATUS.COMPLETED);
        SmmOrderEventsRepository.record(smmOrder.id, 'refill_rejected', smmOrder.refill_id);
        await this._notifyUser(
            bot,
            smmOrder.telegram_id,
            `<b>Reposição não aprovada</b>\n\nPedido #${smmOrder.id}. Contate o suporte se necessário.`,
            orderStatusNoticeKeyboard(smmOrder.id)
        );
        return { updated: true, status: 'rejected', raw };
    },

    async refillForUser(smmOrderId, telegramId) {
        const order = SmmOrderRepository.findById(smmOrderId);
        if (!order) return { ok: false, error: 'order_not_found' };
        if (String(order.telegram_id) !== String(telegramId)) return { ok: false, error: 'not_owner' };

        const service = SmmServiceRepository.findById(order.service_id);
        return this.requestRefill(order, service);
    },

    listPending(limit) {
        return SmmOrderRepository.listRefillPending(limit);
    },

    async _notifyUser(bot, telegramId, html, keyboard = null) {
        if (!bot?.telegram || !telegramId) return;
        try {
            const extra = { parse_mode: 'HTML' };
            if (keyboard) Object.assign(extra, keyboard);
            await bot.telegram.sendMessage(telegramId, html, extra);
        } catch (e) {
            logger.warn('[SMM:refill] notify falhou', { detail: e.message });
        }
    },
};

module.exports = SmmRefillService;
