'use strict';

/** Tags aceitas pelo parse_mode HTML do Telegram (Bot API). */
const TG_HTML_ALLOWED = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'code',
  'pre',
  'a',
  'tg-spoiler',
  'blockquote',
]);

/** Tags de layout que a IA costuma gerar — viram quebra de linha ou são removidas. */
const TG_HTML_BLOCK = new Set([
  'div',
  'p',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'td',
  'th',
  'thead',
  'tbody',
]);

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Garante HTML compatível com Telegram — remove <div>, <p>, etc. que quebram broadcast.
 */
function sanitizeTelegramHtml(html) {
  let s = String(html || '');
  if (!s.trim()) return '';

  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');

  s = s.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)>/g, (full, slash, tagRaw, attrs) => {
    const tag = String(tagRaw || '').toLowerCase();
    const closing = Boolean(slash);

    if (tag === 'span') {
      if (/tg-spoiler/i.test(attrs)) {
        return closing ? '</span>' : '<span class="tg-spoiler">';
      }
      return closing ? '\n' : '';
    }

    if (TG_HTML_BLOCK.has(tag)) {
      return closing ? '\n' : '\n';
    }

    if (!TG_HTML_ALLOWED.has(tag)) {
      return '';
    }

    if (tag === 'a') {
      if (closing) return '</a>';
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs || '');
      if (!href) return '';
      const safe = href[1].replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<a href="${safe}">`;
    }

    return closing ? `</${tag}>` : `<${tag}>`;
  });

  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  return s;
}

function formatBrl(n) {
  return `R$ ${Number(n).toFixed(2)}`;
}

function benefitLine(name) {
  const n = String(name || 'este produto').trim();
  return (
    `⚡ ${n} com entrega automática no Telegram — pague e receba na hora, sem fila e sem burocracia.`
  );
}

function urgencyLine(hasSale) {
  if (hasSale) return '🔥 Preço de oferta relâmpago — pode acabar a qualquer momento.';
  return '⏳ Estoque digital limitado — garanta o seu antes que suba.';
}

function ctaPlain(botLink) {
  if (botLink) {
    return `🛒 Garanta agora: ${botLink}\n✅ Pagamento confirmado = entrega automática.`;
  }
  return '👆 Abra o bot no Telegram, escolha o produto e receba na hora após o pagamento.';
}

function ctaHtml(botLink, precoLabel) {
  if (botLink) {
    return `\n\n🛒 <a href="${botLink}">Quero comprar — ${precoLabel}</a>\n<i>Entrega automática assim que o pagamento confirmar.</i>`;
  }
  return '\n\n👆 <b>Toque abaixo e finalize em segundos.</b>\n<i>Entrega automática após o pagamento.</i>';
}

function buildPriceBlock(p, sale) {
  const price = Number(p.price);
  if (sale) {
    const salePrice = Number(sale.sale_price);
    const pct = Math.round(((price - salePrice) / price) * 100);
    return {
      plain: `💰 De ${formatBrl(price)} por apenas ${formatBrl(salePrice)} (-${pct}%)\n${urgencyLine(true)}`,
      html: `💰 <s>${formatBrl(price)}</s> ➜ <b>${formatBrl(salePrice)}</b> <b>(-${pct}%)</b>\n\n${urgencyLine(true)}`,
      precoLabel: formatBrl(salePrice),
      hasSale: true,
    };
  }
  const preco = formatBrl(price);
  return {
    plain: `💰 Por apenas ${preco}\n${urgencyLine(false)}`,
    html: `💰 <b>${preco}</b>\n\n${urgencyLine(false)}`,
    precoLabel: preco,
    hasSale: false,
  };
}

function trimDesc(desc, max = null) {
  const t = stripHtml(desc);
  if (!t) return '';
  const limit = max != null ? max : 900;
  if (t.length <= limit) return t;
  let cut = t.slice(0, limit - 1).trimEnd();
  const lastNl = cut.lastIndexOf('\n');
  if (lastNl > limit * 0.55) cut = cut.slice(0, lastNl).trimEnd();
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > limit * 0.65) cut = cut.slice(0, lastSpace).trimEnd();
  return `${cut}…`;
}

function stripPriceFromText(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !/^💰/u.test(t) && !/\bR\$\s*\d/u.test(t) && !/\*\*R\$/i.test(t);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

exports.stripHtml = stripHtml;
exports.sanitizeTelegramHtml = sanitizeTelegramHtml;
exports.trimDesc = trimDesc;

/** Monta legenda WA em blocos únicos — título, corpo, preço, CTA (sem HTML). */
function buildWaPlainFromParts({
  productName = '',
  body = '',
  priceLabel = '',
  hasSale = false,
  originalPrice = '',
  botLink = null,
} = {}) {
  const parts = [];
  const name = String(productName || '').trim();
  const core = String(body || '').trim();

  if (name) parts.push(`✨ ${name}`);
  if (core) parts.push(core);

  if (priceLabel) {
    if (hasSale && originalPrice) {
      parts.push(`💰 De ${originalPrice} por apenas ${priceLabel}\n🔥 Preço de oferta relâmpago — pode acabar a qualquer momento.`);
    } else {
      parts.push(`💰 Por apenas ${priceLabel}\n⏳ Estoque digital limitado — garanta o seu antes que suba.`);
    }
  }

  if (botLink) {
    parts.push(`🛒 Garanta agora:\n${botLink}\n✅ Pagamento confirmado = entrega automática.`);
  } else {
    parts.push('👆 Abra o bot no Telegram, escolha o produto e receba na hora após o pagamento.');
  }

  return parts.join('\n\n');
}

exports.buildWaPlainFromParts = buildWaPlainFromParts;

exports.buildWaPlainPromo = (p, { sale = null, username = '' } = {}) => {
  const { withPromoTemplate } = require('../data/productPromoTemplates');
  const { polishAiBody } = require('./broadcastTextClean');
  const { descBudgetForPromo, fitWaPromoPlain, WA_STATUS_CAPTION_MAX } = require('./promoTextLimits');
  p = withPromoTemplate(p);
  const priceBlock = buildPriceBlock(p, sale);
  const botLink = username ? `https://t.me/${username}?start=buy_${p.id}` : null;

  const prefix = `✨ ${p.name}\n\n`;
  const suffixPlain = [
    priceBlock.plain,
    botLink
      ? `🛒 Garanta agora:\n${botLink}\n✅ Pagamento confirmado = entrega automática.`
      : '👆 Abra o bot no Telegram, escolha o produto e receba na hora após o pagamento.',
  ].join('\n\n');
  const descMax = descBudgetForPromo(prefix, suffixPlain, WA_STATUS_CAPTION_MAX);

  let desc = stripPriceFromText(trimDesc(p.description || '', descMax));
  if (desc) desc = polishAiBody(desc, p.name);
  if (!desc) desc = benefitLine(p.name);

  let text = buildWaPlainFromParts({
    productName: p.name,
    body: desc,
    priceLabel: priceBlock.precoLabel,
    hasSale: priceBlock.hasSale,
    originalPrice: formatBrl(Number(p.price)),
    botLink,
  });

  const { prepareWaPromoPlain } = require('./waCaptionPrepare');
  return prepareWaPromoPlain(text, {
    productName: p.name,
    productId: p.id,
    username,
  });
};

/** Promo WA para chat do grupo — descrição completa (status continua curto). */
exports.buildWaChatPromo = (p, { sale = null, username = '' } = {}) => {
  const { withPromoTemplate, getProductPromoBody } = require('../data/productPromoTemplates');
  const { polishAiBody } = require('./broadcastTextClean');
  const { descBudgetForPromo, WA_CHAT_CAPTION_MAX } = require('./promoTextLimits');
  p = withPromoTemplate(p);
  const priceBlock = buildPriceBlock(p, sale);
  const botLink = username ? `https://t.me/${username}?start=buy_${p.id}` : null;

  const prefix = `✨ ${p.name}\n\n`;
  const suffixPlain = [
    priceBlock.plain,
    botLink
      ? `🛒 Garanta agora:\n${botLink}\n✅ Pagamento confirmado = entrega automática.`
      : '👆 Abra o bot no Telegram, escolha o produto e receba na hora após o pagamento.',
  ].join('\n\n');
  const descMax = descBudgetForPromo(prefix, suffixPlain, WA_CHAT_CAPTION_MAX, 16);

  let desc = stripPriceFromText(
    trimDesc(getProductPromoBody(p) || p.description || '', descMax)
  );
  if (desc) desc = polishAiBody(desc, p.name);
  if (!desc) desc = benefitLine(p.name);

  return buildWaPlainFromParts({
    productName: p.name,
    body: desc,
    priceLabel: priceBlock.precoLabel,
    hasSale: priceBlock.hasSale,
    originalPrice: formatBrl(Number(p.price)),
    botLink,
  });
};

exports.buildTelegramHtmlPromo = (p, { sale = null, botLink = null, withPhoto = true } = {}) => {
  const { withPromoTemplate } = require('../data/productPromoTemplates');
  const { polishPromoHtml } = require('./broadcastTextClean');
  const { descBudgetForPromo, fitTelegramPromoHtml, TG_CAPTION_MAX, TG_MESSAGE_MAX } = require('./promoTextLimits');
  p = withPromoTemplate(p);
  const priceBlock = buildPriceBlock(p, sale);
  const cta = ctaHtml(botLink, priceBlock.precoLabel);
  const saleExtra = priceBlock.hasSale ? '\n\n🔥 <b>Oferta relâmpago ativa!</b>' : '';

  const prefixPlain = `✨ ${p.name}\n\n`;
  const suffixPlain = stripHtml(`${priceBlock.html}${saleExtra}${cta}`);
  const maxTotal = withPhoto ? TG_CAPTION_MAX : TG_MESSAGE_MAX;
  const descMax = descBudgetForPromo(prefixPlain, suffixPlain, maxTotal);

  let texto = `✨ <b>${p.name}</b>\n\n`;
  let desc = trimDesc(p.description || '', descMax);
  if (desc) {
    const { polishAiBody } = require('./broadcastTextClean');
    desc = polishAiBody(desc, p.name);
    texto += `${desc.replace(/\n/g, '\n')}\n\n`;
  } else {
    texto += `${benefitLine(p.name)}\n\n`;
  }
  texto += priceBlock.html;
  if (priceBlock.hasSale) texto += '\n\n🔥 <b>Oferta relâmpago ativa!</b>';
  texto += cta;
  return fitTelegramPromoHtml(
    polishPromoHtml(sanitizeTelegramHtml(texto), { productName: p.name }),
    { withPhoto }
  );
};

module.exports = exports;
