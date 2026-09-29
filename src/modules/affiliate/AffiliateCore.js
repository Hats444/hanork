'use strict';

const { prisma } = require('../../config/database');
const { connect: dbConnect } = require('../../config/database-sqlite');
const logger = require('../../config/logger');
const { COMMISSION_RATE, CODE_PREFIX } = require('./affiliateConfig');

function generateAffiliateCode(telegramId) {
    const base = String(telegramId).slice(-4).padStart(4, '0');
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${CODE_PREFIX}${base}${rand}`;
}

function normalizeRefCode(raw) {
    if (!raw) return '';
    let code = String(raw).trim();
    if (code.toLowerCase().startsWith('ref_')) code = code.slice(4);
    return code.toUpperCase();
}

function parseStartRefPayload(payload) {
    if (!payload || !String(payload).startsWith('ref_')) return null;
    return normalizeRefCode(String(payload).replace(/^ref_/i, ''));
}

/** Texto colado de «Compartilhar no Telegram» ou só o deep link — não é comando ao bot. */
function isAffiliateSharePaste(text) {
    const s = String(text || '').trim();
    if (!s || !/t\.me\//i.test(s)) return false;
    return /\?start=ref_/i.test(s) || /\bstart=ref_/i.test(s);
}

function affiliateStartLink(botUsername, code) {
    const user = String(botUsername || 'bot').replace(/^@/, '');
    return `https://t.me/${user}?start=ref_${String(code || '').toUpperCase()}`;
}

function affiliateEarnings(aff) {
    return Math.max(0, Number(aff?.earnings ?? 0));
}

async function ensureAffiliate(userId, telegramId) {
    let aff = await prisma.affiliate.findByUser(userId);
    if (!aff) {
        const code = generateAffiliateCode(telegramId);
        aff = await prisma.affiliate.create(userId, code);
    }
    return aff;
}

async function getBalanceByTelegramId(telegramId) {
    try {
        const user = await prisma.user.findUnique({ where: { telegram_id: String(telegramId) } });
        if (!user) return 0;
        const aff = await prisma.affiliate.findByUser(user.id);
        return affiliateEarnings(aff);
    } catch {
        return 0;
    }
}

/**
 * Registra indicação (um indicador por usuário — UNIQUE referred_user_id).
 */
async function processReferral({ referredUserId, refCode, tenantId = null }) {
    try {
        const code = normalizeRefCode(refCode);
        if (!code || !referredUserId) return { ok: false, reason: 'invalid' };

        const aff = await prisma.affiliate.findByCode(code);
        if (!aff) return { ok: false, reason: 'code_not_found' };
        if (aff.user_id === referredUserId) return { ok: false, reason: 'self' };

        const added = await prisma.affiliate.addReferral(aff.id, referredUserId, tenantId);
        if (added) {
            logger.info('[Affiliate] Nova indicação', {
                affiliateId: aff.id,
                code: aff.code,
                referredUserId,
                tenantId,
            });
        }
        return { ok: true, added, affiliateId: aff.id, code: aff.code };
    } catch (e) {
        logger.warn('[Affiliate] processReferral', { message: e?.message, refCode });
        return { ok: false, reason: 'error' };
    }
}

function getCommissionHistory(affiliateId, limit = 5) {
    const db = dbConnect();
    if (!db) return [];
    const rows = db
        .prepare(
            `
        SELECT ac.order_id, ac.commission, ac.created_at, o.total,
               u.first_name AS buyer_name, u.username AS buyer_username
        FROM affiliate_commissions ac
        LEFT JOIN orders o ON o.id = ac.order_id
        LEFT JOIN users u ON u.id = ac.referred_user_id
        WHERE ac.affiliate_id = ? AND ac.commission > 0
        ORDER BY ac.created_at DESC
        LIMIT ?
    `
        )
        .all(affiliateId, limit);
    if (rows.length) return rows;
    return db
        .prepare(
            `
        SELECT r.order_id, r.commission, r.created_at, o.total,
               u.first_name AS buyer_name, u.username AS buyer_username
        FROM referrals r
        LEFT JOIN orders o ON o.id = r.order_id
        LEFT JOIN users u ON u.id = r.referred_user_id
        WHERE r.affiliate_id = ? AND r.order_id IS NOT NULL AND r.commission > 0
        ORDER BY r.created_at DESC
        LIMIT ?
    `
        )
        .all(affiliateId, limit);
}

function formatCommissionPercent() {
    return `${Math.round(COMMISSION_RATE * 100)}%`;
}

module.exports = {
    generateAffiliateCode,
    normalizeRefCode,
    parseStartRefPayload,
    isAffiliateSharePaste,
    affiliateStartLink,
    affiliateEarnings,
    ensureAffiliate,
    getBalanceByTelegramId,
    processReferral,
    getCommissionHistory,
    formatCommissionPercent,
    COMMISSION_RATE,
};
