'use strict';

/**
 * B3 — catch-all de texto (move-only de bot.js).
 */
function registerTextCatchAllHandler(bot, deps) {
    const {
        Msg, Markup, Menu, logger, prisma, dbRaw, isAdmin, deferBackground,
        productWizard, ProductWizardService, editProductMode, ProductAdminService,
        productAdminDeps, wizardDeps, activeChats,
        joinChatAwaiting, groupService, bridgePoolService, broadcastMode,
        campanhaEmailMode, catalogSearchMode, supportMode, hanorkAssistMode,
        hanorkAssistantApi, adminMsgTarget, UserEmailService, loadProducts,
        sendProductWithPhoto, openUserCatalog, downloadsGuard, hanorkRouterNative, groupGuard,
        isGroupChat, isOnboarding,
        CONFIG, ADMIN_HTML, broadcastService, autoBroadcastService, executeFullBroadcast,
        getVipGroupId, getSupportGroupId, escapeMd, ticketCloseKeyboard,
        stateManager, correlationContext, tenantContext, getBotUsername,
    } = deps;

    const { smmWizardOwnsFlow, tryHandleSmmWizardText } = require('../../modules/smm/smmWizardGuard');

    async function tryHanorkShopBypass(ctx, txt) {
        if (!txt?.trim()) return false;

        if (isAdmin(ctx.from?.id) && (await editProductMode.has(ctx.from?.id))) return false;
        if (isAdmin(ctx.from?.id) && productWizard.has(ctx.from?.id)) return false;

        if (await smmWizardOwnsFlow(ctx, stateManager)) return false;

        const refGuard = require('../referenceChannelGuard');
        if (
            !isAdmin(ctx.from?.id) &&
            refGuard.isEnabled() &&
            ctx.chat?.type === 'private' &&
            !(await refGuard.isMember(ctx))
        ) {
            await refGuard.blockWithGate(ctx);
            return true;
        }

        const HanorkIntentEngine = require('../../services/hanork-ai/HanorkIntentEngine');
        const HanorkRouterGuard = require('../../services/hanork-ai/HanorkRouterGuard');
        const HanorkActionExecutor = require('../../services/hanork-ai/HanorkActionExecutor');
        const { ACTIONS } = require('../../config/hanork-ai-actions');
        const resolveGroup = () => downloadsGuard.resolveDownloadsGroupId();

        if (!HanorkRouterGuard.isHanorkAllowedChat(ctx, resolveGroup)) return false;

        const inPrivate = ctx.chat?.type === 'private';
        const inGroup = groupGuard.isGroupChat(ctx);
        const inSupport = inGroup && HanorkRouterGuard.isSupportGroupChat(ctx, resolveGroup);
        const classifyCtx = {
            isAdmin: isAdmin(ctx.from?.id),
            inPrivate,
            inGroup,
            inSupportGroup: inSupport,
            inMemberRouter: inPrivate || inGroup,
        };
        const peek = HanorkIntentEngine.peekOperationalRoute(txt, classifyCtx, {
            inPrivate,
            inGroup,
        });
        if (!peek.route) return false;

        const classification = peek.classification;
        if (classification.action === ACTIONS.ASK) {
            return false;
        }

        const action = classification.action;
        const params = { ...(classification.params || {}) };
        if (!action || action === ACTIONS.NONE || action === ACTIONS.SUPPORT) return false;

        const policy = HanorkIntentEngine.applyConfidencePolicy(
            { action, confidence: classification.confidence, params, sourceText: txt },
            classifyCtx
        );
        if (policy.action === ACTIONS.ASK) return false;

        const guard = HanorkRouterGuard.validateAction(policy.action, {
            inPrivate,
            isAdmin: isAdmin(ctx.from?.id),
            params: policy.params,
        });
        if (!guard.allowed) return false;

        try {
            const result = await HanorkActionExecutor.execute(
                ctx,
                {
                    action: policy.action,
                    params: policy.params,
                    confidence: policy.confidence,
                    sourceText: txt,
                },
                {
                    Msg,
                    logger,
                    bot,
                    loadProducts,
                    sendProductWithPhoto,
                    openUserCatalog,
                    showCart,
                    isAdmin,
                    groupGuard,
                    native: hanorkRouterNative,
                }
            );
            if (result?.ok !== false && !result?.needsClarify) {
                logger.info('[HanorkShopBypass] ok', { uid: ctx.from?.id, action: policy.action });
                return true;
            }
        } catch (e) {
            logger.warn('[HanorkShopBypass]', { uid: ctx.from?.id, error: e.message });
        }
        return false;
    }

    bot.on('text', async (ctx, next) => {
        const txt = ctx.message.text || '';
        const { isSlashCommandMessage } = require('../../telegram/freshUi');

        if (ctx.telegramEvent?.skipUserPipeline) return;

        // Comandos — handlers bot.command/start ficam ANTES deste catch-all.
        // next() aqui só alcançava middleware posterior (onboarding/globalError) e engolia /start.
        const isCmd =
            isSlashCommandMessage(ctx) ||
            txt.startsWith('/') ||
            (ctx.message.entities || []).some((e) => e.type === 'bot_command') ||
            ctx.state?.commandHandled;
        if (isCmd) {
            return;
        }

        // Link de afiliado colado no PV (preview do compartilhar) — ignorar, não mandar para IA
        if (ctx.chat?.type === 'private') {
            const { isAffiliateSharePaste } = require('../../modules/affiliate/AffiliateCore');
            if (isAffiliateSharePaste(txt)) return;

            try {
                const { handleWaDivulgacaoPrivateText } = require('../../modules/wa-divulgacao/handlers/waDivulgacaoPrivateText');
                if (await handleWaDivulgacaoPrivateText(ctx, { Msg, Markup, prisma })) return;
            } catch (e) {
                logger.warn('[WaDivulgacao] PV text handler failed', {
                    uid: ctx.from?.id,
                    error: e?.message,
                });
                await Msg.reply(
                    ctx,
                    '⚠️ Erro no Hanork Div. Tente de novo pelo painel ou use <code>/handiv</code>.',
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }
        }

        // Grupos: sem menu/IA/atendimento em mensagens comuns — só menção, suporte ou admin
        if (isGroupChat(ctx)) {
            const HanorkRouterGuard = require('../../services/hanork-ai/HanorkRouterGuard');
            const resolveGroup = () => downloadsGuard.resolveDownloadsGroupId();
            const inSupport = HanorkRouterGuard.isSupportGroupChat(ctx, resolveGroup);
            const me = ctx.botInfo?.username;
            const mentioned =
                me &&
                (txt.toLowerCase().includes(`@${String(me).toLowerCase()}`) ||
                    (ctx.message.entities || []).some(
                        (e) =>
                            e.type === 'mention' &&
                            txt.slice(e.offset, e.offset + e.length).toLowerCase() ===
                            `@${String(me).toLowerCase()}`
                    ));
            if (!inSupport && !mentioned && !isAdmin(ctx.from?.id)) {
                return;
            }
        }

        let smmBlocked = false;
        if (ctx.chat?.type === 'private' && txt.trim()) {
            if (await tryHandleSmmWizardText(ctx, stateManager)) return;
            smmBlocked = await smmWizardOwnsFlow(ctx, stateManager);
            if (smmBlocked) return;
        }

        // Admin: edição de produto — prioridade máxima (antes de bridge, broadcast, Hanork…)
        if (isAdmin(ctx.from.id)) {
            const { tryHandleProductEditText } = require('../handlers/productEditTextHandler');
            if (await tryHandleProductEditText(ctx, {
                isAdmin,
                editProductMode,
                Msg,
                productAdminDeps,
                escapeMd,
            })) {
                return;
            }

            const { tryHandleProductWizardText } = require('../handlers/productWizardTextHandler');
            if (await tryHandleProductWizardText(ctx, {
                isAdmin,
                productWizard,
                wizardDeps,
                Msg,
            })) {
                return;
            }
        }

        const { isAdminInProductAdminFlow } = require('../handlers/productAdminFlowGuard');
        const inProductAdminFlow = isAdmin(ctx.from.id)
            ? await isAdminInProductAdminFlow(ctx.from.id, { editProductMode, productWizard })
            : false;

        // Admin: login da ponte — código/SMS/2FA (antes de detectar telefone novo)
        if (!smmBlocked && isAdmin(ctx.from.id) && !inProductAdminFlow) {
            const { getBridgeLoginService } = require('../../services/BridgeLoginService');
            const bridgeLogin = getBridgeLoginService(dbRaw);
            if (bridgeLogin.isAwaiting(ctx.from.id)) {
                try {
                    const r = await bridgeLogin.handleText(ctx.from.id, txt);
                    if (r?.handled) {
                        joinChatAwaiting.delete(ctx.from.id);
                        if (r.needQrLaunch) {
                            if (r.message) await Msg.reply(ctx, r.message);
                            bridgeLogin.launchQr(ctx.from.id, ctx, {
                                background: true,
                                groupService,
                            });
                            return;
                        }
                        if (r.message && !r.silent) await Msg.reply(ctx, r.message);
                        return;
                    }
                } catch (e) {
                    logger.error('[BridgeLogin] handler:', e.message);
                    await bridgeLogin.cancel(ctx.from.id);
                    await Msg.reply(
                        ctx,
                        `❌ Erro na ponte: ${e.message}\n\nDigite <code>novo qr</code> ou <code>/conectar</code>.`
                    );
                    return;
                }
            }
        }

        // Admin: aviso se mandar telefone no PV (usar QR)
        if (!smmBlocked && isAdmin(ctx.from.id) && !inProductAdminFlow && ctx.chat?.type === 'private') {
            try {
                const { tryAutoPhoneLogin } = require('../../services/BridgeAutoService');
                const auto = await tryAutoPhoneLogin(ctx.from.id, txt, dbRaw);
                if (auto?.handled) {
                    joinChatAwaiting.delete(ctx.from.id);
                    await Msg.reply(ctx, auto.message);
                    return;
                }
            } catch (e) {
                logger.warn('[BridgeAuto] phone:', e.message);
            }
        }

        // Admin: link após /entrar (sem argumento)
        if (!smmBlocked && isAdmin(ctx.from.id) && !inProductAdminFlow && joinChatAwaiting.has(ctx.from.id)) {
            joinChatAwaiting.delete(ctx.from.id);
            const { JoinChatService, extractJoinTargets } = require('../../services/JoinChatService');
            const { getBridgeLoginService } = require('../../services/BridgeLoginService');

            const bridge = require('../../services/TelegramUserBridge');
            const needsBridge =
                bridge.canUseBridge() &&
                !bridge.isConfigured() &&
                extractJoinTargets(txt).some((l) => /t\.me\/\+/i.test(l));

            if (needsBridge) {
                const { connectBridge } = require('../../services/BridgeAutoService');
                const chatId = ctx.chat.id;
                const telegram = ctx.telegram;
                deferBackground('join-await-bridge', async () => {
                    await telegram.sendMessage(chatId, '🔗 <b>Link +</b>\n\n⏳ Preparando conexão…', {
                        parse_mode: 'HTML',
                    });
                    await connectBridge(ctx, dbRaw, { pendingLink: txt, groupService });
                });
                return;
            }

            const chatId = ctx.chat.id;
            const telegram = ctx.telegram;
            deferBackground('join-await-link', async () => {
                await telegram.sendMessage(chatId, '⏳ Tentando entrar…', { parse_mode: 'HTML' });
                const joiner = new JoinChatService(telegram, groupService);
                const batch = await joiner.joinFromText(txt);
                const summary = JoinChatService.formatSummary(batch);
                await telegram.sendMessage(chatId, summary.text, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: JoinChatService.getReplyKeyboardRows(summary),
                    },
                });
            });
            return;
        }

        // Admin PV: links de grupo → fila ponte automática (máx 30, mín 50 membros, upgrade por ranking)
        if (isAdmin(ctx.from.id) && !inProductAdminFlow && ctx.chat?.type === 'private') {
            const inBroadcast = await broadcastMode.has(ctx.from.id);
            let smmWizardActive = false;
            try {
                const { isSmmEnabled } = require('../../modules/smm/smmEnabled');
                const { hasActiveSmmWizard } = require('../../modules/smm/handlers/smmWizardHandler');
                if (isSmmEnabled()) {
                    smmWizardActive = await hasActiveSmmWizard(stateManager, ctx.from?.id);
                }
            } catch {
                /* ignore */
            }
            if (!inBroadcast && !smmWizardActive) {
                const { extractJoinTargets } = require('../../services/JoinChatService');
                if (extractJoinTargets(txt).length) {
                    const r = bridgePoolService.handleIncomingText(txt, { source: `admin_pv:${ctx.from.id}` });
                    if (r.queued > 0) {
                        const stats = bridgePoolService.getQueueStats();
                        await Msg.reply(
                            ctx,
                            `🔗 <b>${r.queued} convite(s) na fila</b>\n\n` +
                            `📡 Pool: <b>${stats.active}/${stats.max}</b> grupos\n` +
                            `⏳ Pendentes: <b>${stats.pending}</b>\n\n` +
                            `<i>Só links reais (+, t.me/c, @username válido). ` +
                            `Mín. ${bridgePoolService.minMembers()} membros.</i>`,
                            { parse_mode: 'HTML' }
                        );
                        return;
                    }
                }
            }
        }

        // Admin: cancelar modo broadcast
        if (isAdmin(ctx.from.id) && !inProductAdminFlow && (await broadcastMode.has(ctx.from.id))) {
            const cancelCmd = txt === '/cancelar' || txt === '/cancel' || txt.toLowerCase() === '/cancelar';
            if (cancelCmd) {
                await broadcastMode.delete(ctx.from.id);
                await Msg.edit(
                    ctx,
                    `${ADMIN_HTML.header('Broadcast cancelado')}\n\nNenhuma mensagem foi enviada.`,
                    Markup.inlineKeyboard([[{ text: '🔙 Divulgação', callback_data: 'a_bcast' }]])
                );
                return;
            }
        }

        // Admin: processar texto de divulgação (texto livre, IA, grupos)
        if (isAdmin(ctx.from.id) && !inProductAdminFlow && (await broadcastMode.has(ctx.from.id))) {
            const mode = await broadcastMode.get(ctx.from.id);
            await broadcastMode.delete(ctx.from.id);

            const { isDivulgacaoBusy, prepareFullDivulgacao } = require('../../plugins/zero-divu/fullDivulgacao');
            if (isDivulgacaoBusy({ broadcastService, autoBroadcastService })) {
                return Msg.reply(ctx, '⚠️ Já há uma divulgação em andamento. Aguarde terminar.');
            }

            const bcastTenantId = tenantContext.getCurrentNumericId();
            if (bcastTenantId) {
                const TenantService = require('../../modules/tenant/TenantService');
                const bcastLimit = TenantService.checkBroadcastLimit(bcastTenantId);
                if (!bcastLimit.allowed) {
                    return Msg.reply(
                        ctx,
                        `⚠️ Limite de divulgações do plano: <b>${bcastLimit.current}/${bcastLimit.max}</b> este mês.\n\n/planos ou /admin_loja → Planos`,
                        { parse_mode: 'HTML' }
                    );
                }
                TenantService.incrementBroadcastCount(bcastTenantId);
            }

            const { notifyBroadcastComplete } = require('../../telegram/broadcastNotify');
            const panelRef = {
                chatId: ctx.chat?.id,
                messageId: ctx.message?.message_id,
                isPhoto: !!(ctx.message?.photo?.length),
                userId: ctx.from?.id,
            };
            const backAdmin = Markup.inlineKeyboard([[{ text: '🔙 Admin', callback_data: 'a_menu' }]]);
            const backBcast = Markup.inlineKeyboard([[{ text: '🔙 Divulgação', callback_data: 'a_bcast' }]]);
            const adminIds = CONFIG.ID_DONO || [];
            const bcastNotifyOpts = {
                adminIds,
                userId: ctx.from?.id,
            };

            await notifyBroadcastComplete(
                bot.telegram,
                panelRef,
                '⏳ <b>Divulgação em andamento...</b>\n\n' +
                'Sincronizando grupos · usuários + grupos + canais + ponte MTProto.\n' +
                '<i>Pode levar 1–5 min. Esta mensagem atualiza ao terminar.</i>',
                backBcast,
                { ...bcastNotifyOpts, adminIds: [] }
            );

            const { buildGroupPromoKeyboard } = require('../../telegram/groupPromo');
            const catalogKb = Markup.inlineKeyboard([
                [{ text: '🛍️ Ver Catálogo', callback_data: 'cat' }],
                [{ text: '🏠 Menu', callback_data: 'menu:home' }],
            ]);
            const catalogKbGroups = buildGroupPromoKeyboard(getBotUsername());
            const groupBcastOpts = {
                groupCooldownMs: 0,
                cooldownMode: 'new_only',
                enforceAutoRateLimit: false,
                groupReplyMarkup: catalogKbGroups,
                skipPermissionCheck: true,
                syncGroupsFirst: true,
                groupDelayMs: 800,
            };

            setImmediate(() => {
                (async () => {
                    const t0 = Date.now();
                    try {
                        await prepareFullDivulgacao({
                            CONFIG,
                            loadProducts,
                            prisma,
                            logger,
                        }).catch(() => { });

                        let texto = txt;
                        let resultado;
                        let resumo = '';

                        if (mode.type === 'ia') {
                            const gerado = await broadcastService.generateWithAI(txt);
                            if (!gerado) {
                                await notifyBroadcastComplete(
                                    bot.telegram,
                                    panelRef,
                                    '❌ IA não respondeu. Verifique API_KEY_ZEROTWO ou tente novamente.',
                                    backBcast,
                                    bcastNotifyOpts
                                );
                                return;
                            }
                            texto = gerado.replace(/\*\*/g, '').replace(/\*/g, '');
                            resultado = await executeFullBroadcast(texto, 'HTML', catalogKb, groupBcastOpts);
                            if (resultado?.success) {
                                const bridgePromo = await autoBroadcastService.runBridgePromoAfterBot({
                                    texto,
                                    groupReplyMarkup: catalogKbGroups,
                                    source: 'manual_ia',
                                });
                                resultado = { ...resultado, bridgePromo };
                            }
                            resumo =
                                `${BroadcastService.formatFullResult(resultado)}\n\n<b>Texto gerado:</b>\n${texto.slice(0, 500)}${texto.length > 500 ? '…' : ''}`;
                        } else if (mode.type === 'grupos') {
                            const NL = require('../../services/hanork-ai/HanorkNlExtractors');
                            let broadcastText = txt;
                            let photo = null;
                            let groupKb = catalogKbGroups;
                            let productName = null;
                            if (NL.isLikelyAccidentalBroadcastText(txt) || NL.isGroupCatalogBroadcast(txt)) {
                                if (NL.isLikelyAccidentalBroadcastText(txt)) {
                                    await notifyBroadcastComplete(
                                        bot.telegram,
                                        panelRef,
                                        '⚠️ Texto inválido para divulgação.\n\n' +
                                        'Use <code>divulga em todos os grupos</code> para produto automático,\n' +
                                        'ou envie o HTML da mensagem (mín. 4 caracteres).',
                                        backBcast,
                                        bcastNotifyOpts
                                    );
                                    return;
                                }
                                const built = await autoBroadcastService._buildMessage();
                                broadcastText = built.texto;
                                photo = built.photo;
                                groupKb = built.groupKeyboard || catalogKbGroups;
                                productName = built.productName;
                            }
                            resultado = await broadcastService.executeGroupBroadcast(broadcastText, 'HTML', catalogKb, {
                                photo,
                                cooldownMs: 0,
                                cooldownMode: 'new_only',
                                groupReplyMarkup: groupKb,
                                skipPermissionCheck: true,
                                syncGroupsFirst: true,
                                groupDelayMs: 800,
                            });
                            resumo = BroadcastService.formatGroupResult(resultado);
                            if (productName) {
                                resumo = `📦 <b>${productName}</b>\n\n${resumo}`;
                            }
                        } else if (mode.type === 'canais') {
                            resultado = await broadcastService.executeChannelBroadcast(txt, 'HTML', catalogKb, {
                                channelCooldownMs: 0,
                                channelReplyMarkup: catalogKbGroups,
                                skipPermissionCheck: true,
                                syncChannelsFirst: true,
                                channelDelayMs: 1000,
                            });
                            resumo = BroadcastService.formatChannelResult(resultado);
                        } else {
                            resultado = await executeFullBroadcast(txt, 'HTML', catalogKb, groupBcastOpts);
                            if (resultado?.success) {
                                const bridgePromo = await autoBroadcastService.runBridgePromoAfterBot({
                                    texto: txt,
                                    groupReplyMarkup: catalogKbGroups,
                                    source: 'manual_texto',
                                });
                                resultado = { ...resultado, bridgePromo };
                            }
                            resumo = BroadcastService.formatFullResult(resultado);
                        }

                        if (resultado?.error === 'already_running') {
                            await notifyBroadcastComplete(
                                bot.telegram,
                                panelRef,
                                '⚠️ Já há uma divulgação em andamento.',
                                backBcast,
                                bcastNotifyOpts
                            );
                            return;
                        }

                        const sec = Math.round((Date.now() - t0) / 1000);
                        const finalTxt = `✅ <b>Divulgação finalizada</b> (${sec}s)\n\n${resumo || 'Concluído.'}`;
                        await notifyBroadcastComplete(bot.telegram, panelRef, finalTxt, backAdmin, bcastNotifyOpts);
                    } catch (e) {
                        logger.error('[Broadcast] admin text:', e.message);
                        await notifyBroadcastComplete(
                            bot.telegram,
                            panelRef,
                            `❌ Erro na divulgação: ${escapeMd(e.message)}`,
                            backBcast,
                            bcastNotifyOpts
                        );
                    }
                })();
            });
            return;
        }

        // Cadastro / verificação de e-mail
        if (await campanhaEmailMode.has(ctx.from.id)) {
            const handled = await UserEmailService.handleRegistrationText(ctx, txt, campanhaEmailMode);
            if (handled) return;
        }

        // Busca Virtuo (números SMS) — hub ou por app
        const { hasVirtuoSearch, getVirtuoSearch, clearVirtuoSearch } = require('../../modules/virtuo/state/virtuoSearchMode');
        if (hasVirtuoSearch(ctx.from.id)) {
            const pending = getVirtuoSearch(ctx.from.id);
            if (txt === '/cancelar' || txt.toLowerCase() === 'cancelar') {
                clearVirtuoSearch(ctx.from.id);
                const { CB: VirtuoCB } = require('../../modules/virtuo/utils/virtuoCallbackData');
                const cancelRows =
                    pending?.mode === 'service' && pending.serviceCode
                        ? [
                              [{ text: '🔙 Países', callback_data: VirtuoCB.countriesPage(pending.serviceCode, 0) }],
                              [{ text: '📱 Números SMS', callback_data: 'virtuo:home' }],
                          ]
                        : [
                              [{ text: '🔍 Buscar de novo', callback_data: VirtuoCB.countrySearch('hub') }],
                              [{ text: '📱 Números SMS', callback_data: 'virtuo:home' }],
                          ];
                return Msg.reply(ctx, '❌ Busca cancelada.', Markup.inlineKeyboard(cancelRows));
            }
            clearVirtuoSearch(ctx.from.id);
            if (!txt || txt.length < 2) {
                return Msg.reply(ctx, 'Digite pelo menos 2 caracteres para buscar.');
            }
            try {
                const { isVirtuoEnabled } = require('../../modules/virtuo/virtuoEnabled');
                const { canUseVirtuoCatalog } = require('../../modules/virtuo/virtuoAccess');
                const { dispatchVirtuoTextQuery } = require('../../modules/virtuo/handlers/virtuoUiHandlers');
                if (isVirtuoEnabled() && canUseVirtuoCatalog(ctx.from?.id, isAdmin)) {
                    await dispatchVirtuoTextQuery(ctx, Msg, txt, pending || { mode: 'hub' });
                    return;
                }
            } catch (e) {
                logger.warn('[virtuo] busca:', e.message);
            }
        }

        // Busca no catálogo — qualquer termo válido contra todos os produtos cadastrados
        if (catalogSearchMode.has(ctx.from.id)) {
            if (txt === '/cancelar' || txt.toLowerCase() === 'cancelar') {
                catalogSearchMode.delete(ctx.from.id);
                return Msg.reply(ctx, '❌ Busca cancelada.', Markup.inlineKeyboard([[{ text: '📂 Catálogo', callback_data: 'cat_hub' }]]));
            }
            catalogSearchMode.delete(ctx.from.id);

            const HanorkIntentEngine = require('../../services/hanork-ai/HanorkIntentEngine');
            const ProductSearchService = require('../../services/ProductSearchService');
            const routerCopy = require('../../config/hanork-router-copy');

            if (HanorkIntentEngine.isRecommendIntent(txt)) {
                const { pickProducts } = require('../../services/hanork-ai/HanorkActionExecutor');
                const products = await loadProducts();
                const picked = pickProducts(txt, products, 1);
                if (!picked.length) {
                    return Msg.reply(
                        ctx,
                        routerCopy.catalogEmpty || '🛍️ Nenhum produto disponível.',
                        Markup.inlineKeyboard([[{ text: '📂 Catálogo', callback_data: 'cat_hub' }]])
                    );
                }
                const p = picked[0];
                const safeName = String(p.name || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                await Msg.reply(ctx, routerCopy.recommendLead(safeName), null, { parse_mode: 'HTML' });
                return sendProductWithPhoto(ctx, p);
            }

            const query =
                HanorkIntentEngine.resolveCatalogSearchQuery(txt) || ProductSearchService.normalizeRawQuery(txt);
            if (!query || query.length < 2) {
                return Msg.reply(ctx, 'Digite pelo menos 2 caracteres para buscar.');
            }

            const products = await loadProducts();
            const { results } = ProductSearchService.searchProducts(products, query);
            if (!results.length) {
                try {
                    const UnifiedServiceSearch = require('../../services/UnifiedServiceSearch');
                    const { smm, virtuo } = UnifiedServiceSearch.moduleAccess(ctx.from?.id, isAdmin);
                    if (smm || virtuo) {
                        await UnifiedServiceSearch.dispatch(ctx, Msg, query, isAdmin);
                        return;
                    }
                } catch (e) {
                    logger.warn('[catalog] busca unificada:', e.message);
                }

                const rows = [
                    [{ text: '🔍 Buscar de novo', callback_data: 'cat_search' }],
                    [{ text: '📂 Catálogo', callback_data: 'cat_hub' }],
                ];
                const qLower = query.toLowerCase();
                let virtuoOn = false;
                let smmOn = false;
                try {
                    virtuoOn =
                        require('../../modules/virtuo/virtuoEnabled').isVirtuoEnabled() &&
                        require('../../modules/virtuo/virtuoAccess').canUseVirtuoCatalog(ctx.from?.id, isAdmin);
                } catch {
                    /* ignore */
                }
                try {
                    smmOn =
                        require('../../modules/smm/smmEnabled').isSmmEnabled() &&
                        require('../../modules/smm/smmAccess').canUseSmmCatalog(ctx.from?.id, isAdmin);
                } catch {
                    /* ignore */
                }
                if (virtuoOn && /whatsapp|whats|telegram|sms|n[uú]mero|instagram|discord|tiktok/i.test(qLower)) {
                    rows.unshift([{ text: '🔍 Buscar número SMS', callback_data: 'virtuo:srch:hub' }]);
                    rows.unshift([{ text: '📱 Números SMS', callback_data: 'virtuo:home' }]);
                } else if (virtuoOn) {
                    rows.unshift([{ text: '📱 Números SMS', callback_data: 'virtuo:home' }]);
                }
                if (smmOn && /seguidor|curtida|instagram|tiktok|youtube|smm|visualiza/i.test(qLower)) {
                    rows.unshift([{ text: '📈 Serviços SMM', callback_data: 'smm:home' }]);
                }
                return Msg.reply(
                    ctx,
                    `🔍 Nenhum resultado para <code>${query.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>.\n\n` +
                    '<i>Tente outro nome ou use um dos atalhos abaixo.</i>',
                    Markup.inlineKeyboard(rows),
                    { parse_mode: 'HTML' }
                );
            }

            await openUserCatalog(ctx, { mode: 'list', page: 0, query });
            return;
        }

        if (txt.startsWith('/')) return;

        // Hanork AI Router — pedidos naturais antes de ticket/suporte (recomenda, download, música…)
        if (txt) {
            let blockIntent = !!ctx.state?.smmWizardActive;
            if (!blockIntent && isAdmin(ctx.from.id) && (await editProductMode.has(ctx.from.id))) {
                blockIntent = true;
            }
            if (!blockIntent && isAdmin(ctx.from.id) && productWizard.has(ctx.from.id)) {
                blockIntent = true;
            }
            if (!blockIntent) {
                try {
                    const { shouldBlockHanorkIntent } = require('../../modules/smm/smmWizardGuard');
                    blockIntent = await shouldBlockHanorkIntent(ctx, stateManager);
                } catch {
                    /* ignore */
                }
            }
            if (!blockIntent) {
                const hanorkHandled = await hanorkAssistantApi.tryInvokeMessage(ctx, txt);
                if (hanorkHandled) return;
                if (await tryHanorkShopBypass(ctx, txt)) return;
            }
        }

        // 💬 RELAY BIDIRECIONAL DE TICKET
        const chatSess = await activeChats.get(ctx.chat.id);
        if (chatSess) {
            const ticket = await prisma.ticket.findById(chatSess.ticketId);
            if (!ticket || ticket.status !== 'open') {
                await activeChats.delete(ctx.chat.id);
                return Msg.sendOrEdit(ctx, '⚠️ Este ticket foi encerrado.', Menu.principal());
            }
            const senderLabel = chatSess.role === 'admin' ? '🛡️ *Suporte*' : `👤 <b>${escapeMd(ctx.from.first_name || 'Usuário')}</b>`;
            // Salvar no histórico
            await prisma.ticket.addMessage(chatSess.ticketId, chatSess.role, txt);
            // Se admin ainda não conectou, guardar mensagem e avisar usuário
            if (!chatSess.otherChatId) {
                await Msg.replyPlain(ctx, '📨 _Mensagem registrada. Aguardando suporte conectar..._', null, { parse_mode: 'HTML' });
                return;
            }
            // Repassar para o outro lado
            try {
                await bot.telegram.sendMessage(
                    chatSess.otherChatId,
                    `${senderLabel} (Ticket #${chatSess.ticketId}):\n${txt}`,
                    { parse_mode: 'HTML', reply_markup: ticketCloseKeyboard(chatSess.ticketId).reply_markup }
                );
            } catch (e) {
                await Msg.replyPlain(ctx, '❌ Erro ao enviar: ' + e.message);
                return;
            }
            // Confirmar envio ao remetente
            await Msg.replyPlain(ctx, '✅ _Enviado_', null, { parse_mode: 'HTML' });
            return;
        }

        // Admin: enviar msg direta a usuário (userinfo)
        if (isAdmin(ctx.from.id) && await adminMsgTarget.has(ctx.from.id)) {
            const targetId = await adminMsgTarget.get(ctx.from.id);
            await adminMsgTarget.delete(ctx.from.id);
            try {
                await bot.telegram.sendMessage(parseInt(targetId), `📢 <b>Mensagem do Suporte:</b>\n\n${escapeMd(txt)}`, { parse_mode: 'HTML' });
                return Msg.reply(ctx, `✅ Mensagem enviada para \<code>${targetId}\</code>!`, { parse_mode: 'HTML' });
            } catch (e) { return Msg.reply(ctx, '❌ Erro ao enviar: ' + e.message); }
        }



        // Usuário: ticket humano — Hanork operacional já foi tentado acima
        if (!smmBlocked && (await supportMode.has(ctx.chat.id))) {
            const hanorkFromSupport = await hanorkAssistantApi.tryInvokeMessage(ctx, txt, {
                escapeSupportMode: true,
            });
            if (hanorkFromSupport) return;

            await supportMode.delete(ctx.chat.id);
            const user = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
            if (!user) return Msg.reply(ctx, '❌ Faça /start primeiro.');
            const ticket = await prisma.ticket.create(user.id, ctx.from.id.toString(), txt);
            logger.ticket(ticket.id, ctx.from.id, ctx.from.username);
            // Colocar usuário em modo de chat (aguardando admin)
            await activeChats.set(ctx.chat.id, { ticketId: ticket.id, role: 'user', otherChatId: null, _ts: Date.now() });
            await Msg.replaceMenu(ctx,
                `✅ <b>Ticket #${ticket.id} aberto!</b>\n\n_Aguarde, nossa equipe conectará em instantes._\n_Continue enviando mensagens normalmente.\nClique abaixo para encerrar._`,
                ticketCloseKeyboard(ticket.id)
            );
            // Notificar admins com botão de entrar no chat
            for (const aid of CONFIG.ID_DONO) {
                try {
                    await bot.telegram.sendMessage(aid,
                        `🎫 <b>Novo Ticket #${ticket.id}</b>\n\n👤 ${escapeMd(ctx.from.first_name)} (\<code>${ctx.from.id}\</code>)\n📝 ${escapeMd(txt)}`,
                        {
                            parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
                                [{ text: '💬 Entrar no Chat', callback_data: `tchat_${ticket.id}` }],
                                [{ text: '🔴 Encerrar', callback_data: `tclose_${ticket.id}` }],
                            ]).reply_markup
                        }
                    );
                } catch { }
            }
            return;
        }

        // Operational Intelligence Layer — passiva (após modos críticos; não altera checkout/callbacks)
        try {
            const { tryProcessOperationalMessage } = require('../../modules/context');
            const ctxOil = await tryProcessOperationalMessage(ctx, {
                stateManager,
                dbRaw,
                getCorrelationId: () => ctx.correlationId || correlationContext.get(),
                isAdmin,
                isContextOperator: (c) => {
                    const t = tenantContext.getCurrent();
                    if (t?.mode === 'tenant') return tenantContext.isAdmin(c.from.id);
                    return isAdmin(c.from.id);
                },
                productWizard,
                supportMode,
                hanorkAssistMode,
                editProductMode,
                broadcastMode,
                adminMsgTarget,
                campanhaEmailMode,
                catalogSearchMode,
                activeChats,
                joinChatAwaiting,
                isOnboarding,
                bridgeLogin: require('../../services/BridgeLoginService').getBridgeLoginService(dbRaw),
            });
            if (ctxOil.processed && ctxOil.result?.routed?.ok) {
                if (ctxOil.suggestReply) {
                    await Msg.replyPlain(ctx, ctxOil.suggestReply, null, { parse_mode: 'HTML' });
                }
                return;
            }
        } catch (e) {
            logger.debug('[CONTEXT] failsafe', { error: e?.message });
        }

        // Respostas rápidas por palavras-chave
        const lower = txt.toLowerCase();
        if (lower.includes('preço') || lower.includes('preco') || lower.includes('quanto')) {
            return Msg.reply(ctx, '🛍️ Veja todos os preços no catálogo:', Markup.inlineKeyboard([[{ text: '🛍️ Ver Catálogo', callback_data: 'cat' }]]));
        }
        if (lower.includes('pagamento') || lower.includes('pix') || lower.includes('cartão') || lower.includes('pagar')) {
            return Msg.reply(ctx, '💳 Aceitamos *PIX*, *Cartão de Crédito* e *Boleto* via Mercado Pago.\n\nEscolha um produto para comprar:', Markup.inlineKeyboard([[{ text: '🛍️ Ver Catálogo', callback_data: 'cat' }]]));
        }
        if (
            (lower.includes('suporte') || lower.includes('problema')) &&
            !/\b(produto|music|video|baix|tocar|ouvir|carrinho|pix|comprar)\b/.test(lower)
        ) {
            return Msg.reply(
                ctx,
                `💬 <b>Precisa de ajuda?</b>\n\nUse <code>/hanork</code> para pedidos à loja ou abra ticket humano:`,
                Markup.inlineKeyboard([
                    [{ text: '✨ Assistente Hanork', callback_data: 'hanork:open' }],
                    [{ text: '🎫 Ticket humano', callback_data: 'hanork:ticket' }],
                ])
            );
        }
        if (
            lower.includes('grupo') ||
            lower.includes('vip') ||
            lower.includes('comunidade') ||
            lower.includes('canal') ||
            lower.includes('referencia')
        ) {
            const { channelMenuRow } = require('../referenceChannelGuard');
            const { CHANNEL_UI } = require('../../config/salesReferenceChannel');
            const rows = [];
            const refRow = channelMenuRow({ legacy: true });
            if (refRow) rows.push(refRow);
            rows.push([{ text: '🎫 Abrir ticket', callback_data: 'suporte_start' }]);
            return Msg.reply(
                ctx,
                `<b>${CHANNEL_UI.title}</b>\n\nAcompanhe vendas e novidades no canal. Precisa de ajuda humana? Abra um ticket.`,
                Markup.inlineKeyboard(rows)
            );
        }
        // Assistente IA (PV ou grupos) — em grupos exige citar Hanork ou /hanork
        if (isSlashCommandMessage(ctx) || ctx.state?.commandHandled || txt.startsWith('/')) return;
        if (isGroupChat(ctx)) return;
        await Msg.replaceMenu(
            ctx,
            'Não identifiquei sua solicitação. Use <code>/help</code> para ver todos os comandos ou o menu abaixo.',
            Menu.principal()
        );
    });
}

module.exports = { registerTextCatchAllHandler };
