'use strict';

const fs = require('fs-extra');
const path = require('path');
const pathResolver = require('../utils/pathResolver');
const mediaFinder = require('../utils/mediaFinder');
const { infoLog, warningLog, successLog } = require('../utils/logger');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => IMAGE_EXT.has(path.extname(n.toLowerCase())))
    .map((n) => path.join(dir, n));
}

/** Garante mídia Hanork em src/media/hanork (copia de fotos/hanork se faltar). */
exports.ensureHanorkMedia = () => {
  const base = pathResolver.getMediaDir();
  const sources = [
    path.join(base, 'fotos', 'hanork'),
    path.join(base, 'hanork'),
  ];
  const target = path.join(base, 'hanork');
  fs.ensureDirSync(target);

  let copied = 0;
  const seen = new Set(fs.readdirSync(target));

  for (const srcDir of sources) {
    if (!fs.existsSync(srcDir)) continue;
    for (const file of listImages(srcDir)) {
      const name = path.basename(file);
      if (seen.has(name)) continue;
      try {
        fs.copyFileSync(file, path.join(target, name));
        seen.add(name);
        copied++;
      } catch {
        /* ignore */
      }
    }
  }

  const hanorkCount = mediaFinder.listMedia('image', 'hanork').length;
  const zeroCount = mediaFinder.listMedia('image', 'zero').length;

  if (copied > 0) {
    successLog(`Mídia Hanork: ${copied} arquivo(s) copiado(s) para media/hanork/`);
  }

  if (hanorkCount === 0) {
    warningLog(
      'Campanha Hanork sem imagens em media/hanork/ ou media/fotos/hanork/ — posts Hanork podem ir só texto'
    );
    return { ok: false, hanorkCount, zeroCount, copied };
  }

  if (copied === 0 && hanorkCount > 0) {
    infoLog(`Mídia OK: Hanork ${hanorkCount} · Zero ${zeroCount} imagem(ns)`);
  }

  return { ok: true, hanorkCount, zeroCount, copied };
};

module.exports = exports;
