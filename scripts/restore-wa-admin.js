'use strict';
/**
 * Restaura wa_a + wa_b sem apagar sessão.
 * Uso: cd /home/vendetta/hanork && node scripts/restore-wa-admin.js
 */
process.chdir('/home/vendetta/hanork');
require('dotenv').config({ path: '/home/vendetta/hanork/.env' });

const spawn = require('../src/plugins/zero-divu/spawnZeroWorker');

async function waitMs(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitSessionOnline(sessionId, maxMs = 90000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const h = spawn.readSessionHealth?.(sessionId);
    if (h?.ipcFresh && h?.pidAlive) return h;
    spawn.ensureSessionWorker(sessionId);
    await waitMs(3000);
  }
  return spawn.readSessionHealth?.(sessionId);
}

async function waitConnected(sessionId, maxMs = 120000) {
  const { getZeroDivuClient } = require('../src/plugins/zero-divu/ZeroDivuClient');
  const client = getZeroDivuClient(sessionId);
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const st = client.readState();
    if (st?.connected) {
      console.log(`[${sessionId}] OK connected phone=${st.phone}`);
      return true;
    }
    const r = await client.sendCommand('wa.reconnect_session', {}, 0, { timeoutMs: 15000 }).catch(() => null);
    console.log(`[${sessionId}] reconnect_session ok=${r?.ok} err=${r?.error || ''}`);
    await waitMs(5000);
  }
  const st = client.readState();
  console.log(`[${sessionId}] FAIL connected=${st?.connected}`);
  return false;
}

(async () => {
  console.log('=== restore-wa-admin ===');
  const r = await spawn.ensureAllSessionWorkers(90000);
  console.log('ensureAllSessionWorkers:', JSON.stringify(r));

  for (const sid of ['wa_a', 'wa_b']) {
    const h = await waitSessionOnline(sid);
    console.log(`[${sid}] worker online:`, JSON.stringify(h));
  }

  let ok = 0;
  for (const sid of ['wa_a', 'wa_b']) {
    if (await waitConnected(sid)) ok += 1;
  }

  console.log(`Done: ${ok}/2 connected`);
  process.exit(ok === 2 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
