'use strict';

function registerShopCommands(bot, deps) {
    const {
        requirePrivate,
        cartKey,
        Cart,
        Msg,
        Markup,
        prisma,
        replyWithMenuPhoto,
        TEXTO,
        runCheckout,
        comprasPendentes,
        logger,
        bot: telegramBot,
    } = deps;

    bot.command('carrinho', async (ctx) => {
        if (!(await requirePrivate(ctx))) return;
        const key = cartKey(ctx);
        if (!key) return Msg.reply(ctx, '❌ Não foi possível identificar sua conta. Use /start no privado.');
        const s = await Cart.summary(key);
        if (!s) return Msg.reply(ctx, TEXTO.carrinho.vazio);
        const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
        const baseTotal = await Cart.total(key);
        const t = await Cart.totalWithDiscount(key, user?.id);
        let cartText = TEXTO.carrinho.itens.replace('{itens}', s).replace('{total}', t.toFixed(2));
        if (t < baseTotal - 0.001) {
            cartText += `\n\n💎 Desconto assinante aplicado no checkout.`;
        }
        await replyWithMenuPhoto(
            ctx,
            cartText,
            Markup.inlineKeyboard([
                [{ text: '💳 Finalizar', callback_data: 'checkout' }, { text: '🗑️ Esvaziar', callback_data: 'clr' }],
                [{ text: '🛍️ Catálogo', callback_data: 'cat' }, { text: '🏠 Menu', callback_data: 'home' }],
            ])
        );
    });

    bot.command('checkout', async (ctx) => {
        try {
            await runCheckout(ctx);
        } catch (e) {
            logger.error('[checkout]', { message: e.message, stack: e.stack });
            await Msg.reply(ctx, '❌ Erro no checkout. Tente de novo.');
        }
    });

    bot.command('pix', async (ctx) => {
        const args = ctx.message.text.split(' ');
        const orderId = args[1];
        if (!orderId) {
            const c = await comprasPendentes.get(cartKey(ctx));
            if (!c) {
                return Msg.reply(ctx, '❌ Nenhum pedido pendente.\n\nUse /checkout para criar um pedido primeiro.');
            }
            ctx.callbackQuery = { data: `pp_${c.orderId}`, from: ctx.from, message: ctx.message };
            await telegramBot.handleUpdate({ callback_query: ctx.callbackQuery });
            return;
        }
        ctx.callbackQuery = { data: `pp_${orderId}`, from: ctx.from, message: ctx.message };
        await telegramBot.handleUpdate({ callback_query: ctx.callbackQuery });
    });

    bot.action(/^add_(\d+)$/, async (ctx) => {
        const pid = parseInt(ctx.match[1], 10);
        await ctx.answerCbQuery('✅ Adicionado!');
        await Cart.add(cartKey(ctx), pid, 1);
    });

    bot.action(/^buy_(\d+)$/, async (ctx) => {
        const pid = parseInt(ctx.match[1], 10);
        await ctx.answerCbQuery('🛒 Processando...');
        if (!(await requirePrivate(ctx, '🔒 Para pagar com segurança, abra o bot no privado.'))) return;
        try {
            await Cart.clear(cartKey(ctx));
            await Cart.add(cartKey(ctx), pid, 1);
            await runCheckout(ctx);
        } catch (e) {
            logger.error('[buy_]', { pid, message: e.message });
            await Msg.edit(
                ctx,
                '❌ Erro no checkout. Tente de novo ou use /checkout.',
                Markup.inlineKeyboard([
                    [{ text: '🔙 Produto', callback_data: `p_${pid}` }],
                    [{ text: '🏠 Menu', callback_data: 'home' }],
                ])
            );
        }
    });
}

module.exports = { registerShopCommands };
