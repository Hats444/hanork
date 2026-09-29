'use strict';

const PaymentService = require('../../../modules/payment/PaymentService');
const PaymentCheckService = require('../../../services/PaymentCheckService');
const { orderBelongsToUser } = require('../../../modules/payment/paymentCheckUtils');
const { isCancelled } = require('../../../modules/order/orderStatus');
const { createPaymentUi } = require('./paymentUi');
const { criarPagamentoMP, criarCheckoutMP } = require('./paymentMpHelpers');
const { PAY_BTN, MENU_BTN } = require('../../menus/menuCopy');

/**
 * Callbacks legados de pagamento: pp_, pc_, check_, cancel_, copypix_, payment_methods_
 * @param {import('telegraf').Telegraf} bot
 * @param {object} deps
 */
function registerPaymentActions(bot, deps) {
    const {
        prisma,
        logger,
        Msg,
        Markup,
        Menu,
        MP,
        antiSpam,
        comprasPendentes,
        cartKey,
        getAffSaldo,
        getWalletSaldo,
        dbRaw,
        lastMenuMsg,
        bot: botInstance,
    } = deps;

    const botRef = botInstance || bot;
    const mpDeps = { prisma, MP };
    const ui = createPaymentUi({
        Msg,
        logger,
        lastMenuMsg,
        Markup,
        bot: botRef,
        prisma,
        MP,
        comprasPendentes,
        cartKey,
        CONFIG: deps.CONFIG,
    });
    const { editPaymentScreen, showPixQrPaymentScreen } = ui;

    bot.action(/^payment_methods_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        await ctx.answerCbQuery();
        if (!antiSpam.checkCallback(ctx.chat.id, `paymeth_${orderId}`)) return;
        try {
            const order = await prisma.order.findUnique({ where: { id: orderId } });
            if (!order) {
                return editPaymentScreen(ctx, 'âŒ Pedido nÃ£o encontrado.', Markup.inlineKeyboard([[{ text: 'ðŸ  Menu', callback_data: 'home' }]]));
            }
            if (order.status !== 'WAITING_PAYMENT') {
                return editPaymentScreen(
                    ctx,
                    `âŒ Pedido jÃ¡ ${order.status === 'PAID' ? 'pago' : 'processado'}.`,
                    Markup.inlineKeyboard([[{ text: 'ðŸ  Menu', callback_data: 'home' }]])
                );
            }
            const pending = await comprasPendentes.get(cartKey(ctx));
            const total = pending?.total ?? Number(order.total) ?? 0;
            let affSaldo = 0;
            let walletSaldo = 0;
            try {
                affSaldo = await getAffSaldo(ctx.from?.id);
            } catch { /* ignore */ }
            try {
                if (getWalletSaldo) walletSaldo = await getWalletSaldo(ctx.from?.id);
            } catch { /* ignore */ }
            await editPaymentScreen(
                ctx,
                `ðŸ’³ <b>Formas de pagamento</b>\n\nðŸ“‹ Pedido #${orderId.slice(-8)}\nðŸ’° R$ ${total.toFixed(2)}`,
                Menu.pagamento(orderId, affSaldo, total, { walletSaldo })
            );
        } catch (e) {
            logger.error('[PAYMENT] payment_methods error:', e.message);
            await editPaymentScreen(ctx, 'âŒ Erro ao abrir pagamento.', Markup.inlineKeyboard([[{ text: 'ðŸ  Menu', callback_data: 'home' }]]));
        }
    });

    bot.action(/^pp_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        await ctx.answerCbQuery('ðŸ’³ Gerando PIX...');
        if (!antiSpam.checkCallback(ctx.chat.id, `pp_${orderId}`)) return;
        try {
            const pending = await comprasPendentes.get(cartKey(ctx));
            if (!pending || pending.orderId !== orderId) {
                return editPaymentScreen(ctx, 'âŒ Pedido nÃ£o encontrado ou expirado.', Markup.inlineKeyboard([[{ text: 'ðŸ  Menu', callback_data: 'home' }]]));
            }
            const order = await prisma.order.findUnique({ where: { id: orderId } });
            if (!order) return editPaymentScreen(ctx, 'âŒ Pedido nÃ£o encontrado.', Markup.inlineKeyboard([[{ text: 'ðŸ  Menu', callback_data: 'home' }]]));
            if (order.status !== 'WAITING_PAYMENT') {
                return editPaymentScreen(ctx, `âŒ Pedido jÃ¡ ${order.status === 'PAID' ? 'pago' : 'processado'}.`, Markup.inlineKeyboard([[{ text: 'ðŸ  Menu', callback_data: 'home' }]]));
            }

            const pixMsg = (extra = '') =>
                `ðŸ’³ <b>Pagamento via PIX</b>\n\nðŸ“‹ Pedido: #${orderId.slice(-8)}\nðŸ’° Valor: R$ ${pending.total.toFixed(2)}\n\nðŸ“± Escaneie o QR Code ou toque em <b>Copiar CÃ³digo PIX</b>.\n\n<i>O pagamento serÃ¡ confirmado automaticamente.</i>${extra}`;

            if (pending.pixQrCode) {
                return showPixQrPaymentScreen(ctx, pending, orderId, pixMsg());
            }

            if (!PaymentService.isAvailable()) {
                throw Object.assign(new Error('TOKEN_MP nÃ£o configurado no .env'), { code: 'MP_UNAVAILABLE' });
            }

            await editPaymentScreen(
                ctx,
                `ðŸ’³ <b>Gerando PIX...</b>\n\nðŸ“‹ Pedido: #${orderId.slice(-8)}\nðŸ’° Valor: R$ ${pending.total.toFixed(2)}`,
                Markup.inlineKeyboard([[{ text: 'â³ Aguarde...', callback_data: 'noop' }]])
            );

            const mpResponse = await criarPagamentoMP(mpDeps, orderId, pending.total, ctx.from.id.toString());
            if (!mpResponse?.id) throw new Error('Falha ao criar pagamento MP');

            const qrCode = mpResponse.qr_code;
            const qrCodeBase64 = mpResponse.qr_code_base64;

            if (!qrCode) {
                logger.error('[PAYMENT] PIX sem qr_code', { keys: Object.keys(mpResponse || {}) });
                throw new Error('QR Code nÃ£o retornado pelo MP');
            }

            pending.pixQrCode = qrCode;
            pending.pixQrCodeBase64 = qrCodeBase64;
            pending.paymentId = mpResponse.id;
            await comprasPendentes.set(cartKey(ctx), pending);

            await prisma.order.update({
                where: { id: orderId },
                data: { payment_id: String(mpResponse.id), payment_method: 'pix' },
            });

            try {
                const { trackConversionEvent } = require('../../../services/ConversionEventService');
                if (order?.user_id) {
                    trackConversionEvent(order.user_id, 'payment_pending', { order_id: orderId, method: 'pix' }, order.tenant_id);
                }
            } catch (_) { /* telemetry */ }

            await showPixQrPaymentScreen(ctx, pending, orderId, pixMsg());
        } catch (e) {
            const detail = PaymentService.formatMpError?.(e) || e.message;
            logger.error('PIX error:', detail);
            const hint =
                e.code === 'MP_UNAVAILABLE'
                    ? 'Defina TOKEN_MP no .env e reinicie o bot.'
                    : e.status === 401
                      ? 'Token MP invÃ¡lido â€” gere um novo no painel Mercado Pago.'
                      : 'Verifique TOKEN_MP, MP_PAYER_CPF (11 dÃ­gitos) e conexÃ£o com api.mercadopago.com.';
            await editPaymentScreen(
                ctx,
                `âŒ <b>Erro ao gerar PIX</b>\n\n${detail}\n\n<i>${hint}</i>`,
                Markup.inlineKeyboard([
                    [{ text: 'ðŸ”„ Tentar de novo', callback_data: `pp_${orderId}` }],
                    [{ text: 'ðŸ  Menu', callback_data: 'home' }],
                ])
            );
        }
    });

    bot.action(/^copypix_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        try {
            const pending = await comprasPendentes.get(cartKey(ctx));
            if (!pending || !pending.pixQrCode) {
                return ctx.answerCbQuery('❌ Código PIX não encontrado', { show_alert: true });
            }
            await ctx.answerCbQuery('Atualizando botão de copiar…').catch(() => { });
            const msgText =
                `💳 <b>Pagamento via PIX</b>\n\n📋 Pedido: #${orderId.slice(-8)}\n💰 Valor: R$ ${pending.total.toFixed(2)}\n\n` +
                `📱 Escaneie o QR Code ou toque em <b>Copiar código PIX</b>.\n\n` +
                `<i>O pagamento será confirmado automaticamente.</i>`;
            await showPixQrPaymentScreen(ctx, pending, orderId, msgText);
        } catch (e) {
            if (require('../../messageDelivery').isIgnorableEditError?.(e)) {
                await ctx.answerCbQuery('ðŸ“‹ Toque no cÃ³digo acima para copiar').catch(() => {});
                return;
            }
            logger.error('Copy PIX error:', e.message);
            await ctx.answerCbQuery('âŒ Erro ao exibir cÃ³digo', { show_alert: true }).catch(() => {});
        }
    });

    bot.action(/^pc_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        await ctx.answerCbQuery('ðŸ’³ Gerando checkout...');
        if (!antiSpam.checkCallback(ctx.chat.id, `pc_${orderId}`)) return;
        const { resolveCheckoutButtonUrl } = require('../../../modules/payment/mpPublicUrl');
        try {
            const pending = await comprasPendentes.get(cartKey(ctx));
            if (!pending || pending.orderId !== orderId) {
                return editPaymentScreen(ctx, 'âŒ Pedido nÃ£o encontrado ou expirado.', Markup.inlineKeyboard([[{ text: 'ðŸ  Menu', callback_data: 'home' }]]));
            }
            const order = await prisma.order.findUnique({ where: { id: orderId } });
            if (!order) return editPaymentScreen(ctx, 'âŒ Pedido nÃ£o encontrado.', Markup.inlineKeyboard([[{ text: 'ðŸ  Menu', callback_data: 'home' }]]));
            if (order.status !== 'WAITING_PAYMENT') {
                return editPaymentScreen(ctx, `âŒ Pedido jÃ¡ ${order.status === 'PAID' ? 'pago' : 'processado'}.`, Markup.inlineKeyboard([[{ text: 'ðŸ  Menu', callback_data: 'home' }]]));
            }

            let mpResponse = null;
            let initPoint = null;
            const prefAge = Date.now() - (pending.mpCheckoutAt || 0);
            if (pending.mpPreferenceId && pending.mpCheckoutUrl && prefAge < 6 * 60 * 60 * 1000) {
                mpResponse = { id: pending.mpPreferenceId, checkout_url: pending.mpCheckoutUrl };
                initPoint = pending.mpCheckoutUrl;
            }

            if (!mpResponse) {
                await editPaymentScreen(
                    ctx,
                    `ðŸ’³ <b>Gerando link de pagamento...</b>\n\nðŸ“‹ Pedido: #${orderId.slice(-8)}\nðŸ’° Valor: R$ ${pending.total.toFixed(2)}`,
                    Markup.inlineKeyboard([[{ text: 'â³ Aguarde...', callback_data: 'noop' }]])
                );
                mpResponse = await criarCheckoutMP(mpDeps, orderId, pending.total, ctx.from.id.toString());
                if (!mpResponse?.id) throw new Error('Falha ao criar checkout MP');
                initPoint =
                    mpResponse.checkout_url ||
                    PaymentService.getCheckoutInitPoint(mpResponse);
                if (!initPoint) throw new Error('URL de checkout nÃ£o gerada');
            }

            const buttonUrl = resolveCheckoutButtonUrl(mpResponse.id, initPoint);
            if (!buttonUrl) throw new Error('URL de checkout nÃ£o gerada');

            pending.mpPreferenceId = mpResponse.id;
            pending.mpCheckoutUrl = initPoint;
            pending.mpCheckoutAt = Date.now();
            await comprasPendentes.set(cartKey(ctx), pending);

            await prisma.order.update({
                where: { id: orderId },
                data: { payment_method: 'card' },
            });
            try {
                const { trackConversionEvent } = require('../../../services/ConversionEventService');
                if (order.user_id) {
                    trackConversionEvent(order.user_id, 'payment_pending', { order_id: orderId, method: 'card' }, order.tenant_id);
                }
            } catch (_) { /* telemetry */ }
            try {
                dbRaw().prepare(
                    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
                ).run(`order_mp_pref:${orderId}`, String(mpResponse.id));
                dbRaw().prepare(
                    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
                ).run(`mp_pref_url:${mpResponse.id}`, initPoint);
            } catch (_) { /* ignore */ }

            const viaWrapper = buttonUrl !== initPoint;
            await editPaymentScreen(
                ctx,
                `<b>Pagamento com cartÃ£o ou boleto</b>\n\n` +
                    `Pedido: <b>#${orderId.slice(-8)}</b>\n` +
                    `Valor: <b>R$ ${pending.total.toFixed(2)}</b>\n\n` +
                    `<b>Passo 1</b> â€” Toque em <b>Pagar agora</b> e conclua no Mercado Pago.\n` +
                    `<b>Passo 2</b> â€” ApÃ³s pagar, volte aqui. A confirmaÃ§Ã£o Ã© automÃ¡tica em atÃ© 2 minutos.\n` +
                    `<b>Passo 3</b> â€” Se nÃ£o atualizar, toque em <b>Verificar pagamento</b>.\n\n` +
                    (viaWrapper
                        ? `<i>Se a pÃ¡gina travar, use â‹® â†’ Abrir no navegador.</i>`
                        : `<i>Se a pÃ¡gina travar no carregamento, use â‹® â†’ Abrir no navegador.</i>`),
                Markup.inlineKeyboard([
                    [{ text: PAY_BTN.payNow, url: buttonUrl }],
                    [
                        { text: PAY_BTN.pix, callback_data: `pp_${orderId}` },
                        { text: PAY_BTN.verify, callback_data: `check_${orderId}` },
                    ],
                    [{ text: PAY_BTN.cancel, callback_data: `cancel_${orderId}` }],
                ])
            );
            try {
                const { scheduleCardAutoPoll } = require('../../../modules/payment/cardAutoPoll');
                scheduleCardAutoPoll(orderId, ctx, {
                    prisma,
                    bot: botRef,
                    MP,
                    comprasPendentes,
                    cartKey,
                    log: logger,
                });
            } catch {
                /* ignore */
            }
        } catch (e) {
            const detail = PaymentService.formatMpError?.(e) || e.message;
            logger.error('Card checkout error:', detail);
            const hint =
                e.code === 'MP_UNAVAILABLE'
                    ? 'Configure TOKEN_MP no servidor.'
                    : e.status === 401
                      ? 'Token MP invÃ¡lido ou expirado.'
                      : 'Use PIX abaixo ou tente em instantes.';
            await editPaymentScreen(
                ctx,
                `<b>Checkout cartÃ£o indisponÃ­vel</b>\n\n${detail}\n\n<i>${hint}</i>`,
                Markup.inlineKeyboard([
                    [{ text: PAY_BTN.payWithPix, callback_data: `pp_${orderId}` }],
                    [{ text: MENU_BTN.menu, callback_data: 'home' }],
                ])
            );
        }
    });

    bot.action(/^check_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        let cbAnswered = false;
        const dismissCb = async (text = '', opts = {}) => {
            if (cbAnswered) return;
            cbAnswered = true;
            await ctx.answerCbQuery(text, opts).catch(() => {});
        };
        const notifyUser = async (text, { alert = false } = {}) => {
            if (!cbAnswered) {
                await dismissCb(text, alert ? { show_alert: true } : {});
                return;
            }
            await Msg.sendSide(ctx, text).catch(() => {});
        };
        try {
            await PaymentCheckService.runManualPaymentCheck(
                ctx,
                orderId,
                { prisma, bot: botRef, MP, comprasPendentes, cartKey, log: logger },
                { dismissCb, notifyUser }
            );
        } catch (e) {
            logger.error('[PAYMENT] check_ error:', e.message);
            await notifyUser('âŒ Erro ao verificar. Tente novamente.', { alert: true });
        }
    });

    bot.action(/^cancel_(.+)$/, async (ctx) => {
        const orderId = ctx.match[1];
        try {
            const { cancelPixAutoPoll } = require('../../../modules/payment/pixAutoPoll');
            cancelPixAutoPoll(orderId);
        } catch { /* ignore */ }
        try {
            const { cancelCardAutoPoll } = require('../../../modules/payment/cardAutoPoll');
            cancelCardAutoPoll(orderId);
        } catch { /* ignore */ }
        await ctx.answerCbQuery('Cancelandoâ€¦');
        try {
            const order = await prisma.order.findUnique({ where: { id: orderId } });
            if (!order) return ctx.answerCbQuery('âŒ Pedido nÃ£o encontrado', { show_alert: true });
            if (!(await orderBelongsToUser(prisma, order, ctx.from.id))) {
                return ctx.answerCbQuery('âŒ Este pedido nÃ£o Ã© seu', { show_alert: true });
            }
            if (order.status === 'PAID' || order.status === 'DELIVERING' || order.status === 'DELIVERED') {
                return ctx.answerCbQuery('âŒ Pedido jÃ¡ pago â€” nÃ£o pode cancelar', { show_alert: true });
            }
            if (isCancelled(order.status)) {
                return ctx.answerCbQuery('âŒ Pedido jÃ¡ cancelado', { show_alert: true });
            }

            const pending = await comprasPendentes.get(cartKey(ctx));
            const paymentId = order.payment_id || pending?.paymentId;
            if (paymentId && PaymentService.isAvailable()) {
                try {
                    await MP.cancel(paymentId);
                    logger.info('[PAYMENT] PIX cancelado no MP', { paymentId, orderId });
                } catch (e) {
                    logger.warn('[PAYMENT] NÃ£o foi possÃ­vel cancelar no MP:', e.message);
                }
            }

            await prisma.order.update({ where: { id: orderId }, data: { status: 'FAILED' } });
            try {
                const { cancelSmmHanorkOrder } = require('../../../modules/smm/helpers/smmOrderCancelHelper');
                cancelSmmHanorkOrder(orderId);
            } catch {
                /* SMM opcional */
            }
            try {
                const { cancelVirtuoHanorkOrder } = require('../../../modules/virtuo/helpers/virtuoOrderCancelHelper');
                cancelVirtuoHanorkOrder(orderId);
            } catch {
                /* Virtuo opcional */
            }
            try {
                await comprasPendentes.delete(cartKey(ctx));
            } catch (redisErr) {
                logger.warn('[ORDER] pending_purchase delete falhou â€” pedido jÃ¡ FAILED', {
                    orderId,
                    detail: redisErr.message,
                });
            }
            const user = await prisma.user.findUnique({ where: { telegram_id: String(ctx.from.id) } });
            if (user?.id) {
                try {
                    await prisma.checkoutCooldown.clear(user.id);
                } catch {
                    /* cooldown opcional */
                }
            }

            logger.info('[ORDER] Cancelado pelo usuÃ¡rio', { orderId, uid: ctx.from.id });

            await editPaymentScreen(
                ctx,
                `âŒ <b>Pedido cancelado</b>\n\nPedido #${orderId.slice(-8)} foi cancelado.\n\nVocÃª pode fazer um novo pedido quando quiser.`,
                Markup.inlineKeyboard([
                    [{ text: 'ðŸ›ï¸ CatÃ¡logo', callback_data: 'cat' }],
                    [{ text: 'ðŸ  Menu', callback_data: 'home' }],
                ])
            );
        } catch (e) {
            logger.error('[ORDER] cancel_ error:', e.message);
            await ctx.answerCbQuery('âŒ Erro ao cancelar', { show_alert: true });
        }
    });
}

module.exports = { registerPaymentActions };
