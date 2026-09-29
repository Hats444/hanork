'use strict';

const fs = require('fs-extra');
const mediaFinder = require('./mediaFinder');

let cached = { path: null, buffer: null, mtime: 0 };

exports.getMediaBuffer = async (type = 'image', hint) => {
  const filePath = mediaFinder.findMedia(type, hint);
  if (!filePath) return { filePath: null, buffer: null };

  const stat = await fs.stat(filePath);
  if (cached.path === filePath && cached.mtime === stat.mtimeMs && cached.buffer) {
    return { filePath, buffer: cached.buffer };
  }

  const buffer = await fs.readFile(filePath);
  cached = { path: filePath, buffer, mtime: stat.mtimeMs };
  return { filePath, buffer };
};

exports.invalidate = () => {
  cached = { path: null, buffer: null, mtime: 0 };
};
