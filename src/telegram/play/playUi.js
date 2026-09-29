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

function trackTitle(track) {
    return track?.title || track?.track || 'Sem título';
}

function trackArtist(track) {
    const a = String(track?.artist || '').trim();
    return a || 'Artista desconhecido';
}

function trackDuration(track) {
    return String(track?.duration_string || '').trim();
}

/** Bloco compacto título + artista · duração */
function formatTrackCard(track) {
    const title = escapeTelegramHtml(trackTitle(track));
    const artist = escapeTelegramHtml(trackArtist(track));
    const dur = trackDuration(track);
    const meta = dur
        ? `${artist} · <code>${escapeTelegramHtml(dur)}</code>`
        : artist;
    return `<b>${title}</b>\n${meta}`;
}

function formatHeader(subtitle) {
    let out = '<b>🎧 Hanork Music</b>';
    if (subtitle) out += `\n<i>${escapeTelegramHtml(subtitle)}</i>`;
    return out;
}

function formatSearchCaption(query, results) {
    const q = escapeTelegramHtml(query);
    const n = results.length;
    const lines = results.map((r, i) => {
        const title = escapeTelegramHtml(truncate(trackTitle(r), 36));
        const artist = escapeTelegramHtml(truncate(trackArtist(r), 22));
        const dur = trackDuration(r);
        const tail = dur ? ` · <code>${escapeTelegramHtml(dur)}</code>` : '';
        return `${pickNum(i)} ${title}\n    ${artist}${tail}`;
    });

    return (
        `${formatHeader('escolha uma faixa')}\n\n` +
        `Busca: <i>«${q}»</i>\n` +
        `<i>${n} ${n === 1 ? 'resultado' : 'resultados'}</i>\n\n` +
        `${lines.join('\n\n')}\n\n` +
        `<i>Toque no número correspondente abaixo.</i>`
    );
}

function formatSearchButtonLabel(r, index) {
    const title = truncate(trackTitle(r), 28);
    const dur = trackDuration(r);
    const prefix = pickNum(index);
    const raw = dur ? `${prefix} ${title} · ${dur}` : `${prefix} ${title}`;
    return truncateButtonText(raw, 64);
}

function buildSearchKeyboard(sessionId, results) {
    const rows = results.map((r, i) => [
        Markup.button.callback(formatSearchButtonLabel(r, i), `play:pick:${sessionId}:${i}`),
    ]);
    rows.push([Markup.button.callback('✕ Cancelar busca', `play:scancel:${sessionId}`)]);
    return Markup.inlineKeyboard(rows);
}

function formatDownloadingPanel(track) {
    return (
        `${formatHeader('preparando faixa')}\n\n` +
        `${formatTrackCard(track)}\n\n` +
        `<i>Enviando o áudio para você…</i>`
    );
}

function formatSuccessPanel(track) {
    const { NAV_HINT } = require('../downloads/downloadsNav');
    return (
        `${formatHeader('pronto')}\n\n` +
        `${formatTrackCard(track)}\n\n` +
        `<i>O áudio chegou na mensagem acima ↑</i>\n` +
        `<i>Outra música?</i> <code>/play nome</code> <i>ou link YouTube</i>\n\n` +
        NAV_HINT
    );
}

function formatAudioCaption(track) {
    const title = escapeTelegramHtml(trackTitle(track));
    const artist = escapeTelegramHtml(trackArtist(track));
    const dur = trackDuration(track);
    const meta = dur ? `${artist} · ${escapeTelegramHtml(dur)}` : artist;
    return `🎧 <b>${title}</b>\n${meta}`;
}

function formatHelpPanel() {
    return (
        `${formatHeader('busca e download')}\n\n` +
        `Envie o <b>nome da música</b> ou um <b>link do YouTube</b>:\n\n` +
        `<code>/play artista — faixa</code>\n` +
        `<code>/play https://youtu.be/…</code>\n\n` +
        `<i>No privado, colar só o link também funciona.</i>`
    );
}

function formatNotFound(message) {
    return (
        `${formatHeader('nada encontrado')}\n\n` +
        `${escapeTelegramHtml(message || 'Nenhum resultado para esta busca.')}\n\n` +
        `<i>Tente outro nome ou cole o link completo do vídeo.</i>`
    );
}

function formatPlayError(message) {
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
        `Use <code>/play</code> para buscar de novo.`
    );
}

function formatSearchCancelled() {
    return (
        `${formatHeader()}\n\n` +
        `<i>Busca cancelada.</i>\n\n` +
        `<code>/play nome da música</code> <i>ou link YouTube</i>`
    );
}

function formatForeignSession() {
    return `${formatHeader()}\n\n<i>Esta busca não pertence a você.</i>`;
}

module.exports = {
    formatTrackCard,
    formatSearchCaption,
    formatSearchButtonLabel,
    buildSearchKeyboard,
    formatDownloadingPanel,
    formatSuccessPanel,
    formatAudioCaption,
    formatHelpPanel,
    formatNotFound,
    formatPlayError,
    formatSessionExpired,
    formatSearchCancelled,
    formatForeignSession,
    truncate,
};
