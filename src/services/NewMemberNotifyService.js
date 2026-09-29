'use strict';

const logger = require('../config/logger');
const { forPublicChannel } = require('../utils/maskSensitiveData');
const { getSalesRefChannelId, isSalesRefChannelEnabled } = require('../config/salesReferenceChannel');

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function langLabel(code) {
    if (!code) return null;
    const map = {
        pt: 'Português',
        en: 'Inglês',
        es: 'Espanhol',
        fr: 'Francês',
        de: 'Alemão',
        it: 'Italiano',
        ru: 'Russo',
        ar: 'Árabe',
        hi: 'Hindi',
        id: 'Indonésio',
    };
    const base = String(code).toLowerCase().split('-')[0];
    return map[base] || String(code).toUpperCase();
}

function premiumLabel(isPremium) {
    if (isPremium === true) return '⭐ Telegram Premium';
    if (isPremium === false) return 'Conta padrão';
    return null;
}

/**
 * Monta perfil enriquecido do novo membro (Bot API + banco).
 */
async function buildNewMemberProfile(ctx, deps, { referredBy = null, startPayload = '' } = {}) {
    const { prisma, dbRaw, bot } = deps;
    const from = ctx?.from || {};
    const uid = from.id;
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || 'Sem nome';

    let indicadoPor = null;
    let affiliateOwnerId = null;
    if (referredBy) {
        try {
            const aff = await prisma.affiliate.findByCode(referredBy);
            if (aff) {
                affiliateOwnerId = aff.user_id;
                const affUser = dbRaw().prepare('SELECT * FROM users WHERE id = ?').get(aff.user_id);
                indicadoPor = affUser?.username
                    ? `@${affUser.username}`
                    : affUser?.first_name || referredBy;
            } else {
                indicadoPor = referredBy;
            }
        } catch {
            indicadoPor = referredBy;
        }
    }

    let dbUser = null;
    let totalUsers = 0;
    try {
        dbUser = await prisma.user.findUnique({ where: { telegram_id: String(uid) } });
        totalUsers = await prisma.user.count();
    } catch {
        /* ignore */
    }

    let photoFileId = null;
    let photoCount = 0;
    try {
        const photos = await bot.telegram.getUserProfilePhotos(uid, { limit: 1 });
        photoCount = photos?.total_count || 0;
        if (photoCount > 0) {
            const sizes = photos.photos[0];
            photoFileId = sizes[sizes.length - 1]?.file_id || null;
        }
    } catch (e) {
        logger.debug('[NEW_MEMBER] profile photos', { uid, detail: e.message });
    }

    let chatMeta = null;
    try {
        chatMeta = await bot.telegram.getChat(uid);
    } catch {
        /* privado sem histórico — normal */
    }

    const dataReg = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const profileLink = from.username ? `https://t.me/${from.username}` : `tg://user?id=${uid}`;

    return {
        telegramId: uid,
        name,
        firstName: from.first_name || '',
        lastName: from.last_name || '',
        username: from.username || null,
        languageCode: from.language_code || chatMeta?.language_code || null,
        isPremium: from.is_premium === true || chatMeta?.is_premium === true,
        isBot: !!from.is_bot,
        photoFileId,
        photoCount,
        referredBy,
        indicadoPor,
        affiliateOwnerId,
        startPayload: startPayload || '',
        totalUsers,
        registeredAt: dataReg,
        dbUserId: dbUser?.id || null,
        tenantId: dbUser?.tenant_id ?? null,
        profileLink,
        chatType: ctx?.chat?.type || 'private',
    };
}

function buildNewMemberCaption(p) {
    const lines = [
        '🌟 <b>NOVO MEMBRO NA LOJA</b> 🌟',
        '',
        `👤 <b>Nome:</b> ${escapeHtml(p.name)}`,
        `🆔 <b>Telegram ID:</b> <code>${p.telegramId}</code>`,
    ];

    if (p.username) {
        lines.push(`🔗 <b>Username:</b> @${escapeHtml(p.username)}`);
        lines.push(`🌐 <b>Perfil:</b> <a href="${escapeHtml(p.profileLink)}">abrir no Telegram</a>`);
    } else {
        lines.push('🔗 <b>Username:</b> <i>sem @ público</i>');
    }

    if (p.languageCode) {
        lines.push(`🗣 <b>Idioma:</b> ${escapeHtml(langLabel(p.languageCode))}`);
    }
    const prem = premiumLabel(p.isPremium);
    if (prem) lines.push(`💎 <b>Conta:</b> ${escapeHtml(prem)}`);

    if (p.photoCount > 0) {
        lines.push(`🖼 <b>Fotos de perfil:</b> ${p.photoCount}`);
    }

    if (p.dbUserId) {
        lines.push(`🗄 <b>ID interno:</b> <code>${p.dbUserId}</code>`);
    }

    if (p.indicadoPor) {
        lines.push(
            `🤝 <b>Indicado por:</b> ${escapeHtml(p.indicadoPor)}` +
                (p.referredBy ? ` (<code>${escapeHtml(p.referredBy)}</code>)` : '')
        );
    }

    if (p.startPayload && !String(p.startPayload).startsWith('ref_')) {
        lines.push(`📎 <b>Link /start:</b> <code>${escapeHtml(p.startPayload)}</code>`);
    } else if (p.startPayload) {
        lines.push(`📎 <b>Payload afiliado:</b> <code>${escapeHtml(p.startPayload)}</code>`);
    }

    lines.push('');
    lines.push(`📊 <b>Total de membros:</b> ${p.totalUsers}`);
    lines.push(`🕐 <b>Registrado:</b> ${escapeHtml(p.registeredAt)}`);
    lines.push(`📍 <b>Origem:</b> ${p.chatType === 'private' ? 'Privado (PV)' : escapeHtml(p.chatType)}`);

    return lines.join('\n');
}

/** Versão pública para o canal de referências — nome/@ visíveis; sem ID, link, foto ou payload. */
function buildNewMemberPublicCaption(p) {
    const displayName = escapeHtml(p.name || p.firstName || 'Sem nome');
    const lines = [
        '👋 <b>Novo membro na loja</b>',
        '',
        `👤 <b>Nome:</b> ${displayName}`,
    ];

    if (p.username) {
        lines.push(`🔗 <b>Nick:</b> @${escapeHtml(p.username)}`);
    } else {
        lines.push('🔗 <b>Nick:</b> <i>sem @ público</i>');
    }

    lines.push('');
    lines.push(`🕐 <b>Horário:</b> ${escapeHtml(p.registeredAt)}`);

    if (p.referredBy || p.indicadoPor) {
        lines.push('🤝 <b>Origem:</b> indicação de afiliado');
    } else {
        lines.push('📍 <b>Origem:</b> acesso direto');
    }

    if (p.isPremium === true) {
        lines.push('💎 Conta Telegram Premium');
    }

    lines.push('');
    lines.push('<i>Hanork · referência verificada</i>');
    return forPublicChannel(lines.join('\n'));
}

async function sendToSalesRefChannel(profile, bot) {
    if (!isSalesRefChannelEnabled() || !bot?.telegram) return 0;
    const channelId = getSalesRefChannelId();
    if (!channelId) return 0;

    const text = buildNewMemberPublicCaption(profile);
    try {
        await bot.telegram.sendMessage(channelId, text, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
        logger.info('[NEW_MEMBER] publicado no canal de referências', { channelId });
        return 1;
    } catch (e) {
        logger.warn('[NEW_MEMBER] falha canal referências', {
            channelId,
            detail: e.message,
        });
        return 0;
    }
}

const NEW_MEMBER_NOTIFY_TTL_MS = 7 * 24 * 3600 * 1000;

async function markNotified(stateManager, telegramId) {
    if (!stateManager) return;
    const key = `new_member_sent:${telegramId}`;
    await stateManager.set(key, { at: Date.now() }, NEW_MEMBER_NOTIFY_TTL_MS);
}

async function keyExists(stateManager, key) {
    if (!stateManager) return false;
    if (typeof stateManager.exists === 'function') {
        const r = stateManager.exists(key);
        return r && typeof r.then === 'function' ? !!(await r) : !!r;
    }
    if (typeof stateManager.has === 'function') {
        return !!(await stateManager.has(key));
    }
    const v = stateManager.get(key);
    return v != null && (typeof v.then !== 'function' ? true : !!(await v));
}

async function wasNotified(stateManager, telegramId) {
    if (!stateManager) return false;
    const key = `new_member_sent:${telegramId}`;
    return keyExists(stateManager, key);
}

async function sendViaMainBot(targets, profile, bot) {
    const caption = buildNewMemberCaption(profile);
    let sent = 0;
    for (const target of targets) {
        try {
            if (profile.photoFileId) {
                await bot.telegram.sendPhoto(target, profile.photoFileId, {
                    caption,
                    parse_mode: 'HTML',
                });
            } else {
                await bot.telegram.sendMessage(target, caption, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                });
            }
            sent += 1;
        } catch (e) {
            logger.warn('[NEW_MEMBER] falha envio principal', {
                target,
                uid: profile.telegramId,
                detail: e.message,
            });
        }
    }
    return sent;
}

async function waitForNotifyReady(notifier, maxWaitMs = 90000) {
    if (!notifier) return false;
    if (notifier._deliveryReady) return true;
    const step = 3000;
    const attempts = Math.ceil(maxWaitMs / step);
    for (let i = 0; i < attempts; i++) {
        if (notifier._deliveryReady) return true;
        await new Promise((r) => setTimeout(r, step));
    }
    return !!notifier._deliveryReady;
}

/** PV de novo membro no @hanork_bot (padrão). 0 = volta ao @hanorkt_bot (monitor). */
function newMemberPvViaMainBot() {
    const v = process.env.ADMIN_NOTIFY_NEW_MEMBER_VIA_MAIN;
    if (v === '0' || v === 'false') return false;
    return true;
}

function resolveNewMemberAdminIds(deps, notifier) {
    const envRaw =
        process.env.ADMIN_NOTIFY_IDS ||
        process.env.ID_DONO ||
        deps?.CONFIG?.ID_DONO ||
        '';
    const fromEnv = String(envRaw)
        .split(/[,;\s]+/)
        .map((x) => parseInt(String(x).trim(), 10))
        .filter((x) => Number.isFinite(x) && x > 0);
    const fromNotifier = Array.isArray(notifier?.adminIds) ? notifier.adminIds : [];
    return [...new Set([...fromEnv, ...fromNotifier])];
}

/**
 * Notifica admins (PV via bot principal por padrão) +
 * canal de referências (versão pública, sem dados sensíveis).
 * Grupo VIP não recebe mais esta notificação.
 */
async function notifyNewMember(ctx, deps, options = {}) {
    const { CONFIG, bot, stateManager } = deps;
    const notifier = global.adminActivityNotifier;
    const uid = ctx?.from?.id;
    if (!uid) return { ok: false, reason: 'no_user' };

    if (await wasNotified(stateManager, uid)) {
        logger.debug('[NEW_MEMBER] dedup — já notificado', { uid });
        return { ok: true, skipped: true, reason: 'dedup' };
    }

    const profile = await buildNewMemberProfile(ctx, deps, options);
    const caption = buildNewMemberCaption(profile);

    const refChannelSent = await sendToSalesRefChannel(profile, bot);

    const adminIds = resolveNewMemberAdminIds(deps, notifier);
    const viaMain = newMemberPvViaMainBot();
    let pvSent = 0;

    if (viaMain && adminIds.length && bot?.telegram) {
        pvSent = await sendViaMainBot(adminIds, profile, bot);
        if (!pvSent && profile.photoFileId) {
            pvSent = await sendViaMainBot(adminIds, { ...profile, photoFileId: null }, bot);
        }
        if (pvSent) {
            logger.info('[NEW_MEMBER] PV via bot principal (@hanork_bot)', { uid, pvSent });
        } else {
            logger.warn('[NEW_MEMBER] PV não entregue via bot principal', {
                uid,
                adminIds,
            });
        }
    } else if (!viaMain && notifier?.notifyNewMember) {
        const ready = await waitForNotifyReady(notifier);
        if (ready) {
            pvSent = await notifier.notifyNewMember(profile, caption);
            if (pvSent) {
                logger.info('[NEW_MEMBER] PV via bot de monitoramento', { uid, pvSent });
            }
        } else {
            logger.warn('[NEW_MEMBER] bot de monitor offline — PV novo membro não enviado');
        }
    } else if (!adminIds.length) {
        logger.warn('[NEW_MEMBER] nenhum admin configurado (ADMIN_NOTIFY_IDS / ID_DONO)');
    }

    if (pvSent > 0 || refChannelSent > 0) {
        await markNotified(stateManager, uid);
    }

    logger.info('[NEW_MEMBER] notificação enviada', {
        uid,
        refChannelSent: !!refChannelSent,
        pvSent,
        viaMain,
    });

    return { ok: true, refChannelSent, pvSent, profile };
}

function scheduleNewMemberNotify(ctx, deps, options = {}) {
    const { deferBackground } = deps;
    const run = () =>
        notifyNewMember(ctx, deps, options).catch((e) => {
            logger.error('[NEW_MEMBER] falha', { uid: ctx?.from?.id, detail: e.message });
        });

    if (typeof deferBackground === 'function') {
        deferBackground('new-member-notify', run);
    } else {
        setImmediate(run);
    }
}

module.exports = {
    buildNewMemberProfile,
    buildNewMemberCaption,
    buildNewMemberPublicCaption,
    notifyNewMember,
    scheduleNewMemberNotify,
};
