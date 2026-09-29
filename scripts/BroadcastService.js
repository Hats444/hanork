'use strict';

/**
 * BroadcastService — divulgação admin (usuários + grupos)
 *
 * Usuários (PV): edita slot rastreado ou apaga+1 nova — nunca acumula mensagens no chat
 * Grupos/canais: apaga promo anterior + mensagem nova (visível no feed; não edita in-place)
 */

const logger = require('../config/logger');
const MsgService = require('../telegram/MsgService');
const { generateBroadcastText } = require('../config/ai-brain');
const { pickTelegramOpts, unwrapReplyMarkup, isBlockedError, isNetworkError } = require('../telegram/messageDelivery');

const YIELD_EVERY_N = 8;
const MAX_CONSEC_NET_FAILS = 4;
const NET_FAIL_PAUSE_MS = Math.max(
    3000,
    parseInt(process.env.BROADCAST_NET_FAIL_PAUSE_MS || '15000', 10)
);
const NET_FAIL_ABORT_AFTER = Math.max(
    MAX_CONSEC_NET_FAILS,
    parseInt(process.env.BROADCAST_NET_FAIL_ABORT_AFTER || '8', 10)
);

function yieldEventLoop() {
    return new Promise((resolve) => setImmediate(resolve));
}

function isLikelyNetworkFailure(err) {
    if (!err) return false;
    if (isNetworkError(err)) return true;
    const msg = (err?.message || '').toLowerCase();
    return msg.includes('timeout');
}
const { buildGroupPromoKeyboard } = require('../telegram/groupPromo');
const broadcastRateLimit = require('./broadcastRateLimit');
const { sanitizeTelegramHtml } = require('../utils/persuasiveProductCopy');
const { repairTelegramHtml, polishPromoHtml } = require('../utils/broadcastTextClean');

function normalizeBroadcastHtml(texto, parseMode = 'HTML') {
    const t = String(texto || '');
    if (!t || (parseMode && String(parseMode).toUpperCase() !== 'HTML')) return t;
    return polishPromoHtml(repairTelegramHtml(sanitizeTelegramHtml(t)), {});
}

function buildTelegramOpts(parseMode, replyMarkup) {
    const rm = unwrapReplyMarkup(replyMarkup);
    return pickTelegramOpts({
        parse_mode: parseMode || 'HTML',
        ...(rm ? { reply_markup: rm } : {}),
    });
}

function serializeReplyMarkup(replyMarkup) {
    const rm = unwrapReplyMarkup(replyMarkup);
    if (!rm) return null;
    try {
        return JSON.parse(JSON.stringify(rm));
    } catch {
        return null;
    }
}

function serializePhoto(photo) {
    if (!photo) return null;
    if (typeof photo === 'string') return photo;
    if (typeof photo === 'object' && photo.path) return String(photo.path);
    if (typeof photo === 'object' && photo.source) return String(photo.source);
    return null;
}

class BroadcastService {
    constructor({ bot, lastMenuMsg, dbRaw, groupService, groupSettings }) {
        this.bot = bot;
        this.lastMenuMsg = lastMenuMsg;
        this.dbRaw = dbRaw;
        this.groupService = groupService;
        this.groupSettings = groupSettings;
        this.running = false;
    }

    get isRunning() {
        return this.running;
    }

    /** Entrega PV — edita slot rastreado; nunca apaga+nova (anti-flood). */
    async deliverToUser(chatId, text, opts, deliveryOptions = {}) {
        try {
            const msgSvc = MsgService.get();
            const r = await msgSvc.sendToChat(chatId, text, {
                ...opts,
                photo: deliveryOptions.photo,
                promoMode: true,
                pvPromo: true,
                forceNew: false,
                editOnly: !!deliveryOptions.editOnly,
                requirePhoto: !!deliveryOptions.requirePhoto,
                forcePhoto: !!deliveryOptions.forcePhoto,
                menuType: 'user_promo',
            });
            if (r.action === 'blocked') return 'blocked';
            if (r.action === 'sent') return 'sent';
            if (r.action === 'skipped') return 'skipped';
            if (r.action === 'edited' || r.action === 'unchanged') return 'edited';
            if (r.action === 'failed' && r.error && isNetworkError({ message: r.error })) {
                return 'network_failed';
            }
            return 'skipped';
        } catch (err) {
            if (isBlockedError(err)) return 'blocked';
            logger.warn(`[Broadcast] deliverToUser ${chatId}:`, err.message);
            return 'skipped';
        }
    }

    async _getBotUserId() {
        if (this._botUserId !== undefined) return this._botUserId;
        try {
            const me = await this.bot.telegram.getMe();
            this._botUserId = me.id;
        } catch {
            this._botUserId = null;
        }
        return this._botUserId;
    }

    async _listUserChatIds() {
        const db = this.dbRaw();
        const rows = db
            .prepare(
                "SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL AND TRIM(telegram_id) != ''"
            )
            .all();
        const botId = await this._getBotUserId();
        const ids = [];
        for (const row of rows) {
            const chatId = parseInt(row.telegram_id, 10);
            if (!chatId || Number.isNaN(chatId) || chatId <= 0) continue;
            if (botId && chatId === botId) continue;
            ids.push(chatId);
        }
        return ids;
    }

    async _broadcastUsersViaQueue(texto, parseMode, replyMarkup, options = {}) {
        const QueueService = require('../modules/queue/QueueService');
        const { isPvBroadcastQueueEnabled } = require('../config/broadcastConfig');

        if (!isPvBroadcastQueueEnabled()) {
            throw new Error('BROADCAST_PV_USE_QUEUE desligado');
        }

        const targets = await this._listUserChatIds();
        const exclude = new Set(
            (options.excludeUserIds || [])
                .map((id) => parseInt(id, 10))
                .filter((id) => Number.isFinite(id) && id > 0)
        );
        const total = targets.length;
        const userDelayMs = options.userDelayMs ?? 50;
        const replyMarkupJson = serializeReplyMarkup(replyMarkup);
        const photoPath = serializePhoto(options.photo);
        const jobs = [];
        let queued = 0;

        for (let i = 0; i < targets.length; i++) {
            const chatId = targets[i];
            if (exclude.has(chatId)) continue;

            const gate = broadcastRateLimit.canSendPromo(this.dbRaw, chatId, {
                channel: 'user',
                enforceWindow: !!options.enforceAutoRateLimit,
            });
            if (!gate.ok && !gate.allowEditOnly) continue;

            const job = await QueueService.add(
                'broadcast:pv',
                {
                    chatId,
                    text: texto,
                    parseMode: parseMode || 'HTML',
                    replyMarkup: replyMarkupJson,
                    photo: photoPath,
                    requirePhoto: !!options.requirePhoto,
                    forcePhoto: !!options.forcePhoto,
                    editOnly: !!gate.allowEditOnly,
                    enforceAutoRateLimit: !!options.enforceAutoRateLimit,
                },
                {
                    removeOnComplete: 200,
                    removeOnFail: 50,
                    attempts: 2,
                    delay: Math.max(0, queued * userDelayMs),
                    backoff: { type: 'exponential', delay: 1500 },
                }
            );
            jobs.push(job);
            queued++;
        }

        let sent = 0;
        let edited = 0;
        let blocked = 0;
        let skipped = 0;
        let errors = 0;
        let rateLimited = 0;

        if (jobs.length) {
            QueueService.bumpMaxListeners('broadcast:pv', jobs.length * 2);
        }

        const results = await Promise.allSettled(
            jobs.map((j) => (typeof j.finished === 'function' ? j.finished() : Promise.resolve(null)))
        );

        for (const r of results) {
            if (r.status !== 'fulfilled' || !r.value) {
                errors++;
                continue;
            }
            const action = r.value.action;
            if (action === 'edited') edited++;
            else if (action === 'sent') sent++;
            else if (action === 'blocked') blocked++;
            else if (action === 'rate_limited') rateLimited++;
            else if (action === 'network_failed' || action === 'skipped') skipped++;
            else if (action === 'error') errors++;
        }

        logger.info(
            `[Broadcast] users (fila PV) total=${total} queued=${queued} edited=${edited} sent=${sent} blocked=${blocked} skipped=${skipped} rateLimited=${rateLimited} errors=${errors}`
        );

        return { sent, edited, blocked, skipped, rateLimited, errors, total, queued, via: 'queue' };
    }

    async _broadcastUsers(texto, parseMode, replyMarkup, options = {}) {
        const { isPvBroadcastQueueEnabled } = require('../config/broadcastConfig');
        const { isRealQueueEnabled } = require('../modules/queue/QueueHelpers');
        if (isPvBroadcastQueueEnabled() && isRealQueueEnabled()) {
            try {
                return await this._broadcastUsersViaQueue(texto, parseMode, replyMarkup, options);
            } catch (e) {
                logger.warn('[Broadcast] fila PV indisponível — fallback síncrono:', e.message);
            }
        }

        const opts = buildTelegramOpts(parseMode, replyMarkup);
        let sent = 0;
        let edited = 0;
        let blocked = 0;
        let skipped = 0;
        let errors = 0;
        let rateLimited = 0;

        const targets = await this._listUserChatIds();
        const exclude = new Set(
            (options.excludeUserIds || [])
                .map((id) => parseInt(id, 10))
                .filter((id) => Number.isFinite(id) && id > 0)
        );
        const total = targets.length;
        let consecutiveNetFails = 0;
        let netFailStreak = 0;

        for (let i = 0; i < targets.length; i++) {
            const chatId = targets[i];
            if (exclude.has(chatId)) continue;

            let rateLimitedEditOnly = false;
            const gate = broadcastRateLimit.canSendPromo(this.dbRaw, chatId, {
                channel: 'user',
                enforceWindow: !!options.enforceAutoRateLimit,
            });
            if (!gate.ok) {
                if (gate.allowEditOnly) rateLimitedEditOnly = true;
                else {
                    rateLimited++;
                    continue;
                }
            }

            if (consecutiveNetFails >= MAX_CONSEC_NET_FAILS) {
                if (netFailStreak >= NET_FAIL_ABORT_AFTER) {
                    logger.warn('[Broadcast] rede instável (DNS/API) — interrompendo envio PV', {
                        consecutive: consecutiveNetFails,
                        streak: netFailStreak,
                        remaining: total - i,
                    });
                    break;
                }
                logger.warn('[Broadcast] pausa breve — falhas de rede consecutivas', {
                    consecutive: consecutiveNetFails,
                    streak: netFailStreak,
                    remaining: total - i,
                    pauseSec: Math.round(NET_FAIL_PAUSE_MS / 1000),
                });
                await new Promise((r) => setTimeout(r, NET_FAIL_PAUSE_MS));
                consecutiveNetFails = 0;
            }

            try {
                const action = await this.deliverToUser(chatId, texto, opts, {
                    photo: options.photo,
                    requirePhoto: options.requirePhoto,
                    forcePhoto: options.forcePhoto,
                    editOnly: rateLimitedEditOnly,
                });
                if (action === 'sent') {
                    broadcastRateLimit.recordAutoSend(this.dbRaw, chatId, { channel: 'user' });
                }
                if (rateLimitedEditOnly && action !== 'edited' && action !== 'unchanged') {
                    rateLimited++;
                    continue;
                }
                if (action === 'edited') {
                    edited++;
                    consecutiveNetFails = 0;
                    netFailStreak = 0;
                } else if (action === 'sent') {
                    sent++;
                    consecutiveNetFails = 0;
                    netFailStreak = 0;
                } else if (action === 'blocked') {
                    blocked++;
                    consecutiveNetFails = 0;
                    netFailStreak = 0;
                } else if (action === 'skipped' || action === 'network_failed') {
                    skipped++;
                    consecutiveNetFails++;
                    if (action === 'network_failed') netFailStreak++;
                }
            } catch (e) {
                errors++;
                if (isLikelyNetworkFailure(e)) {
                    consecutiveNetFails++;
                    netFailStreak++;
                } else {
                    consecutiveNetFails = 0;
                    netFailStreak = 0;
                }
                if (errors <= 5) {
                    logger.warn(`[Broadcast] user ${chatId}:`, e.message);
                }
            }

            if (i > 0 && i % YIELD_EVERY_N === 0) {
                await yieldEventLoop();
            }

            await new Promise((r) => setTimeout(r, options.userDelayMs ?? 50));
        }

        logger.info(
            `[Broadcast] users total=${total} edited=${edited} sent=${sent} blocked=${blocked} skipped=${skipped} rateLimited=${rateLimited} errors=${errors}`
        );

        return { sent, edited, blocked, skipped, rateLimited, errors, total };
    }

    async _broadcastGroups(texto, parseMode, replyMarkup, options = {}) {
        if (options.syncGroupsFirst && this.groupService?.syncAllGroups) {
            try {
                await this.groupService.syncAllGroups();
            } catch (e) {
                logger.warn('[Broadcast] sync grupos:', e.message);
            }
        }

        const groups = this.groupService
            ? this.groupService.getGroupBroadcastTargets()
            : this.dbRaw()
                  .prepare(
                      `SELECT chat_id, title, type FROM telegram_groups
                       WHERE active=1 AND COALESCE(broadcast_enabled, 1)=1
                         AND type IN ('group', 'supergroup')`
                  )
                  .all();

        const cooldownMin = options.cooldownMs !== undefined
            ? options.cooldownMs / 60000
            : (this.groupSettings?.getCooldownMinutes() ?? 30);

        const botUser =
            options.botUsername ||
            process.env.BOT_USERNAME ||
            this.bot?.botInfo?.username ||
            '';
        const groupMarkup =
            options.groupReplyMarkup ??
            buildGroupPromoKeyboard(botUser, options.groupPromoOpts);
        const sendOpts = buildTelegramOpts(parseMode, groupMarkup);
        const cooldownMs =
            options.cooldownMs !== undefined
                ? options.cooldownMs
                : cooldownMin > 0
                  ? cooldownMin * 60 * 1000
                  : 0;

        const msgSvc = MsgService.get();
        const result = await msgSvc.broadcastToGroups(groups, texto, {
            ...sendOpts,
            photo: options.photo,
            requirePhoto: options.requirePhoto,
            forcePhoto: options.forcePhoto,
            cooldownMs,
            cooldownMode: options.cooldownMode || 'new_only',
            skipPermissionCheck: options.skipPermissionCheck !== false,
            allowPlainFallback: options.allowPlainFallback !== false,
            forceNew: options.forceNewGroups === true,
            delayMs: options.groupDelayMs,
            groupService: this.groupService,
            enforceAutoRateLimit: !!options.enforceAutoRateLimit,
            dbRaw: this.dbRaw,
        });

        return {
            edited: result.edited || 0,
            sent: result.sent || 0,
            failed: result.failed || 0,
            cooldown: result.cooldown || 0,
            skipped: result.skipped || 0,
            rateLimited: result.rateLimited || 0,
            total: groups.length,
            skippedCooldown: result.cooldown || 0,
        };
    }

    async _broadcastChannels(texto, parseMode, replyMarkup, options = {}) {
        if (options.syncChannelsFirst !== false && this.groupService?.syncAllGroups) {
            try {
                await this.groupService.syncAllGroups();
            } catch (e) {
                logger.warn('[Broadcast] sync canais:', e.message);
            }
        }

        const channels = this.groupService
            ? this.groupService.getChannelBroadcastTargets()
            : this.dbRaw()
                  .prepare(
                      `SELECT chat_id, title, type FROM telegram_groups
                       WHERE active=1 AND type='channel' AND bot_is_admin=1
                         AND COALESCE(broadcast_enabled, 1)=1`
                  )
                  .all();

        const botUser =
            options.botUsername ||
            process.env.BOT_USERNAME ||
            this.bot?.botInfo?.username ||
            '';
        const channelMarkup =
            options.channelReplyMarkup ??
            options.groupReplyMarkup ??
            buildGroupPromoKeyboard(botUser, options.channelPromoOpts || options.groupPromoOpts);
        const sendOpts = buildTelegramOpts(parseMode, channelMarkup);
        const cooldownMs =
            options.channelCooldownMs !== undefined
                ? options.channelCooldownMs
                : options.groupCooldownMs;

        const msgSvc = MsgService.get();
        const result = await msgSvc.broadcastToChannels(channels, texto, {
            ...sendOpts,
            photo: options.photo,
            requirePhoto: options.requirePhoto,
            forcePhoto: options.forcePhoto,
            cooldownMs,
            cooldownMode: options.cooldownMode || 'new_only',
            skipPermissionCheck: options.skipPermissionCheck !== false,
            allowPlainFallback: options.allowPlainFallback !== false,
            forceNew: !!options.forceNewChannels,
            delayMs: options.channelDelayMs ?? options.groupDelayMs,
            groupService: this.groupService,
            enforceAutoRateLimit: !!options.enforceAutoRateLimit,
            dbRaw: this.dbRaw,
        });

        return {
            edited: result.edited || 0,
            sent: result.sent || 0,
            failed: result.failed || 0,
            cooldown: result.cooldown || 0,
            skipped: result.skipped || 0,
            rateLimited: result.rateLimited || 0,
            total: channels.length,
        };
    }

    /**
     * Usuários + grupos + canais num único ciclo (divulgação automática).
     */
    async executeFullBroadcast(texto, parseMode = 'HTML', replyMarkup = null, options = {}) {
        if (this.running) {
            return { success: false, error: 'already_running' };
        }

        texto = normalizeBroadcastHtml(texto, parseMode);

        this.running = true;
        const startedAt = Date.now();
        const watchdog = setTimeout(() => {
            if (this.running) {
                logger.warn('[Broadcast] watchdog: liberando flag isRunning (>25min)');
                this.running = false;
            }
        }, 25 * 60 * 1000);

        try {
            const users = await this._broadcastUsers(texto, parseMode, replyMarkup, {
                userDelayMs: options.userDelayMs,
                photo: options.photo,
                requirePhoto: options.requirePhoto,
                forcePhoto: options.forcePhoto,
                enforceAutoRateLimit: !!options.enforceAutoRateLimit,
            });
            const groups = await this._broadcastGroups(texto, parseMode, replyMarkup, {
                photo: options.photo,
                requirePhoto: options.requirePhoto,
                forcePhoto: options.forcePhoto,
                cooldownMs: options.groupCooldownMs,
                groupReplyMarkup: options.groupReplyMarkup,
                groupPromoOpts: options.groupPromoOpts,
                botUsername: options.botUsername,
                skipPermissionCheck: options.skipPermissionCheck,
                forceNewGroups: options.forceNewGroups,
                syncGroupsFirst: options.syncGroupsFirst,
                groupDelayMs: options.groupDelayMs,
                cooldownMode: options.cooldownMode,
                enforceAutoRateLimit: !!options.enforceAutoRateLimit,
            });
            const channels = await this._broadcastChannels(texto, parseMode, replyMarkup, {
                photo: options.photo,
                requirePhoto: options.requirePhoto,
                forcePhoto: options.forcePhoto,
                channelCooldownMs: options.channelCooldownMs ?? options.groupCooldownMs,
                channelReplyMarkup: options.channelReplyMarkup ?? options.groupReplyMarkup,
                channelPromoOpts: options.channelPromoOpts ?? options.groupPromoOpts,
                botUsername: options.botUsername,
                skipPermissionCheck: options.skipPermissionCheck,
                forceNewChannels: options.forceNewChannels,
                syncChannelsFirst: options.syncChannelsFirst,
                channelDelayMs: options.channelDelayMs ?? options.groupDelayMs,
                cooldownMode: options.cooldownMode,
                enforceAutoRateLimit: !!options.enforceAutoRateLimit,
            });
            const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
            logger.info('[Broadcast] ciclo completo', {
                elapsedSec,
                users: users.total,
                groups: groups.total,
                channels: channels.total,
            });
            return { success: true, users, groups, channels, elapsedSec };
        } finally {
            clearTimeout(watchdog);
            this.running = false;
        }
    }

    /**
     * Divulgação somente em canais cadastrados.
     */
    async executeChannelBroadcast(texto, parseMode = 'HTML', replyMarkup = null, options = {}) {
        texto = normalizeBroadcastHtml(texto, parseMode);
        if (this.running) {
            return {
                success: false,
                error: 'already_running',
                edited: 0,
                sent: 0,
                failed: 0,
                cooldown: 0,
                total: 0,
            };
        }

        this.running = true;
        try {
            const r = await this._broadcastChannels(texto, parseMode, replyMarkup, options);
            return { success: true, ...r };
        } finally {
            this.running = false;
        }
    }

    /**
     * Broadcast para todos os usuários (DM).
     */
    async executeBroadcast(texto, parseMode = 'HTML', replyMarkup = null) {
        texto = normalizeBroadcastHtml(texto, parseMode);
        if (this.running) {
            return {
                success: false,
                error: 'already_running',
                sent: 0,
                edited: 0,
                blocked: 0,
                errors: 0,
                total: 0,
            };
        }

        this.running = true;
        try {
            const r = await this._broadcastUsers(texto, parseMode, replyMarkup);
            return { success: true, ...r };
        } finally {
            this.running = false;
        }
    }

    /**
     * Divulgação em grupos (edita slot / cooldown via MsgService).
     */
    async executeGroupBroadcast(texto, parseMode = 'HTML', replyMarkup = null, options = {}) {
        texto = normalizeBroadcastHtml(texto, parseMode);
        if (this.running) {
            return {
                success: false,
                error: 'already_running',
                edited: 0,
                sent: 0,
                failed: 0,
                cooldown: 0,
                total: 0,
            };
        }

        this.running = true;
        try {
            const r = await this._broadcastGroups(texto, parseMode, replyMarkup, options);
            return { success: true, ...r };
        } finally {
            this.running = false;
        }
    }

    /**
     * Gera texto de divulgação com IA (Zero Two GPT — textos variados).
     */
    async generateWithAI(theme) {
        const db = this.dbRaw();
        return generateBroadcastText(theme, db);
    }

    static formatUserResult(r) {
        if (r.error === 'already_running') {
            return '⚠️ Já há uma divulgação em andamento. Aguarde terminar.';
        }
        return (
            `✅ <b>Divulgação concluída!</b>\n\n` +
            `✏️ Editadas: <b>${r.edited || 0}</b>\n` +
            `📤 Novas: <b>${r.sent || 0}</b>\n` +
            `🚫 Bloqueados: <b>${r.blocked || 0}</b>\n` +
            `⏭️ Ignorados: <b>${r.skipped || 0}</b>\n` +
            `❌ Erros: <b>${r.errors || 0}</b>\n` +
            `👥 Total: <b>${r.total || 0}</b>`
        );
    }

    static formatGroupResult(r) {
        if (r.error === 'already_running') {
            return '⚠️ Já há uma divulgação em andamento. Aguarde terminar.';
        }
        return (
            `✅ <b>Divulgação nos grupos concluída!</b>\n\n` +
            `🔄 Substituídas (apagou + nova): <b>${(r.sent || 0) + (r.edited || 0)}</b>\n` +
            `📤 Primeira vez no grupo: <b>${r.sent || 0}</b>\n` +
            `⏳ Pulados (cooldown): <b>${r.cooldown || 0}</b>\n` +
            `⏭️ Sem permissão de envio: <b>${r.skipped || 0}</b>\n` +
            `❌ Falhas: <b>${r.failed || 0}</b>\n` +
            `👥 Alvos na lista: <b>${r.total || 0}</b>`
        );
    }

    static formatChannelResult(r) {
        if (r.error === 'already_running') {
            return '⚠️ Já há uma divulgação em andamento. Aguarde terminar.';
        }
        return (
            `✅ <b>Divulgação nos canais concluída!</b>\n\n` +
            `🔄 Substituídas (apagou + nova): <b>${(r.sent || 0) + (r.edited || 0)}</b>\n` +
            `📤 Primeira vez no canal: <b>${r.sent || 0}</b>\n` +
            `⏳ Pulados (cooldown): <b>${r.cooldown || 0}</b>\n` +
            `⏭️ Sem permissão: <b>${r.skipped || 0}</b>\n` +
            `❌ Falhas: <b>${r.failed || 0}</b>\n` +
            `📡 Alvos: <b>${r.total || 0}</b>`
        );
    }

    static formatFullResult(r) {
        if (r.error === 'already_running') {
            return '⚠️ Já há uma divulgação em andamento. Aguarde terminar.';
        }
        const u = r.users || {};
        const g = r.groups || {};
        const c = r.channels || {};
        const bp = r.bridgePromo;
        const elapsed =
            r.elapsedSec != null ? `\n\n⏱️ Tempo: <b>${r.elapsedSec}s</b>` : '';
        let throttleBlock = '';
        try {
            const BroadcastAdaptiveThrottle = require('./BroadcastAdaptiveThrottle');
            throttleBlock = `\n\n🛡 <i>${BroadcastAdaptiveThrottle.statusLine()}</i>`;
        } catch {
            /* ignore */
        }
        const rlU = u.rateLimited ? ` · ⏸️ Limite: ${u.rateLimited}` : '';
        const rlG = g.rateLimited ? ` · ⏸️ Limite: ${g.rateLimited}` : '';
        const rlC = c.rateLimited ? ` · ⏸️ Limite: ${c.rateLimited}` : '';
        let bridgeBlock = '';
        if (bp && !bp.skipped && (bp.total > 0 || bp.sent > 0 || bp.edited > 0 || bp.failed > 0)) {
            const rlB = bp.rateLimited ? ` · ⏸️ Limite: ${bp.rateLimited}` : '';
            bridgeBlock =
                `\n\n<b>📡 Ponte MTProto</b> (grupos sem bot · alvos: ${bp.total || 0})\n` +
                `🔄 Substituídas: ${bp.sent || 0} · ✏️ Editadas: ${bp.edited || 0} · ❌ ${bp.failed || 0}${rlB}`;
        } else if (bp?.skipped) {
            bridgeBlock = `\n\n<b>📡 Ponte MTProto:</b> indisponível (${bp.reason || '—'})`;
        }
        const totalImpact =
            (u.sent || 0) + (u.edited || 0) + (g.sent || 0) + (g.edited || 0) +
            (c.sent || 0) + (c.edited || 0) + (bp?.sent || 0) + (bp?.edited || 0);
        const hint =
            totalImpact === 0
                ? '\n\n⚠️ <i>Nenhuma entrega efetiva — limite anti-ban ativo. Próximo ciclo tenta edição nos slots existentes.</i>'
                : '\n\n<i>Grupos/canais: nova mensagem no feed quando há cota; com limite, edita o slot existente.</i>';
        return (
            `✅ <b>Divulgação completa!</b>\n\n` +
            `<b>👤 Usuários</b> (alvos: ${u.total || '—'})\n` +
            `✏️ Editadas: ${u.edited || 0} · 📤 Novas: ${u.sent || 0} · 🚫 Bloq: ${u.blocked || 0} · ⏭️ ${u.skipped || 0}${rlU}\n\n` +
            `<b>👥 Grupos</b> (alvos: ${g.total || 0})\n` +
            `✏️ Editadas: ${g.edited || 0} · 📤 Novas: ${g.sent || 0} · ⏳ Cooldown: ${g.cooldown || 0} · ⏭️ ${g.skipped || 0} · ❌ ${g.failed || 0}${rlG}\n\n` +
            `<b>📡 Canais</b> (alvos: ${c.total || 0})\n` +
            `✏️ Editadas: ${c.edited || 0} · 📤 Novas: ${c.sent || 0} · ⏳ Cooldown: ${c.cooldown || 0} · ⏭️ ${c.skipped || 0} · ❌ ${c.failed || 0}${rlC}` +
            bridgeBlock +
            throttleBlock +
            elapsed +
            hint
        );
    }
}

module.exports = { BroadcastService };
