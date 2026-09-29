'use strict';

const logger = require('../config/logger');
const { SalesReferenceChannelService } = require('./SalesReferenceChannelService');

const KV_PREFIX = 'admin_pv_sale:';
const KV_COMM_PREFIX = 'admin_pv_comm:';

class AdminSaleNotifyService {
    constructor({ dbRaw }) {
        this.dbRaw = dbRaw;
    }

    _notifier() {
        return global.adminActivityNotifier || null;
    }

    _alreadySent(db, key) {
        return !!db.prepare('SELECT 1 FROM kv_store WHERE key=? LIMIT 1').get(key);
    }

    _markSent(db, key) {
        db.prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(key, String(Date.now()));
    }

    async _deliverToAdmins(text, { dedupKey = null } = {}) {
        const notifier = this._notifier();
        if (!notifier?.enabled || !text) return { ok: false, reason: 'no_notifier' };

        const db = this.dbRaw();
        if (dedupKey && this._alreadySent(db, dedupKey)) {
            return { ok: true, skipped: true, reason: 'duplicate' };
        }

        let delivered = 0;
        for (const adminId of notifier.adminIds || []) {
            try {
                const ok = await notifier._sendToAdminOrQueue(adminId, text);
                if (ok) delivered += 1;
            } catch (e) {
                logger.warn('[ADMIN_SALE] falha PV', { adminId, detail: e.message });
            }
        }

        if (delivered > 0 && dedupKey) {
            this._markSent(db, dedupKey);
        }

        if (delivered > 0) {
            logger.info('[ADMIN_SALE] PV admin enviado', { admins: delivered, dedupKey });
        }
        return { ok: delivered > 0, delivered };
    }

    async notifySaleConfirmed(eventData = {}) {
        const orderId = eventData?.orderId;
        if (!orderId) return { ok: false, reason: 'no_order' };

        const db = this.dbRaw();
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        if (!order) return { ok: false, reason: 'order_not_found' };

        const refSvc = new SalesReferenceChannelService({ bot: null, dbRaw: this.dbRaw });
        let enriched = { ...eventData };
        try {
            const SafeWebhookHandler = require('../modules/payment/SafeWebhookHandler');
            const items = await SafeWebhookHandler.resolveDeliveryItems(orderId);
            if (items?.length) enriched = { ...enriched, items };
        } catch {
            /* optional */
        }

        const text = refSvc.buildAdminPrivateMessage(order, enriched);
        return this._deliverToAdmins(text, { dedupKey: `${KV_PREFIX}${orderId}` });
    }

    async notifyCommissionPaid(payload = {}) {
        const { orderId, commission, code } = payload;
        if (!orderId || !code) return { ok: false, reason: 'invalid_payload' };

        const comm = Number(commission);
        if (!Number.isFinite(comm) || comm <= 0) return { ok: false, reason: 'zero_commission' };

        const refSvc = new SalesReferenceChannelService({ bot: null, dbRaw: this.dbRaw });
        const text = refSvc.buildCommissionAdminMessage(payload);
        return this._deliverToAdmins(text, { dedupKey: `${KV_COMM_PREFIX}${orderId}` });
    }
}

function createAdminSaleNotifyService(deps) {
    return new AdminSaleNotifyService(deps);
}

module.exports = { AdminSaleNotifyService, createAdminSaleNotifyService };
