'use strict';

/** ID do produto Hanork PRO no catálogo (único produto ativo). */
function getHanorkProductId() {
  const raw = process.env.HANORK_PRODUCT_ID || process.env.HANORK_ONLY_PRODUCT_ID || '1';
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : 1;
}

const HANORK_PRODUCT_ID = getHanorkProductId();

module.exports = { getHanorkProductId, HANORK_PRODUCT_ID };
