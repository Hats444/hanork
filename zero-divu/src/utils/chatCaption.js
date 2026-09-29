'use strict';

const { ensureProductBuyLink, WA_CHAT_CAPTION_MAX } = require('./waPromoLink');
const { sanitizeWaCaption } = require('./statusCaptionSanitizer');

/**
 * Legenda do espelho no chat — prioriza texto completo (textoChat), sem truncar como status.
 */
function resolveChatCaption({
  chatText = '',
  statusText = '',
  productId = null,
  productName = null,
  link = null,
} = {}) {
  let raw = String(chatText || statusText || '').trim();
  if (!raw) return '';
  raw = ensureProductBuyLink(raw, productId, {
    link: link || undefined,
    maxLen: WA_CHAT_CAPTION_MAX,
  });
  return sanitizeWaCaption(raw, { productName });
}

module.exports = { resolveChatCaption };
