'use strict';

/**
 * Política de campanhas WA — padrão: só produtos cadastrados no Hanork.
 * Zero Divu (self-promo) e mídias/textos legados ficam desligados.
 */

function envOn(name, defaultTrue = true) {
  const v = process.env[name];
  if (v == null || v === '') return defaultTrue;
  return !/^(0|false|off|no)$/i.test(String(v).trim());
}

const PRODUCTS_ONLY = envOn('ZERO_DIVU_PRODUCTS_ONLY', true);

exports.isProductsOnlyMode = () => PRODUCTS_ONLY;

exports.isZeroCampaignEnabled = () =>
  !PRODUCTS_ONLY && envOn('ZERO_CAMPAIGN_ENABLED', false);

exports.isHanorkCatalogMode = () => PRODUCTS_ONLY || envOn('HANORK_CATALOG_ONLY', true);

exports.isCampaignAllowed = (campaignId) => {
  const id = String(campaignId || '').toLowerCase();
  if (id === 'zero' || id === 'legacy') return exports.isZeroCampaignEnabled();
  if (id === 'hanork' || id === 'hanork-promo') return true;
  return false;
};

exports.blockManualCampaignEdit = (campaignId) => {
  if (!PRODUCTS_ONLY) return false;
  const id = String(campaignId || '').toLowerCase();
  return id === 'zero' || id === 'legacy';
};

exports.legacyMediaDirs = () => [
  'fotos/zero',
  'fotos/divu',
  'imagens',
];

exports.legacyHanorkStaticPattern = /^hanork-\d/i;
