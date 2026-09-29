'use strict';

const { denySilent } = require('../../../utils/silencedAccess');

const ProductAdminService = require('../../../services/ProductAdminService');
const { registerProductWizardHandlers } = require('./productWizardHandlers');

/**
 * M4 — comandos /produto, /listprodutos, etc. (extraídos de bot.js)
 */
function registerProductAdminCommands(bot, deps) {
    const {
        isAdmin,
        Msg,
        Markup,
        prisma,
        botSession,
        sessionNote,
        openProductAdminPanelWithCleanSessions,
        beginProductFieldEdit,
        productAdminDeps,
        productWizard,
        wizardDeps,
        dbRaw,
        beginProductCreateFlow,
    } = deps;

    bot.command('produto', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const pid = parseInt(String(ctx.message.text || '').trim().split(/\s+/)[1], 10);
        if (!pid) {
            return Msg.reply(
                ctx,
                '📦 <b>Ver produto</b>\n\nUse: <code>/produto ID</code>\nExemplo: <code>/produto 5</code>',
                { parse_mode: 'HTML' }
            );
        }
        await openProductAdminPanelWithCleanSessions(ctx, pid);
    });

    bot.command('listprodutos', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const cleared = await botSession.clearForAdminNav(ctx);
        const prods = await prisma.product.findMany({});
        prods.sort((a, b) => Number(b.id) - Number(a.id));
        await Msg.reply(ctx, sessionNote(ProductAdminService.buildListText(prods), cleared), {
            parse_mode: 'HTML',
            reply_markup: ProductAdminService.buildListKeyboard(prods).reply_markup,
        });
    });

    bot.command('editproduto', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const text = String(ctx.message.text || '').trim();
        const quick = ProductAdminService.parseQuickEdit(text);
        if (quick) {
            const cleared = await botSession.clearForAdminNav(ctx);
            const result = await ProductAdminService.applyFieldUpdate(
                quick.pid,
                quick.field,
                quick.value,
                productAdminDeps(ctx)
            );
            if (!result.ok) return Msg.reply(ctx, `❌ ${result.error}`);
            return Msg.reply(
                ctx,
                sessionNote(
                    `✅ <b>${result.label}</b> do produto #${quick.pid} atualizado.\n\n` +
                        `Novo valor: <code>${result.displayValue}</code>`,
                    cleared
                ),
                {
                    parse_mode: 'HTML',
                    reply_markup: ProductAdminService.buildEditKeyboard(quick.pid, result.product).reply_markup,
                }
            );
        }

        const pid = parseInt(text.split(/\s+/)[1], 10);
        if (!pid) {
            const cleared = await botSession.clearForAdminNav(ctx);
            return Msg.reply(ctx, sessionNote(ProductAdminService.buildEditHelpText(), cleared), { parse_mode: 'HTML' });
        }
        await openProductAdminPanelWithCleanSessions(ctx, pid);
    });

    bot.command('removeproduto', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const cleared = await botSession.clearForAdminNav(ctx);
        const parts = String(ctx.message.text || '').trim().split(/\s+/);
        const pid = parseInt(parts[1], 10);
        if (!pid) {
            return Msg.reply(
                ctx,
                sessionNote(
                    '🗑️ <b>Remover do catálogo</b>\n\n' +
                        'Use: <code>/removeproduto ID</code>\n' +
                        'Confirmação rápida: <code>/removeproduto ID confirmar</code>\n\n' +
                        '<i>O produto é pausado — histórico de pedidos é mantido.</i>',
                    cleared
                ),
                { parse_mode: 'HTML' }
            );
        }
        const p = await ProductAdminService.findProduct(pid, true);
        if (!p) return Msg.reply(ctx, '❌ Produto não encontrado.');
        if (parts[2]?.toLowerCase() === 'confirmar') {
            const result = await ProductAdminService.setProductActive(pid, false, productAdminDeps(ctx));
            if (!result.ok) return Msg.reply(ctx, `❌ ${result.error}`);
            return Msg.reply(
                ctx,
                `⏸️ <b>Produto pausado</b>\n\n` +
                    `#${p.id} — ${p.name}\n\n` +
                    `Fora do catálogo. Reative com <code>/reativarproduto ${pid}</code>`,
                { parse_mode: 'HTML' }
            );
        }
        if (!p.active) {
            return Msg.reply(
                ctx,
                `ℹ️ O produto #${pid} já está pausado.\n\nReative: <code>/reativarproduto ${pid}</code>`,
                { parse_mode: 'HTML' }
            );
        }
        await Msg.reply(
            ctx,
            `<b>🗑️ Pausar produto?</b>\n\n` +
                `#${p.id} — <b>${p.name}</b>\n` +
                `💰 R$ ${Number(p.price).toFixed(2)}\n\n` +
                `<i>Some do catálogo, mas pedidos antigos permanecem no sistema.</i>`,
            {
                parse_mode: 'HTML',
                reply_markup: ProductAdminService.buildDeleteConfirmKeyboard(pid).reply_markup,
            }
        );
    });

    bot.command('reativarproduto', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const cleared = await botSession.clearForAdminNav(ctx);
        const pid = parseInt(String(ctx.message.text || '').trim().split(/\s+/)[1], 10);
        if (!pid) {
            return Msg.reply(ctx, sessionNote('Use: <code>/reativarproduto ID</code>', cleared), { parse_mode: 'HTML' });
        }
        const p = await ProductAdminService.findProduct(pid, true);
        if (!p) return Msg.reply(ctx, '❌ Produto não encontrado.');
        if (p.active) {
            return Msg.reply(ctx, sessionNote(`ℹ️ O produto #${pid} já está ativo no catálogo.`, cleared));
        }
        const result = await ProductAdminService.setProductActive(pid, true, productAdminDeps(ctx));
        if (!result.ok) return Msg.reply(ctx, `❌ ${result.error}`);
        await Msg.reply(
            ctx,
            sessionNote(
                `✅ <b>Produto reativado!</b>\n\n#${p.id} — ${p.name}\n\nJá visível no catálogo.`,
                cleared
            ),
            {
                parse_mode: 'HTML',
                reply_markup: ProductAdminService.buildEditKeyboard(pid, result.product).reply_markup,
            }
        );
    });

    bot.action(/^ep_(name|price|desc|photo|file|stock|cat)_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const field = ctx.match[1];
        const pid = parseInt(ctx.match[2], 10);
        const label = ProductAdminService.getEditFieldPrompt(field);
        const started = await beginProductFieldEdit(ctx, ctx.from.id, pid, field);
        if (!started?.ok) {
            await ctx.answerCbQuery('Produto não encontrado');
            const back = Markup.inlineKeyboard([[{ text: '🔙 Produtos', callback_data: 'prod_menu_back' }]]);
            if (ctx.callbackQuery?.message) {
                return Msg.editCallbackPanel(ctx, '❌ Produto não encontrado.', back);
            }
            return Msg.reply(ctx, '❌ Produto não encontrado.', back);
        }
        const cleared = started.cleared;
        const photoHint =
            field === 'photo'
                ? 'Envie uma <b>foto</b> / arquivo de imagem ou digite URL <code>https://...</code>:'
                : field === 'file'
                  ? 'Envie o <b>arquivo</b> (documento, mídia) ou cole link <code>https://...</code>:'
                  : 'Digite o novo valor:';
        const body = sessionNote(
            `<b>✏️ Editar ${label}</b> — produto #${pid}\n\n${photoHint}\n\n<i>cancelar</i> para voltar sem salvar.`,
            cleared
        );
        const kb = Markup.inlineKeyboard([[{ text: '❌ Cancelar', callback_data: `prod_edit_${pid}` }]]);
        if (ctx.callbackQuery?.message) {
            await Msg.editCallbackPanel(ctx, body, kb);
        } else {
            await Msg.reply(ctx, body, kb);
        }
        await ctx.answerCbQuery();
    });

    registerProductWizardHandlers(bot, deps);
}

module.exports = { registerProductAdminCommands };
