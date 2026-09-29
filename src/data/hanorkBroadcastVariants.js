'use strict';

/**
 * Hanork PRO (#1): 25 textos profissionais + 1 foto principal (virtuo_01 / hanork_01 / ssm_01).
 * Rotação por fila de variantes; cada variante usa somente mídia HANORK correspondente.
 */

const path = require('path');
const fs = require('fs');
const { listPromoPhotos, resolvePairedPromoPhoto } = require('../utils/promoMediaPaths');
const { HANORK_PRODUCT_ID } = require('../constants/hanorkProduct');
const { appendHanorkCta, buyDeepLink } = require('../utils/broadcastDeepLinks');

const themesPath = path.join(__dirname, 'hanorkPromoThemes.json');
const VARIANTS = JSON.parse(fs.readFileSync(themesPath, 'utf8'));

const BUY_LINK = buyDeepLink();
const PRICE_LABEL = 'R$ 297,90';
const DEFAULT_PHOTO = 'hanork_01.jpg';
const KV_VARIANT_QUEUE = 'hanork_broadcast_variant_queue';
/** @deprecated fila independente — mantido só para compatibilidade de chave KV */
const KV_PHOTO_QUEUE = 'hanork_broadcast_photo_queue';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickFromQueue(ids, kv, queueKey) {
  let queue = [];
  try {
    const raw = kv.get?.(queueKey);
    queue = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(queue)) queue = [];
  } catch {
    queue = [];
  }
  queue = queue.filter((id) => ids.includes(id));
  if (!queue.length) queue = shuffle(ids);
  const picked = queue.shift();
  kv.set?.(queueKey, JSON.stringify(queue));
  return picked;
}

function variantIndex(variant) {
  const idx = VARIANTS.findIndex((v) => v.id === variant?.id);
  return idx >= 0 ? idx : 0;
}

function listHanorkPromoPhotos(photosDir) {
  const paired = VARIANTS.map((v) => v.image_file).filter(Boolean);
  if (paired.length === VARIANTS.length) return paired;
  const fromDirs = listPromoPhotos('hanork', photosDir);
  return fromDirs.length ? fromDirs : [DEFAULT_PHOTO];
}

function pickHanorkVariant(kv = {}) {
  const ids = VARIANTS.map((v) => v.id);
  const picked = pickFromQueue(ids, kv, KV_VARIANT_QUEUE);
  return VARIANTS.find((v) => v.id === picked) || VARIANTS[0];
}

/** @deprecated Use resolvePairedPromoPhoto via pickHanorkBroadcast */
function pickHanorkPromoPhoto(_kv = {}, _photosDir = null) {
  return DEFAULT_PHOTO;
}

/** Texto + foto pareados por variante (sem misturar filas). */
function pickHanorkBroadcast(kv = {}, photosDir = null) {
  try {
    const { isMarketingMdEnabled, pickHanorkFromMarkdown } = require('./marketingMarkdownVariants');
    if (isMarketingMdEnabled()) {
      const md = pickHanorkFromMarkdown(kv, photosDir);
      if (md?.variant) return md;
    }
  } catch {
    /* fallback JSON themes */
  }
  const variant = pickHanorkVariant(kv);
  const idx = variantIndex(variant);
  const paired = resolvePairedPromoPhoto('hanork', variant, idx, photosDir);
  return { variant, ...paired };
}

function formatHanorkTelegramHtml(variant, product, opts = {}) {
  if (variant?.fromMarkdown && variant.fullBody) {
    return appendHanorkCta(variant.fullBody, {
      botLink: opts.botLink || BUY_LINK,
      username: opts.username,
      ctaLabel: opts.ctaLabel || '🛒 Comprar agora',
    });
  }
  const price =
    opts.precoTxt ||
    (opts.sale
      ? `<s>R$ ${Number(product.price).toFixed(2)}</s> <b>R$ ${Number(opts.sale.sale_price).toFixed(2)}</b>`
      : `<b>R$ ${Number(product.price).toFixed(2)}</b>`);
  const botLink = opts.botLink || BUY_LINK;
  const headline = variant.headline || product.name || 'Hanork PRO v3.0';
  const body = String(variant.tgBody || '').replace(/\n/g, '\n');
  return (
    `<b>${headline}</b>\n\n` +
    `${body}\n\n` +
    `Investimento: ${price}\n` +
    `Produto digital com entrega automática após confirmação do pagamento.\n\n` +
    `<a href="${botLink}">Comprar Hanork PRO agora</a>\n` +
    `PIX ou Mercado Pago: o cliente recebe o pacote no Telegram assim que o pagamento é aprovado.`
  );
}

function buildWaPromoText(variant, opts = {}) {
  const username = (opts.username || 'hanork_bot').replace(/^@/, '');
  const link = `https://t.me/${username}?start=buy_${HANORK_PRODUCT_ID}`;
  const price = Number(opts.price || 297.9).toFixed(2);
  return (
    `${variant.waBody}\n\n` +
    `Investimento: R$ ${price}\n` +
    `Compra: ${link}\n` +
    `Entrega automática após confirmação do pagamento.`
  );
}

function buildHanorkCatalogVariacoes(product, opts = {}) {
  const username = (opts.username || 'hanork_bot').replace(/^@/, '');
  const price = Number(product?.price || 297.9);
  const photosDir = opts.photosDir || null;

  return VARIANTS.map((v, i) => {
    const paired = resolvePairedPromoPhoto('hanork', v, i, photosDir);
    const imageFile = paired.photoFile || v.image_file;
    const texto = buildWaPromoText(v, { username, price });
    return {
      tipo: `hanork-${v.id}`,
      texto,
      textoChat: texto,
      productId: HANORK_PRODUCT_ID,
      productName: product?.name || 'Hanork PRO v3.0',
      imageFile,
    };
  });
}

function resolveHanorkVariantPhoto(variant, photosDir, _kv = {}) {
  const idx = variantIndex(variant);
  return resolvePairedPromoPhoto('hanork', variant, idx, photosDir).photo;
}

function formatAllVariantsBonusFile(photosDir = null) {
  const pool = listHanorkPromoPhotos(photosDir);
  const lines = [
    'HANORK PRO — TEXTOS + FOTOS PAREADOS (TG + WA)',
    '==============================================',
    'Textos: rotação aleatória entre 25 variantes (fila sem repetir).',
    'Foto: principal hanork_01.jpg (todos os textos usam a mesma imagem).',
    `Fotos catalogadas (${pool.length}): ${pool.join(', ')}`,
    `Link: ${BUY_LINK}`,
    `Preço: ${PRICE_LABEL}`,
    '',
  ];
  VARIANTS.forEach((v, i) => {
    lines.push('='.repeat(48));
    lines.push(`${String(i + 1).padStart(2, '0')}) ${v.headline} [${v.id}] → ${v.image_file}`, '');
    lines.push('TELEGRAM:', v.tgBody, '');
    lines.push('WHATSAPP:', v.waBody, '', '');
  });
  return lines.join('\n');
}

function writeHanorkOnlyCatalogFile(product, opts = {}) {
  const catalogPath =
    opts.catalogPath || path.join(__dirname, '../../shared/zero-ipc/hanork_auto_catalog.json');
  const photosDir = opts.photosDir || null;
  const pool = listHanorkPromoPhotos(photosDir);
  const payload = {
    updatedAt: new Date().toISOString(),
    source: 'hanork_paired_promo',
    dynamicPromo: true,
    pairedMedia: true,
    productCount: VARIANTS.length,
    photoPool: pool,
    photosDir: photosDir || null,
    productId: HANORK_PRODUCT_ID,
    productName: product?.name || 'Hanork PRO v3.0',
    variacoes: [
      {
        tipo: 'hanork-paired',
        productId: HANORK_PRODUCT_ID,
        productName: product?.name || 'Hanork PRO v3.0',
        dynamic: true,
      },
    ],
    aiAsync: false,
    hanorkOnly: true,
    theme: 'hanork-pro-professional',
  };
  fs.writeFileSync(catalogPath, JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

/** KV compartilhado (Hanork + WA) — fila de texto no hanork.db */
function createHanorkPromoKv(dbRaw) {
  if (!dbRaw) return null;
  try {
    const db = typeof dbRaw === 'function' ? dbRaw() : dbRaw;
    if (!db?.prepare) return null;
    return {
      get: (k) => db.prepare('SELECT value FROM kv_store WHERE key=?').get(k)?.value ?? null,
      set: (k, v) => {
        db.prepare(
          `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(k, String(v));
      },
    };
  } catch {
    return null;
  }
}

/** Próximo post WA — mesmo motor do Telegram (texto + foto pareados). */
function pickHanorkWaPost(kv = {}, photosDir = null, opts = {}) {
  const { variant, photoFile, photoPath } = pickHanorkBroadcast(kv, photosDir);
  const username = (opts.username || process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
  const price = Number(opts.price ?? opts.product?.price ?? 297.9);
  const texto = buildWaPromoText(variant, { username, price });
  return {
    variant,
    photoFile,
    photoPath,
    texto,
    textoChat: texto,
    productId: HANORK_PRODUCT_ID,
    productName: opts.productName || opts.product?.name || 'Hanork PRO v3.0',
    tipo: `hanork-${variant.id}`,
  };
}

module.exports = {
  HANORK_PRODUCT_ID,
  BUY_LINK,
  PRICE_LABEL,
  DEFAULT_PHOTO,
  VARIANTS,
  KV_VARIANT_QUEUE,
  KV_PHOTO_QUEUE,
  listHanorkPromoPhotos,
  pickHanorkVariant,
  pickHanorkPromoPhoto,
  pickHanorkBroadcast,
  formatHanorkTelegramHtml,
  buildWaPromoText,
  buildHanorkCatalogVariacoes,
  resolveHanorkVariantPhoto,
  formatAllVariantsBonusFile,
  writeHanorkOnlyCatalogFile,
  createHanorkPromoKv,
  pickHanorkWaPost,
};
