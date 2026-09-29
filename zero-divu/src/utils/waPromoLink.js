'use strict';

const hanorkStoreLink = require('../config/hanorkStoreLink');

const WA_CAPTION_MAX = 1024;
const WA_CHAT_CAPTION_MAX = Number(process.env.WA_CHAT_CAPTION_MAX) || 4096;
const TG_LINK_RE = /https?:\/\/t\.me\/[^\s<>)]+/i;

function hasTelegramBuyLink(text) {
  return TG_LINK_RE.test(String(text || ''));
}

function getProductBuyLink(productId) {
  return hanorkStoreLink.getProductLink(productId);
}

function ensureProductBuyLink(text, productId, options = {}) {
  const base = String(text || '').trim();
  const link = options.link || getProductBuyLink(productId);
  if (!link) return base;
  if (hasTelegramBuyLink(base)) return base;

  const cta = `\n\n🛒 Comprar agora:\n${link}`;
  const maxLen = options.maxLen || WA_CAPTION_MAX;

  if (!base) return `🛒 Comprar agora:\n${link}`.slice(0, maxLen);
  if (base.length + cta.length <= maxLen) return base + cta;

  const room = maxLen - cta.length - 1;
  const trimmed = room > 20 ? base.slice(0, room).trim() : base.slice(0, Math.max(0, room));
  return `${trimmed}…${cta}`;
}

module.exports = {
  WA_CAPTION_MAX,
  WA_CHAT_CAPTION_MAX,
  hasTelegramBuyLink,
  getProductBuyLink,
  ensureProductBuyLink,
};
