'use strict';

const { execSync } = require('child_process');
const env = require('./environmentDetector');

let cached = null;

function hasCmd(cmd) {
  try {
    if (process.platform === 'win32') {
      execSync(`where ${cmd}`, { stdio: 'ignore' });
    } else {
      execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

function probe() {
  const e = env.get();
  return {
    ffmpeg: e.hasFFmpeg,
    bash: e.hasBash,
    pm2: e.hasPm2,
    systemd: e.hasSystemd,
    termuxApi: e.isTermux && hasCmd('termux-api'),
    imagemagick: hasCmd('convert') || hasCmd('magick'),
  };
}
exports.get = () => {
  if (!cached) cached = probe();
  return cached;
};

exports.refresh = () => {
  cached = probe();
  return cached;
};

exports.logSummary = () => {
  const d = exports.get();
  const e = env.get();
  const parts = [
    e.runtimeLabel || e.platform,
    e.arch,
    d.ffmpeg ? 'ffmpeg' : 'sem-ffmpeg',
  ];
  return parts.join(' · ');
};

module.exports = exports;
