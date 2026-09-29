'use strict';

const fs = require('fs-extra');
const path = require('path');
const pathResolver = require('../utils/pathResolver');
const hanorkAutoCatalog = require('../ipc/hanorkAutoCatalog');

function productImagePath(imageFile) {
  if (!imageFile) return null;
  const fp = path.join(pathResolver.getMediaDir(), 'hanork', path.basename(String(imageFile)));
  return fs.existsSync(fp) ? fp : null;
}

/** Inclui todos os produtos sincronizados — foto ausente é resolvida na rotação (menu fallback). */
function filterVariacoesForWa(variacoes) {
  return (variacoes || []).filter((v) => v && String(v.texto || '').trim());
}

function resolveStoreLink() {
  try {
    return require('../config/hanorkStoreLink').getHanorkStoreLink('catalogo');
  } catch {
    const user = String(process.env.BOT_USERNAME || process.env.HANORK_BOT_USERNAME || 'hanork_bot').replace(
      /^@/,
      ''
    );
    return user ? `https://t.me/${user}?start=catalogo` : 'https://t.me/hanork_bot?start=catalogo';
  }
}

function applyHanorkAutoOverlay(camp) {
  if (!camp || camp.id !== 'hanork') return camp;
  try {
    if (!require('../ipc/runtimeSettings').isHanorkAutoSyncEnabled()) return camp;
  } catch {
    /* ignore */
  }
  const overlay = hanorkAutoCatalog.load();
  if (!overlay?.variacoes?.length) return camp;

  const bridge = require('./hanorkPromoBridge');
  if (bridge.isDynamicHanorkCatalog(overlay)) {
    return {
      ...camp,
      variacoes: overlay.variacoes,
      imagem: 'hanork',
      link: resolveStoreLink(),
      _hanorkAutoSync: true,
      _hanorkDynamicPromo: true,
      _photoPool: overlay.photoPool || [],
      _syncedAt: overlay.updatedAt,
    };
  }

  const variacoes = filterVariacoesForWa(overlay.variacoes);
  if (!variacoes.length) return camp;

  return {
    ...camp,
    variacoes,
    imagem: 'hanork',
    link: resolveStoreLink(),
    _hanorkAutoSync: true,
    _syncedAt: overlay.updatedAt,
  };
}

function extractProductId(variacao) {
  if (variacao?.productId != null) return Number(variacao.productId);
  const m = String(variacao?.tipo || '').match(/^prod-(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function resolveVariacaoImage(camp, variacao) {
  if (camp.id !== 'hanork' && !camp._hanorkAutoSync) return null;

  if (variacao?.useMenuPhoto) {
    return require('./menuPhotoFallback').nextMenuPhotoPath();
  }

  if (camp._hanorkDynamicPromo) {
    const bridge = require('./hanorkPromoBridge');
    const picked = variacao?._pickedPhotoFile || variacao?.photoFile;
    if (picked) {
      const fp = bridge.resolvePhotoFile(picked);
      if (fp) return fp;
    }
    if (variacao?._pickedPhotoPath && fs.existsSync(variacao._pickedPhotoPath)) {
      return variacao._pickedPhotoPath;
    }
  }

  const synced = productImagePath(variacao?.imageFile);
  if (synced) return synced;

  const pid = extractProductId(variacao);
  if (pid != null) {
    const byId = productImagePath(`auto-prod-${pid}.jpg`);
    if (byId) return byId;
  }

  if (isAutoSyncProduct(variacao)) {
    return require('./menuPhotoFallback').nextMenuPhotoPath();
  }
  return null;
}

function isAutoSyncProduct(variacao) {
  if (!variacao) return false;
  if (variacao.productId) return true;
  return /^prod-\d+$/i.test(String(variacao.tipo || ''));
}

function isProductBoundImage(filePath) {
  if (!filePath) return false;
  const base = path.basename(String(filePath));
  return /^auto-prod-\d+\./i.test(base) || /^prod-\d+-/i.test(base);
}

module.exports = {
  applyHanorkAutoOverlay,
  resolveVariacaoImage,
  extractProductId,
  isAutoSyncProduct,
  isProductBoundImage,
  productImagePath,
  filterVariacoesForWa,
};
