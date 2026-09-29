'use strict';

/**
 * Regras de elegibilidade — divulgação só de produtos reais do catálogo Hanork.
 * Exclui meta-produtos (ex.: listing "Zero Divu") e IDs em DIVULGACAO_EXCLUDE_PRODUCT_IDS.
 */

function parseExcludeIds() {
  const raw =
    process.env.DIVULGACAO_EXCLUDE_PRODUCT_IDS ||
    process.env.AUTO_BROADCAST_EXCLUDE_IDS ||
    '17';
  return raw
    .split(/[,;\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function isMetaProductName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  if (n === 'zero' || n === 'zero divu' || n === 'zerodivu') return true;
  if (/^zero\s*divu\b/.test(n) && !/\bhanork\b/.test(n)) return true;
  if (/\bzero\s*divu\b/.test(n) && /\b(bot|status|divulg)/.test(n)) return true;
  return false;
}

function parseHanorkOnlyId() {
  const v = String(process.env.DIVULGACAO_HANORK_ONLY || process.env.HANORK_ONLY_PRODUCT_ID || '1')
    .trim()
    .toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return null;
  const id = Number(process.env.HANORK_PRODUCT_ID || process.env.HANORK_ONLY_PRODUCT_ID || 1);
  return Number.isFinite(id) && id > 0 ? id : 1;
}

function isDivulgacaoEligibleProduct(p) {
  if (!p) return false;

  const hanorkOnly = parseHanorkOnlyId();
  if (hanorkOnly != null && Number(p.id) !== hanorkOnly) return false;

  if (p.active === false) return false;
  if ((p.stock ?? 999) <= 0) return false;

  const id = Number(p.id);
  if (parseExcludeIds().includes(id)) return false;

  const name = String(p.name || p.title || '').trim();
  if (isMetaProductName(name)) return false;

  const tags = String(p.tags || p.category || '').toLowerCase();
  if (tags.includes('zero-divu') || tags.includes('zerodivu')) return false;

  return true;
}

function filterDivulgacaoProducts(products) {
  return (products || []).filter(isDivulgacaoEligibleProduct);
}

module.exports = {
  isDivulgacaoEligibleProduct,
  filterDivulgacaoProducts,
  parseExcludeIds,
  isMetaProductName,
};
