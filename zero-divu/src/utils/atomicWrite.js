'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jsonWriteLock = require('./jsonWriteLock');

function checksum(data) {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

function lockName(filePath) {
  return path.basename(filePath);
}

function rotateBackups(filePath, retain = 3) {
  if (retain < 2) return;
  for (let i = retain - 1; i >= 1; i--) {
    const from = i === 1 ? `${filePath}.bak` : `${filePath}.bak.${i - 1}`;
    const to = `${filePath}.bak.${i}`;
    if (!fs.existsSync(from)) continue;
    try {
      fs.copyFileSync(from, to);
    } catch {
      /* ignore */
    }
  }
}

function writeJsonAtomic(filePath, data, { backup = true, spaces = 2, backupRetain = 3, useLock = true } = {}) {
  const writeBody = () => {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const content = JSON.stringify(data, null, spaces);
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const metaPath = `${filePath}.meta.json`;

    fs.writeFileSync(tmp, content, 'utf8');

    if (backup && fs.existsSync(filePath)) {
      rotateBackups(filePath, backupRetain);
      const bak = `${filePath}.bak`;
      try {
        fs.copyFileSync(filePath, bak);
      } catch {
        /* ignore */
      }
    }

    fs.renameSync(tmp, filePath);

    try {
      fs.writeFileSync(
        metaPath,
        JSON.stringify({ checksum: checksum(content), at: new Date().toISOString() }, null, 2)
      );
    } catch {
      /* ignore */
    }

    return filePath;
  };

  if (useLock) {
    return jsonWriteLock.withLock(lockName(filePath), writeBody);
  }
  return writeBody();
}
function readJsonSafe(filePath, fallback) {
  const load = (p) => {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  };

  const candidates = [filePath];
  for (let i = 0; i < 5; i++) {
    candidates.push(i === 0 ? `${filePath}.bak` : `${filePath}.bak.${i}`);
  }

  for (const p of candidates) {
    try {
      const data = load(p);
      if (data !== null) {
        if (p !== filePath) writeJsonAtomic(filePath, data, { backup: false });
        return data;
      }
    } catch {
      /* try next backup */
    }
  }

  return typeof fallback === 'function' ? fallback() : JSON.parse(JSON.stringify(fallback));
}

module.exports = { writeJsonAtomic, readJsonSafe, checksum };
