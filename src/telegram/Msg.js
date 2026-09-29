/**
 * Msg — Edição/envio unificado (anti-flood profissional)
 *
 * Regras:
 * - Menus no PV: sempre com foto (infos/menu.jpg, menu2.jpg ou menu3.jpg)
 * - Comando digitado (/…): apaga última msg do bot e envia nova (fim do chat)
 * - Botão (callback): edita a mesma mensagem
 */
'use strict';

const logger = require('../config/logger');
const { shouldForceNewMessage, isPrivateChat: isPrivateChatFresh } = require('./freshUi');
const { getScreenPhotoInput } = require('./screenPhoto');
const { shouldCreateFreshPanel, resetPanelUserMsgCounter } = require('./panelDistance');
const {
    deliverMessage,
    deleteSlotMessage,
    tryEditMessage,
    isIgnorableEditError,
    isMissingMessageEditError,
    resolvePhotoInput,
    isUsablePhotoUrl,
    isLocalFilePhotoInput,
    normalizeOpts,
    pickTelegramOpts,
    normalizeSlotChatId,
    slotMessageId,
    unwrapReplyMarkup,
    isNetworkError,
} = require('./messageDelivery');
const { truncateTelegramHtml, isCaptionTooLongError, CAPTION_MAX, MESSAGE_MAX } = require('./telegramLimits');
const { sendLongHtml, needsLongDelivery } = require('./htmlMessages');

function hasInlineKeyboard(markup) {
    if (!markup) return false;
    const km = markup.reply_markup || markup;
    return !!(km?.inline_keyboard?.length);
}

function buildOpts(text, markup) {
    return pickTelegramOpts({
        parse_mode: 'HTML',
        ...(markup ? { reply_markup: unwrapReplyMarkup(markup) } : {}),
    });
}

function isPrivateChat(ctx) {
    return isPrivateChatFresh(ctx);
}

function resolveDeliveryOptions(ctx, options = {}) {
    const forceNew = shouldForceNewMessage(ctx, options);
    return { ...options, forceNew };
}

async function resolveDeliveryOptionsAsync(ctx, lastMenuMsg, options = {}) {
    if (options.forceNew === true || options.replaceInPlace === true) {
        return resolveDeliveryOptions(ctx, options);
    }
    const fresh = await shouldCreateFreshPanel(ctx, lastMenuMsg, options);
    return { ...options, forceNew: fresh || shouldForceNewMessage(ctx, options) };
}

class Msg {
    constructor(lastMenuMsg, options = {}) {
        this.lastMenuMsg = lastMenuMsg;
        this.getMenuPhoto = options.getMenuPhoto || null;
        this.telegram = options.telegram || null;
    }

    applyTheme(text) {
        if (Array.isArray(text)) return text;
        return text || '';
    }

    _chatId(ctx) {
        return ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
    }

    _telegram(ctx) {
        return ctx?.telegram || this.telegram;
    }

    async _track(chatId, messageId) {
        if (chatId && messageId && this.lastMenuMsg) {
            const key = normalizeSlotChatId(chatId);
            await this.lastMenuMsg.set(key, {
                messageId,
                chatId: key,
                updatedAt: Date.now(),
            });
        }
    }

    async _getSlot(chatId) {
        if (!this.lastMenuMsg || !chatId) return null;
        const key = normalizeSlotChatId(chatId);
        const raw = await this.lastMenuMsg.get(key);
        return raw ? { ...raw, messageId: slotMessageId(raw) } : null;
    }

    /** Após comando no PV: remove o /comando do usuário (chat mais limpo) */
    async _cleanupUserCommand(ctx) {
        if (!shouldForceNewMessage(ctx) || !ctx.message?.message_id) return;
        if (!isPrivateChat(ctx)) return;
        try {
            await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);
        } catch {
            /* sem permissão ou msg antiga */
        }
    }

    _resolvePhoto(ctx, options = {}) {
        const uid = ctx.from?.id || this._chatId(ctx);
        const cqMsg = ctx.callbackQuery?.message;
        const hasExplicitPhoto = !!(options.photoUrl || options.photo || options.screen || options.platform);
        let photo =
            resolvePhotoInput(options.photoUrl) ||
            resolvePhotoInput(options.photo);

        if (!photo && options.screen) {
            photo = resolvePhotoInput(getScreenPhotoInput(options.screen, uid));
        }
        if (!photo && options.platform) {
            const { getPlatformPhotoInput } = require('./screenPhoto');
            photo = resolvePhotoInput(getPlatformPhotoInput(options.platform, uid));
        }

        const useMenuPhoto = options.useMenuPhoto !== false && !options.skipMenuPhoto;
        const forceMenuPhoto = options.forceMenuPhoto === true;
        const isCallbackEdit = !!cqMsg && !options.forceNew && !hasExplicitPhoto;
        let reuseMedia = false;

        if (!photo && isCallbackEdit && useMenuPhoto && !forceMenuPhoto) {
            if (cqMsg?.photo?.length) {
                photo = cqMsg.photo[cqMsg.photo.length - 1].file_id;
                reuseMedia = true;
            } else if (cqMsg?.document) {
                const mime = cqMsg.document.mime_type || '';
                const name = cqMsg.document.file_name || '';
                const isImageDoc =
                    /^image\//i.test(mime) || /\.(jpe?g|png|webp|gif)$/i.test(name);
                if (isImageDoc) {
                    photo = cqMsg.document.file_id;
                    reuseMedia = true;
                }
            }
        }

        if (!photo && useMenuPhoto && this.getMenuPhoto) {
            const rotateMenu = !isCallbackEdit || !!options.forceNew || forceMenuPhoto;
            photo = resolvePhotoInput(this.getMenuPhoto(uid, { rotate: rotateMenu }));
        }

        const resolved = photo ? resolvePhotoInput(photo) || photo : null;
        if (hasExplicitPhoto || (resolved && isLocalFilePhotoInput(resolved))) {
            reuseMedia = false;
        }
        if (forceMenuPhoto) {
            reuseMedia = false;
        }

        return {
            photo: resolved,
            requirePhoto: useMenuPhoto && isPrivateChat(ctx),
            reuseMedia,
            photoChanged: forceMenuPhoto || hasExplicitPhoto || !!options.photoChanged || !reuseMedia,
        };
    }

    async _retryAfter(err, fn) {
        if (err?.description?.includes('Too Many Requests') || err?.code === 429) {
            const sec = err.parameters?.retry_after || 1;
            await new Promise((r) => setTimeout(r, sec * 1000));
            return fn();
        }
        throw err;
    }

    /** Envio direto quando edit/slot falha — evita comando “mudo” */
    async _fallbackSend(ctx, text, markup, photo) {
        const replyMarkup = unwrapReplyMarkup(markup?.reply_markup || markup);
        const opts = { parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}) };
        const safeCaption = truncateTelegramHtml(text);
        const send = async (withPhoto) => {
            if (withPhoto && photo) {
                return ctx.replyWithPhoto(photo, { caption: safeCaption, ...opts });
            }
            return ctx.reply(text.length > 4000 ? truncateTelegramHtml(text, 4000) : text, opts);
        };
        try {
            let sent;
            try {
                sent = await send(!!photo);
            } catch (e) {
                if (photo && isCaptionTooLongError(e)) {
                    sent = await send(false);
                } else {
                    throw e;
                }
            }
            await this._track(this._chatId(ctx), sent.message_id);
            return { action: 'sent', messageId: sent.message_id };
        } catch (e) {
            if (photo && isCaptionTooLongError(e)) {
                const sent = await send(false);
                await this._track(this._chatId(ctx), sent.message_id);
                return { action: 'sent', messageId: sent.message_id };
            }
            return this._retryAfter(e, () => send(false));
        }
    }

    /**
     * Entrega em chatId (broadcast sem foto de menu por padrão).
     */
    async deliverToChat(telegram, chatId, text, markupOrOpts = null, options = {}) {
        const deliveryOpts = resolveDeliveryOptions(
            { chat: { id: chatId, type: options._chatType || 'private' }, state: options._ctxState },
            options
        );
        const opts =
            markupOrOpts?.parse_mode || markupOrOpts?.reply_markup
                ? normalizeOpts(text, markupOrOpts)
                : buildOpts(text, markupOrOpts);
        const key = normalizeSlotChatId(chatId);
        const slot = await this._getSlot(chatId);

        let photo = resolvePhotoInput(deliveryOpts.photo ?? options.photo);
        if (!photo && options.withMenuPhoto && this.getMenuPhoto) {
            photo = resolvePhotoInput(this.getMenuPhoto(chatId));
        }

        const telegramOpts = pickTelegramOpts(opts);
        const run = () =>
            deliverMessage(telegram, key, slot, text, telegramOpts, {
                photo,
                requirePhoto: !!options.requirePhoto,
                forceNew: deliveryOpts.forceNew,
                messageIsPhoto: options.messageIsPhoto,
                reuseMedia: options.reuseMedia,
                photoChanged: options.photoChanged,
            });

        try {
            const r = await run();
            if (r.messageId && r.action !== 'blocked') {
                await this._track(chatId, r.messageId);
            }
            return r;
        } catch (e) {
            return this._retryAfter(e, run);
        }
    }

    /**
     * Edita / envia com foto — PV e callbacks de menu usam replaceMenu (nunca só texto).
     */
    async edit(ctx, text, markup = null, options = {}) {
        const themed = this.applyTheme(text);
        const hasExplicitPhoto = !!(options.photoUrl || options.photo || options.screen || options.platform);
        if (
            ctx.callbackQuery?.message &&
            hasInlineKeyboard(markup) &&
            isPrivateChat(ctx) &&
            !hasExplicitPhoto &&
            !options.skipMenuPhoto &&
            options.useMenuPhoto !== false
        ) {
            return this.editCallbackPanel(ctx, themed, markup, options);
        }
        return this.replaceMenu(ctx, themed, markup, options);
    }

    /**
     * Menu rastreado: sempre foto do menu no PV (salvo foto de produto explícita).
     */
    async replaceMenu(ctx, text, markup = null, options = {}) {
        const chatId = this._chatId(ctx);
        const telegram = this._telegram(ctx);
        if (!chatId || !telegram) return null;

        const deliveryOpts = await resolveDeliveryOptionsAsync(ctx, this.lastMenuMsg, options);
        const { photo, requirePhoto, reuseMedia, photoChanged } = this._resolvePhoto(ctx, deliveryOpts);
        const fullText = text || '';
        const cqMsg = ctx.callbackQuery?.message;

        // Editar a mensagem do botão clicado (evita atualizar slot/menu antigo fora da tela)
        if (cqMsg?.message_id) {
            await this._track(chatId, cqMsg.message_id);
            if (this.lastMenuMsg) {
                await resetPanelUserMsgCounter(this.lastMenuMsg, chatId).catch(() => {});
            }
        }

        const messageIsPhoto = !!(cqMsg?.photo || cqMsg?.document);
        const messageIsVideo = !!(cqMsg?.video || cqMsg?.animation);

        if (requirePhoto && !photo) {
            logger.warn('[Msg] Fotos de menu ausentes — coloque infos/menu.jpg, menu2.jpg, etc.');
        }

        const forceNew = deliveryOpts.forceNew;

        if (forceNew) {
            const slot = await this._getSlot(chatId);
            if (slot) await deleteSlotMessage(telegram, chatId, slot);
        }

        const run = () =>
            this.deliverToChat(telegram, chatId, fullText, markup, {
                photo: photo || undefined,
                requirePhoto: requirePhoto && !!photo && !needsLongDelivery(fullText),
                forceNew: forceNew || (deliveryOpts.forceMenuPhoto && messageIsVideo),
                messageIsPhoto,
                reuseMedia,
                photoChanged,
                _ctxState: ctx.state,
                _chatType: ctx.chat?.type,
            });

        try {
            let r = await run();
            if (r?.action === 'blocked') return null;
            if (!r?.messageId && !deliveryOpts.noFallback) {
                r = await this._fallbackSend(ctx, fullText, markup, photo);
            }
            if (r?.messageId && forceNew) {
                await this._cleanupUserCommand(ctx);
            }
            return r;
        } catch (e) {
            if (isIgnorableEditError(e)) {
                if (!deliveryOpts.noFallback) {
                    try {
                        const r = await this._fallbackSend(ctx, text, markup, photo);
                        if (r?.messageId && forceNew) await this._cleanupUserCommand(ctx);
                        return r;
                    } catch (e2) {
                        logger.error('[Msg] replaceMenu fallback:', e2.message);
                    }
                }
                return null;
            }
            logger.error('[Msg] replaceMenu:', e.message);
            if (!deliveryOpts.noFallback) {
                const net = isNetworkError(e);
                try {
                    const r = await this._fallbackSend(ctx, text, markup, net ? null : photo);
                    if (r?.messageId && forceNew) await this._cleanupUserCommand(ctx);
                    return r;
                } catch (e2) {
                    logger.error('[Msg] replaceMenu fallback2:', e2.message);
                    if (!net) {
                        try {
                            const r = await this._fallbackSend(ctx, fullText, markup, null);
                            if (r?.messageId && forceNew) await this._cleanupUserCommand(ctx);
                            return r;
                        } catch (e3) {
                            logger.error('[Msg] replaceMenu fallback3 text:', e3.message);
                        }
                    }
                    if (isCaptionTooLongError(e2) || isCaptionTooLongError(e)) {
                        try {
                            return await this._fallbackSend(ctx, fullText, markup, null);
                        } catch { /* throw original */ }
                    }
                    throw e;
                }
            }
            throw e;
        }
    }

    /**
     * Mensagem auxiliar — não edita menu/pagamento (ex.: copiar PIX, aviso rápido em callback).
     */
    async sendSide(ctx, text, markup = null, options = {}) {
        const chatId = this._chatId(ctx);
        const telegram = this._telegram(ctx);
        if (!chatId || !telegram) return null;
        const opts = pickTelegramOpts({
            parse_mode: 'HTML',
            disable_notification: options.disable_notification !== false,
            ...(markup ? { reply_markup: unwrapReplyMarkup(markup) } : {}),
            ...options,
        });
        const safeText =
            (text || '').length > 4000 ? truncateTelegramHtml(text, 4000) : text || '';
        try {
            const sent = await telegram.sendMessage(chatId, safeText, opts);
            return { action: 'sent', messageId: sent.message_id };
        } catch (e) {
            return this._retryAfter(e, () => telegram.sendMessage(chatId, safeText, opts).then((sent) => ({
                action: 'sent',
                messageId: sent.message_id,
            })));
        }
    }

    /**
     * PV: menu com foto. Grupos: MsgService.
     */
    async reply(ctx, text, markup = null, options = {}) {
        if (options.detached || options.preserveMenu || options.sendSide) {
            return this.sendSide(ctx, text, markup, options);
        }
        const deliveryOpts = resolveDeliveryOptions(ctx, options);
        const textOnly = options.skipMenuPhoto || deliveryOpts.skipMenuPhoto;
        const splitAt = textOnly ? MESSAGE_MAX : CAPTION_MAX;
        if (
            !options.skipLongSplit &&
            String(text || '').length > splitAt &&
            textOnly
        ) {
            return sendLongHtml(ctx, text, markup, { ...options, Msg: this, forceNew: deliveryOpts.forceNew });
        }
        if (hasInlineKeyboard(markup) || isPrivateChat(ctx) || ctx.callbackQuery) {
            return this.replaceMenu(ctx, text, markup, deliveryOpts);
        }
        const opts = buildOpts(text, markup);
        try {
            return await ctx.reply(text, opts);
        } catch (e) {
            return this._retryAfter(e, () => ctx.reply(text, opts));
        }
    }

    async respond(ctx, text, markup = null, options = {}) {
        return this.reply(ctx, text, markup, options);
    }

    async sendOrEdit(ctx, text, markup = null, options = {}) {
        return this.edit(ctx, text, markup, options);
    }

    /**
     * Painéis de callback — mesma entrega do /start (foto menu: edita ou apaga+reenvia).
     * skipMenuPhoto só vale fora de painel PV com teclado inline (avisos laterais, tickets).
     */
    async editCallbackPanel(ctx, text, markup = null, options = {}) {
        const themed = this.applyTheme(text);
        const hasExplicitPhoto = !!(options.photoUrl || options.photo || options.screen || options.platform);
        const isPvPanel = isPrivateChat(ctx) && hasInlineKeyboard(markup) && !hasExplicitPhoto;

        if (isPvPanel) {
            if (!options.skipLongSplit && needsLongDelivery(themed, CAPTION_MAX)) {
                return sendLongHtml(ctx, themed, markup, { ...options, Msg: this, editFirst: true });
            }
            return this.replaceMenu(ctx, themed, markup, {
                useMenuPhoto: true,
                forceMenuPhoto: !hasExplicitPhoto,
                ...options,
            });
        }

        if (options.skipMenuPhoto || options.useMenuPhoto === false) {
            if (!options.skipLongSplit && needsLongDelivery(themed, MESSAGE_MAX)) {
                return sendLongHtml(ctx, themed, markup, {
                    ...options,
                    Msg: this,
                    editFirst: true,
                });
            }
            return this._editCallbackPanelText(ctx, themed, markup, options);
        }
        if (!options.skipLongSplit && needsLongDelivery(themed, CAPTION_MAX)) {
            return sendLongHtml(ctx, themed, markup, { ...options, Msg: this, editFirst: true });
        }
        return this.replaceMenu(ctx, themed, markup, {
            useMenuPhoto: true,
            forceMenuPhoto: !hasExplicitPhoto,
            ...options,
        });
        const payload = Array.isArray(text) ? text : this.applyTheme(text);
        return sendLongHtml(ctx, payload, markup, { ...options, Msg: this });
    }

    /** Edição só texto (sem foto de menu) — uso raro; no PV sem foto na msg, sobe para menu com foto */
    async _editCallbackPanelText(ctx, text, markup = null, options = {}) {
        const chatId = this._chatId(ctx);
        const telegram = this._telegram(ctx);
        if (!chatId || !telegram) return null;

        const cqMsg = ctx.callbackQuery?.message;
        const msgHasPhoto = !!(cqMsg?.photo?.length || cqMsg?.document);
        const hasExplicitPhoto = !!(options.photoUrl || options.photo || options.screen || options.platform);

        if (isPrivateChat(ctx) && hasInlineKeyboard(markup) && !msgHasPhoto && !hasExplicitPhoto) {
            return this.replaceMenu(ctx, text, markup, { useMenuPhoto: true, ...options });
        }

        const opts = buildOpts(text, markup);
        const cbMsgId = cqMsg?.message_id;
        if (cbMsgId) {
            try {
                const ok = await tryEditMessage(telegram, chatId, cbMsgId, text, opts);
                if (ok) {
                    await this._track(chatId, cbMsgId);
                    return { action: 'edited', messageId: cbMsgId };
                }
            } catch (e) {
                if (!isIgnorableEditError(e) && !isMissingMessageEditError(e)) {
                    logger.warn('[Msg] editCallbackPanel text:', e.message);
                }
            }
        }
        if (!msgHasPhoto && isPrivateChat(ctx)) {
            return this.replaceMenu(ctx, text, markup, { useMenuPhoto: true, ...options });
        }
        return this.replaceMenu(ctx, text, markup, { skipMenuPhoto: true, useMenuPhoto: false, ...options });
    }

    /** Mensagem simples no PV sem foto de menu (relay de ticket, etc.) */
    async replyPlain(ctx, text, markup = null, options = {}) {
        const opts = pickTelegramOpts({ ...buildOpts(this.applyTheme(text), markup), ...options });
        try {
            return await ctx.reply(text, opts);
        } catch (e) {
            return this._retryAfter(e, () => ctx.reply(text, opts));
        }
    }

    static init(lastMenuMsg, options = {}) {
        Msg._instance = new Msg(lastMenuMsg, options);
        return Msg._instance;
    }

    static get instance() {
        if (!Msg._instance) throw new Error('Msg not initialized. Call Msg.init() first.');
        return Msg._instance;
    }

    static async edit(ctx, text, markup, options) {
        return Msg.instance.edit(ctx, text, markup, options);
    }

    static async editCallbackPanel(ctx, text, markup, options) {
        return Msg.instance.editCallbackPanel(ctx, text, markup, options);
    }

    static async sendLongHtml(ctx, text, markup, options) {
        return sendLongHtml(ctx, text, markup, { ...options, Msg: Msg.instance });
    }

    static async replyPlain(ctx, text, markup, options) {
        return Msg.instance.replyPlain(ctx, text, markup, options);
    }

    static async replaceMenu(ctx, text, markup, options) {
        return Msg.instance.replaceMenu(ctx, text, markup, options);
    }

    static async reply(ctx, text, markup, options) {
        return Msg.instance.reply(ctx, text, markup, options);
    }

    static async sendSide(ctx, text, markup, options) {
        return Msg.instance.sendSide(ctx, text, markup, options);
    }

    static async sendOrEdit(ctx, text, markup, options) {
        return Msg.instance.sendOrEdit(ctx, text, markup, options);
    }

    static async respond(ctx, text, markup, options) {
        return Msg.instance.respond(ctx, text, markup, options);
    }

    static async deliverToChat(telegram, chatId, text, markup, options) {
        return Msg.instance.deliverToChat(telegram, chatId, text, markup, options);
    }
}

module.exports = Msg;
module.exports.resolvePhotoInput = resolvePhotoInput;
module.exports.isUsablePhotoUrl = isUsablePhotoUrl;
