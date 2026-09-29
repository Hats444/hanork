'use strict';

const { escapeTelegramHtml } = require('../htmlEscape');

function truncate(text, max = 64) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function formatHelpPanel() {
    return (
        `<b>📺 YouTube — vídeo / áudio</b>\n\n` +
        `Baixe vídeos, Shorts ou lives do YouTube neste chat.\n\n` +
        `<b>Como usar</b>\n` +
        `• <code>/youtube</code> + link do YouTube\n` +
        `• Cole o link direto aqui no privado\n` +
        `• Frases: <i>baixa esse vídeo do youtube</i>\n\n` +
        `<b>Exemplos</b>\n` +
        `<code>/youtube https://youtu.be/…</code>\n` +
        `<code>/youtube https://youtube.com/shorts/…</code>\n\n` +
        `<i>Música por nome → use <code>/play</code>. Rotas alternadas automaticamente (ytvideo, ytaudio…).</i>`
    );
}

function formatProcessingPanel(item) {
    const title = escapeTelegramHtml(truncate(item?.title || 'YouTube', 72));
    const author = item?.author ? `\n👤 ${escapeTelegramHtml(truncate(item.author, 48))}` : '';
    const kind =
        item?.kind === 'shorts'
            ? '📱 Short'
            : item?.kind === 'live'
              ? '🔴 Live'
              : '🎬 Vídeo';
    return (
        `${kind} <b>${title}</b>${author}\n\n` +
        `⏳ Preparando download — tentando rotas Zero Two…`
    );
}

function formatSuccessPanel(item, result) {
    const { NAV_HINT } = require('../downloads/downloadsNav');
    const title = escapeTelegramHtml(truncate(item?.title || 'YouTube', 72));
    const route = escapeTelegramHtml(result?.route || '—');
    const mode = result?.kind === 'audio' ? '🎵 Áudio' : '🎬 Vídeo';
    return (
        `✅ <b>Download concluído</b>\n\n` +
        `${mode} · <b>${title}</b>\n` +
        `🔌 Rota: <code>${route}</code>\n\n` +
        NAV_HINT
    );
}

function formatYoutubeError(message) {
    const msg = escapeTelegramHtml(String(message || 'Erro desconhecido').slice(0, 400));
    return (
        `❌ <b>Não foi possível baixar</b>\n\n` +
        `${msg}\n\n` +
        `<i>Tente outro link ou use <code>/play</code> só para áudio/música.</i>`
    );
}

module.exports = {
    formatHelpPanel,
    formatProcessingPanel,
    formatSuccessPanel,
    formatYoutubeError,
    truncate,
};
