'use strict';

const CatalogService = require('../services/catalogService');
const { formatQuote, formatMoney } = require('../utils/smmTextFormat');
const { effectiveMinQuantity, meetsMpMinPayment, MP_MIN_PAYMENT_BRL } = require('../services/pricingService');
const { checkoutErrorMessage, paymentBelowMinimumMessage } = require('../validators/smmActionValidator');
const { validateTargetInput, validateComments } = require('../validators/smmLinkValidator');
const {
    buildWizardCommentsHint,
    buildWizardQuantityHint,
    buildWizardStartMessage,
    buildWizardTargetHint,
} = require('../services/purchaseGuideService');
const {
    getServiceInputProfile,
    wizardStepTotal,
    wizardStepIndex,
    quantityUnitLabel,
} = require('../constants/serviceTypes');
const { smmPanel } = require('../helpers/smmPanelUi');
const { CB } = require('../utils/smmCallbackData');
const { Markup } = require('telegraf');
const L = require('../utils/smmLabels');
const {
    wizardLinkNoticeKeyboard,
    wizardQuantityNoticeKeyboard,
    catalogNoticeKeyboard,
    genericNoticeKeyboard,
} = require('../keyboards/smmNoticeKeyboards');

const WIZARD_TTL_SEC = 1800;
const WIZARD_TTL_MS = WIZARD_TTL_SEC * 1000;

function wizardKey(telegramId) {
    return `smm_wizard:${String(telegramId)}`;
}

async function getWizard(stateManager, telegramId) {
    if (!stateManager) return null;
    return stateManager.get(wizardKey(telegramId));
}

async function setWizard(stateManager, telegramId, data) {
    if (!stateManager) return;
    await stateManager.set(wizardKey(telegramId), data, WIZARD_TTL_MS);
}

async function clearWizard(stateManager, telegramId) {
    if (!stateManager) return;
    await stateManager.delete(wizardKey(telegramId));
}

function wizardCancelKeyboard() {
    return Markup.inlineKeyboard([
        [{ text: L.CATALOG, callback_data: CB.HOME }],
        [{ text: L.CANCEL, callback_data: CB.cancelWizard }],
    ]);
}

function stepLabel(stepIndex, totalSteps, title) {
    return `<b>Passo ${stepIndex} de ${totalSteps} — ${title}</b>`;
}

function paymentMinMessage(svc, quantity, saleTotal) {
    const payMinQty = effectiveMinQuantity(svc);
    const unit = quantityUnitLabel(svc, quantity);
    return paymentBelowMinimumMessage({
        quantity,
        total: saleTotal,
        minQuantity: payMinQty,
        unitLabel: unit,
    });
}

async function showConfirm(ctx, Msg, stateManager, svc, w) {
    const quote = CatalogService.quote(w.serviceId, w.quantity);
    if (quote?.error) {
        await smmPanel(
            ctx,
            Msg,
            `Quantidade fora do limite (${quote.min} a ${quote.max}).`,
            wizardQuantityNoticeKeyboard(svc.id)
        );
        return;
    }
    const payMinQty = effectiveMinQuantity(svc);
    if (w.quantity < payMinQty || !meetsMpMinPayment(quote.sale_total)) {
        if (payMinQty > svc.max_quantity) {
            await smmPanel(
                ctx,
                Msg,
                `Este serviço não atinge o mínimo de ${formatMoney(MP_MIN_PAYMENT_BRL)} para PIX/cartão. Escolha outro serviço.`,
                genericNoticeKeyboard(svc.id)
            );
            return;
        }
        await smmPanel(
            ctx,
            Msg,
            paymentMinMessage(svc, w.quantity, quote.sale_total),
            wizardQuantityNoticeKeyboard(svc.id)
        );
        return;
    }

    await setWizard(stateManager, ctx.from.id, { ...w, step: 'confirm' });
    const profile = getServiceInputProfile(svc);
    const payStep = wizardStepIndex(profile, 'payment');
    const totalSteps = wizardStepTotal(profile);
    await smmPanel(
        ctx,
        Msg,
        `${stepLabel(payStep, totalSteps, 'Pagamento')}\n\n` +
            formatQuote(svc, w.quantity, quote.sale_total) +
            '\n\nToque em <b>Continuar para pagamento</b> e escolha PIX ou cartão.\n' +
            'Após pagar, a confirmação é automática (até 2 min no cartão).\n\n' +
            '<i>Cupom: /cupom CODIGO antes de continuar.</i>',
        Markup.inlineKeyboard([
            [{ text: L.CONTINUE_PAY, callback_data: CB.confirmPay }],
            [{ text: L.CANCEL, callback_data: CB.cancelWizard }],
        ])
    );
}

async function startBuyWizard(ctx, Msg, stateManager, serviceId) {
    const svc = CatalogService.getService(serviceId);
    if (!svc) {
        return smmPanel(ctx, Msg, 'Serviço indisponível.', catalogNoticeKeyboard());
    }
    const profile = getServiceInputProfile(svc);
    const totalSteps = wizardStepTotal(profile);
    await setWizard(stateManager, ctx.from.id, {
        step: 'target',
        serviceId: svc.id,
    });
    return smmPanel(
        ctx,
        Msg,
        `${stepLabel(1, totalSteps, profile.targetLabel)}\n\n` +
            `${buildWizardStartMessage(svc, profile)}\n\n` +
            '<i>/cancelar para sair</i>',
        wizardCancelKeyboard()
    );
}

async function resumeWizardLink(ctx, Msg, stateManager, serviceId) {
    const svc = CatalogService.getService(serviceId);
    if (!svc) {
        await clearWizard(stateManager, ctx.from?.id);
        return smmPanel(ctx, Msg, 'Serviço não encontrado.', catalogNoticeKeyboard());
    }
    const profile = getServiceInputProfile(svc);
    const w = await getWizard(stateManager, ctx.from?.id);
    await setWizard(stateManager, ctx.from.id, {
        step: 'target',
        serviceId: svc.id,
        link: undefined,
        comments: undefined,
        quantity: undefined,
    });
    const kept = w?.link ? '\n<i>Informação anterior descartada. Envie novamente.</i>' : '';
    const totalSteps = wizardStepTotal(profile);
    const targetHint = buildWizardTargetHint(svc);
    return smmPanel(
        ctx,
        Msg,
        `${stepLabel(1, totalSteps, profile.targetLabel)}\n\n` +
            `Serviço: <i>${svc.name.slice(0, 80)}</i>\n\n` +
            targetHint +
            kept,
        wizardLinkNoticeKeyboard(svc.id)
    );
}

async function resumeWizardComments(ctx, Msg, stateManager, serviceId) {
    const svc = CatalogService.getService(serviceId);
    if (!svc) {
        await clearWizard(stateManager, ctx.from?.id);
        return smmPanel(ctx, Msg, 'Serviço não encontrado.', catalogNoticeKeyboard());
    }
    const profile = getServiceInputProfile(svc);
    const w = await getWizard(stateManager, ctx.from?.id);
    if (!w?.link) {
        return resumeWizardLink(ctx, Msg, stateManager, serviceId);
    }
    await setWizard(stateManager, ctx.from.id, {
        step: 'comments',
        serviceId: svc.id,
        link: w.link,
    });
    const totalSteps = wizardStepTotal(profile);
    return smmPanel(
        ctx,
        Msg,
        `${stepLabel(wizardStepIndex(profile, 'comments'), totalSteps, 'Comentários')}\n\n` +
            buildWizardCommentsHint(svc),
        wizardQuantityNoticeKeyboard(svc.id)
    );
}

async function resumeWizardQuantity(ctx, Msg, stateManager, serviceId) {
    const svc = CatalogService.getService(serviceId);
    if (!svc) {
        await clearWizard(stateManager, ctx.from?.id);
        return smmPanel(ctx, Msg, 'Serviço não encontrado.', catalogNoticeKeyboard());
    }
    const profile = getServiceInputProfile(svc);
    if (profile.needsComments) {
        return resumeWizardComments(ctx, Msg, stateManager, serviceId);
    }
    if (profile.fixedQuantity) {
        return resumeWizardLink(ctx, Msg, stateManager, serviceId);
    }
    const w = await getWizard(stateManager, ctx.from?.id);
    if (!w?.link) {
        return resumeWizardLink(ctx, Msg, stateManager, serviceId);
    }
    await setWizard(stateManager, ctx.from.id, {
        step: 'quantity',
        serviceId: svc.id,
        link: w.link,
        comments: w.comments,
    });
    const payMinQty = effectiveMinQuantity(svc);
    const unit = quantityUnitLabel(svc, payMinQty);
    const payHint =
        payMinQty > svc.min_quantity
            ? `\nMín. para PIX/cartão: <b>${payMinQty.toLocaleString('pt-BR')}</b> ${unit} (${formatMoney(MP_MIN_PAYMENT_BRL)})`
            : '';
    const linkPreview =
        String(w.link).length > 60 ? `${String(w.link).slice(0, 60)}…` : String(w.link);
    const totalSteps = wizardStepTotal(profile);
    const qtyHint = buildWizardQuantityHint(svc);
    return smmPanel(
        ctx,
        Msg,
        `${stepLabel(wizardStepIndex(profile, 'quantity'), totalSteps, 'Quantidade')}\n\n` +
            `${profile.targetMode === 'text' ? 'Dados' : 'Link'}: <i>${linkPreview}</i>\n\n` +
            `${qtyHint}` +
            payHint +
            `\n\nDigite apenas o número (ex.: 500, 1000).`,
        wizardQuantityNoticeKeyboard(svc.id)
    );
}

async function handleWizardText(ctx, Msg, stateManager, text) {
    const w = await getWizard(stateManager, ctx.from?.id);
    if (!w?.step) return false;

    const trimmed = String(text || '').trim();
    if (!trimmed || trimmed.startsWith('/')) {
        if (trimmed === '/cancelar') {
            await clearWizard(stateManager, ctx.from.id);
            await smmPanel(ctx, Msg, 'Pedido SMM cancelado.', catalogNoticeKeyboard());
            return true;
        }
        return false;
    }

    const svc = CatalogService.getService(w.serviceId);
    if (!svc) {
        await clearWizard(stateManager, ctx.from.id);
        await smmPanel(ctx, Msg, 'Serviço não encontrado.', catalogNoticeKeyboard());
        return true;
    }

    const profile = getServiceInputProfile(svc);
    const totalSteps = wizardStepTotal(profile);

    if (w.step === 'target') {
        const err = validateTargetInput(trimmed, svc.platform, profile.targetMode);
        if (err) {
            await smmPanel(ctx, Msg, checkoutErrorMessage(err), wizardLinkNoticeKeyboard(svc.id));
            return true;
        }

        const next = { ...w, step: 'quantity', link: trimmed };

        if (profile.needsComments) {
            next.step = 'comments';
            await setWizard(stateManager, ctx.from.id, next);
            await smmPanel(
                ctx,
                Msg,
                `${stepLabel(wizardStepIndex(profile, 'comments'), totalSteps, 'Comentários')}\n\n` +
                    buildWizardCommentsHint(svc),
                wizardQuantityNoticeKeyboard(svc.id)
            );
            return true;
        }

        if (profile.fixedQuantity) {
            next.quantity = profile.defaultQuantity || svc.min_quantity;
            await setWizard(stateManager, ctx.from.id, next);
            await showConfirm(ctx, Msg, stateManager, svc, next);
            return true;
        }

        await setWizard(stateManager, ctx.from.id, next);
        const payMinQty = effectiveMinQuantity(svc);
        const unit = quantityUnitLabel(svc, payMinQty);
        const payHint =
            payMinQty > svc.min_quantity
                ? `\nMín. para PIX/cartão: <b>${payMinQty.toLocaleString('pt-BR')}</b> ${unit} (${formatMoney(MP_MIN_PAYMENT_BRL)})`
                : '';
        const qtyHint = buildWizardQuantityHint(svc);
        await smmPanel(
            ctx,
            Msg,
            `${stepLabel(wizardStepIndex(profile, 'quantity'), totalSteps, 'Quantidade')}\n\n` +
                `${qtyHint}` +
                payHint +
                `\n\nDigite apenas o número desejado:`,
            wizardQuantityNoticeKeyboard(svc.id)
        );
        return true;
    }

    if (w.step === 'comments') {
        const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const qty = lines.length;
        const commentsErr = validateComments(trimmed, qty);
        if (commentsErr) {
            await smmPanel(ctx, Msg, checkoutErrorMessage(commentsErr), wizardQuantityNoticeKeyboard(svc.id));
            return true;
        }
        const qtyErr =
            qty < svc.min_quantity || qty > svc.max_quantity
                ? 'quantity_out_of_range'
                : null;
        if (qtyErr) {
            await smmPanel(
                ctx,
                Msg,
                `Quantidade (${qty}) fora do limite (${svc.min_quantity} a ${svc.max_quantity}).`,
                wizardQuantityNoticeKeyboard(svc.id)
            );
            return true;
        }
        const next = { ...w, step: 'confirm', comments: trimmed, quantity: qty };
        await setWizard(stateManager, ctx.from.id, next);
        await showConfirm(ctx, Msg, stateManager, svc, next);
        return true;
    }

    if (w.step === 'quantity') {
        const qty = parseInt(trimmed.replace(/\D/g, ''), 10);
        if (!Number.isFinite(qty)) {
            await smmPanel(ctx, Msg, checkoutErrorMessage('quantity_invalid'), wizardQuantityNoticeKeyboard(svc.id));
            return true;
        }
        const quote = CatalogService.quote(w.serviceId, qty);
        if (quote?.error) {
            await smmPanel(
                ctx,
                Msg,
                `Quantidade fora do limite (${quote.min} a ${quote.max}).`,
                wizardQuantityNoticeKeyboard(svc.id)
            );
            return true;
        }
        const next = { ...w, step: 'confirm', quantity: qty };
        await setWizard(stateManager, ctx.from.id, next);
        await showConfirm(ctx, Msg, stateManager, svc, next);
        return true;
    }

    return false;
}

async function readConfirmWizard(stateManager, telegramId) {
    const w = await getWizard(stateManager, telegramId);
    if (w?.step !== 'confirm' || !w.serviceId || !w.link || !w.quantity) return null;
    const svc = CatalogService.getService(w.serviceId);
    if (!svc) return null;
    const profile = getServiceInputProfile(svc);
    if (profile.needsComments && !w.comments) return null;
    return w;
}

async function hasActiveSmmWizard(stateManager, telegramId) {
    if (!stateManager || telegramId == null) return false;
    const w = await getWizard(stateManager, telegramId);
    return !!(w?.step);
}

module.exports = {
    startBuyWizard,
    handleWizardText,
    clearWizard,
    getWizard,
    readConfirmWizard,
    hasActiveSmmWizard,
    resumeWizardLink,
    resumeWizardQuantity,
    resumeWizardComments,
};
