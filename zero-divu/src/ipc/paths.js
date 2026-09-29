'use strict';

const fs = require('fs-extra');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function resolveIpcDir() {
  const fromEnv = process.env.ZERO_DIVU_IPC_DIR;
  if (fromEnv && String(fromEnv).trim()) {
    const raw = String(fromEnv).trim();
    if (raw.startsWith('./') || raw.startsWith('.\\')) {
      return path.resolve(ROOT, raw);
    }
    if (raw.startsWith('../') || raw.startsWith('..\\')) {
      return path.resolve(ROOT, raw);
    }
    return path.resolve(raw);
  }
  return path.resolve(ROOT, '..', 'shared', 'zero-ipc');
}

const IPC_DIR = resolveIpcDir();

const FILES = {
  commands: path.join(IPC_DIR, 'commands.jsonl'),
  ack: path.join(IPC_DIR, 'commands.ack'),
  events: path.join(IPC_DIR, 'events.jsonl'),
  state: path.join(IPC_DIR, 'state.json'),
  configPatch: path.join(IPC_DIR, 'config.patch.json'),
};

function ensureDir() {
  fs.ensureDirSync(IPC_DIR);
  for (const key of ['commands', 'events']) {
    const fp = FILES[key];
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, '', 'utf8');
  }
  if (!fs.existsSync(FILES.ack)) {
    fs.writeJsonSync(FILES.ack, {}, { spaces: 2 });
  }
  if (!fs.existsSync(FILES.state)) {
    fs.writeJsonSync(
      FILES.state,
      {
        updatedAt: null,
        ipcOnline: false,
        connected: false,
        phone: null,
        profile: 'safe',
        maxGroups: 20,
        activeGroups: 0,
        paused: false,
        lastPostAt: null,
        workerPid: null,
      },
      { spaces: 2 }
    );
  }
  if (!fs.existsSync(FILES.configPatch)) {
    fs.writeJsonSync(FILES.configPatch, {}, { spaces: 2 });
  }
}

module.exports = { IPC_DIR, FILES, ensureDir, ROOT };
