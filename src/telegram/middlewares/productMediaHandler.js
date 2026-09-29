'use strict';

/**
 * B3 — relay de mídia (wizard produto + tickets) (move-only de bot.js).
 */
function registerProductMediaHandler(bot, deps) {
    const {
        isAdmin, editProductMode, ProductWizardService, ProductAdminService,
        buildProductPhotoFileName, productAdminDeps, wizardDeps, productWizard,
        CONFIG, Msg, Markup, logger, activeChats, prisma, bot: telegramBot,
    } = deps;

    async function clearEditOnSuccess(uid) {
        await editProductMode.delete(uid);
    }

    async function keepEditSession(uid, edit) {
        await editProductMode.set(uid, { pid: edit.pid, field: edit.field, _ts: Date.now() });
    }

    bot.on(['photo', 'document', 'audio', 'voice', 'video', 'video_note', 'animation'], async (ctx) => {
        if (isAdmin(ctx.from.id) && (await editProductMode.has(ctx.from.id))) {
            const edit = await editProductMode.get(ctx.from.id);
            if (edit?.field === 'photo' || edit?.field === 'file') {
                const media = ProductWizardService.extractMediaFromMessage(ctx.message);
                if (edit.field === 'photo' && media?.isImage) {
                    try {
                        await Msg.reply(ctx, '⏳ Salvando capa do produto...');
                        const p = await ProductAdminService.findProduct(edit.pid, true);
                        if (!p) {
                            await editProductMode.delete(ctx.from.id);
                            return Msg.reply(ctx, '❌ Produto não encontrado.');
                        }
                        const saved = await ProductWizardService.downloadTelegramFile(
                            ctx,
                            media.fileId,
                            buildProductPhotoFileName(p?.name || 'produto', media, CONFIG.CAMINHO_FOTOS),
                            CONFIG.CAMINHO_FOTOS
                        );
                        const result = await ProductAdminService.updateProductPhotoFromFile(
                            edit.pid,
                            saved.fileName,
                            p?.name,
                            productAdminDeps(ctx)
                        );
                        if (!result.ok) {
                            await keepEditSession(ctx.from.id, edit);
                            return Msg.reply(ctx, `❌ ${result.error}`);
                        }
                        await clearEditOnSuccess(ctx.from.id);
                        await Msg.reply(ctx,
                            `✅ Capa do produto #${edit.pid} atualizada.`,
                            Markup.inlineKeyboard([[{ text: '🔙 Produto', callback_data: `prod_edit_${edit.pid}` }]])
                        );
                    } catch (e) {
                        logger.error('[ProductEdit] photo:', e.message);
                        await keepEditSession(ctx.from.id, edit);
                        await Msg.reply(ctx, '❌ Não foi possível salvar a foto. Tente URL https:// ou outra imagem.');
                    }
                    return;
                }
                if (edit.field === 'file' && media) {
                    try {
                        await Msg.reply(ctx, '⏳ Salvando arquivo de entrega...');
                        const saved = await ProductWizardService.downloadTelegramFile(
                            ctx,
                            media.fileId,
                            media.fileName,
                            CONFIG.CAMINHO_PRODUTOS
                        );
                        const result = await ProductAdminService.applyFieldUpdate(
                            edit.pid,
                            'file_url',
                            saved.fileName,
                            productAdminDeps(ctx)
                        );
                        if (!result.ok) {
                            await keepEditSession(ctx.from.id, edit);
                            return Msg.reply(ctx, `❌ ${result.error}`);
                        }
                        await clearEditOnSuccess(ctx.from.id);
                        await Msg.reply(ctx,
                            `✅ Arquivo do produto #${edit.pid} atualizado.\n📎 <code>${saved.fileName}</code>`,
                            {
                                parse_mode: 'HTML',
                                reply_markup: Markup.inlineKeyboard([[{ text: '🔙 Produto', callback_data: `prod_edit_${edit.pid}` }]]).reply_markup,
                            }
                        );
                    } catch (e) {
                        logger.error('[ProductEdit] file:', e.message);
                        await keepEditSession(ctx.from.id, edit);
                        await Msg.reply(ctx, '❌ Não foi possível salvar o arquivo.');
                    }
                    return;
                }
                const hint =
                    edit.field === 'photo'
                        ? '🖼️ Envie uma <b>foto</b> ou arquivo de imagem (.jpg, .png…).'
                        : '📎 Envie um <b>documento</b> ou mídia de entrega.';
                await Msg.reply(ctx, hint, { parse_mode: 'HTML' });
                return;
            }
        }

        const wiz = productWizard.get(ctx.from.id);
        if (isAdmin(ctx.from.id) && wiz) {
            const { PRODUCT_WIZARD_STEPS } = ProductWizardService;
            if (wiz.step === PRODUCT_WIZARD_STEPS.FILE || wiz.step === PRODUCT_WIZARD_STEPS.PHOTO) {
                const handled = await ProductWizardService.handleMedia(ctx, wiz, productWizard, wizardDeps());
                if (handled) return;
            }
        }

        const sess = await activeChats.get(ctx.chat.id);
        if (!sess) return;
        const ticket = await prisma.ticket.findById(sess.ticketId);
        if (!ticket || ticket.status !== 'open') {
            await activeChats.delete(ctx.chat.id);
            return Msg.reply(ctx, '⚠️ Este ticket foi encerrado.');
        }
        const senderLabel = sess.role === 'admin' ? '🛡️ Suporte' : `👤 ${ctx.from.first_name || 'Usuário'}`;
        const caption = ctx.message.caption || '';
        const note = `<i>[mídia enviada pelo ${sess.role === 'admin' ? 'suporte' : 'usuário'}]</i>`;
        await prisma.ticket.addMessage(sess.ticketId, sess.role, `[mídia] ${caption}`.trim());
        const tg = telegramBot?.telegram || ctx.telegram;
        try {
            if (ctx.message.photo) {
                const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                await tg.sendPhoto(sess.otherChatId, fileId, { caption: `${senderLabel}:\n${caption}\n${note}`, parse_mode: 'HTML' });
            } else if (ctx.message.document) {
                await tg.sendDocument(sess.otherChatId, ctx.message.document.file_id, { caption: `${senderLabel}:\n${caption}\n${note}`, parse_mode: 'HTML' });
            } else if (ctx.message.audio) {
                await tg.sendAudio(sess.otherChatId, ctx.message.audio.file_id, { caption: `${senderLabel}: ${note}`, parse_mode: 'HTML' });
            } else if (ctx.message.voice) {
                await tg.sendVoice(sess.otherChatId, ctx.message.voice.file_id, { caption: `${senderLabel}: ${note}`, parse_mode: 'HTML' });
            }
        } catch (e) { await Msg.reply(ctx, '❌ Erro ao repassar mídia: ' + e.message); }
    });
}

module.exports = { registerProductMediaHandler };
