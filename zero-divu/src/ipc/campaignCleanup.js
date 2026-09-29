'use strict';

const fs = require('fs-extra');
const path = require('path');
const pathResolver = require('../utils/pathResolver');
const policy = require('../config/campaignPolicy');
const { infoLog, warningLog } = require('../utils/logger');

const SKIP = new Set(['leia-me.txt', 'readme.txt', '.gitkeep']);

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(fp);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...listFilesRecursive(fp));
    else out.push(fp);
  }
  return out;
}

function shouldRemoveHanorkStatic(basename) {
  if (basename.startsWith('auto-prod-')) return false;
  if (policy.legacyHanorkStaticPattern.test(basename)) return true;
  if (/^divulga-/i.test(basename)) return true;
  return false;
}

function purgeLegacyCampaignAssets() {
  if (!policy.isProductsOnlyMode()) {
    return { ok: true, skipped: true, reason: 'products_only_off' };
  }

  const base = pathResolver.getMediaDir();
  const removed = [];

  for (const rel of policy.legacyMediaDirs()) {
    const dir = path.join(base, ...rel.split('/'));
    for (const fp of listFilesRecursive(dir)) {
      const name = path.basename(fp).toLowerCase();
      if (SKIP.has(name)) continue;
      try {
        fs.removeSync(fp);
        removed.push(path.relative(base, fp));
      } catch (e) {
        warningLog(`Não removeu ${fp}: ${e.message}`);
      }
    }
  }

  const hanorkDir = path.join(base, 'hanork');
  const hanorkFotos = path.join(base, 'fotos', 'hanork');
  for (const dir of [hanorkDir, hanorkFotos]) {
    if (!fs.existsSync(dir)) continue;
    for (const fp of listFilesRecursive(dir)) {
      const baseName = path.basename(fp);
      if (SKIP.has(baseName.toLowerCase())) continue;
      if (!shouldRemoveHanorkStatic(baseName)) continue;
      try {
        fs.removeSync(fp);
        removed.push(path.relative(base, fp));
      } catch (e) {
        warningLog(`Não removeu ${fp}: ${e.message}`);
      }
    }
  }

  try {
    const rot = require('./rotacao');
    rot.purgeCampaign?.('zero');
  } catch {
    /* ignore */
  }

  if (removed.length) {
    infoLog(`Campanhas legadas: ${removed.length} arquivo(s) removido(s) (modo catálogo Hanork)`);
  }

  return { ok: true, removed: removed.length, files: removed.slice(0, 40) };
}

function applyProductsOnlyBoot() {
  purgeLegacyCampaignAssets();
  try {
    require('../ipc/runtimeSettings').ensureProductsOnlyDefaults();
  } catch {
    /* ignore */
  }
}

module.exports = {
  purgeLegacyCampaignAssets,
  applyProductsOnlyBoot,
};
