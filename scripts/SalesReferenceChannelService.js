'use strict';

const logger = require('../config/logger');
const { getSalesRefChannelId, isSalesRefChannelEnabled } = require('../config/salesReferenceChannel');
const { isSmmHanorkOrder } = require('../modules/smm/helpers/smmPendingHelper');
const SmmOrderRepository = require('../modules/smm/repositories/smmOrderRepository');
const SmmServiceRepository = require('../modules/smm/repositories/smmServiceRepository');

const KV_PREFIX = 'sales_ref_posted:';

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'R$ 0,00';
    return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

function formatPaymentMethod(order, paymentId) {
    const m = String(order?.payment_method || '').toLowerCase();
    if (m === 'pix') return 'PIX';
    if (m === 'credit_card' || m === 'card' || m === 'checkout') return 'Cartão';
    if (m === 'affiliate_balance' || m === 'affiliate') return 'Saldo afiliado';
    if (String(paymentId || '').startsWith('aff-')) return 'Saldo afiliado';
    if (m) return m;
    return 'Mercado Pago';
}

function formatLocalTime(isoOrDate) {
    try {
        const d = isoOrDate ? new Date(isoOrDate) : new Date();
        return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    } catch {
        return new Date().toISOString();
    }
}

function formatDateOnly(isoOrDate) {
    try {
        const d = isoOrDate ? new Date(isoOrDate) : null;
        if (!d || Number.isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    } catch {
        return '—';
    }
}

function truncate(str, max = 80) {
    const s = String(str || '').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
}

function displayName(user) {
    const parts = [user?.first_name, user?.last_name].map((p) => String(p || '').trim()).filter(Boolean);
    return parts.join(' ') || 'Cliente';
}

function loadUserContext(db, userId) {
    if (!userId) return null;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return null;

    const stats = db
        .prepare(
            `SELECT COUNT(*) as paid_orders,
                    COALESCE(SUM(total), 0) as total_spent
             FROM orders
             WHERE user_id = ? AND status IN ('PAID', 'DELIVERED', 'DELIVERING')`
        )
        .get(userId);

    const referral = db
        .prepare(
            `SELECT r.commission, a.code as aff_code, u.username as aff_username, u.first_name as aff_first
             FROM referrals r
             JOIN affiliates a ON a.id = r.affiliate_id
             LEFT JOIN users u ON u.id = a.user_id
             WHERE r.referred_user_id = ?
             LIMIT 1`
        )
        .get(userId);

    return { user, stats, referral };
}

function buildUserSection(db, userId, orderId) {
    const ctx = loadUserContext(db, userId);
    if (!ctx?.user) return ['👤 <b>Cliente</b>: —'];

    const { user, stats, referral } = ctx;
    const name = escapeHtml(displayName(user));
    const username = String(user.username || '').replace(/^@/, '').trim();
    const tgId = escapeHtml(user.telegram_id);
    const lines = ['👤 <b>Cliente</b>'];

    if (username) {
        lines.push(`   Nome: <b>${name}</b> · @${escapeHtml(username)}`);
        lines.push(`   Perfil: <a href="https://t.me/${escapeHtml(username)}">t.me/${escapeHtml(username)}</a>`);
    } else {
        lines.push(`   Nome: <b>${name}</b> <i>(sem @username)</i>`);
    }
    lines.push(`   ID Telegram: <code>${tgId}</code>`);

    const paidOrders = Number(stats?.paid_orders) || 0;
    const totalSpent = Number(stats?.total_spent) || 0;
    lines.push(
        `   Histórico: <b>${paidOrders}</b> compra(s) paga(s) · total <b>${formatMoney(totalSpent)}</b>`
    );
    if (user.created_at) {
        lines.push(`   Cliente desde: ${escapeHtml(formatDateOnly(user.created_at))}`);
    }

    const affOnOrder = db
        .prepare(
            `SELECT r.commission, a.code as aff_code, u.username as aff_username, u.first_name as aff_first
             FROM referrals r
             JOIN affiliates a ON a.id = r.affiliate_id
             LEFT JOIN users u ON u.id = a.user_id
             WHERE r.order_id = ?
             LIMIT 1`
        )
        .get(orderId);

    const aff = affOnOrder || referral;
    if (aff?.aff_code) {
        const affLabel = aff.aff_username
            ? `@${escapeHtml(aff.aff_username)}`
            : escapeHtml(aff.aff_first || aff.aff_code);
        const comm =
            affOnOrder?.commission != null && Number(affOnOrder.commission) > 0
                ? ` · comissão ${formatMoney(affOnOrder.commission)}`
                : '';
        lines.push(`   Indicação: <code>${escapeHtml(aff.aff_code)}</code> (${affLabel})${comm}`);
    }

    return lines;
}

function loadProductLines(db, orderId, eventItems) {
    if (Array.isArray(eventItems) && eventItems.length) {
        return eventItems.map((it) => {
            const name = it.name || it.product_name || it.title || 'Produto';
            const qty = Number(it.quantity) || 1;
            const price = Number(it.price);
            const priceTxt = Number.isFinite(price) ? ` · ${formatMoney(price * qty)}` : '';
            return `• ${escapeHtml(truncate(name, 70))} × <b>${qty}</b>${priceTxt}`;
        });
    }
    const rows = db
        .prepare(
            `SELECT oi.quantity, oi.price, p.name
             FROM order_items oi
             LEFT JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = ?`
        )
        .all(orderId);
    if (!rows.length) return ['• Produto digital'];
    return rows.map((r) => {
        const qty = Number(r.quantity) || 1;
        const price = Number(r.price);
        const priceTxt = Number.isFinite(price) ? ` · ${formatMoney(price * qty)}` : '';
        return `• ${escapeHtml(truncate(r.name || 'Produto', 70))} × <b>${qty}</b>${priceTxt}`;
    });
}

function buildSmmLines(smmOrder) {
    if (!smmOrder) return ['• Serviço SMM'];
    const svc = SmmServiceRepository.findById(smmOrder.service_id);
    const platform = escapeHtml(svc?.platform || 'SMM');
    const sub = svc?.subcategory ? ` › ${escapeHtml(svc.subcategory)}` : '';
    const name = svc?.name ? escapeHtml(truncate(svc.name, 60)) : 'Serviço';
    const qty = Number(smmOrder.quantity).toLocaleString('pt-BR');
    const link = String(smmOrder.link || '').trim();
    const lines = [
        `• 📱 <b>${platform}${sub}</b>`,
        `  <i>${name}</i>`,
        `  Quantidade: <b>${qty}</b>`,
    ];
    if (link) {
        lines.push(`  Link alvo: <code>${escapeHtml(truncate(link, 120))}</code>`);
    }
    return lines;
}

function buildPaymentSection(order, eventData) {
    const lines = [];
    const total = Number(eventData.total ?? order.total);
    const discount = Number(order.discount) || 0;
    const cupom = order.coupon_code ? String(order.coupon_code).trim() : null;

    if (cupom && discount > 0) {
        lines.push(`🎟 Cupom <code>${escapeHtml(cupom)}</code> · −${formatMoney(discount)}`);
    } else if (cupom) {
        lines.push(`🎟 Cupom <code>${escapeHtml(cupom)}</code>`);
    }

    lines.push(`💰 <b>${formatMoney(total)}</b> · ${formatPaymentMethod(order, eventData.paymentId)}`);
    lines.push(`📋 Pedido <code>${escapeHtml(order.id)}</code>`);
    lines.push(`🕐 Pago em: ${escapeHtml(formatLocalTime(order.paid_at || order.created_at))}`);
    return lines;
}

class SalesReferenceChannelService {
    constructor({ bot, dbRaw, groupService = null }) {
        this.bot = bot;
        this.dbRaw = dbRaw;
        this.groupService = groupService;
    }

    getChannelId() {
        return getSalesRefChannelId();
    }

    isEnabled() {
        return isSalesRefChannelEnabled() && !!this.bot?.telegram;
    }

    ensureExcludedFromAutoBroadcast() {
        if (!isSalesRefChannelEnabled()) return;
        try {
            if (this.groupService?.excludeSalesRefFromAutoBroadcast) {
                this.groupService.excludeSalesRefFromAutoBroadcast();
                return;
            }
            const id = getSalesRefChannelId();
            const db = this.dbRaw();
            const r = db
                .prepare(
                    `UPDATE telegram_groups SET broadcast_enabled=0, updated_at=datetime('now') WHERE chat_id=?`
                )
                .run(id);
            if (r.changes > 0) {
                logger.info('[SALES_REF] divulgação automática desativada no canal de referências', {
                    chatId: id,
                });
            }
        } catch (e) {
            logger.warn('[SALES_REF] exclude broadcast:', e.message);
        }
    }

    _alreadyPosted(db, orderId) {
        return !!db.prepare('SELECT 1 FROM kv_store WHERE key=? LIMIT 1').get(`${KV_PREFIX}${orderId}`);
    }

    _markPosted(db, orderId) {
        db.prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(`${KV_PREFIX}${orderId}`, String(Date.now()));
    }

    buildMessage(order, eventData = {}) {
        const orderId = order.id;
        const db = this.dbRaw();

        const isSmm = eventData.orderKind === 'smm' || isSmmHanorkOrder(orderId);
        const kindLabel = isSmm ? '📱 Serviço SMM' : '📦 Produto';

        let detailLines;
        if (isSmm) {
            const smmOrder = SmmOrderRepository.findByHanorkOrderId(orderId);
            detailLines = buildSmmLines(smmOrder);
        } else {
            detailLines = loadProductLines(db, orderId, eventData.items);
        }

        const userLines = buildUserSection(db, order.user_id, orderId);
        const payLines = buildPaymentSection(order, eventData);

        return (
            `✅ <b>Venda confirmada</b>\n\n` +
            `${userLines.join('\n')}\n\n` +
            `${kindLabel}\n` +
            `${detailLines.join('\n')}\n\n` +
            `${payLines.join('\n')}\n\n` +
            `<i>Hanork · referência verificada</i>`
        );
    }

    async postConfirmedSale(eventData) {
        if (!this.isEnabled()) return { ok: false, skipped: true, reason: 'disabled' };

        const orderId = eventData?.orderId;
        if (!orderId) return { ok: false, skipped: true, reason: 'no_order' };

        const db = this.dbRaw();
        if (this._alreadyPosted(db, orderId)) {
            return { ok: true, skipped: true, reason: 'duplicate' };
        }

        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        if (!order) {
            logger.warn('[SALES_REF] pedido não encontrado', { orderId });
            return { ok: false, skipped: true, reason: 'order_not_found' };
        }

        const text = this.buildMessage(order, eventData);
        const channelId = getSalesRefChannelId();

        try {
            await this.bot.telegram.sendMessage(channelId, text, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            });
            this._markPosted(db, orderId);
            logger.info('[SALES_REF] publicado no canal', {
                orderId,
                channelId,
                userId: order.user_id,
                total: Number(eventData.total ?? order.total),
                kind: eventData.orderKind === 'smm' || isSmmHanorkOrder(orderId) ? 'smm' : 'product',
            });
            return { ok: true, channelId };
        } catch (e) {
            logger.error('[SALES_REF] falha ao publicar', {
                orderId,
                channelId,
                detail: e.message,
            });
            return { ok: false, error: e.message };
        }
    }
}

module.exports = { SalesReferenceChannelService };
