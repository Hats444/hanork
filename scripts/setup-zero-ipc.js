'use strict';

/**
 * Garante pasta IPC + arquivos vazios. Rode: npm run setup:zero-ipc
 */
const fs = require('fs');
const path = require('path');
require('../src/config/env');
const { ZERO_DIVU_CONFIG } = require('../src/plugins/zero-divu/config');

const ipcDir = ZERO_DIVU_CONFIG.ipcDir;

function writeJson(fp, obj) {
  fs.writeFileSync(fp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function main() {
  fs.mkdirSync(ipcDir, { recursive: true });
  fs.mkdirSync(path.join(ipcDir, 'inbox'), { recursive: true });

  const files = {
    'commands.jsonl': '',
    'events.jsonl': '',
    'commands.ack': {},
    'state.json': {
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
    'config.patch.json': {},
    'wa_runtime.json': {
      hanorkCampaignEnabled: true,
      hanorkAutoSyncEnabled: true,
    },
    'idempotency.json': {},
  };

  for (const [name, def] of Object.entries(files)) {
    const fp = path.join(ipcDir, name);
    if (fs.existsSync(fp)) continue;
    if (typeof def === 'string') {
      fs.writeFileSync(fp, def, 'utf8');
    } else {
      writeJson(fp, def);
    }
  }

  console.log('IPC OK:', ipcDir);
  console.log('ZERO_DIVU_ENABLED=', process.env.ZERO_DIVU_ENABLED || '(unset)');
}

main();
