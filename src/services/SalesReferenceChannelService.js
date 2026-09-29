'use strict';

const logger = require('../config/logger');
const { getSalesRefChannelId, isSalesRefChannelEnabled } = require('../config/salesReferenceChannel');
const { isSmmHanorkOrder } = require('../modules/smm/helpers/smmPendingHelper');
const { isVirtuoHanorkOrder } = require('../modules/virtuo/helpers/virtuoPendingHelper');
const { isWaDivulgacaoHanorkOrder } = require('../modules/wa-divulgacao/helpers/waDivulgacaoPendingHelper');
const VirtuoOrderRepository = require('../modules/virtuo/repositories/virtuoOrderRepository');
const { featuredByCode } = require('../modules/virtuo/constants/featuredServices');
const SmmOrderRepository = require('../modules/smm/repositories/smmOrderRepository');
const SmmServiceRepository = require('../modules/smm/repositories/smmServiceRepository');
const { maskSensitiveData, maskTelegramId, maskAffiliateCode, maskOrderId } = require('../utils/maskSensitiveData');

const KV_PREFIX = 'sales_ref_posted:';
const KV_DAILY_PROMO_PREFIX = 'sales_ref_daily_promo:';

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

function shortOrderId(orderId) {
    const s = String(orderId || '').trim();
    if (s.length >= 8) return `#${s.slice(-8)}`;
    return s ? `#${s}` : '—';
}

function formatLinkLabel(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
        const u = new URL(raw);
        const host = u.hostname.replace(/^www\./, '');
        const path = u.pathname.replace(/\/$/, '');
        const tail = path.length > 28 ? `${path.slice(0, 27)}…` : path;
        return tail && tail !== '/' ? `${host}${tail}` : host;
    } catch {
        return truncate(raw, 48);
    }
}

function section(title, bodyLines) {
    const body = bodyLines.filter(Boolean).join('\n');
    if (!body) return title;
    return `${title}\n<blockquote>${body}</blockquote>`;
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
    if (!ctx?.user) return section('👤 <b>Cliente</b>', ['—']);

    const { user, stats, referral } = ctx;
    const name = escapeHtml(displayName(user));
    const username = String(user.username || '').replace(/^@/, '').trim();
    const tgId = escapeHtml(user.telegram_id);
    const lines = [];

    if (username) {
        lines.push(`<b>${name}</b> · @${escapeHtml(username)}`);
        lines.push(
            `<a href="https://t.me/${escapeHtml(username)}">Perfil</a> · <code>${tgId}</code>`
        );
    } else {
        lines.push(`<b>${name}</b> · <code>${tgId}</code>`);
    }

    const paidOrders = Number(stats?.paid_orders) || 0;
    const totalSpent = Number(stats?.total_spent) || 0;
    const since = user.created_at ? formatDateOnly(user.created_at) : null;
    const hist = `${paidOrders} compra${paidOrders === 1 ? '' : 's'} · <b>${formatMoney(totalSpent)}</b>`;
    lines.push(since ? `${hist} · desde ${escapeHtml(since)}` : hist);

    const affOnOrder = db
        .prepare(
            `SELECT ac.commission, a.code as aff_code, u.username as aff_username, u.first_name as aff_first
             FROM affiliate_commissions ac
             JOIN affiliates a ON a.id = ac.affiliate_id
             LEFT JOIN users u ON u.id = a.user_id
             WHERE ac.order_id = ?
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
        lines.push(`🤝 <code>${escapeHtml(aff.aff_code)}</code> · ${affLabel}${comm}`);
    }

    return section('👤 <b>Cliente</b>', lines);
}

/** Versão pública — sem Telegram ID, histórico de gastos ou código de afiliado. */
function buildPublicUserSection(db, userId, orderId) {
    const ctx = loadUserContext(db, userId);
    if (!ctx?.user) return section('👤 <b>Cliente</b>', ['—']);

    const { user, referral } = ctx;
    const name = escapeHtml(displayName(user));
    const username = String(user.username || '').replace(/^@/, '').trim();
    const lines = [];

    if (username) {
        lines.push(`<b>${name}</b> · @${escapeHtml(username)}`);
        lines.push(`<a href="https://t.me/${escapeHtml(username)}">Perfil</a>`);
    } else {
        lines.push(`<b>${name}</b> · ${escapeHtml(maskTelegramId(user.telegram_id))}`);
    }

    const affOnOrder = orderId
        ? db.prepare('SELECT 1 FROM affiliate_commissions ac WHERE ac.order_id = ? LIMIT 1').get(orderId)
        : null;
    if (affOnOrder || referral?.aff_code) {
        lines.push(`🤝 ${maskAffiliateCode()}`);
    }

    return section('👤 <b>Cliente</b>', lines);
}

function formatProductLineItem(it) {
    const name = String(it.name || it.product_name || it.title || '').trim() || 'Produto';
    const qty = Number(it.quantity) || 1;
    const unit = Number(it.price);
    const lineTotal = Number.isFinite(unit) ? unit * qty : NaN;
    const priceTxt = Number.isFinite(lineTotal) ? ` · ${formatMoney(lineTotal)}` : '';
    return `${escapeHtml(truncate(name, 70))} × <b>${qty}</b>${priceTxt}`;
}

function loadProductLines(db, orderId, eventItems) {
    let rows;
    if (Array.isArray(eventItems) && eventItems.length) {
        rows = eventItems.map(formatProductLineItem);
    } else {
        const dbRows = db
            .prepare(
                `SELECT oi.quantity, oi.price, p.name
                 FROM order_items oi
                 LEFT JOIN products p ON p.id = oi.product_id
                 WHERE oi.order_id = ?
                 ORDER BY oi.id ASC`
            )
            .all(orderId);
        if (!dbRows.length) {
            return section('📦 <b>Produto</b>', ['Compra na loja Hanork']);
        }
        rows = dbRows.map((r) =>
            formatProductLineItem({
                name: r.name,
                quantity: r.quantity,
                price: r.price,
            })
        );
    }
    const title = rows.length > 1 ? '📦 <b>Itens do carrinho</b>' : '📦 <b>Produto</b>';
    return section(title, rows);
}

function buildVirtuoAppLabel(virtuoOrder) {
    const featured = featuredByCode(virtuoOrder?.service_code);
    if (featured) return `${featured.emoji} ${featured.name}`;
    const name = String(virtuoOrder?.service_name || virtuoOrder?.service_code || 'SMS').trim();
    return name || 'Número SMS';
}

function buildVirtuoLines(virtuoOrder) {
    if (!virtuoOrder) return section('📱 <b>Número SMS</b>', ['Número virtual']);
    const app = escapeHtml(truncate(buildVirtuoAppLabel(virtuoOrder), 48));
    const country = escapeHtml(truncate(virtuoOrder.country_name || '—', 56));
    const lines = [
        `<b>${app}</b>`,
        `País: <b>${country}</b>`,
        `1 número virtual · recebimento SMS`,
    ];
    const sale = Number(virtuoOrder.sale_price);
    if (Number.isFinite(sale) && sale > 0) {
        lines.push(formatMoney(sale));
    }
    return section('📱 <b>Número SMS</b>', lines);
}

function buildPublicVirtuoLines(virtuoOrder) {
    return buildVirtuoLines(virtuoOrder);
}

function resolveSaleKind(orderId, eventData = {}) {
    if (eventData.orderKind === 'virtuo' || isVirtuoHanorkOrder(orderId)) return 'virtuo';
    if (eventData.orderKind === 'smm' || isSmmHanorkOrder(orderId)) return 'smm';
    if (eventData.orderKind === 'wa_div' || isWaDivulgacaoHanorkOrder(orderId)) return 'wa_div';
    return 'product';
}

function resolveDetailBlock(db, orderId, eventData, { publicView = false } = {}) {
    const kind = resolveSaleKind(orderId, eventData);
    if (kind === 'virtuo') {
        const vo = VirtuoOrderRepository.findByHanorkOrderId(orderId);
        return publicView ? buildPublicVirtuoLines(vo) : buildVirtuoLines(vo);
    }
    if (kind === 'smm') {
        const sm = SmmOrderRepository.findByHanorkOrderId(orderId);
        return publicView ? buildPublicSmmLines(sm) : buildSmmLines(sm);
    }
    if (kind === 'wa_div') {
        return publicView ? buildPublicWaDivLines(db, orderId) : buildWaDivLines(db, orderId);
    }
    return loadProductLines(db, orderId, eventData.items);
}

async function enrichEventItems(orderId, eventData = {}) {
    const enriched = { ...eventData };
    if (resolveSaleKind(orderId, enriched) !== 'product') return enriched;
    if (Array.isArray(enriched.items) && enriched.items.length) return enriched;
    try {
        const SafeWebhookHandler = require('../modules/payment/SafeWebhookHandler');
        const items = await SafeWebhookHandler.resolveDeliveryItems(orderId);
        if (items?.length) enriched.items = items;
    } catch (e) {
        logger.warn('[SALES_REF] enrich items falhou', { orderId, detail: e.message });
    }
    return enriched;
}

function loadWaDivulgacaoOrderItems(db, orderId) {
    return (
        db
            .prepare(
                `SELECT oi.quantity, oi.price, p.name, p.description, p.category
                 FROM order_items oi
                 JOIN products p ON p.id = oi.product_id
                 WHERE oi.order_id = ?
                 ORDER BY oi.id ASC`
            )
            .all(orderId) || []
    );
}

function buildWaDivLines(db, orderId) {
    const { parsePlanDaysFromProduct } = require('../modules/wa-divulgacao/waDivulgacaoPlans');
    const rows = loadWaDivulgacaoOrderItems(db, orderId);
    const order = db.prepare('SELECT user_id, telegram_id, payment_method FROM orders WHERE id = ?').get(orderId);
    if (!rows.length) {
        return section('📲 <b>Hanork Div</b>', ['Plano de automação WhatsApp']);
    }
    const lines = rows.map((r) => {
        const days = parsePlanDaysFromProduct(r);
        const qty = Number(r.quantity) || 1;
        const lineTotal = Number(r.price) * qty;
        const name = escapeHtml(truncate(String(r.name || 'Hanork Div'), 56));
        return `<b>${name}</b> · <b>${days} dia${days > 1 ? 's' : ''}</b> · ${formatMoney(lineTotal)}`;
    });
    lines.push('Conexão WhatsApp · campanhas · Status · grupos');

    if (order?.user_id) {
        const sub = db
            .prepare(
                `SELECT id, plan_name, next_payment_date, total_paid, status
                 FROM subscriptions
                 WHERE user_id = ?
                 AND (plan_name LIKE 'Hanork Div%' OR plan_name LIKE 'WA Divulgação%')
                 ORDER BY id DESC LIMIT 1`
            )
            .get(order.user_id);
        if (sub) {
            lines.push(
                `Assinatura <b>#${sub.id}</b> · ${escapeHtml(sub.plan_name || 'Hanork Div')}`,
                `Válida até <b>${escapeHtml(formatDateOnly(sub.next_payment_date))}</b> · total pago ${formatMoney(sub.total_paid)}`
            );
        }
    }
    if (order?.telegram_id) {
        lines.push(`Telegram do comprador: <code>${escapeHtml(String(order.telegram_id))}</code>`);
    }
    return section('📲 <b>Hanork Div — assinatura</b>', lines);
}

function buildPublicWaDivLines(db, orderId) {
    return buildWaDivLines(db, orderId);
}

function buildSmmLines(smmOrder) {
    if (!smmOrder) return section('📱 <b>Serviço SMM</b>', ['Serviço digital']);
    const svc = SmmServiceRepository.findById(smmOrder.service_id);
    const platform = escapeHtml(svc?.platform || 'SMM');
    const sub = svc?.subcategory ? ` › ${escapeHtml(svc.subcategory)}` : '';
    const name = svc?.name ? escapeHtml(truncate(svc.name, 72)) : 'Serviço';
    const qty = Number(smmOrder.quantity).toLocaleString('pt-BR');
    const link = String(smmOrder.link || '').trim();
    const lines = [
        `<b>${platform}${sub}</b>`,
        `<i>${name}</i>`,
        `<b>${qty}</b> unidades`,
    ];
    if (link) {
        const label = escapeHtml(formatLinkLabel(link));
        lines.push(`🔗 <a href="${escapeHtml(link)}">${label}</a>`);
    }
    const providerId = smmOrder.provider_order_id || smmOrder.external_order_id;
    if (providerId) {
        lines.push(`Fornecedor <code>${escapeHtml(String(providerId))}</code>`);
    }
    return section('📱 <b>Serviço SMM</b>', lines);
}

function buildPublicSmmLines(smmOrder) {
    if (!smmOrder) return section('📱 <b>Serviço SMM</b>', ['Serviço digital']);
    const svc = SmmServiceRepository.findById(smmOrder.service_id);
    const platform = escapeHtml(svc?.platform || 'SMM');
    const sub = svc?.subcategory ? ` › ${escapeHtml(svc.subcategory)}` : '';
    const name = svc?.name ? escapeHtml(truncate(svc.name, 72)) : 'Serviço';
    const qty = Number(smmOrder.quantity).toLocaleString('pt-BR');
    const link = String(smmOrder.link || '').trim();
    const lines = [
        `<b>${platform}${sub}</b>`,
        `<i>${name}</i>`,
        `<b>${qty}</b> unidades`,
    ];
    if (link) {
        const label = escapeHtml(formatLinkLabel(link));
        lines.push(`🔗 <a href="${escapeHtml(link)}">${label}</a>`);
    }
    return section('📱 <b>Serviço SMM</b>', lines);
}

function buildPaymentFooter(order, eventData) {
    const lines = [];
    const total = Number(eventData.total ?? order.total);
    const discount = Number(order.discount) || 0;
    const cupom = order.coupon_code ? String(order.coupon_code).trim() : null;
    const paidAt = formatLocalTime(order.paid_at || order.created_at);
    const method = formatPaymentMethod(order, eventData.paymentId);
    const ref = shortOrderId(order.id);

    if (cupom && discount > 0) {
        lines.push(`🎟 <code>${escapeHtml(cupom)}</code> · −${formatMoney(discount)}`);
    } else if (cupom) {
        lines.push(`🎟 <code>${escapeHtml(cupom)}</code>`);
    }

    lines.push(
        `<code>${escapeHtml(ref)}</code> · ${escapeHtml(paidAt)}`,
        `<code>${escapeHtml(order.id)}</code>`
    );
    return { total, method, paidAt, footerLines: lines };
}

/** Versão pública — sem UUID completo, cupom ou IDs internos. */
function buildPublicPaymentFooter(order, eventData) {
    const total = Number(eventData.total ?? order.total);
    const paidAt = formatLocalTime(order.paid_at || order.created_at);
    const method = formatPaymentMethod(order, eventData.paymentId);
    const ref = maskOrderId(order.id);

    return {
        total,
        method,
        footerLines: [
            `${escapeHtml(ref)} · ${escapeHtml(paidAt)}`,
            `<i>Valor desta compra: <b>${formatMoney(total)}</b></i>`,
        ],
    };
}

function buildPurchaseSourceSection(db, userId, orderId, eventData = {}) {
    const lines = [];
    const kind = resolveSaleKind(orderId, eventData);
    const kindLabels = {
        product: 'Catálogo / loja Hanork',
        smm: 'Painel SMM',
        virtuo: 'Números SMS (Virtuo)',
        wa_div: 'Hanork Div · assinatura',
    };
    lines.push(`Tipo: <b>${kindLabels[kind] || 'Loja Hanork'}</b>`);

    const comm = orderId
        ? db
              .prepare(
                  `SELECT ac.commission, a.code as aff_code, u.username as aff_username, u.first_name as aff_first
                   FROM affiliate_commissions ac
                   JOIN affiliates a ON a.id = ac.affiliate_id
                   LEFT JOIN users u ON u.id = a.user_id
                   WHERE ac.order_id = ?
                   LIMIT 1`
              )
              .get(orderId)
        : null;

    const referral = userId
        ? db
              .prepare(
                  `SELECT a.code as aff_code, u.username as aff_username, u.first_name as aff_first, r.created_at
                   FROM referrals r
                   JOIN affiliates a ON a.id = r.affiliate_id
                   LEFT JOIN users u ON u.id = a.user_id
                   WHERE r.referred_user_id = ?
                   LIMIT 1`
              )
              .get(userId)
        : null;

    if (comm?.aff_code) {
        const affLabel = comm.aff_username
            ? `@${escapeHtml(comm.aff_username)}`
            : escapeHtml(comm.aff_first || comm.aff_code);
        lines.push(`🤝 Venda por indicação · <code>${escapeHtml(comm.aff_code)}</code> · ${affLabel}`);
        if (Number(comm.commission) > 0) {
            lines.push(`Comissão: <b>${formatMoney(comm.commission)}</b>`);
        }
    } else if (referral?.aff_code) {
        const affLabel = referral.aff_username
            ? `@${escapeHtml(referral.aff_username)}`
            : escapeHtml(referral.aff_first || referral.aff_code);
        lines.push(`🔗 Cliente veio de indicação · <code>${escapeHtml(referral.aff_code)}</code> · ${affLabel}`);
        if (referral.created_at) {
            lines.push(`Indicado em ${escapeHtml(formatDateOnly(referral.created_at))}`);
        }
    } else {
        lines.push('🛒 Compra direta no bot (sem afiliado neste pedido)');
    }

    return section('📍 <b>Origem da venda</b>', lines);
}

function buildCommissionAdminMessage(db, { orderId, buyerUserId, commission, code, affiliateTelegramId }) {
    const order = orderId ? db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) : null;
    const buyerCtx = loadUserContext(db, buyerUserId);
    const buyer = buyerCtx?.user;
    const commVal = Number(commission);
    const commTxt = Number.isFinite(commVal) ? formatMoney(commVal) : '—';

    let affRow = null;
    if (code) {
        affRow = db
            .prepare(
                `SELECT a.code, a.earnings, u.username, u.first_name, u.telegram_id
                 FROM affiliates a
                 LEFT JOIN users u ON u.id = a.user_id
                 WHERE a.code = ?
                 LIMIT 1`
            )
            .get(String(code).toUpperCase());
    }

    const affLabel = affRow?.username
        ? `@${escapeHtml(affRow.username)}`
        : escapeHtml(affRow?.first_name || code || 'Afiliado');

    const buyerName = buyer ? escapeHtml(displayName(buyer)) : 'Cliente';
    const buyerUser = buyer?.username ? ` · @${escapeHtml(buyer.username)}` : '';
    const buyerId = buyer?.telegram_id ? ` · <code>${escapeHtml(buyer.telegram_id)}</code>` : '';

    const lines = [];
    lines.push(`Afiliado: <b>${affLabel}</b> · <code>${escapeHtml(code || '—')}</code>`);
    if (affiliateTelegramId || affRow?.telegram_id) {
        lines.push(`ID afiliado: <code>${escapeHtml(affiliateTelegramId || affRow.telegram_id)}</code>`);
    }
    if (affRow?.earnings != null) {
        lines.push(`Saldo acumulado: <b>${formatMoney(affRow.earnings)}</b>`);
    }

    const buyerLines = [`<b>${buyerName}</b>${buyerUser}${buyerId}`];
    if (buyerCtx?.stats) {
        const paid = Number(buyerCtx.stats.paid_orders) || 0;
        const spent = Number(buyerCtx.stats.total_spent) || 0;
        buyerLines.push(`${paid} compra${paid === 1 ? '' : 's'} · <b>${formatMoney(spent)}</b> no total`);
    }

    let detailBlock = '';
    let paymentBlock = '';
    if (order) {
        detailBlock = resolveDetailBlock(db, order.id, {}, { publicView: false });
        const { total, method, footerLines } = buildPaymentFooter(order, { total: order.total });
        paymentBlock = `${footerLines.join('\n')}\n💳 ${method} · pedido <b>${formatMoney(total)}</b>`;
    } else if (orderId) {
        paymentBlock = `<code>${escapeHtml(shortOrderId(orderId))}</code>`;
    }

    return (
        `🤝 <b>Comissão de afiliado</b> · <b>${commTxt}</b>\n\n` +
        `${section('👤 <b>Afiliado</b>', lines)}\n\n` +
        `${section('🛒 <b>Compra do indicado</b>', buyerLines)}\n\n` +
        (detailBlock ? `${detailBlock}\n\n` : '') +
        (paymentBlock ? `${paymentBlock}\n\n` : '') +
        `<i>PV Admin · Hanork</i>`
    );
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
        const detailBlock = resolveDetailBlock(db, orderId, eventData, { publicView: false });

        const userBlock = buildUserSection(db, order.user_id, orderId);
        const { total, method, footerLines } = buildPaymentFooter(order, eventData);

        return (
            `✅ <b>Venda confirmada</b> · <b>${formatMoney(total)}</b> · ${method}\n\n` +
            `${userBlock}\n\n` +
            `${detailBlock}\n\n` +
            `${footerLines.join('\n')}\n\n` +
            `<i>Hanork · referência verificada</i>`
        );
    }

    /** Mensagem completa para PV dos admins (com origem da venda). */
    buildAdminPrivateMessage(order, eventData = {}) {
        const orderId = order.id;
        const db = this.dbRaw();
        const detailBlock = resolveDetailBlock(db, orderId, eventData, { publicView: false });
        const userBlock = buildUserSection(db, order.user_id, orderId);
        const sourceBlock = buildPurchaseSourceSection(db, order.user_id, orderId, eventData);
        const { total, method, footerLines } = buildPaymentFooter(order, eventData);

        return (
            `💰 <b>Nova venda</b> · <b>${formatMoney(total)}</b> · ${method}\n\n` +
            `${userBlock}\n\n` +
            `${detailBlock}\n\n` +
            `${sourceBlock}\n\n` +
            `${footerLines.join('\n')}\n\n` +
            `<i>PV Admin · Hanork</i>`
        );
    }

    buildCommissionAdminMessage(payload) {
        return buildCommissionAdminMessage(this.dbRaw(), payload);
    }

    buildPublicMessage(order, eventData = {}) {
        const orderId = order.id;
        const db = this.dbRaw();
        const detailBlock = resolveDetailBlock(db, orderId, eventData, { publicView: true });

        const userBlock = buildPublicUserSection(db, order.user_id, orderId);
        const { total, method, footerLines } = buildPublicPaymentFooter(order, eventData);

        const text =
            `✅ <b>Venda confirmada</b> · <b>${formatMoney(total)}</b> · ${method}\n\n` +
            `${userBlock}\n\n` +
            `${detailBlock}\n\n` +
            `${footerLines.join('\n')}\n\n` +
            `<i>Hanork · referência verificada</i>`;

        return maskSensitiveData(text, { public: true });
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

        const enriched = await enrichEventItems(orderId, eventData);
        const text = this.buildPublicMessage(order, enriched);
        const channelId = getSalesRefChannelId();
        const saleKind = resolveSaleKind(orderId, enriched);

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
                kind: saleKind,
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

    _dailyPromoPosted(db, dayKey) {
        return !!db.prepare('SELECT 1 FROM kv_store WHERE key=? LIMIT 1').get(`${KV_DAILY_PROMO_PREFIX}${dayKey}`);
    }

    _markDailyPromoPosted(db, dayKey) {
        db.prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(`${KV_DAILY_PROMO_PREFIX}${dayKey}`, String(Date.now()));
    }

    /**
     * 1 post/dia no canal de referências — rotação Hanork/SMM + deep link (Semana 2).
     */
    async postDailyPromo(opts = {}) {
        const { isSalesRefDailyPromoEnabled, dayKey, getRefChannelPromoType, getWeekdayIso } = require('../data/marketingWeekdayCalendar');
        if (!isSalesRefDailyPromoEnabled()) {
            return { ok: false, skipped: true, reason: 'disabled' };
        }
        if (!this.isEnabled()) return { ok: false, skipped: true, reason: 'disabled' };

        const today = dayKey();
        const db = this.dbRaw();
        if (this._dailyPromoPosted(db, today)) {
            return { ok: true, skipped: true, reason: 'duplicate' };
        }

        const promoType = getRefChannelPromoType();
        const photosDir = opts.photosDir || null;
        const kv = {
            get: (k) => db.prepare('SELECT value FROM kv_store WHERE key=?').get(k)?.value ?? null,
            set: (k, v) => {
                db.prepare(
                    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
                ).run(k, String(v));
            },
        };

        const { pickHanorkFromMarkdown, pickSmmFromMarkdown } = require('../data/marketingMarkdownVariants');
        const { formatHanorkTelegramHtml } = require('../data/hanorkBroadcastVariants');
        const { formatSmmTelegramHtml } = require('../data/smmBroadcastVariants');
        const { HANORK_PRODUCT_ID } = require('../constants/hanorkProduct');

        let picked;
        let texto;
        const username = String(process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');

        if (promoType === 'smm') {
            picked = pickSmmFromMarkdown(kv, photosDir);
            if (!picked?.variant) return { ok: false, skipped: true, reason: 'no_smm_variant' };
            texto = formatSmmTelegramHtml(picked.variant, { username });
        } else {
            picked = pickHanorkFromMarkdown(kv, photosDir);
            if (!picked?.variant) return { ok: false, skipped: true, reason: 'no_hanork_variant' };
            const product = db.prepare('SELECT * FROM products WHERE id=?').get(HANORK_PRODUCT_ID) || {
                id: HANORK_PRODUCT_ID,
                name: 'Hanork PRO v3.0',
                price: 297.9,
            };
            texto = formatHanorkTelegramHtml(picked.variant, product, { username });
            if (getWeekdayIso() === 6) {
                const { buyDeepLink } = require('../utils/broadcastDeepLinks');
                texto += `\n\n🔥 <b>Destaque do fim de semana</b> — <a href="${buyDeepLink(username)}">Ver oferta no bot</a>`;
            }
        }

        const channelId = getSalesRefChannelId();
        try {
            if (picked.photo) {
                await this.bot.telegram.sendPhoto(channelId, picked.photo, {
                    caption: texto,
                    parse_mode: 'HTML',
                });
            } else {
                await this.bot.telegram.sendMessage(channelId, texto, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: false,
                });
            }
            this._markDailyPromoPosted(db, today);
            logger.info('[SALES_REF] promo diária publicada', {
                channelId,
                day: today,
                type: promoType,
                variantId: picked.variant?.id,
            });
            return { ok: true, channelId, type: promoType, variantId: picked.variant?.id };
        } catch (e) {
            logger.error('[SALES_REF] falha promo diária', { channelId, detail: e.message });
            return { ok: false, error: e.message };
        }
    }
}

module.exports = { SalesReferenceChannelService };
