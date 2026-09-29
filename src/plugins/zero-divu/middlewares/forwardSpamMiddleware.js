'use strict';

/**
 * B3 — bloqueio de forwards e mensagens vazias (move-only de bot.js).
 */
const { isSystemTelegramEvent } = require('../events/TelegramEventClassifier');

function registerForwardSpamMiddleware(bot, deps) {
    const { Msg, isAdmin, productWizard, ProductWizardService, editProductMode } = deps;

    bot.on('message', async (ctx, next) => {
        if (ctx.telegramEvent?.skipUserPipeline || isSystemTelegramEvent(ctx)) {
            return next();
        }

        const msg = ctx.message;
        const uid = ctx.from?.id;
        const wiz = productWizard.get(uid);
        const adminProductWizard =
            isAdmin(uid) &&
            wiz &&
            (wiz.step === ProductWizardService.PRODUCT_WIZARD_STEPS.FILE ||
                wiz.step === ProductWizardService.PRODUCT_WIZARD_STEPS.PHOTO);

        let adminProductEdit = false;
        if (isAdmin(uid) && editProductMode && (await editProductMode.has(uid))) {
            const edit = await editProductMode.get(uid);
            adminProductEdit = edit?.field === 'photo' || edit?.field === 'file';
        }

        if ((msg.forward_from_chat || msg.forward_sender_name) && !adminProductWizard && !adminProductEdit) {
            return Msg.reply(ctx, '⚠️ Mensagens encaminhadas não são aceitas aqui.');
        }
        if (!msg.text && !msg.photo && !msg.document && !msg.audio && !msg.voice && !msg.video && !msg.video_note && !msg.animation) {
            if (msg.sticker) return next();
            return next();
        }
        return next();
    });
}

module.exports = { registerForwardSpamMiddleware };
