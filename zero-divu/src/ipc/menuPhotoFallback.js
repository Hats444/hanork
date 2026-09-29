'use strict';

const fs = require('fs');
const path = require('path');

const MENU_FILE_RE = /^menu(\d*)\.(jpe?g|png|webp)$/i;

let rotateIdx = 0;
let cachedPaths = null;
let cachedFingerprint = '';

function menuSortKey(filename) {
  const m = String(filename).match(/^menu(\d*)\./i);
  if (!m) return 9999;
  if (m[1] === '') return 1;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 9999;
}

function infosSearchDirs() {
  const dirs = [];
  const envDir = process.env.HANORK_INFOS_DIR || process.env.ZERO_DIVU_INFOS_DIR;
  if (envDir) dirs.push(path.resolve(envDir));

  const zeroRoot = path.resolve(__dirname, '../..');
  dirs.push(path.join(zeroRoot, 'infos'));
  dirs.push(path.join(zeroRoot, '..', 'infos'));
  dirs.push(path.join(zeroRoot, '..', '..', 'infos'));

  return [...new Set(dirs)];
}

function dirsFingerprint(dirs) {
  const parts = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      parts.push(`${path.normalize(dir)}:${fs.statSync(dir).mtimeMs}`);
    } catch {
      /* ignore */
    }
  }
  return parts.join('|');
}

function collectMenuPaths() {
  const dirs = infosSearchDirs();
  const seen = new Set();
  const found = [];

  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!MENU_FILE_RE.test(name)) continue;
      const fp = path.join(dir, name);
      const norm = path.normalize(fp);
      if (seen.has(norm)) continue;
      seen.add(norm);
      found.push(norm);
    }
  }

  found.sort((a, b) => {
    const ka = menuSortKey(path.basename(a));
    const kb = menuSortKey(path.basename(b));
    if (ka !== kb) return ka - kb;
    return path.basename(a).localeCompare(path.basename(b), undefined, { sensitivity: 'base' });
  });

  return found;
}

function warmCache() {
  const fp = dirsFingerprint(infosSearchDirs());
  if (cachedPaths && cachedFingerprint === fp) return cachedPaths;
  cachedFingerprint = fp;
  cachedPaths = collectMenuPaths();
  return cachedPaths;
}

/** Próxima foto de menu (rotação automática de menu*.jpg/png) — fallback quando produto não tem foto */
exports.nextMenuPhotoPath = () => {
  const files = warmCache();
  if (!files.length) return null;
  const fp = files[rotateIdx % files.length];
  rotateIdx = (rotateIdx + 1) % files.length;
  return fp;
};

exports.resetCache = () => {
  cachedPaths = null;
  cachedFingerprint = '';
  rotateIdx = 0;
};

module.exports = exports;
