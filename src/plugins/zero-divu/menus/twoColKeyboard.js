'use strict';

const { sanitizeReplyMarkup } = require('../telegramButtonText');

/**
 * Teclado inline padrão Hanork — sempre 2 colunas (2 botões por linha).
 * - Flatten de rows → pares; ímpar completa com NOOP invisível (ㅤ)
 * - Markup.inlineKeyboard do Telegraf é patchado ao carregar este módulo
 */

const NOOP_BUTTON = { text: 'ㅤ', callback_data: 'noop' };

function toTwoCols(rows = [], opts = {}) {
  const fill = opts.fill !== false;
  const filler = opts.filler || NOOP_BUTTON;

  const flat = []
    .concat(...(Array.isArray(rows) ? rows : []))
    .filter(Boolean)
    .flat()
    .filter(Boolean);

  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    const a = flat[i];
    const b = flat[i + 1];
    if (b) out.push([a, b]);
    else out.push(fill ? [a, filler] : [a]);
  }
  return out;
}

/** Markup.inlineKeyboard com layout 2 colunas */
function kb2(Markup, rows) {
  return Markup.inlineKeyboard(toTwoCols(rows));
}

/** Normaliza reply_markup / inline_keyboard cru (API Telegram direta) */
function normalizeReplyMarkup(markup) {
  if (!markup) return markup;
  if (Array.isArray(markup)) {
    return sanitizeReplyMarkup({ inline_keyboard: toTwoCols(markup) });
  }
  if (markup.inline_keyboard?.length) {
    return sanitizeReplyMarkup({ ...markup, inline_keyboard: toTwoCols(markup.inline_keyboard) });
  }
  if (markup.reply_markup) {
    const inner = normalizeReplyMarkup(markup.reply_markup);
    if (inner === markup.reply_markup) return markup;
    return { ...markup, reply_markup: inner };
  }
  return sanitizeReplyMarkup(markup);
}

function patchTelegrafMarkup(Markup) {
  if (!Markup || Markup.__hanorkTwoColPatched) return;
  const original = Markup.inlineKeyboard.bind(Markup);
  Markup.inlineKeyboard = (buttons, options) => original(toTwoCols(buttons), options);
  Markup.__hanorkTwoColPatched = true;
}

try {
  const { Markup } = require('telegraf');
  patchTelegrafMarkup(Markup);
} catch {
  /* ambiente de teste sem telegraf */
}

module.exports = {
  toTwoCols,
  NOOP_BUTTON,
  kb2,
  normalizeReplyMarkup,
  patchTelegrafMarkup,
};
