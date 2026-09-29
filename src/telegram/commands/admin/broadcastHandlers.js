'use strict';

const { denySilent, denyCbSilent } = require('../../../utils/silencedAccess');

const { kb2, normalizeReplyMarkup } = require('../../menus/twoColKeyboard');
const destinationsPanel = require('../../admin/broadcastDestinations');
const {
    entrarNeedsBridge,
    fullDivulgacaoDeps,
    startFullDivulgacaoBackground,
    sendProgressPanel,
    updateAdminPanelMessage,
} = require('./shared');
const { pickAdminDeps } = require('./deps');
const { BroadcastService } = require('../../../services/BroadcastService');
const { deferBackground } = require('../../../utils/defer');
const {
    BROADCAST_RATE_WINDOW_MS,
    BROADCAST_MAX_PER_DESTINATION,
    formatBroadcastInterval,
} = require('../../../config/broadcastConfig');


/** Broadcast admin — M4 */
function registerBroadcastHandlers(bot, deps) {
    const d = pickAdminDeps(deps);
    const {
        prisma, dbRaw, Markup, isAdmin, ADMIN_HTML, Msg, Menu, logger,
        antiSpam, backup, broadcastMode, addProductMode, adminMsgTarget,
        editProductMode, giveawayMode, getMaintenanceMode, setMaintenanceMode,
        botSession, appendSessionDiscardedNote, getAutoBroadcastEnabled, setAutoBroadcastEnabled,
        getAutoBroadcastLastSent, getAutoBroadcastCount, AUTO_BROADCAST_INTERVAL, formatBroadcastInterval,
        getAutoBroadcastLastSummary, runAutoBroadcastNow, runBridgePromoNow, runBridgePromoAfterBot,
        emailService, loadProducts, executeBroadcast, executeFullBroadcast, broadcastService,
        sendAdminPanelWithPhoto, editAdminPanel, invalidateProductCache, invalidateBotUsername, formatTimer,
        carrinhos, UserService, AuditService, sendMainMenu, deliverProducts, confirmarSaldoReservado,
        showUsers, activeChats, openTicketChat, closeTicketChat, ticketCloseKeyboard,
        buildGiveawaysPanel, groupSettings, groupService, joinChatAwaiting,
    } = d;

    try {
        const { registerProductBroadcastHandlers } = require('../../../plugins/zero-divu/promo');
        registerProductBroadcastHandlers(bot, {
            isAdmin,
            Msg,
            Markup,
            logger,
            deferBackground:
                deps.deferBackground || require('../../../utils/defer').deferBackground,
            loadProducts,
            prisma,
            broadcastService,
            autoBroadcastService: deps.autoBroadcastService,
            executeFullBroadcast,
            runBridgePromoAfterBot,
            BroadcastService,
            sendProgressPanel,
            updateAdminPanelMessage,
            CONFIG: deps.CONFIG,
        });
    } catch (e) {
        logger.warn('[Broadcast] handlers produto:', e.message);
    }

    bot.action('a_bcast', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        if (broadcastMode && (await broadcastMode.has(ctx.from.id))) {
            await broadcastMode.delete(ctx.from.id);
        }
        await ctx.answerCbQuery();
        const users = await prisma.user.findMany();
        const st = groupService?.getStats?.() || {};
        const enabled = getAutoBroadcastEnabled();
        const intervalLbl = formatBroadcastInterval
            ? formatBroadcastInterval(AUTO_BROADCAST_INTERVAL)
            : `${Math.round(AUTO_BROADCAST_INTERVAL / 3600000)}h`;
        const rateLbl = `${BROADCAST_MAX_PER_DESTINATION}×/${formatBroadcastInterval(BROADCAST_RATE_WINDOW_MS)} por destino`;
        await editAdminPanel(ctx,
            `${ADMIN_HTML.header('Broadcast')}\n\n` +
            `Usuários: <b>${users.length}</b>\n` +
            `Grupos (bot): <b>${st.admin ?? 0}</b> admin | alvos: <b>${st.targets ?? 0}</b>\n` +
            `Ponte MTProto: <b>${st.bridgePromo ?? 0}</b> grupo(s) sem bot\n` +
            `Canais (admin): <b>${st.channelsAdmin ?? 0}</b> | alvos: <b>${st.channelTargets ?? 0}</b>\n\n` +
            `Auto: ${enabled ? ADMIN_HTML.green('Ativo') : ADMIN_HTML.red('Pausado')} ` +
            `(ciclo <b>${intervalLbl}</b> | <b>${rateLbl}</b> | rotaciona produtos)\n` +
            `${ADMIN_HTML.small('Auto = limite por destino. Texto, IA, Produto, Grupos e Canais = imediato (sem limite). IA auto usa template (AUTO_BROADCAST_USE_AI=1 para IA).')}`,
            kb2(Markup, [
                [{ text: 'Texto livre', callback_data: 'bcast_texto' }, { text: 'IA', callback_data: 'bcast_ia' }],
                [{ text: 'Produto', callback_data: 'bcast_produto' }, { text: 'Só grupos', callback_data: 'bcast_grupos' }],
                [{ text: 'Só canais', callback_data: 'bcast_canais' }],
                [{ text: 'Disparar auto agora', callback_data: 'bcast_run_now' }],
                [{ text: enabled ? 'Pausar auto' : 'Ativar auto', callback_data: 'bcast_toggle_auto' }],
                [{ text: 'Status', callback_data: 'bcast_status' }, { text: 'Alcance', callback_data: 'a_destinos' }],
                [{ text: 'Voltar admin', callback_data: 'a_menu' }],
            ]));
    });

    bot.action('bcast_toggle_auto', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const newVal = !getAutoBroadcastEnabled();
        setAutoBroadcastEnabled(newVal);
        await ctx.answerCbQuery(newVal ? 'Ativado — preparando canais' : 'Pausado');

        let extra = '';
        if (newVal) {
            const { isDivulgacaoBusy } = require('../../../plugins/zero-divu/fullDivulgacao');
            if (isDivulgacaoBusy(fullDivulgacaoDeps(deps))) {
                extra =
                    '\n\n<i>Já há uma divulgação rodando — o ciclo automático segue no intervalo configurado.</i>';
            } else {
                extra =
                    '\n\n<i>Primeira rodada completa iniciada (PV + grupos + canais + ponte + fila WA).</i>';
                setImmediate(() => {
                    startFullDivulgacaoBackground(ctx, deps, 'button_activate').catch((e) => {
                        deps.logger.warn('[Broadcast] toggle auto cycle:', e.message);
                    });
                });
            }
        }

        await Msg.edit(
            ctx,
            `Divulgação automática: <b>${newVal ? 'ATIVADA' : 'PAUSADA'}</b>${extra}`,
            kb2(Markup, [[{ text: 'Voltar broadcast', callback_data: 'a_bcast' }]])
        );
    });

    bot.action('bcast_run_now', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery('Disparando em todos os canais...');
        const { isDivulgacaoBusy } = require('../../../plugins/zero-divu/fullDivulgacao');
        if (isDivulgacaoBusy(fullDivulgacaoDeps(deps))) {
            return Msg.edit(
                ctx,
                'Aviso: Já há uma divulgação em andamento. Aguarde terminar.',
                kb2(Markup, [[{ text: 'Voltar broadcast', callback_data: 'a_bcast' }]])
            );
        }
        setImmediate(() => {
            startFullDivulgacaoBackground(ctx, deps, 'button_run_now').catch((e) => {
                logger.error('[Broadcast] bcast_run_now:', e.message);
            });
        });
    });

    bot.action('bcast_status', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const now = Date.now();
        const lastSent = getAutoBroadcastLastSent();
        const enabled = getAutoBroadcastEnabled();
        const ultima = lastSent ? new Date(lastSent).toLocaleString('pt-BR') : 'Nunca';
        const proxima = enabled && lastSent
            ? formatTimer(Math.max(0, AUTO_BROADCAST_INTERVAL - (now - lastSent)))
            : enabled ? 'Em breve' : 'Pausado';
        const summary = getAutoBroadcastLastSummary?.();
        const rateLbl = `${BROADCAST_MAX_PER_DESTINATION}×/${formatBroadcastInterval(BROADCAST_RATE_WINDOW_MS)} por destino (auto)`;
        let extra = '';
        if (summary?.users) {
            const prodLine = summary.productName
                ? `\nProduto: <b>${summary.productName}</b>${summary.productId ? ` (#${summary.productId})` : ''}`
                : '\nSem produto (catálogo vazio)';
            const rl = (n) => (Number(n) > 0 ? ` | limite ${n}` : '');
            extra =
                `\n\n<b>Último ciclo</b> (${summary.source || 'auto'})${prodLine}\n` +
                `Usuários: editados ${summary.users.edited || 0} | enviados ${summary.users.sent || 0}${rl(summary.users.rateLimited)}\n` +
                `Grupos: editados ${summary.groups?.edited || 0} | enviados ${summary.groups?.sent || 0}${rl(summary.groups?.rateLimited)}\n` +
                `Canais: editados ${summary.channels?.edited || 0} | enviados ${summary.channels?.sent || 0}${rl(summary.channels?.rateLimited)}`;
            if (summary.bridgePromo && !summary.bridgePromo.skipped) {
                extra +=
                    `\nPonte: editados ${summary.bridgePromo.edited || 0} | enviados ${summary.bridgePromo.sent || 0}` +
                    ` | alvos ${summary.bridgePromo.total || 0}${rl(summary.bridgePromo.rateLimited)}`;
            }
        }
        await Msg.edit(ctx,
            `<b>Status Divulgação</b>\n\n` +
            `Estado: ${enabled ? 'Ativo (padrão)' : 'Pausado'}\n` +
            `Ciclo auto: <b>${formatBroadcastInterval ? formatBroadcastInterval(AUTO_BROADCAST_INTERVAL) : 'n/d'}</b>\n` +
            `Limite auto: <b>${rateLbl}</b>\n` +
            `Manual (botões): <b>sem limite</b> — posta em todos os alvos\n` +
            `Última: ${ultima}\n` +
            `Próxima: ${proxima}\n` +
            `Ciclos: ${getAutoBroadcastCount()}` +
            extra,
            kb2(Markup, [[{ text: 'Voltar broadcast', callback_data: 'a_bcast' }]]));
    });

    bot.action('a_email', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const configured = emailService.isEmailConfigured();
        let emailCount = 0;
        try { emailCount = dbRaw().prepare("SELECT COUNT(*) as c FROM users WHERE email IS NOT NULL AND email_verified=1").get()?.c || 0; } catch { }
        await editAdminPanel(ctx,
            `${ADMIN_HTML.header('Email')}\n\nSMTP: ${configured ? ADMIN_HTML.green('' + process.env.SMTP_EMAIL) : ADMIN_HTML.red('Não configurado')}\nEmails verificados: ${emailCount}`,
            kb2(Markup, [
                [{ text: 'Broadcast', callback_data: 'email_broadcast' }, { text: 'Testar SMTP', callback_data: 'email_test' }],
                [{ text: 'Voltar admin', callback_data: 'a_menu' }],
            ]));
    });

    bot.action('email_test', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery('Testando...');
        if (!emailService.isEmailConfigured()) return editAdminPanel(ctx, `${ADMIN_HTML.header('SMTP')}\n\n${ADMIN_HTML.red('SMTP não configurado')}`, kb2(Markup, [[{ text: 'Voltar', callback_data: 'a_email' }]]));
        const adminUser = await prisma.user.findUnique({ where: { telegram_id: ctx.from.id.toString() } });
        const testEmail = adminUser?.email || process.env.SMTP_EMAIL;
        const html = emailService.createEmailTemplate(`<h2>SMTP funcionando!</h2>`);
        const result = await emailService.sendEmail(testEmail, 'Teste SMTP', html);
        await editAdminPanel(ctx, result.success ? `${ADMIN_HTML.green('Email enviado!')} Para: <code>${testEmail}</code>` : `${ADMIN_HTML.red('Erro:')} ${result.error?.slice(0, 200)}`, kb2(Markup, [[{ text: 'Voltar', callback_data: 'a_email' }]]));
    });

    bot.action('a_dashboard', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const site = (process.env.SITE_HANORK || '').replace(/\/$/, '');
        let body;
        const rows = [];
        if (site) {
            body =
                `${ADMIN_HTML.header('Dashboard Web')}\n\n` +
                `Produção:\n<code>${site}/admin</code>\n\n` +
                `<i>Use o seletor de loja no topo para filtrar dados SaaS.</i>`;
            rows.push([{ text: 'Abrir dashboard', url: `${site}/admin` }]);
        } else {
            const {
                formatAdminAccessTelegram,
                getAdminAccessUrls,
                refreshLanNetworkCache,
            } = require('../../../utils/dashboardNetwork');
            refreshLanNetworkCache();
            const urls = getAdminAccessUrls();
            body =
                `${ADMIN_HTML.header('Dashboard Web')}\n\n` +
                `${formatAdminAccessTelegram()}\n\n` +
                `<i>Use o seletor de loja no topo para filtrar dados SaaS.</i>`;
            if (urls.primaryLan) {
                rows.push([{ text: 'Abrir no celular (Wi-Fi)', url: urls.primaryLan }]);
            }
        }
        rows.push([{ text: 'Voltar admin', callback_data: 'a_menu' }]);
        await editAdminPanel(ctx, body, kb2(Markup, rows));
    });

    // grupos_status_cb
    bot.action('grupos_status_cb', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const stats = groupService ? groupService.getStats() : { total: 0, admin: 0, targets: 0, broadcastOn: 0 };
        const cd = groupSettings ? groupSettings.getCooldownMinutes() : 30;
        await editAdminPanel(ctx,
            `${ADMIN_HTML.header('Status Divulgação')}\n\n` +
            `Grupos: <b>${stats.total}</b> ativos | <b>${stats.admin}</b> admin | <b>${stats.targets}</b> alvos\n` +
            `Canais: <b>${stats.channels}</b> ativos | <b>${stats.channelsAdmin}</b> podem postar | <b>${stats.channelTargets}</b> alvos\n` +
            `Cooldown grupos: <b>${cd > 0 ? cd + ' min' : 'OFF'}</b>`,
            kb2(Markup, [[{ text: 'Voltar grupos', callback_data: 'a_grupos' }, { text: 'Canais', callback_data: 'a_canais' }], [{ text: 'Voltar admin', callback_data: 'a_menu' }]]));
    });

    // home_user — admin visualiza menu como usuário comum (delega para 'home')
    bot.action('home_user', async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            await denyCbSilent('admin_callback', ctx);
            return;
        }
        await ctx.answerCbQuery();
        const sendMainMenu = deps.sendMainMenu;
        if (typeof sendMainMenu === 'function') await sendMainMenu(ctx, true);
    });

    // bcast_texto
    bot.action('bcast_texto', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const { guardDivulgacaoBusy } = require('../../../plugins/zero-divu/fullDivulgacao');
        if (guardDivulgacaoBusy(ctx, fullDivulgacaoDeps(deps))) return;
        const cleared = botSession ? await botSession.enterAdminFlow(ctx, 'broadcast') : {};
        await broadcastMode.set(ctx.from.id, { type: 'texto', _ts: Date.now() });
        await Msg.edit(ctx,
            appendSessionDiscardedNote(
                '<b>Broadcast — texto livre</b>\n\nEnvie a mensagem (suporta HTML).\n\n' +
                '<i>Envia para usuários + grupos + canais + ponte MTProto.</i>\n\n' +
                '<i>/cancelar para sair.</i>',
                cleared
            ),
            kb2(Markup, [[{ text: 'Cancelar', callback_data: 'a_bcast' }]]));
        await ctx.answerCbQuery();
    });

    // bcast_ia
    bot.action('bcast_ia', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const { guardDivulgacaoBusy } = require('../../../plugins/zero-divu/fullDivulgacao');
        if (guardDivulgacaoBusy(ctx, fullDivulgacaoDeps(deps))) return;
        if (!process.env.API_KEY_ZEROTWO) {
            return ctx.answerCbQuery('API_KEY_ZEROTWO não configurada', { show_alert: true });
        }
        const cleared = botSession ? await botSession.enterAdminFlow(ctx, 'broadcast') : {};
        await broadcastMode.set(ctx.from.id, { type: 'ia', _ts: Date.now() });
        await Msg.edit(ctx,
            appendSessionDiscardedNote(
                '<b>Broadcast com IA</b>\n\n' +
                'Descreva o produto ou tema. A API Zero Two gera um texto <b>diferente a cada envio</b> ' +
                '(urgência, benefício, confiança, etc.).\n\n' +
                '<i>Usuários + grupos + canais + ponte MTProto.</i>\n\n' +
                '<i>/cancelar para sair</i>',
                cleared
            ),
            kb2(Markup, [[{ text: 'Cancelar', callback_data: 'a_bcast' }]]));
        await ctx.answerCbQuery();
    });

    bot.action('bcast_canais', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const { guardDivulgacaoBusy } = require('../../../plugins/zero-divu/fullDivulgacao');
        if (guardDivulgacaoBusy(ctx, fullDivulgacaoDeps(deps))) return;
        const cleared = botSession ? await botSession.enterAdminFlow(ctx, 'broadcast') : {};
        await broadcastMode.set(ctx.from.id, { type: 'canais', _ts: Date.now() });
        const stats = groupService?.getStats?.() || { channelTargets: 0, channelsAdmin: 0 };
        let msg = `<b>Divulgar nos canais</b>\n\n`;
        msg += `Alvos: <b>${stats.channelTargets || 0}</b> (${stats.channelsAdmin || 0} com permissão)\n\n`;
        msg += `Envie a mensagem (HTML).\n`;
        msg += `Botões só com links (comprar no privado).\n\n`;
        msg += `<i>Cadastre canais: bot admin + publicar · ou /canal add ID</i>`;
        msg = appendSessionDiscardedNote(msg, cleared);
        await Msg.edit(ctx, msg, kb2(Markup, [[{ text: 'Cancelar', callback_data: 'a_bcast' }]]));
        await ctx.answerCbQuery();
    });

    // bcast_grupos
    bot.action('bcast_grupos', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const { guardDivulgacaoBusy } = require('../../../plugins/zero-divu/fullDivulgacao');
        if (guardDivulgacaoBusy(ctx, fullDivulgacaoDeps(deps))) return;
        const cleared = botSession ? await botSession.enterAdminFlow(ctx, 'broadcast') : {};
        await broadcastMode.set(ctx.from.id, { type: 'grupos', _ts: Date.now() });
        const db = dbRaw();
        const groupService = deps.groupService;
        const groupSettings = deps.groupSettings;
        const stats = groupService ? groupService.getStats() : { targets: 0, total: 0, admin: 0 };
        const cd = groupSettings ? groupSettings.getCooldownMinutes() : 30;

        let msg = `<b>Divulgar nos grupos</b>\n\n`;
        msg += `Alvos agora: <b>${stats.targets}</b> (${stats.admin} admin / ${stats.total} ativos)\n`;
        msg += `Cooldown: <b>${cd > 0 ? cd + ' min/grupo' : 'DESLIGADO'}</b>\n`;
        msg += `Modo: <b>${groupSettings?.isRequireAdmin() ? 'Só admin' : 'Todos ativos'}</b>\n\n`;
        msg += `Envie a mensagem (HTML).\n`;
        msg += `Cada grupo recebe <b>1 mensagem editada</b> (sem flood).\n\n`;
        msg += `<i>Cooldown bloqueia reenvio no mesmo grupo — desligue em Configurar.</i>`;
        msg = appendSessionDiscardedNote(msg, cleared);

        const buttons = [
            [{ text: 'Config grupos', callback_data: 'grp_config' }, { text: 'Ver lista', callback_data: 'a_grupos' }],
            [{ text: 'Cancelar', callback_data: 'a_bcast' }],
        ];

        await Msg.edit(ctx, msg, kb2(Markup, buttons));
        await ctx.answerCbQuery();
    });

    // bcast_produto — selecionar produto para broadcast
    bot.action('bcast_produto', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const { guardDivulgacaoBusy } = require('../../../plugins/zero-divu/fullDivulgacao');
        if (guardDivulgacaoBusy(ctx, fullDivulgacaoDeps(deps))) return;
        await ctx.answerCbQuery();
        const prods = await loadProducts();
        if (!prods.length) return ctx.answerCbQuery('Nenhum produto.');
        const rows = [];
        for (let i = 0; i < prods.length; i += 2) {
            const row = [{ text: prods[i].name, callback_data: `bcast_prod_${prods[i].id}` }];
            if (prods[i + 1]) row.push({ text: prods[i + 1].name, callback_data: `bcast_prod_${prods[i + 1].id}` });
            rows.push(row);
        }
        rows.push([{ text: 'Voltar', callback_data: 'a_bcast' }]);
        await Msg.edit(ctx, '<b>Divulgar produto</b>\n\nTelegram (PV, grupos, canais) e/ou <b>WhatsApp Status</b> (foto+texto, não chat):', kb2(Markup, rows));
    });

    bot.action(/^bcast_prod_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const pid = parseInt(ctx.match[1], 10);
        const prods = await loadProducts();
        const p = prods.find((x) => x.id === pid);
        if (!p) return ctx.answerCbQuery('Produto não encontrado.');
        const { guardDivulgacaoBusy } = require('../../../plugins/zero-divu/fullDivulgacao');
        if (guardDivulgacaoBusy(ctx, fullDivulgacaoDeps(deps))) return;
        await ctx.answerCbQuery();

        const zeroOn = require('../../../plugins/zero-divu/config').isZeroDivuEnabled();
        const rows = [
            [
                { text: 'PV', callback_data: `bcast_prod_pv_${pid}` },
                { text: 'Grupos', callback_data: `bcast_prod_gr_${pid}` },
                { text: 'Canais', callback_data: `bcast_prod_cn_${pid}` },
            ],
            [{ text: 'TG completo', callback_data: `bcast_prod_tg_${pid}` }],
        ];
        if (zeroOn) {
            rows.splice(1, 0, [{ text: 'WA Status', callback_data: `bcast_prod_wa_${pid}` }]);
            rows.push([{ text: 'TG + WA', callback_data: `bcast_prod_all_${pid}` }]);
        }

        await Msg.edit(
            ctx,
            `<b>Divulgar: ${p.name}</b>\n\n` +
            `<i>PV / grupos / canais / completo (+ ponte MTProto no TG completo)</i>` +
            (zeroOn
                ? '\n<i>WA Status: foto+texto · TG+WA: Telegram agora, WA em 3–5 min (anti-spam)</i>'
                : '\n<i>WhatsApp: ative ZERO_DIVU_ENABLED no .env para Status</i>'),
            kb2(Markup, [...rows, [{ text: 'Voltar Produtos', callback_data: 'bcast_produto' }]])
        );
    });

    bot.command('broadcast_email', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const UserEmailService = require('../../../services/UserEmailService');
        if (!emailService.isEmailConfigured()) {
            return Msg.reply(ctx, 'SMTP não configurado. Defina SMTP_EMAIL e SMTP_PASSWORD no .env');
        }
        const raw = ctx.message.text.replace(/^\/broadcast_email\s*/i, '').trim();
        const sep = raw.indexOf('|');
        if (sep < 1) {
            return Msg.reply(
                ctx,
                '<b>Broadcast por e-mail</b>\n\n' +
                'Use:\n<code>/broadcast_email Assunto | Mensagem HTML</code>\n\n' +
                'Envia para todos com e-mail verificado.',
                { parse_mode: 'HTML' }
            );
        }
        const subject = raw.slice(0, sep).trim();
        const body = raw.slice(sep + 1).trim();
        if (!subject || !body) return Msg.reply(ctx, 'Assunto e mensagem são obrigatórios.');
        await Msg.reply(ctx, 'Enviando e-mails...');
        const result = await UserEmailService.broadcastToVerified(subject, body);
        await Msg.reply(
            ctx,
            `<b>Broadcast concluído</b>\n\n` +
            `Enviados: ${result.sent}\n` +
            `Falhas: ${result.failed}\n` +
            `Total: ${result.total}`,
            { parse_mode: 'HTML' }
        );
    });
}

module.exports = { registerBroadcastHandlers };
