'use strict';

const path = require('path');

/** Capas Hanork PRO ficam em hanork/fotos (mesmo dir do broadcast TG). */
function resolveHanorkPromoMediaDir() {
  const fromEnv = process.env.HANORK_PROMO_MEDIA_DIR || process.env.HANORK_WA_MEDIA_DIR;
  if (fromEnv && String(fromEnv).trim()) {
    return path.resolve(String(fromEnv).trim());
  }
  try {
    const { CONFIG } = require('../config/config');
    if (CONFIG?.CAMINHO_FOTOS) return path.normalize(CONFIG.CAMINHO_FOTOS);
  } catch {
    /* ignore */
  }
  return path.join(__dirname, '../../fotos');
}

module.exports = { resolveHanorkPromoMediaDir };
