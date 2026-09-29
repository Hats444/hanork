/**
 * mainMiddleware.js — Middleware principal do bot
 *
 * Extraído de bot.js para modularização incremental.
 * Zero breaking changes — exporta função compatível com bot.use().
 *
 * Responsabilidades:
 *  1. Anti-spam e rate limiting
 *  2. Logging estruturado
 *  3. Rastreamento de grupos
 *  4. Bloqueio de ações sensíveis em grupos
 *  5. ContextGuard para callbacks padronizados
 *  6. Modo manutenção
 *  7. Onboarding intercept
 *  8. Performance monitoring (SLOW warns)
 */

const logger = require('../../config/logger');
const Msg = require('../Msg');
const groupGuard = require('../groupGuard');
const { handleSpamCheck } = require('./spamGuardMiddleware');
const { buildManualBanMessage } = require('../../modules/security/BanMessages');
const { markFreshUi, isSlashCommandMessage } = require('../freshUi');

/**
 * Cria o middleware principal do bot.
 *
 * @param {object} deps - Dependências injetadas (sem circular imports)
 * @param {object} deps.antiSpam        - Instância AntiSpam
 * @param {object} deps.commandLimiter  - Instância CommandRateLimiter
 * @param {object} deps.bot             - Instância Telegraf (para getMe)
 * @param {object} deps.stateManager    - DistributedStateManager
 * @param {object} deps.config          - CONFIG object
 * @param {Function} deps.isAdmin       - (uid) => boolean
 * @param {Function} deps.upsertGroup   - (chat) => void
 * @param {Function} deps.upsertGroupMember - (chatId, from) => void
 * @param {Function} deps.isOnboarding  - (uid) => boolean
 * @param {Function} deps.handleOnboardingCallback  - async (ctx) => boolean
 * @param {Function} deps.handleOnboardingMessage   - async (ctx) => boolean
 * @param {object}   deps.TEXTO         - Textos do bot
 * @param {Function} deps.getMaintenanceMode - () => boolean
 * @returns {Function} Telegraf middleware
 */
function createMainMiddleware(deps) {
    const {
        antiSpam,
        commandLimiter,
        bot,
        stateManager,
        config,
        isAdmin,
        upsertGroup,
        upsertGroupMember,
        isOnboarding,
        handleOnboardingCallback,
        handleOnboardingMessage,
        getMaintenanceMode,
        isBannedOverride,
        bannedUsers,
        adminActivityNotifier,
    } = deps;

    // isBannedOverride permite combinar ban manual + anti-spam ban
    const checkBanned = isBannedOverride || ((uid) => antiSpam.isBanned(uid));

    return async (ctx, next) => {
        const uid = ctx.from?.id;
        if (!uid) return next();

        // Ignorar bots do sistema Telegram
        if (ctx.from?.is_bot) return next();

        const eventMeta = ctx.telegramEvent;
        const isSystemEvent = eventMeta?.skipUserPipeline;

        // Eventos de sistema (entrada/saída/título/etc.) — nunca anti-spam, menu, IA ou vendas
        if (isSystemEvent) return next();

        const isCallback = !!ctx.callbackQuery;

        // 1. Ban manual (/ban ou painel admin)
        const manualBanned = bannedUsers?.has?.(uid);
        if (manualBanned) {
            if (!isCallback) {
                logger.warn(`[TELEGRAM] bloqueado (ban manual) uid=${uid}`);
                try {
                    if (ctx.chat?.type === 'private') {
                        await Msg.reply(ctx, buildManualBanMessage('suspensão administrativa da conta'));
                    } else {
                        await ctx.reply(buildManualBanMessage('suspensão administrativa da conta'), {
                            parse_mode: 'HTML',
                            disable_web_page_preview: true,
                        });
                    }
                } catch { /* ignore */ }
            }
            return;
        }

        // 2. Penalidade ativa (anti-spam) — mensagem clara, sem silêncio
        const banCheck = checkBanned(uid);
        if (banCheck.banned) {
            if (!isCallback) {
                logger.warn(`[TELEGRAM] bloqueado (anti-spam) uid=${uid}`);
                await handleSpamCheck(ctx, {
                    allowed: false,
                    reason: banCheck.permanent ? 'blacklist' : 'banned',
                    permanent: banCheck.permanent,
                    violation: banCheck.violation,
                    count: banCheck.count,
                    remaining: banCheck.remaining,
                    notify: antiSpam.shouldNotifyUser(uid),
                });
            }
            return;
        }

        // 3. Anti-spam — somente mensagens reais com texto ou legenda (nunca eventos de sistema)
        const msgText =
            ctx.message?.text ||
            ctx.message?.caption ||
            ctx.editedMessage?.text ||
            ctx.editedMessage?.caption ||
            '';
        const { shouldRunAntiSpam } = require('../events/TelegramEventClassifier');
        if (!isCallback && shouldRunAntiSpam(ctx)) {
            const result = antiSpam.check(uid, msgText);
            if (!result.allowed) {
                await handleSpamCheck(ctx, result);
                return;
            }
        }

        // 2.3. Canal de referências obrigatório (loja, downloads, conta…)
        try {
            const refGuard = require('../referenceChannelGuard');
            if (await refGuard.interceptIfNeeded(ctx, bot, isAdmin)) return;
        } catch (e) {
            logger.warn('[refChannel] middleware:', e.message);
        }

        // 2.4. Comandos bloqueados em grupos (checkout, pix, conta…)
        if (await groupGuard.handleGroupCommand(ctx, bot, isAdmin)) return;

        // 2.45. Comando no PV → resposta nova no fim do chat (não editar menu antigo)
        if (!isCallback && ctx.chat?.type === 'private' && isSlashCommandMessage(ctx)) {
            markFreshUi(ctx);
        }

        // 2.46. Mensagem de texto no PV → conta para painel distante
        if (!isCallback && ctx.chat?.type === 'private' && msgText && !msgText.startsWith('/')) {
            try {
                const { trackUserMessageSincePanel } = require('../panelDistance');
                if (Msg.instance?.lastMenuMsg) {
                    await trackUserMessageSincePanel(Msg.instance.lastMenuMsg, ctx.chat.id);
                }
            } catch {
                /* ignore */
            }
        }

        // 2.5. Rate limiting por comando
        if (ctx.message?.text?.startsWith('/') && !isAdmin(uid)) {
            const cmdLimit = commandLimiter.check(uid, ctx.message.text);
            if (!cmdLimit.allowed) {
                logger.warn(`[TELEGRAM] rate limit uid=${uid} cmd=${cmdLimit.command} retryAfter=${cmdLimit.retryAfter}s`);
                try {
                    const cooldownTxt = `⚠️ Comando <b>${cmdLimit.command}</b> em cooldown. Aguarde ${cmdLimit.retryAfter}s.`;
                    if (ctx.chat?.type === 'private') {
                        await Msg.reply(ctx, cooldownTxt);
                    } else {
                        await ctx.reply(cooldownTxt, { parse_mode: 'HTML' });
                    }
                } catch { }
                return;
            }
        }

        // 3. Log estruturado + aviso admin (PV, grupos e callbacks — exceto admins e eventos de sistema)
        const uname = ctx.from?.username || String(uid);
        const notifyAdmin = (kind, value, extra = {}) => {
            try {
                adminActivityNotifier?.notifyTelegramAction?.(ctx, kind, value, extra);
            } catch { /* ignore */ }
        };

        if (!isSystemEvent && ctx.message?.text) {
            if (ctx.message.text.startsWith('/')) {
                const cmdLine = ctx.message.text.split('\n')[0].trim();
                logger.cmd(uid, uname, cmdLine.split(' ')[0]);
                const extra = {};
                if (/^\/start\b/i.test(cmdLine)) {
                    const payload = cmdLine.split(/\s+/).slice(1).join(' ').trim();
                    if (payload) extra.startPayload = payload;
                }
                notifyAdmin('cmd', cmdLine, extra);
            } else {
                logger.msg(uid, uname, ctx.message.text);
                if (ctx.chat?.type === 'private') {
                    notifyAdmin('msg', ctx.message.text, { note: 'PV' });
                } else if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
                    notifyAdmin('msg', ctx.message.text, { note: 'grupo' });
                }
            }
        } else if (!isSystemEvent && ctx.callbackQuery?.data) {
            logger.action(uid, uname, ctx.callbackQuery.data);
            notifyAdmin('btn', ctx.callbackQuery.data);
        } else if (!isSystemEvent && ctx.message && ctx.chat?.type === 'private') {
            const m = ctx.message;
            const cap = m.caption || '';
            if (m.photo?.length) notifyAdmin('media', cap, { mediaType: 'photo', note: 'PV', caption: cap });
            else if (m.document) notifyAdmin('media', cap || m.document.file_name, { mediaType: 'document', note: 'PV' });
            else if (m.video) notifyAdmin('media', cap, { mediaType: 'video', note: 'PV' });
            else if (m.voice) notifyAdmin('media', '', { mediaType: 'voice', note: 'PV' });
            else if (m.audio) notifyAdmin('media', cap, { mediaType: 'audio', note: 'PV' });
            else if (m.sticker) notifyAdmin('media', m.sticker.emoji || '', { mediaType: 'sticker', note: 'PV' });
            else if (m.contact) notifyAdmin('media', m.contact.phone_number || '', { mediaType: 'contact', note: 'PV' });
            else if (m.location) notifyAdmin('media', '', { mediaType: 'location', note: 'PV' });
        }

        // 3.5. Rastrear grupos — apenas mensagens/interações reais (não entrada/saída em massa)
        const chatType = ctx.chat?.type;
        if (!isSystemEvent && chatType === 'channel') {
            setImmediate(() => {
                try { upsertGroup(ctx.chat, 1); } catch { }
            });
        } else if (!isSystemEvent && (chatType === 'group' || chatType === 'supergroup')) {
            const chat = ctx.chat;
            const from = ctx.from;
            setImmediate(() => {
                try { upsertGroup(chat); } catch { }
                if (from && !from.is_bot) {
                    try { upsertGroupMember(chat.id, from); } catch { }
                }
            });
        }

        // 3.6. Grupos: bloqueio centralizado de callbacks sensíveis
        if (await groupGuard.handleGroupCallback(ctx, bot, isAdmin)) return;

        // 4. Modo manutenção
        if (getMaintenanceMode() && !isAdmin(uid)) {
            try {
                if (ctx.chat?.type === 'private') {
                    await Msg.reply(ctx, '🔧 Bot em <b>manutenção</b>. Voltamos em breve!');
                } else {
                    await ctx.reply('🔧 Bot em <b>manutenção</b>. Voltamos em breve!', { parse_mode: 'HTML' });
                }
            } catch { }
            return;
        }

        // 4.5. Onboarding intercept (antes do router de callbacks)
        if (ctx.callbackQuery?.data?.startsWith('onb_')) {
            try {
                const handled = await handleOnboardingCallback(ctx);
                if (handled) return;
            } catch (e) {
                logger.warn('[ONBOARDING] callback error:', e.message);
            }
            try {
                const { safeAnswerCbQuery } = require('../../utils/safeTelegram');
                await safeAnswerCbQuery(ctx, 'Sessão expirada. Use /registrar_loja', { show_alert: true });
            } catch { /* ignore */ }
            return;
        }
        if (ctx.message?.text && !ctx.message.text.startsWith('/')) {
            try {
                const onb = typeof isOnboarding === 'function' ? await isOnboarding(uid) : false;
                if (onb) {
                    const handled = await handleOnboardingMessage(ctx);
                    if (handled) return;
                }
            } catch { }
        }

        // 4.55. SMM wizard — antes do Intent AI (admin com link t.me/+ no checkout)
        if (ctx.message?.text && ctx.chat?.type === 'private' && !isSlashCommandMessage(ctx)) {
            try {
                const { tryHandleSmmWizardText } = require('../../modules/smm/smmWizardGuard');
                if (await tryHandleSmmWizardText(ctx, stateManager)) return;
            } catch (e) {
                logger.debug('[SMM] wizard middleware', { detail: e.message });
            }
        }

        // 5. Processar + medir performance
        const start = Date.now();
        try {
            await next();
        } catch (e) {
            const msg = e.message || '';
            const silent = [
                'query is too old',
                'message is not modified',
                'Promise timed out',
                'bot was blocked',
                'user is deactivated',
                'chat not found',
            ];
            if (!silent.some(s => msg.includes(s))) {
                logger.error(`Middleware error [${uid}]: ${msg}`);
            }
        }
        const ms = Date.now() - start;
        const slowWarnMs = Math.max(3000, Number(process.env.HANORK_SLOW_WARN_MS) || 6000);
        const slowInfoMs = Math.max(2000, Number(process.env.HANORK_SLOW_INFO_MS) || 3500);
        if (ms > slowWarnMs) {
            logger.warn(`SLOW ${ms}ms uid=${uid}`);
        } else if (ms > slowInfoMs) {
            logger.info(`SLOW ${ms}ms uid=${uid}`);
        }
    };
}

module.exports = createMainMiddleware;
