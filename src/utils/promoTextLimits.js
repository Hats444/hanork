'use strict';

const { CAPTION_MAX, MESSAGE_MAX, truncateTelegramHtml } = require('../telegram/telegramLimits');
const { WA_CAPTION_MAX } = require('./waPromoLink');

const TG_PROMO_MARGIN = 24;
const WA_PROMO_MARGIN = 32;
/** Legenda de mídia no chat do grupo WA (bem maior que status ~1024). */
const WA_CHAT_CAPTION_MAX = Number(process.env.WA_CHAT_CAPTION_MAX) || 4096;
const WA_CHAT_MARGIN = 16;

/**
 * Espaço restante para corpo/descrição dentro de uma legenda completa.
 */
function descBudgetForPromo(prefixPlain, suffixPlain, maxTotal, margin = TG_PROMO_MARGIN) {
  const overhead = String(prefixPlain || '').length + String(suffixPlain || '').length + margin;
  return Math.max(80, maxTotal - overhead);
}

function fitPlainText(text, maxLen) {
  const s = String(text || '').trim();
  if (!s || s.length <= maxLen) return s;
  let cut = s.slice(0, maxLen - 1).trimEnd();
  const lastNl = cut.lastIndexOf('\n');
  if (lastNl > maxLen * 0.55) cut = cut.slice(0, lastNl).trimEnd();
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.65) cut = cut.slice(0, lastSpace).trimEnd();
  return `${cut}…`;
}

function fitTelegramPromoHtml(html, { withPhoto = true } = {}) {
  const max = withPhoto ? CAPTION_MAX : MESSAGE_MAX;
  if (!html || html.length <= max) return html || '';
  return truncateTelegramHtml(html, max);
}

function fitWaPromoPlain(text) {
  const s = String(text || '').trim();
  if (s.length <= WA_CAPTION_MAX) return s;
  return fitPlainText(s, WA_CAPTION_MAX);
}

function fitWaChatPlain(text) {
  const s = String(text || '').trim();
  if (s.length <= WA_CHAT_CAPTION_MAX) return s;
  return fitPlainText(s, WA_CHAT_CAPTION_MAX);
}

module.exports = {
  TG_CAPTION_MAX: CAPTION_MAX,
  TG_MESSAGE_MAX: MESSAGE_MAX,
  WA_STATUS_CAPTION_MAX: WA_CAPTION_MAX,
  WA_CHAT_CAPTION_MAX,
  descBudgetForPromo,
  fitPlainText,
  fitTelegramPromoHtml,
  fitWaPromoPlain,
  fitWaChatPlain,
};
