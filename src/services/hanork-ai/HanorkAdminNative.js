'use strict';

const { Markup } = require('telegraf');
const { denySilent } = require('../../utils/silencedAccess');
const {
    isDivulgacaoBusy,
    busyAlertMessage,
    runFullDivulgacaoCycle,
} = require('../../plugins/zero-divu/fullDivulgacao');

/**
 * Ações admin nativas — mesma lógica dos callbacks do painel (admin.js / bot.js).
 */
function fullDivulgacaoDeps(deps) {
    return {
        CONFIG: deps.CONFIG,
        loadProducts: deps.loadProducts,
        prisma: deps.prisma,
        logger: deps.logger,
        broadcastService: deps.broadcastService,
        autoBroadcastService: deps.autoBroadcastService,
    };
}

async function enterBroadcastGroupsMode(ctx, deps) {
    if (!deps.isAdmin(ctx.from?.id)) return { ok: false, reason: 'not_admin' };
    const fd = fullDivulgacaoDeps(deps);
    if (isDivulgacaoBusy(fd)) {
        await deps.Msg.reply(ctx, busyAlertMessage(), null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'busy' };
    }

    const cleared = deps.botSession ? await deps.botSession.enterAdminFlow(ctx, 'broadcast') : {};
    await deps.broadcastMode.set(ctx.from.id, { type: 'grupos', _ts: Date.now() });

    const stats = deps.groupService?.getStats?.() || { targets: 0, total: 0, admin: 0 };
    const cd = deps.groupSettings?.getCooldownMinutes?.() ?? 30;
    const requireAdmin = deps.groupSettings?.isRequireAdmin?.() ?? false;

    let msg =
        '<b>Divulgação nos grupos</b>\n\n' +
        `Alvos: <b>${stats.targets}</b> (${stats.admin} admin / ${stats.total} ativos)\n` +
        `Cooldown: <b>${cd > 0 ? `${cd} min/grupo` : 'desligado'}</b>\n` +
        `Modo: <b>${requireAdmin ? 'só onde o bot é admin' : 'todos ativos'}</b>\n\n` +
        'Envie a <b>mensagem</b> (HTML) neste chat para publicar nos grupos.\n' +
        '<i>Ou diga no Hanork: <code>divulga em todos os grupos</code> — envia um produto do catálogo automaticamente.</i>\n' +
        '<i>Texto customizado: <code>divulga nos grupos mensagem: seu texto aqui</code></i>\n' +
        '<i>Uma mensagem editada por grupo — sem flood.</i>';

    if (deps.sessionNote && Object.keys(cleared).length) {
        msg = deps.sessionNote(msg, cleared);
    }

    await deps.Msg.reply(
        ctx,
        msg,
        Markup.inlineKeyboard([
            [{ text: '⚙️ Configurar grupos', callback_data: 'grp_config' }, { text: '📋 Lista', callback_data: 'a_grupos' }],
            [{ text: '❌ Cancelar', callback_data: 'a_bcast' }],
        ]),
        { parse_mode: 'HTML' }
    );
    return { ok: true, awaitingText: true };
}

async function enterBroadcastIaMode(ctx, deps) {
    if (!deps.isAdmin(ctx.from?.id)) return { ok: false, reason: 'not_admin' };
    const fd = fullDivulgacaoDeps(deps);
    if (isDivulgacaoBusy(fd)) {
        await deps.Msg.reply(ctx, busyAlertMessage(), null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'busy' };
    }

    await deps.botSession?.enterAdminFlow?.(ctx, 'broadcast');
    await deps.broadcastMode.set(ctx.from.id, { type: 'ia', _ts: Date.now() });

    await deps.Msg.reply(
        ctx,
        '<b>Divulgação com IA</b>\n\n' +
        'Descreva o tema da mensagem (ex.: promoção do fim de semana).\n' +
        'A IA gera o texto e envia para <b>usuários, grupos, canais e ponte</b>.\n\n' +
        '<i>Envie sua instrução na próxima mensagem.</i>',
        Markup.inlineKeyboard([[{ text: '❌ Cancelar', callback_data: 'a_bcast' }]]),
        { parse_mode: 'HTML' }
    );
    return { ok: true, awaitingText: true };
}

async function enterBroadcastTextMode(ctx, deps) {
    if (!deps.isAdmin(ctx.from?.id)) return { ok: false, reason: 'not_admin' };
    const fd = fullDivulgacaoDeps(deps);
    if (isDivulgacaoBusy(fd)) {
        await deps.Msg.reply(ctx, busyAlertMessage(), null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'busy' };
    }

    await deps.botSession?.enterAdminFlow?.(ctx, 'broadcast');
    await deps.broadcastMode.set(ctx.from.id, { type: 'texto', _ts: Date.now() });

    await deps.Msg.reply(
        ctx,
        '<b>Divulgação — texto livre</b>\n\n' +
        'Envie o texto (HTML) para <b>PV, grupos, canais e ponte MTProto</b>.\n\n' +
        '<i>Próxima mensagem = conteúdo da divulgação.</i>',
        Markup.inlineKeyboard([[{ text: '❌ Cancelar', callback_data: 'a_bcast' }]]),
        { parse_mode: 'HTML' }
    );
    return { ok: true, awaitingText: true };
}

async function openBroadcastProductPicker(ctx, deps) {
    if (!deps.isAdmin(ctx.from?.id)) return { ok: false, reason: 'not_admin' };
    const fd = fullDivulgacaoDeps(deps);
    if (isDivulgacaoBusy(fd)) {
        await deps.Msg.reply(ctx, busyAlertMessage(), null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'busy' };
    }

    const prods = await deps.loadProducts();
    if (!prods.length) {
        await deps.Msg.reply(ctx, 'Nenhum produto cadastrado.', null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'no_products' };
    }

    const rows = [];
    for (let i = 0; i < prods.length; i += 2) {
        const row = [{ text: prods[i].name, callback_data: `bcast_prod_${prods[i].id}` }];
        if (prods[i + 1]) row.push({ text: prods[i + 1].name, callback_data: `bcast_prod_${prods[i + 1].id}` });
        rows.push(row);
    }
    rows.push([{ text: '🔙 Broadcast', callback_data: 'a_bcast' }]);

    await deps.Msg.reply(
        ctx,
        '<b>Divulgar produto</b>\n\nEscolha o produto e o destino (PV, grupos, canais, completo).',
        Markup.inlineKeyboard(rows),
        { parse_mode: 'HTML' }
    );
    return { ok: true };
}

async function buildCatalogBroadcastPayload(deps, customBody, mode) {
    const { buildGroupPromoKeyboard } = require('../../telegram/groupPromo');
    const catalogKbGroups = buildGroupPromoKeyboard(deps.botUsername || '');

    if (mode === 'custom' && String(customBody || '').trim()) {
        return {
            broadcastText: customBody,
            groupReplyMarkup: catalogKbGroups,
            channelReplyMarkup: catalogKbGroups,
            photo: null,
            productName: null,
        };
    }

    const abs = deps.autoBroadcastService;
    if (!abs?._buildMessage) return null;
    const built = await abs._buildMessage();
    return {
        broadcastText: built.texto,
        groupReplyMarkup: built.groupKeyboard || catalogKbGroups,
        channelReplyMarkup: built.channelKeyboard || catalogKbGroups,
        photo: built.photo,
        productName: built.productName,
    };
}

async function runBroadcastFullNow(ctx, deps, opts = {}) {
    if (!deps.isAdmin(ctx.from?.id)) return { ok: false, reason: 'not_admin' };
    const fd = fullDivulgacaoDeps(deps);
    if (isDivulgacaoBusy(fd)) {
        await deps.Msg.reply(ctx, '⚠️ Já há uma divulgação em andamento. Aguarde a conclusão.', null, {
            parse_mode: 'HTML',
        });
        return { ok: false, reason: 'busy' };
    }

    const mode = opts.mode || 'catalog';
    const customBody = opts.body || '';
    const payload =
        mode === 'custom' && customBody
            ? await buildCatalogBroadcastPayload(deps, customBody, 'custom')
            : null;

    await deps.Msg.reply(
        ctx,
        payload?.productName
            ? `⏳ <b>Divulgação completa</b> — <i>${payload.productName}</i>`
            : '⏳ <b>Divulgação completa iniciada</b>\n\nPV · grupos · canais · ponte MTProto' +
            (require('../../plugins/zero-divu/config').isZeroDivuEnabled() ? ' · fila WhatsApp' : '') +
            '\n\n<i>Você receberá atualização quando terminar.</i>',
        Markup.inlineKeyboard([[{ text: '📢 Painel broadcast', callback_data: 'a_bcast' }]]),
        { parse_mode: 'HTML' }
    );

    const panelRef = {
        chatId: ctx.chat?.id,
        messageId: ctx.message?.message_id,
        isPhoto: false,
        userId: ctx.from?.id,
    };

    deps.deferBackground?.('hanork-bcast-full', async () => {
        const { notifyBroadcastComplete } = require('../../telegram/broadcastNotify');
        const { BroadcastService } = require('../BroadcastService');
        const { buildGroupPromoKeyboard } = require('../../telegram/groupPromo');
        const backKb = Markup.inlineKeyboard([[{ text: '🔙 Broadcast', callback_data: 'a_bcast' }]]);
        const bcastNotifyOpts = {
            adminIds: deps.CONFIG?.ID_DONO || [ctx.from.id],
            userId: ctx.from.id,
        };
        const catalogKb = Markup.inlineKeyboard([
            [{ text: '🛍️ Ver Catálogo', callback_data: 'cat' }],
            [{ text: '🏠 Menu', callback_data: 'menu:home' }],
        ]);
        const catalogKbGroups = buildGroupPromoKeyboard(deps.botUsername || '');
        const groupBcastOpts = {
            photo: payload?.photo,
            groupCooldownMs: 0,
            cooldownMode: 'new_only',
            groupReplyMarkup: payload?.groupReplyMarkup || catalogKbGroups,
            channelReplyMarkup: payload?.channelReplyMarkup || catalogKbGroups,
            skipPermissionCheck: true,
            syncGroupsFirst: true,
            syncChannelsFirst: true,
            groupDelayMs: 800,
            channelDelayMs: 1000,
        };
        const t0 = Date.now();
        try {
            await require('../../plugins/zero-divu/fullDivulgacao').prepareFullDivulgacao(fd).catch(() => { });
            let r;
            if (payload?.broadcastText) {
                r = await deps.broadcastService.executeFullBroadcast(
                    payload.broadcastText,
                    'HTML',
                    catalogKb,
                    groupBcastOpts
                );
                if (r?.success) {
                    const bridgePromo = await deps.autoBroadcastService.runBridgePromoAfterBot({
                        texto: payload.broadcastText,
                        photo: payload.photo,
                        groupReplyMarkup: payload.groupReplyMarkup,
                        source: 'hanork_router_custom',
                    });
                    r = { ...r, bridgePromo };
                }
            } else {
                r = await runFullDivulgacaoCycle(fd, 'hanork_router');
            }
            let txt =
                r?.success !== false && BroadcastService.formatFullResult
                    ? BroadcastService.formatFullResult(r)
                    : '❌ Não foi possível concluir. Verifique os logs.';
            if (r?.productName || payload?.productName) {
                txt = `📦 <b>${r?.productName || payload.productName}</b>\n\n${txt}`;
            }
            const sec = Math.round((Date.now() - t0) / 1000);
            txt = `✅ <b>Divulgação finalizada</b> (${sec}s)\n\n${txt}`;
            await notifyBroadcastComplete(ctx.telegram, panelRef, txt, backKb, bcastNotifyOpts);
        } catch (e) {
            deps.logger?.error?.('[HanorkRouter] full broadcast:', e.message);
            await notifyBroadcastComplete(
                ctx.telegram,
                panelRef,
                `❌ <b>Erro na divulgação</b>\n\n${e.message}`,
                backKb,
                bcastNotifyOpts
            );
        }
    });

    return { ok: true, started: true };
}

async function runGroupBroadcastNow(ctx, deps, opts = {}) {
    if (!deps.isAdmin(ctx.from?.id)) return { ok: false, reason: 'not_admin' };
    const fd = fullDivulgacaoDeps(deps);
    if (isDivulgacaoBusy(fd)) {
        await deps.Msg.reply(ctx, '⚠️ Já há uma divulgação em andamento.', null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'busy' };
    }

    const legacyText = typeof opts === 'string' ? opts : null;
    const mode = legacyText ? 'custom' : opts.mode || 'catalog';
    const customBody = legacyText || opts.body || '';

    const { BroadcastService } = require('../BroadcastService');
    const catalogKb = Markup.inlineKeyboard([
        [{ text: '🛍️ Ver Catálogo', callback_data: 'cat' }],
        [{ text: '🏠 Menu', callback_data: 'menu:home' }],
    ]);

    const payload = await buildCatalogBroadcastPayload(deps, customBody, mode);
    if (!payload) {
        await deps.Msg.reply(ctx, '❌ Divulgação automática de produtos indisponível.', null, {
            parse_mode: 'HTML',
        });
        return { ok: false, reason: 'no_auto_broadcast' };
    }

    const preview = payload.productName
        ? `⏳ Publicando <b>${payload.productName}</b> nos grupos…`
        : '⏳ Publicando nos grupos…';
    await deps.Msg.reply(ctx, preview, null, { parse_mode: 'HTML' });

    deps.deferBackground?.('hanork-bcast-grupos', async () => {
        try {
            await require('../../plugins/zero-divu/fullDivulgacao')
                .prepareFullDivulgacao(fd)
                .catch(() => { });
            const resultado = await deps.broadcastService.executeGroupBroadcast(
                payload.broadcastText,
                'HTML',
                catalogKb,
                {
                    photo: payload.photo,
                    cooldownMs: 0,
                    cooldownMode: 'new_only',
                    groupReplyMarkup: payload.groupReplyMarkup,
                    skipPermissionCheck: true,
                    syncGroupsFirst: true,
                    groupDelayMs: 800,
                }
            );
            const resumo = BroadcastService.formatGroupResult(resultado);
            const header = payload.productName
                ? `✅ <b>Grupos</b> — <i>${payload.productName}</i>\n\n`
                : '✅ <b>Grupos</b>\n\n';
            await deps.Msg.reply(ctx, `${header}${resumo}`, null, { parse_mode: 'HTML' });
        } catch (e) {
            deps.logger?.error?.('[HanorkRouter] group broadcast:', e.message);
            await deps.Msg.reply(ctx, `❌ Erro: ${e.message}`, null, { parse_mode: 'HTML' });
        }
    });

    return { ok: true, started: true };
}

async function runChannelBroadcastNow(ctx, deps, opts = {}) {
    if (!deps.isAdmin(ctx.from?.id)) return { ok: false, reason: 'not_admin' };
    const fd = fullDivulgacaoDeps(deps);
    if (isDivulgacaoBusy(fd)) {
        await deps.Msg.reply(ctx, '⚠️ Já há uma divulgação em andamento.', null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'busy' };
    }

    const legacyText = typeof opts === 'string' ? opts : null;
    const mode = legacyText ? 'custom' : opts.mode || 'catalog';
    const customBody = legacyText || opts.body || '';

    const { BroadcastService } = require('../BroadcastService');
    const catalogKb = Markup.inlineKeyboard([
        [{ text: '🛍️ Ver Catálogo', callback_data: 'cat' }],
        [{ text: '🏠 Menu', callback_data: 'menu:home' }],
    ]);

    const payload = await buildCatalogBroadcastPayload(deps, customBody, mode);
    if (!payload) {
        await deps.Msg.reply(ctx, '❌ Divulgação automática de produtos indisponível.', null, {
            parse_mode: 'HTML',
        });
        return { ok: false, reason: 'no_auto_broadcast' };
    }

    const preview = payload.productName
        ? `⏳ Publicando <b>${payload.productName}</b> nos canais…`
        : '⏳ Publicando nos canais…';
    await deps.Msg.reply(ctx, preview, null, { parse_mode: 'HTML' });

    deps.deferBackground?.('hanork-bcast-canais', async () => {
        try {
            await require('../../plugins/zero-divu/fullDivulgacao')
                .prepareFullDivulgacao(fd)
                .catch(() => { });
            const resultado = await deps.broadcastService.executeChannelBroadcast(
                payload.broadcastText,
                'HTML',
                catalogKb,
                {
                    photo: payload.photo,
                    channelCooldownMs: 0,
                    channelReplyMarkup: payload.channelReplyMarkup || payload.groupReplyMarkup,
                    skipPermissionCheck: true,
                    syncChannelsFirst: true,
                    channelDelayMs: 1000,
                }
            );
            const resumo = BroadcastService.formatChannelResult(resultado);
            const header = payload.productName
                ? `✅ <b>Canais</b> — <i>${payload.productName}</i>\n\n`
                : '✅ <b>Canais</b>\n\n';
            await deps.Msg.reply(ctx, `${header}${resumo}`, null, { parse_mode: 'HTML' });
        } catch (e) {
            deps.logger?.error?.('[HanorkRouter] channel broadcast:', e.message);
            await deps.Msg.reply(ctx, `❌ Erro: ${e.message}`, null, { parse_mode: 'HTML' });
        }
    });

    return { ok: true, started: true };
}

function openAdminCallback(ctx, deps, callbackData, caption) {
    return deps.Msg.reply(
        ctx,
        caption,
        Markup.inlineKeyboard([[{ text: '🔧 Abrir painel', callback_data: callbackData }]]),
        { parse_mode: 'HTML' }
    );
}

async function resolveProductTarget(ctx, deps, params = {}) {
    const ProductSearchService = require('../ProductSearchService');
    const { productId, productQuery } = params;

    let pid = productId ? parseInt(productId, 10) : null;
    if (!pid && productQuery) {
        const prods = await deps.loadProducts();
        const picked = ProductSearchService.pickProducts(prods, productQuery, 3);
        if (!picked.length) {
            await deps.Msg.reply(ctx, `❌ Nenhum produto encontrado para «${productQuery}».`, null, {
                parse_mode: 'HTML',
            });
            return { ok: false, reason: 'not_found' };
        }
        if (picked.length > 1) {
            const lines = picked
                .map((p) => `• #${p.id} — ${p.name} (R$ ${Number(p.price).toFixed(2)})`)
                .join('\n');
            await deps.Msg.reply(
                ctx,
                `Encontrei vários produtos. Seja mais específico ou use o ID:\n${lines}`,
                null,
                { parse_mode: 'HTML' }
            );
            return { ok: false, reason: 'ambiguous' };
        }
        pid = picked[0].id;
    }

    if (!pid) {
        await deps.Msg.reply(
            ctx,
            'Qual produto? Ex.: <i>pausa o produto Likes FF</i> ou <i>apaga aquele</i> após citar o item.',
            null,
            { parse_mode: 'HTML' }
        );
        return { ok: false, reason: 'needs_product' };
    }

    return { ok: true, pid };
}

async function applyProductPause(ctx, deps, params = {}) {
    if (!deps.isAdmin(ctx.from?.id)) {
        denySilent('hanork_ai_admin', ctx);
        return { ok: false, reason: 'not_admin' };
    }

    const ProductAdminService = require('../ProductAdminService');
    const resolved = await resolveProductTarget(ctx, deps, params);
    if (!resolved.ok) return resolved;

    const pid = resolved.pid;
    const pad =
        typeof deps.getProductAdminDeps === 'function'
            ? deps.getProductAdminDeps(ctx)
            : deps.productAdminDeps || {};

    const p = await ProductAdminService.findProduct(pid, true);
    if (!p) {
        await deps.Msg.reply(ctx, '❌ Produto não encontrado.', null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'not_found' };
    }

    if (!p.active) {
        await deps.Msg.reply(
            ctx,
            `ℹ️ O produto #${pid} já está pausado.\n\nReative: <code>/reativarproduto ${pid}</code>`,
            null,
            { parse_mode: 'HTML' }
        );
        return { ok: true, productId: pid, alreadyPaused: true };
    }

    if (!params.confirmed) {
        await deps.Msg.reply(
            ctx,
            `<b>🗑️ Pausar produto?</b>\n\n` +
            `#${p.id} — <b>${p.name}</b>\n` +
            `💰 R$ ${Number(p.price).toFixed(2)}\n\n` +
            `<i>Some do catálogo; pedidos antigos permanecem.</i>`,
            ProductAdminService.buildDeleteConfirmKeyboard(pid),
            { parse_mode: 'HTML' }
        );
        return { ok: true, productId: pid, awaitingConfirm: true };
    }

    const result = await ProductAdminService.setProductActive(pid, false, pad);
    if (!result.ok) {
        await deps.Msg.reply(ctx, `❌ ${result.error}`, null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'apply_failed' };
    }

    await deps.Msg.reply(
        ctx,
        `⏸️ <b>Produto pausado</b>\n\n#${p.id} — ${p.name}\n\nFora do catálogo. Reative com <code>/reativarproduto ${pid}</code> ou <i>reativa o produto ${p.name}</i>.`,
        null,
        { parse_mode: 'HTML' }
    );
    return { ok: true, productId: pid };
}

async function applyProductReactivate(ctx, deps, params = {}) {
    if (!deps.isAdmin(ctx.from?.id)) {
        denySilent('hanork_ai_admin', ctx);
        return { ok: false, reason: 'not_admin' };
    }

    const ProductAdminService = require('../ProductAdminService');
    const resolved = await resolveProductTarget(ctx, deps, params);
    if (!resolved.ok) return resolved;

    const pid = resolved.pid;
    const pad =
        typeof deps.getProductAdminDeps === 'function'
            ? deps.getProductAdminDeps(ctx)
            : deps.productAdminDeps || {};

    const p = await ProductAdminService.findProduct(pid, true);
    if (!p) {
        await deps.Msg.reply(ctx, '❌ Produto não encontrado.', null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'not_found' };
    }

    if (p.active) {
        await deps.Msg.reply(ctx, `ℹ️ O produto #${pid} já está ativo no catálogo.`, null, {
            parse_mode: 'HTML',
        });
        return { ok: true, productId: pid, alreadyActive: true };
    }

    const result = await ProductAdminService.setProductActive(pid, true, pad);
    if (!result.ok) {
        await deps.Msg.reply(ctx, `❌ ${result.error}`, null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'apply_failed' };
    }

    await deps.Msg.reply(
        ctx,
        `✅ <b>Produto reativado!</b>\n\n#${p.id} — ${result.product?.name || p.name}\n\nJá visível no catálogo.`,
        ProductAdminService.buildEditKeyboard(pid, result.product),
        { parse_mode: 'HTML' }
    );
    return { ok: true, productId: pid };
}

async function applyProductFieldUpdate(ctx, deps, params = {}) {
    if (!deps.isAdmin(ctx.from?.id)) {
        denySilent('hanork_ai_admin', ctx);
        return { ok: false, reason: 'not_admin' };
    }

    const ProductAdminService = require('../ProductAdminService');
    const { field, value } = params;
    if (!field || value == null || String(value).trim() === '') {
        await deps.Msg.reply(ctx, 'Informe o novo valor do campo.', null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'needs_value' };
    }

    const resolved = await resolveProductTarget(ctx, deps, params);
    if (!resolved.ok) return resolved;
    const pid = resolved.pid;

    const pad =
        typeof deps.getProductAdminDeps === 'function'
            ? deps.getProductAdminDeps(ctx)
            : deps.productAdminDeps || {};

    const result = await ProductAdminService.applyFieldUpdate(pid, field, String(value).trim(), pad);
    if (!result.ok) {
        await deps.Msg.reply(ctx, `❌ ${result.error}`, null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'apply_failed' };
    }

    await deps.Msg.reply(
        ctx,
        `✅ <b>${result.label}</b> do produto #${pid} atualizado.`,
        ProductAdminService.buildEditKeyboard(pid, result.product),
        { parse_mode: 'HTML' }
    );
    return { ok: true, productId: pid, field };
}

async function applyProductPriceUpdate(ctx, deps, params = {}) {
    if (!deps.isAdmin(ctx.from?.id)) {
        denySilent('hanork_ai_admin', ctx);
        return { ok: false, reason: 'not_admin' };
    }

    const ProductAdminService = require('../ProductAdminService');
    const { price } = params;

    if (price == null || Number(price) <= 0) {
        await deps.Msg.reply(
            ctx,
            'Informe o preço em reais (ex.: <code>29.90</code> ou <code>20</code>).',
            null,
            { parse_mode: 'HTML' }
        );
        return { ok: false, reason: 'needs_price' };
    }

    const resolved = await resolveProductTarget(ctx, deps, params);
    if (!resolved.ok) return resolved;
    const pid = resolved.pid;

    const pad =
        typeof deps.getProductAdminDeps === 'function'
            ? deps.getProductAdminDeps(ctx)
            : deps.productAdminDeps || {};

    const result = await ProductAdminService.applyFieldUpdate(pid, 'price', String(price), pad);
    if (!result.ok) {
        await deps.Msg.reply(ctx, `❌ ${result.error}`, null, { parse_mode: 'HTML' });
        return { ok: false, reason: 'apply_failed' };
    }

    await deps.Msg.reply(
        ctx,
        `✅ Preço de <b>#${pid}</b> — ${result.product?.name || 'produto'} atualizado para <b>R$ ${Number(price).toFixed(2)}</b>.`,
        ProductAdminService.buildEditKeyboard(pid, result.product),
        { parse_mode: 'HTML' }
    );
    return { ok: true, productId: pid, price };
}

module.exports = {
    enterBroadcastGroupsMode,
    enterBroadcastIaMode,
    enterBroadcastTextMode,
    openBroadcastProductPicker,
    runBroadcastFullNow,
    runGroupBroadcastNow,
    runChannelBroadcastNow,
    openAdminCallback,
    applyProductPriceUpdate,
    applyProductFieldUpdate,
    applyProductPause,
    applyProductReactivate,
    resolveProductTarget,
    fullDivulgacaoDeps,
};
