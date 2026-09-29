#!/usr/bin/env node
'use strict';

/**
 * Valida que ZeroDivuClient inclui ZERO_IPC_TOKEN nos comandos IPC.
 * Uso: node scripts/test-zero-ipc-auth.js
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const HANORK_ROOT = path.resolve(__dirname, '..');
const TMP_IPC = path.join(os.tmpdir(), `hanork-ipc-auth-${Date.now()}`);
const TEST_TOKEN = 'hanork-test-ipc-token';

process.env.ZERO_DIVU_IPC_DIR = TMP_IPC;
process.env.ZERO_IPC_TOKEN = TEST_TOKEN;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const clientPath = path.join(HANORK_ROOT, 'src', 'plugins', 'zero-divu', 'ZeroDivuClient.js');
  delete require.cache[require.resolve(clientPath)];
  const { ZeroDivuClient, buildCommandPayload } = require(clientPath);

  await fs.ensureDir(TMP_IPC);

  const payload = buildCommandPayload('wa.ping', {}, 42, 'test-id');
  assert(payload.token === TEST_TOKEN, 'buildCommandPayload deve incluir token');
  assert(payload.cmd === 'wa.ping', 'cmd preservado');

  delete process.env.ZERO_IPC_TOKEN;
  delete require.cache[require.resolve(path.join(HANORK_ROOT, 'src', 'plugins', 'zero-divu', 'config.js'))];
  delete require.cache[require.resolve(clientPath)];
  const { buildCommandPayload: buildWithoutToken } = require(clientPath);
  const noToken = buildWithoutToken('wa.ping', {}, null, 'id-2');
  assert(noToken.token == null, 'sem ZERO_IPC_TOKEN não deve incluir campo token');

  process.env.ZERO_IPC_TOKEN = TEST_TOKEN;
  delete require.cache[require.resolve(path.join(HANORK_ROOT, 'src', 'plugins', 'zero-divu', 'config.js'))];
  delete require.cache[require.resolve(clientPath)];
  const { ZeroDivuClient: Client2 } = require(clientPath);
  const client = new Client2({ ipcDir: TMP_IPC, commandTimeoutMs: 200 });
  client.ensureDir();

  const line = JSON.stringify(buildCommandPayload('wa.ping', {}, 0, 'write-test'));
  await fs.appendFile(path.join(TMP_IPC, 'commands.jsonl'), `${line}\n`, 'utf8');
  const raw = await fs.readFile(path.join(TMP_IPC, 'commands.jsonl'), 'utf8');
  const parsed = JSON.parse(raw.trim().split('\n').pop());
  assert(parsed.token === TEST_TOKEN, 'payload gravado deve incluir token');
  assert(parsed.cmd === 'wa.ping', 'cmd em commands.jsonl');

  console.log('test-zero-ipc-auth: OK');
}

main()
  .catch((e) => {
    console.error('test-zero-ipc-auth: FALHA —', e.message);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await fs.remove(TMP_IPC);
    } catch {
      /* ignore */
    }
  });
