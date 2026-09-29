'use strict';

const path = require('path');
const fs = require('fs');

let loaded = false;

function loadEnv() {
  if (loaded) return;
  const root = path.join(__dirname, '../..');
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    try {
      require('dotenv').config({ path: envPath, quiet: true });
    } catch {
      const raw = fs.readFileSync(envPath, 'utf8');
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i < 1) continue;
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (process.env[k] == null || process.env[k] === '') process.env[k] = v;
      }
    }
  }
  loaded = true;
}

loadEnv();

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(v).trim().toLowerCase());
}

function getIpcToken() {
  const v = process.env.ZERO_IPC_TOKEN;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

function isIpcAuthRequired() {
  return envBool('ZERO_IPC_AUTH_REQUIRED', false);
}

module.exports = { loadEnv, envBool, getIpcToken, isIpcAuthRequired };
