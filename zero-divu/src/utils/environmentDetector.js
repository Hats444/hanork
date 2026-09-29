'use strict';

const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

let cached = null;

function commandExists(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function readOsRelease() {
  try {
    return fs.readFileSync('/etc/os-release', 'utf8').toLowerCase();
  } catch {
    return '';
  }
}

function detectWSL() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) return true;
  try {
    const release = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    return release.includes('microsoft') || release.includes('wsl');
  } catch {
    return false;
  }
}

function detectDocker() {
  if (process.env.DOCKER === 'true' || process.env.container === 'docker') return true;
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

function detectUbuntu() {
  if (process.platform !== 'linux') return false;
  const osRelease = readOsRelease();
  return osRelease.includes('ubuntu') || osRelease.includes('debian');
}

/** Ubuntu dentro do Termux (proot-distro) — não é Termux nativo */
function detectProot() {
  if (process.env.PROOT_VERSION) return true;
  try {
    if (fs.existsSync('/.proot-installed')) return true;
    const status = fs.readFileSync('/proc/self/status', 'utf8');
    if (/Name:\s*proot/i.test(status)) return true;
    const maps = fs.readFileSync('/proc/self/maps', 'utf8');
    if (/proot/i.test(maps)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function detectTermux() {
  if (process.platform !== 'linux') return false;

  // WSL / Ubuntu nativo / proot Ubuntu — nunca Termux nativo
  if (detectWSL()) return false;
  if (detectProot() && detectUbuntu()) return false;
  if (detectUbuntu() && !process.env.TERMUX_VERSION) {
    const prefix = String(process.env.PREFIX || '');
    const execPath = process.execPath || '';
    if (!/com\.termux/i.test(prefix) && !/com\.termux/i.test(execPath)) {
      return false;
    }
  }

  if (process.env.TERMUX_VERSION) return true;

  const prefix = String(process.env.PREFIX || '');
  if (/com\.termux/i.test(prefix)) return true;

  if (/com\.termux/i.test(process.execPath || '')) return true;

  // Termux nativo (Android) — sem os-release Ubuntu
  if (!detectUbuntu()) {
    return fs.existsSync('/data/data/com.termux/files/usr/bin/termux-info');
  }

  return false;
}

function detect() {
  const isWSL = detectWSL();
  const isDocker = detectDocker();
  const isProot = detectProot();
  const isTermux = detectTermux();
  const isUbuntu = detectUbuntu();
  const isTermuxProot = isProot && isUbuntu && !isWSL;

  return {
    platform: process.platform,
    arch: process.arch,
    isTermux,
    isTermuxProot,
    isAndroid: isTermux || process.platform === 'android',
    isUbuntu,
    isDebian: isUbuntu,
    isProot,
    isWSL,
    isDocker,
    isWindows: process.platform === 'win32',
    isLinux: process.platform === 'linux',
    hasSystemd: !isTermux && !isWSL && commandExists('systemctl'),
    hasFFmpeg: commandExists('ffmpeg'),
    hasBash: commandExists('bash'),
    hasPm2: commandExists('pm2'),
    shell: process.env.SHELL || (process.platform === 'win32' ? 'cmd' : 'sh'),
    nodeVersion: process.version,
    hostname: os.hostname(),
    homedir: os.homedir(),
    cpus: os.cpus()?.length || 1,
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    runtimeLabel: null,
  };
}

function runtimeLabel(e) {
  if (e.isTermux) return 'Termux';
  if (e.isWSL && e.isUbuntu) return 'Ubuntu (WSL)';
  if (e.isTermuxProot) return 'Ubuntu (proot)';
  if (e.isUbuntu) return 'Ubuntu/Linux';
  if (e.isDocker) return 'Docker';
  if (e.isWindows) return 'Windows';
  return e.platform;
}

exports.detect = detect;

exports.get = () => {
  if (!cached) cached = detect();
  cached.runtimeLabel = runtimeLabel(cached);
  return cached;
};

exports.refresh = () => {
  cached = detect();
  cached.runtimeLabel = runtimeLabel(cached);
  return cached;
};

exports.getRuntimeLabel = () => exports.get().runtimeLabel;

exports.getBootHint = () => {
  const e = exports.get();
  if (e.isTermux) return 'Termux nativo — timers e persistência em modo resiliente';
  if (e.isWSL) return 'WSL detectado — caminhos /mnt/c/… funcionam normalmente';
  if (e.isTermuxProot) return 'Ubuntu via proot — tratado como Linux (não Termux nativo)';
  if (e.isUbuntu) return 'Ubuntu/Linux detectado';
  return null;
};

module.exports = exports;
