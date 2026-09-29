'use strict';

const fs = require('fs-extra');
const path = require('path');
const cfg = require('../config/divulgacao');
const { infoLog, warningLog } = require('../utils/logger');

function credsPath() {
  return path.join(process.cwd(), cfg.SESSION_DIR || './database/session', 'creds.json');
}

function backupPath() {
  return `${credsPath()}.bak`;
}

/** Remove backup — evita restore de sessão inválida após logout/401 */
exports.purge = () => {
  const bak = backupPath();
  try {
    if (fs.existsSync(bak)) fs.removeSync(bak);
  } catch {
    /* ignore */
  }
};

exports.getBackupPath = backupPath;

function hasMe(creds) {
  return Boolean(creds?.me?.id);
}

/** Cópia de segurança — não apaga login */
exports.backup = () => {
  const src = credsPath();
  if (!fs.existsSync(src)) return false;
  try {
    const data = fs.readJsonSync(src);
    if (!hasMe(data)) return false;
    fs.writeJsonSync(backupPath(), data, { spaces: 2 });
    return true;
  } catch {
    return false;
  }
};

/** Restaura backup se creds atuais perderam o login */
exports.restoreIfNeeded = () => {
  const src = credsPath();
  const bak = backupPath();

  let live = null;
  try {
    if (fs.existsSync(src)) live = fs.readJsonSync(src);
  } catch {
    live = null;
  }

  if (hasMe(live)) return false;

  if (!fs.existsSync(bak)) return false;

  try {
    const saved = fs.readJsonSync(bak);
    if (!hasMe(saved)) return false;
    fs.ensureDirSync(path.dirname(src));
    fs.writeJsonSync(src, saved, { spaces: 2 });
    infoLog(`Sessão restaurada do backup (${String(saved.me.id).split(':')[0]})`);
    return true;
  } catch (e) {
    warningLog(`Backup de sessão indisponível: ${e.message}`);
    return false;
  }
};

module.exports = exports;
