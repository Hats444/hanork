'use strict';

const { denySilent, denyCbSilent } = require('../../../utils/silencedAccess');

const ProductAdminService = require('../../../services/ProductAdminService');
const ProductWizardService = require('../../../services/ProductWizardService');

/**
 * B3 — wizard prod_* e /gerenciarprodutos (extraído de bot.js)
 */
function registerProductWizardHandlers(bot, deps) {
    const {
        isAdmin,
        Msg,
        Markup,
        prisma,
        dbRaw,
        botSession,
        sessionNote,
        productWizard,
        wizardDeps,
        productAdminDeps,
        beginProductCreateFlow,
        openProductAdminPanelWithCleanSessions,
    } = deps;

    const { PRODUCT_TYPES } = ProductWizardService;

    async function openProductCreateFlow(ctx, edit = false) {
        const { DEFAULT_MAX_BYTES, formatBytes } = require('../../../utils/telegramMedia');
        const cleared = await beginProductCreateFlow(ctx, ctx.from.id);
        const keyboard = ProductWizardService.typeKeyboard(Markup);
        const text = sessionNote(
            `<b>Novo produto para vender</b>\n\n` +
                `Um bom anúncio vende mais:\n` +
                `Nome claro (o que é + formato)\n` +
                `Descrição com benefícios e entrega automática\n` +
                `Capa (foto ou URL) e arquivo de entrega\n\n` +
                `<b>Arquivos aceitos:</b> ZIP, RAR, PDF, TXT, fotos, vídeos, áudios, APK… (até ${formatBytes(DEFAULT_MAX_BYTES)})\n` +
                `<i>ZIP/PDF: envie como documento</i>\n\n` +
                `1. Tipo → 2. Nome → 3. Descrição → 4. Preço\n` +
                `5. Capa (opcional) → 6. Arquivo → 7. Prévia e publicar\n\n` +
                `<i>/cancelar a qualquer momento</i>`,
            cleared
        );
        if (edit && ctx.callbackQuery) {
            await Msg.editCallbackPanel(ctx, text, keyboard);
        } else {
            await Msg.reply(ctx, text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
        }
    }

    async function setProductType(ctx, type) {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const wizard = productWizard.get(ctx.from.id);
        if (!wizard) return Msg.reply(ctx, 'Sessão expirada. Use /addproduto');
        const returnToConfirm = wizard.data._returnToConfirm;
        ProductWizardService.setType(wizard, type);
        if (returnToConfirm) {
            delete wizard.data._returnToConfirm;
            wizard.step = ProductWizardService.PRODUCT_WIZARD_STEPS.CONFIRM;
            return ProductWizardService.showConfirmPreview(ctx, wizard, productWizard, wizardDeps());
        }
        await Msg.editCallbackPanel(
            ctx,
            `<b>Novo produto</b>\n\n` +
                `Tipo: ${ProductWizardService.getTypeName(type)}\n\n` +
                `Envie o <b>nome</b> do produto:`,
            Markup.inlineKeyboard([[{ text: 'Cancelar', callback_data: 'prod_cancel' }]])
        );
    }

    function buildProductPickerRows(products, prefix, page = 0, pageSize = 8) {
        const slice = products.slice(page * pageSize, (page + 1) * pageSize);
        const rows = slice.map((p) => [
            { text: `#${p.id} ${p.name.slice(0, 28)}`, callback_data: `${prefix}${p.id}` },
        ]);
        const nav = [];
        if (page > 0) nav.push({ text: 'Anterior', callback_data: `${prefix}pg_${page - 1}` });
        if ((page + 1) * pageSize < products.length) nav.push({ text: 'Próxima', callback_data: `${prefix}pg_${page + 1}` });
        if (nav.length) rows.push(nav);
        rows.push([{ text: 'Voltar produtos', callback_data: 'prod_menu_back' }]);
        return rows;
    }

    bot.command('gerenciarprodutos', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        const cleared = await botSession.clearForAdminNav(ctx);

        const keyboard = Markup.inlineKeyboard([
            [{ text: 'Criar produto', callback_data: 'prod_create' }],
            [{ text: 'Editar produto', callback_data: 'prod_edit_list' }],
            [{ text: 'Pausar produto', callback_data: 'prod_delete_list' }],
            [{ text: 'Listar todos', callback_data: 'prod_list_all' }],
            [{ text: 'Estatísticas', callback_data: 'prod_stats' }],
            [{ text: 'Voltar', callback_data: 'a_menu' }],
        ]);

        await Msg.reply(
            ctx,
            sessionNote(
                `<b>Gerenciamento de produtos</b>\n\n` +
                    `Escolha uma ação ou use os comandos:\n\n` +
                    `<code>/addproduto</code> — criar novo\n` +
                    `<code>/produto ID</code> — ver detalhes\n` +
                    `<code>/editproduto ID</code> — editar\n` +
                    `<code>/removeproduto ID</code> — pausar\n` +
                    `<code>/listprodutos</code> — listar todos\n\n` +
                    `<b>Tipos suportados:</b>\n` +
                    `Arquivos, fotos, vídeos, áudios, texto, serviços`,
                cleared
            ),
            { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }
        );
    });

    bot.command('addproduto', async (ctx) => {
        if (!isAdmin(ctx.from.id)) { denySilent('admin', ctx); return; }
        await openProductCreateFlow(ctx, false);
    });

    bot.action('prod_create', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        await openProductCreateFlow(ctx, true);
    });

    bot.action('prod_cancel', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        const cleared = await botSession.clearForAdminNav(ctx);
        await ctx.answerCbQuery('Cancelado');
        await Msg.editCallbackPanel(
            ctx,
            sessionNote('Cadastro cancelado.', cleared),
            Markup.inlineKeyboard([[{ text: 'Voltar produtos', callback_data: 'prod_menu_back' }]])
        );
    });

    bot.action('prod_publish', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const wizard = productWizard.get(ctx.from.id);
        if (!wizard || wizard.step !== ProductWizardService.PRODUCT_WIZARD_STEPS.CONFIRM) {
            return Msg.reply(ctx, 'Sessão expirada ou prévia pendente. Use /addproduto');
        }
        await ProductWizardService.finishWizard(ctx, wizard, productWizard, wizardDeps());
    });

    bot.action(/^prod_flash_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery('Criando oferta...');
        const pid = parseInt(ctx.match[1], 10);
        const prod = await prisma.product.findUnique({ where: { id: pid } });
        if (!prod) return Msg.reply(ctx, 'Produto não encontrado.');
        const salePrice = Math.max(0.01, Math.round(prod.price * 0.8 * 100) / 100);
        const horas = 24;
        const endsAt = new Date(Date.now() + horas * 3600000).toISOString();
        await prisma.flashSale.create(pid, salePrice, prod.price, endsAt, 0);
        const pct = Math.round(((prod.price - salePrice) / prod.price) * 100);
        await Msg.reply(
            ctx,
            `<b>Flash Sale ativa!</b>\n\n${prod.name}\n` +
                `<s>R$ ${prod.price.toFixed(2)}</s> → <b>R$ ${salePrice.toFixed(2)}</b> (-${pct}%)\n` +
                `24 horas\n\nClientes veem em <code>/flashsales</code>.`,
            {
                parse_mode: 'HTML',
                reply_markup: Markup.inlineKeyboard([
                    [{ text: 'Divulgar', callback_data: `fs_broadcast_${pid}` }],
                    [{ text: 'Catálogo', callback_data: 'cat_hub' }],
                ]).reply_markup,
            }
        );
    });

    bot.action('prod_edit_desc', async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const wizard = productWizard.get(ctx.from.id);
        if (!wizard) return Msg.reply(ctx, 'Sessão expirada. Use /addproduto');
        ProductWizardService.startDraftEdit(wizard, 'desc');
        await Msg.reply(ctx, ProductWizardService.getDraftEditPrompt(wizard, 'desc'), {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[{ text: 'Voltar à prévia', callback_data: 'prod_draft_refresh' }]]),
        });
    });

    bot.action(/^prod_draft_(name|desc|price|photo|file|type|refresh)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) await denyCbSilent('admin_callback', ctx); return;
        await ctx.answerCbQuery();
        const wizard = productWizard.get(ctx.from.id);
        if (!wizard) return Msg.reply(ctx, 'Sessão expirada. Use /addproduto');

        const field = ctx.match[1];
        if (field === 'refresh') {
            wizard.step = ProductWizardService.PRODUCT_WIZARD_STEPS.CONFIRM;
            return ProductWizardService.showConfirmPreview(ctx, wizard, productWizard, wizardDeps());
        }

        ProductWizardService.startDraftEdit(wizard, field);
        const prompt = ProductWizardService.getDraftEditPrompt(wizard, field);
        const backKb = Markup.inlineKeyboard([[{ text: 'Voltar à prévia', callback_data: 'prod_draft_refresh' }]]);

        if (field === 'type') {
            return Msg.editCallbackPanel(ctx, prompt, ProductWizardService.typeKeyboard(Markup));
        }
        await Msg.reply(ctx, `${prompt}\n\n<i>Quando terminar, a prévia atualiza automaticamente.</i>`, backKb);
    });

    bot.action('prod_menu_back', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const cleared = await botSession.clearForAdminNav(ctx);
        const keyboard = Markup.inlineKeyboard([
            [{ text: 'Criar produto', callback_data: 'prod_create' }],
            [{ text: 'Editar', callback_data: 'prod_edit_list' }, { text: 'Pausar', callback_data: 'prod_delete_list' }],
            [{ text: 'Listar', callback_data: 'prod_list_all' }],
            [{ text: 'Comandos', callback_data: 'a_cmd_produtos' }],
            [{ text: 'Voltar admin', callback_data: 'a_menu' }],
        ]);
        await Msg.editCallbackPanel(
            ctx,
            sessionNote(
                `<b>Gerenciamento de produtos</b>\n\n` +
                    `<code>/addproduto</code> · <code>/listprodutos</code>\n` +
                    `<code>/produto ID</code> · <code>/editproduto ID</code>\n` +
                    `<code>/removeproduto ID</code> · <code>/reativarproduto ID</code>`,
                cleared
            ),
            keyboard
        );
    });

    bot.action('prodtype_file', async (ctx) => setProductType(ctx, PRODUCT_TYPES.FILE));
    bot.action('prodtype_photo', async (ctx) => setProductType(ctx, PRODUCT_TYPES.PHOTO));
    bot.action('prodtype_video', async (ctx) => setProductType(ctx, PRODUCT_TYPES.VIDEO));
    bot.action('prodtype_audio', async (ctx) => setProductType(ctx, PRODUCT_TYPES.AUDIO));
    bot.action('prodtype_text', async (ctx) => setProductType(ctx, PRODUCT_TYPES.TEXT));
    bot.action('prodtype_service', async (ctx) => setProductType(ctx, PRODUCT_TYPES.SERVICE));
    bot.action('prodtype_subscription', async (ctx) => setProductType(ctx, PRODUCT_TYPES.SUBSCRIPTION));

    bot.action('prod_list_all', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const cleared = await botSession.clearForAdminNav(ctx);
        const prods = await prisma.product.findMany({});
        prods.sort((a, b) => Number(b.id) - Number(a.id));
        if (!prods.length) {
            return Msg.editCallbackPanel(ctx, 'Nenhum produto cadastrado.', Markup.inlineKeyboard([[{ text: 'Criar', callback_data: 'prod_create' }]]));
        }
        await Msg.editCallbackPanel(
            ctx,
            sessionNote(ProductAdminService.buildListText(prods), cleared),
            ProductAdminService.buildListKeyboard(prods)
        );
    });

    bot.action(/^prod_list_pg_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const page = parseInt(ctx.match[1], 10) || 0;
        const prods = await prisma.product.findMany({});
        prods.sort((a, b) => Number(b.id) - Number(a.id));
        await Msg.editCallbackPanel(ctx, ProductAdminService.buildListText(prods, { page }), ProductAdminService.buildListKeyboard(prods, page));
    });

    bot.action('prod_stats', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const db = dbRaw();
        const total = db.prepare('SELECT COUNT(*) as c FROM products').get()?.c || 0;
        const active = db.prepare('SELECT COUNT(*) as c FROM products WHERE active=1').get()?.c || 0;
        const subs = db.prepare('SELECT COUNT(*) as c FROM products WHERE is_subscription=1').get()?.c || 0;
        await Msg.editCallbackPanel(
            ctx,
            `<b>Estatísticas</b>\n\nTotal: ${total}\nAtivos: ${active}\nAssinaturas: ${subs}`,
            Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'prod_menu_back' }]])
        );
    });

    bot.action('prod_edit_list', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const cleared = await botSession.clearForAdminNav(ctx);
        const prods = (await prisma.product.findMany({})).filter((p) => p.active);
        if (!prods.length) {
            return Msg.editCallbackPanel(ctx, 'Nenhum produto ativo.', Markup.inlineKeyboard([[{ text: 'Criar', callback_data: 'prod_create' }]]));
        }
        await Msg.editCallbackPanel(
            ctx,
            sessionNote(
                '<b>Editar produto</b>\n\nEscolha o produto ou use:\n<code>/editproduto ID</code>\n<code>/editproduto ID preco 29.90</code>',
                cleared
            ),
            Markup.inlineKeyboard(buildProductPickerRows(prods, 'prod_edit_'))
        );
    });

    bot.action(/^prod_edit_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const pid = parseInt(ctx.match[1], 10);
        await openProductAdminPanelWithCleanSessions(ctx, pid, { edit: true });
    });

    bot.action('prod_delete_list', async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const cleared = await botSession.clearForAdminNav(ctx);
        const prods = (await prisma.product.findMany({})).filter((p) => p.active);
        if (!prods.length) {
            return Msg.editCallbackPanel(ctx, 'Nenhum produto ativo para pausar.', Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'prod_menu_back' }]]));
        }
        await Msg.editCallbackPanel(
            ctx,
            sessionNote(
                '<b>Pausar produto</b>\n\nEscolha o produto ou use <code>/removeproduto ID</code>:\n\n<i>O produto some do catálogo — pedidos antigos são mantidos.</i>',
                cleared
            ),
            Markup.inlineKeyboard(buildProductPickerRows(prods, 'prod_del_'))
        );
    });

    bot.action(/^prod_del_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const pid = parseInt(ctx.match[1], 10);
        const p = await ProductAdminService.findProduct(pid, true);
        if (!p) {
            return Msg.editCallbackPanel(ctx, 'Produto não encontrado.', Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'prod_delete_list' }]]));
        }
        if (!p.active) {
            return Msg.editCallbackPanel(ctx, `Produto #${pid} já está pausado.`, Markup.inlineKeyboard([[{ text: 'Reativar', callback_data: `prod_reactivate_${pid}` }]]));
        }
        await Msg.editCallbackPanel(
            ctx,
            `<b>Pausar produto?</b>\n\n#${p.id} — <b>${p.name}</b>\nR$ ${Number(p.price).toFixed(2)}`,
            ProductAdminService.buildDeleteConfirmKeyboard(pid)
        );
    });

    bot.action(/^prod_del_confirm_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const pid = parseInt(ctx.match[1], 10);
        const result = await ProductAdminService.setProductActive(pid, false, productAdminDeps(ctx));
        await ctx.answerCbQuery(result.ok ? 'Produto pausado' : 'Erro');
        if (!result.ok) {
            return Msg.editCallbackPanel(ctx, `${result.error}`, Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'prod_menu_back' }]]));
        }
        await Msg.editCallbackPanel(
            ctx,
            `<b>Produto pausado</b>\n\n#${result.product.id} — ${result.product.name}\n\nReative: <code>/reativarproduto ${pid}</code>`,
            Markup.inlineKeyboard([[{ text: 'Voltar produtos', callback_data: 'prod_menu_back' }]])
        );
    });

    bot.action(/^prod_reactivate_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        const pid = parseInt(ctx.match[1], 10);
        const result = await ProductAdminService.setProductActive(pid, true, productAdminDeps(ctx));
        await ctx.answerCbQuery(result.ok ? 'Produto reativado' : 'Erro');
        if (!result.ok) {
            return Msg.editCallbackPanel(ctx, `${result.error}`, Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'prod_menu_back' }]]));
        }
        await openProductAdminPanelWithCleanSessions(ctx, pid, { edit: true });
    });

    bot.action(/^prod_edit_pg_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const page = parseInt(ctx.match[1], 10) || 0;
        const prods = (await prisma.product.findMany({})).filter((p) => p.active);
        if (!prods.length) {
            return Msg.editCallbackPanel(ctx, 'Nenhum produto ativo.', Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'prod_menu_back' }]]));
        }
        await Msg.editCallbackPanel(
            ctx,
            '<b>Editar produto</b>\n\nEscolha o produto ou use:\n<code>/editproduto ID</code>\n<code>/editproduto ID preco 29.90</code>',
            Markup.inlineKeyboard(buildProductPickerRows(prods, 'prod_edit_', page))
        );
    });

    bot.action(/^prod_del_pg_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx.from.id)) return;
        await ctx.answerCbQuery();
        const page = parseInt(ctx.match[1], 10) || 0;
        const prods = (await prisma.product.findMany({})).filter((p) => p.active);
        if (!prods.length) {
            return Msg.editCallbackPanel(ctx, 'Nenhum produto para desativar.', Markup.inlineKeyboard([[{ text: 'Voltar', callback_data: 'prod_menu_back' }]]));
        }
        await Msg.editCallbackPanel(
            ctx,
            '<b>Pausar produto</b>\n\nEscolha o produto ou use <code>/removeproduto ID</code>:',
            Markup.inlineKeyboard(buildProductPickerRows(prods, 'prod_del_', page))
        );
    });
}

module.exports = { registerProductWizardHandlers };
