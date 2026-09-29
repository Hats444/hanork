'use strict';

const { Markup } = require('telegraf');
const { CB } = require('../callbacks/constants');
const { cartBtn, restockBtn, payBalanceBtn, payWalletBtn } = require('../../utils/buttonLabels');
const { MENU_BTN, PAY_BTN } = require('./menuCopy');
const { channelMenuRow } = require('../referenceChannelGuard');

function menuUsesV4() {
    const v = String(process.env.HANORK_MENU_V4 ?? '1').toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no';
}

function menuSmmEnabled() {
    try {
        return require('../../modules/smm/smmEnabled').isSmmEnabled();
    } catch {
        return false;
    }
}

function menuVirtuoEnabled() {
    try {
        return require('../../modules/virtuo/virtuoEnabled').isVirtuoEnabled();
    } catch {
        return false;
    }
}

function menuVirtuoVisible() {
    const v = String(process.env.VIRTUO_MENU ?? '1').toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no';
}

function virtuoMenuButton(uid, isAdminFn) {
    if (!menuVirtuoVisible()) return null;
    try {
        const label = require('../../modules/virtuo/virtuoAccess').virtuoMenuButtonLabel(uid, isAdminFn);
        if (!label) return null;
        return { text: label, callback_data: CB.VIRTUO_HOME };
    } catch {
        return { text: MENU_BTN.virtuo, callback_data: CB.VIRTUO_HOME };
    }
}

function smmMenuButton(uid, isAdminFn) {
    if (!menuSmmEnabled()) return null;
    try {
        const label = require('../../modules/smm/smmAccess').smmMenuButtonLabel(uid, isAdminFn);
        if (!label) return null;
        return { text: label, callback_data: CB.SMM_HOME };
    } catch {
        return { text: MENU_BTN.smm, callback_data: CB.SMM_HOME };
    }
}

function smmMenuRow(uid, isAdminFn) {
    const btn = smmMenuButton(uid, isAdminFn);
    return btn ? [btn] : null;
}

function createMenuKeyboards(config, PaymentService) {
    return class Menu {
        static principal(
            isSubscriber = false,
            productCount = null,
            featured = null,
            menuUid = null,
            isAdminFn = null,
            menuOpts = {}
        ) {
            if (menuUsesV4()) {
                return Menu.principalV4(isSubscriber, productCount, featured, menuUid, isAdminFn, menuOpts);
            }
            return Menu.principalLegacy(isSubscriber, productCount, featured, menuUid, isAdminFn, menuOpts);
        }

        /** UX V4 — 8 botões principais (+ referências / destaque opcionais). */
        static principalV4(
            isSubscriber = false,
            productCount = null,
            featured = null,
            menuUid = null,
            isAdminFn = null,
            menuOpts = {}
        ) {
            const catLabel = menuOpts.isStartScreen
                ? MENU_BTN.verProdutos
                : MENU_BTN.catalogo(productCount);
            const rows = [];

            if (menuOpts.showRefChannel !== false) {
                const refRow = channelMenuRow();
                if (refRow) rows.push(refRow);
            }

            rows.push([
                { text: MENU_BTN.comecar, callback_data: CB.CATALOG_VIEW },
                { text: catLabel, callback_data: CB.CATALOG_VIEW },
            ]);

            const premiumBtn = {
                text: isSubscriber ? MENU_BTN.premium(true) : MENU_BTN.premium(false),
                callback_data: CB.SUBSCRIPTION_VIEW,
            };
            const downloadsBtn = { text: MENU_BTN.downloads, callback_data: CB.DOWNLOADS_OPEN };
            const smmBtn = smmMenuButton(menuUid, isAdminFn);
            const virtuoBtn = virtuoMenuButton(menuUid, isAdminFn);

            // Números SMS em linha própria — não esconder atrás do atalho BR removido
            if (virtuoBtn) {
                rows.push([virtuoBtn]);
            }
            if (smmBtn && virtuoBtn) {
                rows.push([smmBtn, premiumBtn]);
                rows.push([downloadsBtn]);
            } else if (smmBtn) {
                rows.push([smmBtn, premiumBtn]);
                rows.push([downloadsBtn]);
            } else if (virtuoBtn) {
                rows.push([premiumBtn, downloadsBtn]);
            } else {
                rows.push([premiumBtn, downloadsBtn]);
            }

            if (featured?.menuLabel && featured?.callbackData) {
                rows.push([{ text: featured.menuLabel, callback_data: featured.callbackData }]);
            }

            rows.push(
                [
                    { text: MENU_BTN.carrinho, callback_data: CB.CART_VIEW },
                    { text: MENU_BTN.ofertas, callback_data: CB.FLASH_SALES },
                ],
                [
                    { text: MENU_BTN.minhaConta, callback_data: CB.MENU_ACCOUNT },
                    { text: MENU_BTN.suporte, callback_data: CB.HELP_OPEN },
                ],
            );

            return Markup.inlineKeyboard(rows);
        }

        /** Layout legado (10+ botões) — rollback via HANORK_MENU_V4=0 */
        static principalLegacy(
            isSubscriber = false,
            productCount = null,
            featured = null,
            menuUid = null,
            isAdminFn = null,
            menuOpts = {}
        ) {
            const catLabel = MENU_BTN.catalogo(productCount);
            const rows = [];
            if (menuOpts.showRefChannel !== false) {
                const refRow = channelMenuRow({ legacy: true });
                if (refRow) rows.push(refRow);
            }
            rows.push([{ text: catLabel, callback_data: CB.CATALOG_VIEW }]);
            if (featured?.menuLabel && featured?.callbackData) {
                rows.push([{ text: featured.menuLabel, callback_data: featured.callbackData }]);
            }
            rows.push(
                [{ text: MENU_BTN.carrinho, callback_data: CB.CART_VIEW }],
                [{ text: MENU_BTN.buscar, callback_data: CB.SEARCH_OPEN }],
                [{ text: MENU_BTN.ofertas, callback_data: CB.FLASH_SALES }],
            );
            if (menuSmmEnabled()) {
                const smmRow = smmMenuRow(menuUid, isAdminFn);
                if (smmRow) rows.push(smmRow);
            }
            if (menuVirtuoEnabled()) {
                const vBtn = virtuoMenuButton(menuUid, isAdminFn);
                if (vBtn) rows.push([vBtn]);
            }
            rows.push(
                [{ text: MENU_BTN.downloads, callback_data: CB.DOWNLOADS_OPEN }],
                [{ text: MENU_BTN.minhaConta, callback_data: CB.MENU_ACCOUNT }],
                [{ text: MENU_BTN.favoritos, callback_data: CB.USER_FAVORITES }],
                [{
                    text: isSubscriber ? MENU_BTN.premium(true) : MENU_BTN.premium(false),
                    callback_data: CB.SUBSCRIPTION_VIEW,
                }],
                [{ text: MENU_BTN.assistente, callback_data: CB.HANORK_OPEN }],
                [{ text: MENU_BTN.suporte, callback_data: CB.HELP_OPEN }],
            );
            return Markup.inlineKeyboard(rows);
        }

        static minhaConta(isSubscriber = false) {
            if (menuUsesV4()) {
                return Menu.minhaContaV4(isSubscriber);
            }
            return Menu.minhaContaLegacy(isSubscriber);
        }

        static minhaContaV4(isSubscriber = false) {
            const rows = [
                [{ text: '📦 Meus Pedidos', callback_data: CB.ORDER_LIST }],
                [
                    { text: '📦 Rastrear', callback_data: CB.ORDER_TRACK },
                    { text: '🔄 Reenviar', callback_data: CB.ORDER_RESEND },
                ],
                [
                    { text: MENU_BTN.buscar, callback_data: CB.SEARCH_OPEN },
                    { text: MENU_BTN.favoritos, callback_data: CB.USER_FAVORITES },
                ],
                [{ text: MENU_BTN.downloads, callback_data: CB.DOWNLOADS_OPEN }],
                [{
                    text: isSubscriber ? MENU_BTN.premium(true) : MENU_BTN.premium(false),
                    callback_data: CB.SUBSCRIPTION_VIEW,
                }],
                [
                    { text: '🤝 Afiliados', callback_data: CB.USER_AFFILIATE },
                    { text: '🏷️ Cupom', callback_data: CB.USER_COUPON },
                ],
                [
                    { text: MENU_BTN.assistente, callback_data: CB.HANORK_OPEN },
                    { text: '📤 Indicar', callback_data: CB.USER_SHARE },
                ],
                [{ text: '📄 Termos', callback_data: 'terms:summary' }],
                [{ text: MENU_BTN.menu, callback_data: CB.MENU_HOME }],
            ];
            return Markup.inlineKeyboard(rows);
        }

        static minhaContaLegacy(isSubscriber = false) {
            const rows = [
                [{ text: '📦 Meus Pedidos', callback_data: CB.ORDER_LIST }],
                [{ text: '📦 Rastrear', callback_data: CB.ORDER_TRACK }],
                [{ text: '🔄 Reenviar', callback_data: CB.ORDER_RESEND }],
                [{ text: '🤝 Afiliados', callback_data: CB.USER_AFFILIATE }],
                [{ text: '🏷️ Cupom', callback_data: CB.USER_COUPON }],
                [{ text: '📤 Indicar', callback_data: CB.USER_SHARE }],
                [{ text: MENU_BTN.menu, callback_data: CB.MENU_HOME }],
            ];
            void isSubscriber;
            return Markup.inlineKeyboard(rows);
        }

        static produto(pid, hasStock = true, cartQty = 0, cartTotal = 0, restockSubscribed = false) {
            const rows = [];
            if (hasStock) {
                rows.push(
                    [{ text: '➕ Adicionar', callback_data: `add_${pid}` }],
                    [{ text: '💳 Comprar', callback_data: `buy_${pid}` }]
                );
            } else {
                rows.push([{
                    text: restockBtn(restockSubscribed),
                    callback_data: `notify_restock_${pid}`,
                }]);
            }
            if (cartTotal > 0) {
                rows.push([{ text: cartBtn(cartTotal), callback_data: CB.CART_VIEW }]);
            }
            rows.push(
                [{ text: MENU_BTN.catalogo(), callback_data: CB.CATALOG_VIEW }],
                [{ text: MENU_BTN.menu, callback_data: CB.MENU_HOME }]
            );
            return Markup.inlineKeyboard(rows);
        }

        static pagamento(oid, affSaldo = 0, total = 0, opts = {}) {
            const mpOk = PaymentService.isAvailable();
            const backLabel = opts.backLabel || PAY_BTN.backCart;
            const backCallback = opts.backCallback || CB.CART_VIEW;
            const walletSaldo = Number(opts.walletSaldo ?? 0);
            const rows = [];
            if (mpOk) {
                rows.push(
                    [{ text: PAY_BTN.pix, callback_data: CB.PAYMENT_PIX(oid) }],
                    [{ text: PAY_BTN.card, callback_data: CB.PAYMENT_CARD(oid) }]
                );
            } else {
                rows.push([{ text: PAY_BTN.support, url: config.CONTATO_ESPECIALISTA }]);
            }
            if (walletSaldo >= total && total > 0) {
                rows.push([{
                    text: payWalletBtn(total),
                    callback_data: CB.PAYMENT_WALLET(oid),
                }]);
            }
            if (affSaldo >= total && total > 0) {
                rows.push([{
                    text: payBalanceBtn(total),
                    callback_data: CB.PAYMENT_AFF(oid),
                }]);
            }
            rows.push([{ text: backLabel, callback_data: backCallback }]);
            if (mpOk) {
                rows.push(
                    [{ text: PAY_BTN.verify, callback_data: CB.PAYMENT_CHECK(oid) }],
                    [{ text: MENU_BTN.menu, callback_data: CB.MENU_HOME }]
                );
            } else {
                rows.push([{ text: MENU_BTN.menu, callback_data: CB.MENU_HOME }]);
            }
            return Markup.inlineKeyboard(rows);
        }

        static admin(page = 0) {
            const { buildAdminPanelKeyboard } = require('./adminPanelUi');
            return buildAdminPanelKeyboard(page).markup;
        }
    };
}

module.exports = { createMenuKeyboards, menuUsesV4 };
