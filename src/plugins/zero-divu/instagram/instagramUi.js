'use strict';

const { escapeTelegramHtml } = require('../htmlEscape');

const NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

function truncate(text, max = 38) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function itemTitle(item) {
    return item?.title || 'Instagram';
}

function itemAuthor(item) {
    const a = String(item?.author || '').trim();
    if (!a) return '';
    return a.startsWith('@') ? a : `@${a.replace(/^@/, '')}`;
}

function formatHeader(subtitle) {
    let out = '<b>📸 Hanork Instagram</b>';
    if (subtitle) out += `\n<i>${escapeTelegramHtml(subtitle)}</i>`;
    return out;
}

function formatTrackCard(item) {
    const title = escapeTelegramHtml(truncate(itemTitle(item), 64));
    const author = escapeTelegramHtml(itemAuthor(item) || 'Instagram');
    const extra =
        item.mode === 'stories' && item.storiesCount
            ? `\n<i>${item.storiesCount} story(s)</i>`
            : item.mode === 'highlights' && item.highlightsCount
              ? `\n<i>${item.highlightsCount} destaque(s)</i>`
              : item.medias?.length > 1
                ? `\n<i>${item.medias.length} mídia(s)</i>`
                : '';
    return `<b>${title}</b>\n${author}${extra}`;
}

function formatDownloadingPanel(item) {
    const action =
        item.mode === 'post' && item.medias?.length > 1
            ? `<i>Enviando as mídias para você…</i>`
            : `<i>Enviando o conteúdo para você…</i>`;

    return (
        `${formatHeader('preparando conteúdo')}\n\n` +
        `${formatTrackCard(item)}\n\n` +
        action
    );
}

function formatSuccessPanel(item) {
    const { NAV_HINT } = require('../downloads/downloadsNav');
    const hint =
        item.mode === 'stories'
            ? `<code>/instagram highlights @${item.author?.replace(/^@/, '') || 'usuario'}</code>`
            : item.mode === 'highlights'
              ? `<code>/instagram stories @${item.author?.replace(/^@/, '') || 'usuario'}</code>`
              : `<code>/instagram</code> <i>+ link</i>`;

    const arrived =
        item.mode === 'post' && item.medias?.length > 1
            ? `<i>As mídias chegaram acima ↑</i>`
            : `<i>O conteúdo chegou na mensagem acima ↑</i>`;

    return (
        `${formatHeader('pronto')}\n\n` +
        `${formatTrackCard(item)}\n\n` +
        `${arrived}\n` +
        `<i>Outro pedido?</i> ${hint}\n\n` +
        NAV_HINT
    );
}

function formatMediaCaption(item, index = 0, total = 1) {
    const title = escapeTelegramHtml(truncate(itemTitle(item), 72));
    const author = escapeTelegramHtml(itemAuthor(item));
    const prefix = total > 1 ? `${index + 1}/${total} · ` : '';
    return `📸 <b>${prefix}${title}</b>\n${author}`;
}

function formatStoryAlbumCaption(story, item, index, total) {
    const user = escapeTelegramHtml(itemAuthor(item) || '');
    return `📸 <b>Story ${index + 1}/${total}</b>\n${user}`;
}

function formatHelpPanel() {
    return (
        `${formatHeader('download e stories')}\n\n` +
        `📎 <b>Post, reel ou carrossel</b>\n` +
        `<code>/instagram https://instagram.com/reel/…</code>\n` +
        `<code>/instagram https://instagram.com/p/…</code>\n\n` +
        `📖 <b>Stories</b>\n` +
        `<code>/instagram stories @usuario</code>\n` +
        `<code>/instagram @usuario</code>\n\n` +
        `⭐ <b>Destaques</b>\n` +
        `<code>/instagram highlights @usuario</code>\n\n` +
        `<i>No privado, colar só o link também funciona.</i>`
    );
}

function formatNotFound(message) {
    return (
        `${formatHeader('nada encontrado')}\n\n` +
        `${escapeTelegramHtml(message || 'Não foi possível obter este conteúdo.')}\n\n` +
        `<i>Confira o link ou o @ e tente de novo.</i>`
    );
}

function formatInstagramError(message) {
    return (
        `${formatHeader('algo deu errado')}\n\n` +
        `${escapeTelegramHtml(message || 'Não foi possível concluir.')}\n\n` +
        `<i>Tente novamente em instantes.</i>`
    );
}

module.exports = {
    formatHeader,
    formatTrackCard,
    formatDownloadingPanel,
    formatSuccessPanel,
    formatMediaCaption,
    formatStoryAlbumCaption,
    formatHelpPanel,
    formatNotFound,
    formatInstagramError,
    truncate,
};
