'use strict';

const { dedupePlainText, stripDuplicatePriceLines } = require('./broadcastTextClean');
const { ensureProductBuyLink } = require('./waPromoLink');
const { fitWaPromoPlain, fitWaChatPlain, WA_CHAT_CAPTION_MAX } = require('./promoTextLimits');

/**
 * Legenda final WA — limpeza sem remover o título estruturado (✨ produto).
 */
function prepareWaPromoPlain(text, { productName = '', productId = null, username = '' } = {}) {
  let s = dedupePlainText(String(text || '').trim());
  s = stripDuplicatePriceLines(s);
  try {
    const { sanitizeWaCaption } = require('../../zero-divu/src/utils/statusCaptionSanitizer');
    s = sanitizeWaCaption(s, { productName });
  } catch {
    /* worker path opcional em dev */
  }
  if (productId != null) {
    s = ensureProductBuyLink(s, productId, username);
    try {
      const { sanitizeWaCaption } = require('../../zero-divu/src/utils/statusCaptionSanitizer');
      s = sanitizeWaCaption(s, { productName });
    } catch {
      /* ignore */
    }
  }
  return fitWaPromoPlain(s);
}

/** Legenda completa para espelho no chat do grupo (limite alto, não corta como status). */
function prepareWaChatPlain(text, { productName = '', productId = null, username = '' } = {}) {
  let s = dedupePlainText(String(text || '').trim());
  s = stripDuplicatePriceLines(s);
  try {
    const { sanitizeWaCaption } = require('../../zero-divu/src/utils/statusCaptionSanitizer');
    s = sanitizeWaCaption(s, { productName });
  } catch {
    /* worker path opcional em dev */
  }
  if (productId != null) {
    s = ensureProductBuyLink(s, productId, username, { maxLen: WA_CHAT_CAPTION_MAX });
    try {
      const { sanitizeWaCaption } = require('../../zero-divu/src/utils/statusCaptionSanitizer');
      s = sanitizeWaCaption(s, { productName });
    } catch {
      /* ignore */
    }
  }
  return fitWaChatPlain(s);
}

module.exports = { prepareWaPromoPlain, prepareWaChatPlain };
