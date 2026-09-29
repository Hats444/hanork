'use strict';

const Msg = require('../Msg');
const logger = require('../../config/logger');

const THEME = {
    RED: '#FF0000',
    DARK_RED: '#CC0000',
    BRIGHT_RED: '#FF3333',
    GREEN: '#00FF00',
    YELLOW: '#FFFF00',
    WHITE: '#FFFFFF',
    GRAY: '#AAAAAA',
    DARK_BG: '#000000',

    md: {
        title: (text) => `🔴 <b>${text.toUpperCase()}</b>`,
        subtitle: (text) => `<b>${text}</b>`,
        text: (text) => text,
        success: (text) => `✅ ${text}`,
        warning: (text) => `⚠️ ${text}`,
        muted: (text) => `<i>${text}</i>`,
        box: (content) => content,
        separator: '',
        icon: (emoji, text) => `${emoji} ${text}`,
        money: (value) => `<b>R$ ${Number(value).toFixed(2)}</b>`,
        status: (ok, text) => ok ? `✅ ${text}` : `❌ ${text}`,
        button: (text) => `[ <b>${text}</b> ]`,
    },

    html: {
        title: (text) => `🔴 <b>${String(text).toUpperCase()}</b>`,
        subtitle: (text) => `<b>${text}</b>`,
        text: (text) => text,
        success: (text) => `✅ ${text}`,
        warning: (text) => `⚠️ ${text}`,
        muted: (text) => `<i>${text}</i>`,
        box: (content) => content,
        separator: '',
        icon: (emoji, text) => `${emoji} ${text}`,
        money: (value) => `<b>R$ ${Number(value).toFixed(2)}</b>`,
        status: (ok, text) => ok ? `✅ ${text}` : `❌ ${text}`,
        button: (text) => `[ <b>${text}</b> ]`,
    },

    wrap: (content) => content,

    apply: (text, type = 'text') => {
        const styles = {
            title: THEME.html.title,
            subtitle: THEME.html.subtitle,
            text: THEME.html.text,
            success: THEME.html.success,
            warning: THEME.html.warning,
            muted: THEME.html.muted,
        };
        return styles[type] ? styles[type](text) : THEME.html.text(text);
    },
};

const ADMIN_HTML = {
    header: THEME.html.title,
    sub: THEME.html.subtitle,
    red: THEME.html.text,
    green: THEME.html.success,
    yellow: THEME.html.warning,
    small: THEME.html.muted,
    box: THEME.html.box,
    separator: '',
};

async function sendThemedMessage(ctx, content, keyboard = null, options = {}) {
    const body = options.noWrap ? content : THEME.wrap(content);
    if (keyboard) {
        return Msg.sendOrEdit(ctx, body, keyboard);
    }
    return Msg.reply(ctx, body);
}

async function editThemedMessage(ctx, content, keyboard = null) {
    return Msg.editCallbackPanel(ctx, content, keyboard, { useMenuPhoto: true });
}

async function sendAdminPanelWithPhoto(ctx, caption, keyboard, options = {}) {
    const { truncateTelegramHtml } = require('../telegramLimits');
    const wrapCaption = truncateTelegramHtml(caption);
    const { unwrapReplyMarkup } = require('../messageDelivery');
    unwrapReplyMarkup(keyboard);

    const fallbackText = async () => {
        await Msg.reply(ctx, wrapCaption, keyboard, { useMenuPhoto: true });
    };

    try {
        if (ctx.callbackQuery) {
            const r = await Msg.editCallbackPanel(ctx, wrapCaption, keyboard, { useMenuPhoto: true });
            if (!r?.messageId) await fallbackText();
            return r;
        }
        const r = await Msg.replaceMenu(ctx, wrapCaption, keyboard, { useMenuPhoto: true, ...options });
        if (!r?.messageId) await fallbackText();
        return r;
    } catch (e) {
        logger.warn('[AdminPanel] replaceMenu falhou, enviando texto:', e.message);
        await fallbackText();
        return null;
    }
}

async function editAdminPanel(ctx, caption, keyboard, opts = {}) {
    const { truncateTelegramHtml } = require('../telegramLimits');
    const body = truncateTelegramHtml(caption);
    return Msg.editCallbackPanel(ctx, body, keyboard, {
        useMenuPhoto: opts.useMenuPhoto !== false,
    });
}

module.exports = {
    THEME,
    ADMIN_HTML,
    sendThemedMessage,
    editThemedMessage,
    sendAdminPanelWithPhoto,
    editAdminPanel,
};
