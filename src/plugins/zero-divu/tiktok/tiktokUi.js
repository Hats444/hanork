'use strict';

const { Markup } = require('telegraf');
const { escapeTelegramHtml } = require('../htmlEscape');
const { truncateUnicode, truncateButtonText } = require('../telegramButtonText');

const NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

function pickNum(i) {
    return NUM[i] ?? `${i + 1}.`;
}

function truncate(text, max = 38) {
    return truncateUnicode(text, max) || '';
}

function itemTitle(item) {
    return item?.title || item?.desc || 'Sem título';
}

function itemAuthor(item) {
    const a = String(item?.author || item?.nickname || '').trim();
    return a || 'Autor desconhecido';
}

function itemDuration(item) {
    return String(item?.duration_string || '').trim();
}

function formatCompactCount(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    return String(n);
}

function formatStatsLine(item) {
    const parts = [];
    const likes = formatCompactCount(item?.likes);
    const comments = formatCompactCount(item?.comments);
    const views = formatCompactCount(item?.views);
    const dur = itemDuration(item);
    if (likes) parts.push(`❤️ ${escapeTelegramHtml(likes)}`);
    if (comments) parts.push(`💬 ${escapeTelegramHtml(comments)}`);
    if (views) parts.push(`👁 ${escapeTelegramHtml(views)}`);
    if (dur) parts.push(`⏱ <code>${escapeTelegramHtml(dur)}</code>`);
    return parts.join(' · ');
}

function formatTrackCard(item) {
    const title = escapeTelegramHtml(truncate(itemTitle(item), 64));
    const author = escapeTelegramHtml(itemAuthor(item));
    const stats = formatStatsLine(item);
    const meta = stats ? `${author}\n${stats}` : author;
    return `<b>${title}</b>\n${meta}`;
}

function formatHeader(subtitle) {
    let out = '<b>🎬 Hanork TikTok</b>';
    if (subtitle) out += `\n<i>${escapeTelegramHtml(subtitle)}</i>`;
    return out;
}

function formatSearchCaption(query, results) {
    const q = escapeTelegramHtml(query);
    const n = results.length;
    const lines = results.map((r, i) => {
        const title = escapeTelegramHtml(truncate(itemTitle(r), 36));
        const author = escapeTelegramHtml(truncate(itemAuthor(r), 22));
        const dur = itemDuration(r);
        const tail = dur ? ` · <code>${escapeTelegramHtml(dur)}</code>` : '';
        return `${pickNum(i)} ${title}\n    ${author}${tail}`;
    });

    return (
        `${formatHeader('escolha um vídeo')}\n\n` +
        `Busca: <i>«${q}»</i>\n` +
        `<i>${n} ${n === 1 ? 'resultado' : 'resultados'}</i>\n\n` +
        `${lines.join('\n\n')}\n\n` +
        `<i>Toque no número correspondente abaixo.</i>`
    );
}

function formatSearchButtonLabel(r, index) {
    const title = truncate(itemTitle(r), 28);
    const dur = itemDuration(r);
    const prefix = pickNum(index);
    const raw = dur ? `${prefix} ${title} · ${dur}` : `${prefix} ${title}`;
    return truncateButtonText(raw, 64);
}

function buildSearchKeyboard(sessionId, results) {
    const rows = results.map((r, i) => [
        Markup.button.callback(formatSearchButtonLabel(r, i), `tiktok:pick:${sessionId}:${i}`),
    ]);
    rows.push([Markup.button.callback('✕ Cancelar busca', `tiktok:scancel:${sessionId}`)]);
    return Markup.inlineKeyboard(rows);
}

function mediaKindLabel(item, result) {
    if (result?.mode === 'photo-video') return 'vídeo';
    return item?.mediaType === 'image' || item?.imageUrls?.length ? 'foto' : 'vídeo';
}

function formatDownloadingPanel(item) {
    const kind =
        item?.mediaType === 'image' && item?.musicUrl ? 'vídeo (foto+áudio)' : mediaKindLabel(item);
    return (
        `${formatHeader(`preparando ${kind}`)}\n\n` +
        `${formatTrackCard(item)}\n\n` +
        `<i>Enviando ${kind === 'foto' ? 'a foto' : 'o vídeo'} para você…</i>`
    );
}

function formatSuccessPanel(item, result) {
    const kind = mediaKindLabel(item, result);
    const { NAV_HINT } = require('../downloads/downloadsNav');
    return (
        `${formatHeader('pronto')}\n\n` +
        `${formatTrackCard(item)}\n\n` +
        `<i>A ${kind} chegou na mensagem acima ↑</i>\n` +
        `<i>Outro TikTok?</i> <code>/tiktok @usuario</code> <i>ou cole o link</i>\n\n` +
        NAV_HINT
    );
}

function formatVideoCaption(item) {
    const title = escapeTelegramHtml(truncate(itemTitle(item), 80));
    const author = escapeTelegramHtml(itemAuthor(item));
    const stats = formatStatsLine(item);
    return stats ? `🎬 <b>${title}</b>\n${author}\n${stats}` : `🎬 <b>${title}</b>\n${author}`;
}

function formatHelpPanel() {
    return (
        `${formatHeader('busca e download')}\n\n` +
        `Envie um <b>link do TikTok</b> ou busque por <b>@usuário</b> / texto:\n\n` +
        `<code>/tiktok https://vm.tiktok.com/…</code>\n` +
        `<code>/tiktok @usuario</code>\n` +
        `<code>/tiktok nome do vídeo</code>\n\n` +
        `<i>No privado, colar só o link também funciona.</i>`
    );
}

function formatNotFound(message) {
    return (
        `${formatHeader('nada encontrado')}\n\n` +
        `${escapeTelegramHtml(message || 'Nenhum resultado para esta busca.')}\n\n` +
        `<i>Tente outro @usuário, texto ou cole o link completo.</i>`
    );
}

function formatTikTokError(message) {
    return (
        `${formatHeader('algo deu errado')}\n\n` +
        `${escapeTelegramHtml(message || 'Não foi possível concluir.')}\n\n` +
        `<i>Tente novamente em instantes.</i>`
    );
}

function formatSessionExpired() {
    return (
        `${formatHeader()}\n\n` +
        `<i>Esta seleção expirou.</i>\n\n` +
        `Use <code>/tiktok</code> para buscar de novo.`
    );
}

function formatSearchCancelled() {
    return (
        `${formatHeader()}\n\n` +
        `<i>Busca cancelada.</i>\n\n` +
        `<code>/tiktok @usuario</code> <i>ou link TikTok</i>`
    );
}

module.exports = {
    formatTrackCard,
    formatSearchCaption,
    formatSearchButtonLabel,
    buildSearchKeyboard,
    formatDownloadingPanel,
    formatSuccessPanel,
    formatVideoCaption,
    formatHelpPanel,
    formatNotFound,
    formatTikTokError,
    formatSessionExpired,
    formatSearchCancelled,
    truncate,
};
