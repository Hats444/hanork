'use strict';

const fs = require('fs');
const path = require('path');

function ipcDir() {
  return (
    process.env.ZERO_DIVU_IPC_DIR ||
    path.resolve(__dirname, '../../../shared/zero-ipc')
  );
}

function appendWaOpsEvent(event) {
  try {
    const dir = ipcDir();
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: Date.now(),
      channel: 'wa',
      ...event,
    });
    fs.appendFileSync(path.join(dir, 'ops-events.jsonl'), `${line}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

module.exports = { appendWaOpsEvent, ipcDir };
