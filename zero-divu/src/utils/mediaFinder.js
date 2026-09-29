'use strict';

const fs = require('fs-extra');
const path = require('path');
const pathResolver = require('./pathResolver');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm']);
const AUDIO_EXT = new Set(['.mp3', '.ogg', '.m4a', '.wav', '.opus']);

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/mp4',
  '.mkv': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.opus': 'audio/ogg',
};

const SKIP = new Set(['leia-me.txt', 'readme.txt', '.ds_store']);

/** Capas geradas (generate_promo_covers.py) — ignorar; divulgação usa menu ou /foto_* manual. */
const AUTO_PROMO_COVER_RE =
  /^(hanork|ssm|smm|virtuo|nums|wadv|div)[-_]\d{1,2}\.(jpe?g|png|webp)$/i;

function isAutoPromoCover(name) {
  return AUTO_PROMO_COVER_RE.test(String(name || ''));
}

function filterPromoCovers(files) {
  return (files || []).filter((fp) => !isAutoPromoCover(path.basename(fp)));
}

function mediaDirs(type, hint) {
  const root = pathResolver.getProjectRoot();
  const base = pathResolver.getMediaDir();
  const h = hint ? String(hint).toLowerCase() : '';
  if (h === 'hanork') {
    return [
      path.join(base, 'fotos', 'hanork'),
      path.join(base, 'hanork'),
    ];
  }
  if (h === 'zero' || h === 'auto' || h === 'alternar' || h === 'alternate') {
    return [
      path.join(base, 'fotos', 'zero'),
      path.join(base, 'fotos', 'divu'),
      path.join(base, 'imagens'),
      path.join(base, 'images'),
      path.join(root, 'media', 'imagens'),
    ];
  }
  const map = {
    image: [
      path.join(base, 'fotos', 'zero'),
      path.join(base, 'fotos', 'divu'),
      path.join(base, 'imagens'),
      path.join(base, 'images'),
      path.join(root, 'media', 'imagens'),
    ],
    video: [path.join(base, 'videos'), path.join(root, 'media', 'videos')],
    audio: [path.join(base, 'audios'), path.join(root, 'media', 'audios')],
  };
  return map[type] || map.image;
}

function resolvePath(rel) {
  if (!rel) return null;
  const root = pathResolver.getProjectRoot();
  const candidates = [
    path.isAbsolute(rel) ? rel : path.join(root, rel),
    path.join(root, 'src', rel),
    path.join(pathResolver.getMediaDir(), rel.replace(/^media\//, '')),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function listInDir(dir, extSet) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => {
      const lower = name.toLowerCase();
      if (SKIP.has(lower)) return false;
      return extSet.has(path.extname(lower));
    })
    .map((name) => path.join(dir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function scanType(type, hint) {
  const extSet = type === 'video' ? VIDEO_EXT : type === 'audio' ? AUDIO_EXT : IMAGE_EXT;
  for (const dir of mediaDirs(type, hint)) {
    let files = listInDir(dir, extSet);
    if (type === 'image' && String(hint).toLowerCase() === 'hanork') {
      files = filterPromoCovers(files);
    }
    if (files.length) return files;
  }
  if (type === 'image' && String(hint).toLowerCase() === 'hanork') {
    try {
      const menu = require('../services/menuPhotoFallback').nextMenuPhotoPath();
      if (menu) return [menu];
    } catch {
      /* ignore */
    }
  }
  return [];
}

exports.guessMime = (filePath) => MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

exports.findMedia = (type = 'image', hint) => {
  const h = hint ? String(hint).toLowerCase() : '';
  if (h && h !== 'auto' && h !== 'alternar' && h !== 'zero' && h !== 'hanork') {
    const resolved = resolvePath(hint);
    if (resolved) {
      try {
        if (fs.statSync(resolved).isFile()) return resolved;
      } catch {
        /* ignore */
      }
    }
  }
  const files = scanType(type, hint);
  return files[0] || null;
};

exports.listMedia = (type = 'image', hint) => scanType(type, hint);

exports.hasMediaType = (type, hint) => scanType(type, hint).length > 0;

exports.getAvailableStatusTypes = (hint) => {
  const types = [];
  if (exports.hasMediaType('image', hint)) types.push('image');
  if (exports.hasMediaType('video', hint)) types.push('video');
  if (exports.hasMediaType('audio', hint)) types.push('audio');
  return types;
};

exports.resolveMedia = (rel, type = 'image') => exports.findMedia(type, rel);

exports.listAll = () => ({
  fotosZero: scanType('image', 'zero'),
  fotosHanork: scanType('image', 'hanork'),
  images: scanType('image'),
  videos: scanType('video'),
  audios: scanType('audio'),
});

exports.describeMedia = (filePath) => {
  if (!filePath) return 'nenhuma mídia encontrada';
  const ext = path.extname(filePath).toLowerCase();
  const size = Math.round(fs.statSync(filePath).size / 1024);
  return `${path.basename(filePath)} (${ext}, ${size} KB)`;
};

module.exports = exports;
