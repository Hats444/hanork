'use strict';

const AffiliateCore = require('../../../modules/affiliate/AffiliateCore');
const { shouldAutoStartWelcomeTour } = require('./userWelcomeTour');

const START_TEXT_RE = /^\/start(?:@\w+)?(?:\s+(.*))?$/i;

function parseStartPayload(ctx) {
    if (ctx.startPayload != null && String(ctx.startPayload).trim()) {
        return String(ctx.startPayload).trim();
    }
    const text = ctx.message?.text || '';
    const m = text.match(START_TEXT_RE);
    return (m?.[1] || '').trim();
}

/**
 * @param {object} deps
 * @returns {(ctx: import('telegraf').Context) => Promise<void>}
 */
function createStartCommandHandler(deps) {
    const {
        logger, prisma, processAffiliateRef, isGroupChat, groupGuard, bot: telegramBot,
        CONFIG, getProductById, startBuyProduct, sendProductWithPhoto, Msg, deferBackground,
        openUserCatalog, sendMainMenu, scheduleNewMemberAlerts,
        isShopAreaStartPayload, resolveShopStartPayload,
        startWelcomeTour, isAdmin,
    } = deps;

    return async function handleStartCommand(ctx) {
        const payload = parseStartPayload(ctx);
        logger.info('[TELEGRAM] /start processando', { uid: ctx.from?.id, chat: ctx.chat?.type, payload: payload || '' });

        ctx.sendChatAction('typing').catch(() => {});

        try {
            let isNew = false;
            try {
                const existing = await prisma.user.findUnique({
                    where: { telegram_id: ctx.from.id.toString() },
                });
                isNew = !existing;
                const tenantId =
                    ctx.tenant?.mode === 'tenant' && ctx.tenant.id != null ? Number(ctx.tenant.id) : null;
                const upsertPayload = {
                    first_name: ctx.from.first_name || '',
                    username: ctx.from.username || '',
                    last_name: ctx.from.last_name || '',
                };
                if (tenantId) upsertPayload.tenant_id = tenantId;
                await prisma.user.upsert({
                    where: { telegram_id: ctx.from.id.toString() },
                    update: upsertPayload,
                    create: {
                        telegram_id: ctx.from.id.toString(),
                        ...upsertPayload,
                    },
                });
            } catch (e) {
                logger.warn('[start] user upsert:', e.message);
            }

            try {
                const { trackConversionEvent, trackFromTelegramId } = require('../../../services/ConversionEventService');
                if (isNew) {
                    const u = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
                    if (u?.id) trackConversionEvent(u.id, 'user_started', { payload: payload || null }, u.tenant_id);
                }
                trackFromTelegramId(ctx.from.id, 'menu_opened', { source: 'start' });
            } catch (_) { /* telemetry */ }

            let referredBy = null;
            if (payload && payload.startsWith('ref_')) {
                const refCode = AffiliateCore.parseStartRefPayload(payload) || payload.replace(/^ref_/i, '');
                await processAffiliateRef(ctx, refCode);
                if (isNew) referredBy = refCode;
            }

            if (!isGroupChat(ctx) && !isAdmin(ctx.from?.id)) {
                try {
                    const refGuard = require('../../referenceChannelGuard');
                    if (refGuard.isEnabled() && !(await refGuard.isMember(ctx))) {
                        const pending = payload
                            ? refGuard.capturePendingFromStartPayload(payload)
                            : { type: 'callback', data: 'menu:home' };
                        if (pending) refGuard.savePendingAction(ctx.from.id, pending);
                        if (isNew) {
                            logger.newUser(ctx.from.id, ctx.from.username);
                            scheduleNewMemberAlerts(ctx, referredBy, { startPayload: payload });
                        }
                        await refGuard.showGatePanel(ctx);
                        return;
                    }
                } catch (e) {
                    logger.warn('[start] ref channel gate:', e.message);
                }
            }

            if (isGroupChat(ctx)) {
                if (payload && payload.startsWith('buy_')) {
                    const pid = payload.replace('buy_', '');
                    await groupGuard.replyGroupRedirect(ctx, telegramBot, {
                        startPayload: `buy_${pid}`,
                        buttonText: 'Continuar compra no privado',
                        body:
                            'Para pagar com segurança, abra o bot no privado.\n\n' +
                            'Toque no botão, depois em <b>Iniciar</b>. A tela de pagamento abre no chat privado.',
                    });
                    return;
                }
                if (payload && payload.startsWith('produto_')) {
                    const pid = parseInt(payload.replace('produto_', ''), 10);
                    if (!isNaN(pid)) {
                        const p = await getProductById(pid);
                        if (p) return groupGuard.sendGroupProductPreview(ctx, telegramBot, p);
                    }
                }
                return groupGuard.sendGroupWelcome(ctx, telegramBot, { supportUrl: CONFIG.CONTATO_ESPECIALISTA });
            }

            if (payload && payload.startsWith('buy_')) {
                const pid = parseInt(payload.replace(/^buy_/, ''), 10);
                if (!isNaN(pid)) {
                    const ok = await startBuyProduct(ctx, pid);
                    if (ok) {
                        if (isNew) {
                            logger.newUser(ctx.from.id, ctx.from.username);
                            scheduleNewMemberAlerts(ctx, referredBy, { startPayload: payload });
                        }
                        return;
                    }
                }
            }

            if (payload && payload.startsWith('produto_')) {
                const pid = parseInt(payload.replace('produto_', ''), 10);
                if (!isNaN(pid)) {
                    const p = await getProductById(pid);
                    if (p) return sendProductWithPhoto(ctx, p);
                }
            }

            if (payload === 'downloads' || payload === 'download') {
                try {
                    const { showHub } = require('../../downloads/downloadsHandlers');
                    await sendMainMenu(ctx);
                    if (isNew) {
                        logger.newUser(ctx.from.id, ctx.from.username);
                        scheduleNewMemberAlerts(ctx, referredBy, { startPayload: payload });
                    }
                    deferBackground('start-downloads', async () => {
                        try {
                            await showHub(ctx);
                        } catch (e) {
                            logger.warn('[start] downloads hub:', e.message);
                        }
                    });
                    return;
                } catch (e) {
                    logger.warn('[start] downloads deep link:', e.message);
                }
            }

            if (payload === 'smm' || payload === 'servicos') {
                try {
                    const { isSmmEnabled } = require('../../../modules/smm/smmEnabled');
                    const { canUseSmmCatalog } = require('../../../modules/smm/smmAccess');
                    const { sendPlatforms } = require('../../../modules/smm/handlers/smmUiHandlers');
                    if (isSmmEnabled() && canUseSmmCatalog(ctx.from?.id, isAdmin)) {
                        await sendPlatforms(ctx, Msg);
                        if (isNew) {
                            logger.newUser(ctx.from.id, ctx.from.username);
                            scheduleNewMemberAlerts(ctx, referredBy, { startPayload: payload });
                        }
                        return;
                    }
                } catch (e) {
                    logger.warn('[start] smm deep link:', e.message);
                }
            }

            const VIRTUO_NUMEROS_ALIASES = {
                virtuo_wa_br: 'whatsapp brasil',
                numeros_brasil: 'whatsapp brasil',
                wa_br: 'whatsapp brasil',
                numeros_br: 'whatsapp brasil',
            };

            if (payload && VIRTUO_NUMEROS_ALIASES[payload]) {
                try {
                    const { isVirtuoEnabled } = require('../../../modules/virtuo/virtuoEnabled');
                    const { dispatchVirtuoFromText } = require('../../../modules/virtuo/commands/registerVirtuoCommands');
                    if (isVirtuoEnabled()) {
                        const ok = await dispatchVirtuoFromText(
                            ctx,
                            Msg,
                            VIRTUO_NUMEROS_ALIASES[payload],
                            isAdmin,
                            null
                        );
                        if (ok) {
                            if (isNew) {
                                logger.newUser(ctx.from.id, ctx.from.username);
                                scheduleNewMemberAlerts(ctx, referredBy, { startPayload: payload });
                            }
                            return;
                        }
                    }
                } catch (e) {
                    logger.warn('[start] virtuo numeros alias:', e.message);
                }
            }

            if (payload && payload.startsWith('numeros_')) {
                try {
                    const { isVirtuoEnabled } = require('../../../modules/virtuo/virtuoEnabled');
                    const { dispatchVirtuoFromText } = require('../../../modules/virtuo/commands/registerVirtuoCommands');
                    const query = decodeURIComponent(payload.replace(/^numeros_/, '').replace(/_/g, ' '));
                    if (isVirtuoEnabled() && query.trim()) {
                        const ok = await dispatchVirtuoFromText(ctx, Msg, query, isAdmin, null);
                        if (ok) {
                            if (isNew) {
                                logger.newUser(ctx.from.id, ctx.from.username);
                                scheduleNewMemberAlerts(ctx, referredBy, { startPayload: payload });
                            }
                            return;
                        }
                    }
                } catch (e) {
                    logger.warn('[start] virtuo numeros deep link:', e.message);
                }
            }

            if (payload === 'sms' || payload === 'virtuo' || payload === 'numero' || payload === 'numeros') {
                try {
                    const { isVirtuoEnabled } = require('../../../modules/virtuo/virtuoEnabled');
                    const { canUseVirtuoCatalog } = require('../../../modules/virtuo/virtuoAccess');
                    const { sendHome } = require('../../../modules/virtuo/handlers/virtuoUiHandlers');
                    if (isVirtuoEnabled() && canUseVirtuoCatalog(ctx.from?.id, isAdmin)) {
                        await sendHome(ctx, Msg);
                        if (isNew) {
                            logger.newUser(ctx.from.id, ctx.from.username);
                            scheduleNewMemberAlerts(ctx, referredBy, { startPayload: payload });
                        }
                        return;
                    }
                } catch (e) {
                    logger.warn('[start] virtuo deep link:', e.message);
                }
            }

            const HANDIV_START_ALIASES = new Set([
                'handiv',
                'hanorkdiv',
                'wadv',
                'wadiv',
                'zap',
                'zappro',
                'divulgacao',
                'div',
            ]);
            const payloadLower = payload ? String(payload).toLowerCase() : '';
            if (payloadLower === 'handiv_connect') {
                try {
                    const {
                        isWaDivulgacaoEnabled,
                    } = require('../../../modules/wa-divulgacao/handlers/waDivulgacaoUiHandlers');
                    const { getWaDivulgacaoLoginService } = require('../../../modules/wa-divulgacao/waDivulgacaoLoginService');
                    if (isWaDivulgacaoEnabled()) {
                        const login = getWaDivulgacaoLoginService();
                        await login.showConnectChoice(ctx);
                        return;
                    }
                } catch (e) {
                    logger.warn('[start] handiv_connect:', e.message);
                }
            }
            if (payloadLower === 'handiv_tour') {
                try {
                    const Onboarding = require('../../../modules/wa-divulgacao/waDivulgacaoOnboardingService');
                    const { waDivulgacaoPanel } = require('../../../modules/wa-divulgacao/helpers/waDivulgacaoPanelUi');
                    const { isWaDivulgacaoEnabled } = require('../../../modules/wa-divulgacao/handlers/waDivulgacaoUiHandlers');
                    const Msg = require('../../../telegram/Msg');
                    if (isWaDivulgacaoEnabled()) {
                        await waDivulgacaoPanel(
                            ctx,
                            Msg,
                            Onboarding.buildTourMessage('connect'),
                            Onboarding.tourKeyboard('connect')
                        );
                        return;
                    }
                } catch (e) {
                    logger.warn('[start] handiv_tour:', e.message);
                }
            }
            if (payload && HANDIV_START_ALIASES.has(payloadLower)) {
                try {
                    const {
                        sendWaDivulgacaoHome,
                        isWaDivulgacaoEnabled,
                    } = require('../../../modules/wa-divulgacao/handlers/waDivulgacaoUiHandlers');
                    if (isWaDivulgacaoEnabled()) {
                        await sendWaDivulgacaoHome(ctx);
                        if (isNew) {
                            logger.newUser(ctx.from.id, ctx.from.username);
                            scheduleNewMemberAlerts(ctx, referredBy, { startPayload: payload });
                        }
                        return;
                    }
                } catch (e) {
                    logger.warn('[start] Hanork Div deep link:', e.message);
                }
            }

            if (isGroupChat(ctx) && isShopAreaStartPayload(payload)) {
                await groupGuard.replyGroupRedirect(ctx, telegramBot, {
                    startPayload: resolveShopStartPayload(),
                    buttonText: 'Comprar agora no privado',
                    title: 'Loja Hanork',
                    body:
                        'Toque no botão, depois em <b>Iniciar</b>. O <b>catálogo</b> abre na hora.\n\n' +
                        'PIX automático | entrega instantânea após pagamento.',
                });
                return;
            }

            if (isShopAreaStartPayload(payload)) {
                try {
                    await Msg.reply(ctx, 'Abrindo catálogo…', { parse_mode: 'HTML' });
                } catch { /* ignore */ }
                deferBackground('start-shop', async () => {
                    try {
                        await openUserCatalog(ctx, { mode: 'hub' });
                        if (isNew) {
                            logger.newUser(ctx.from.id, ctx.from.username);
                            scheduleNewMemberAlerts(ctx, referredBy, { startPayload: payload });
                        }
                    } catch (e) {
                        logger.error('[start] shop catalog:', e.message);
                        try {
                            await Msg.reply(
                                ctx,
                                '<b>Olá!</b>\n\nToque em /start de novo ou use /cat para ver o catálogo.',
                                { parse_mode: 'HTML' }
                            );
                        } catch { /* ignore */ }
                    }
                });
                return;
            }

            if (
                isNew &&
                typeof startWelcomeTour === 'function' &&
                shouldAutoStartWelcomeTour(ctx, {
                    isNew: true,
                    payload,
                    isAdmin: isAdmin(ctx.from?.id),
                    isGroupChat: isGroupChat(ctx),
                })
            ) {
                logger.newUser(ctx.from.id, ctx.from.username);
                scheduleNewMemberAlerts(ctx, referredBy, { startPayload: payload });
                await startWelcomeTour(ctx);
                return;
            }

            await sendMainMenu(ctx);

            if (isNew) {
                logger.newUser(ctx.from.id, ctx.from.username);
                scheduleNewMemberAlerts(ctx, referredBy, { startPayload: payload });
            }
        } catch (e) {
            logger.error('[start] falha:', e.message);
            try {
                await Msg.reply(ctx,
                    '<b>Olá!</b>\n\nToque em /start de novo ou use /cat para ver o catálogo.',
                    { parse_mode: 'HTML' }
                );
            } catch { /* ignore */ }
        }
    };
}

/**
 * B3 — handler /start (move-only de bot.js).
 */
function registerStartHandler(bot, deps) {
    const handleStart = createStartCommandHandler(deps);

    const guardedStart = async (ctx) => {
        if (ctx.telegramEvent?.skipUserPipeline) return;
        await handleStart(ctx);
    };

    bot.start(guardedStart);

    // Fallback: se o matcher nativo bot.start falhar (entities/@bot/ctx.me), ainda responde.
    bot.hears(START_TEXT_RE, guardedStart);
}

module.exports = { registerStartHandler, createStartCommandHandler, parseStartPayload };
