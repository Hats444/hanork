'use strict';

/**
 * Smoke IPC contra worker real (shared/zero-ipc).
 * Simula /wa_status, /wa_limites, /wa_delay post 15000, /wa_max 40 e reverte.
 * Uso: node scripts/test-wa-live-ipc.js [--no-revert]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs-extra');
const path = require('path');
const { ZeroDivuClient } = require('../src/plugins/zero-divu/ZeroDivuClient');
const { parseWaArgs } = require('../src/plugins/zero-divu/waCommandParse');
const { sendWaCommand, mutateWa, formatLimitsText, isWorkerOnline } = require('../src/plugins/zero-divu/waIpcHelper');

const ADMIN_ID = 0;
const IPC_DIR = process.env.ZERO_DIVU_IPC_DIR
  ? path.resolve(process.cwd(), process.env.ZERO_DIVU_IPC_DIR)
  : path.join(__dirname, '..', 'shared', 'zero-ipc');
const NO_REVERT = process.argv.includes('--no-revert');

const client = new ZeroDivuClient({ ipcDir: IPC_DIR });
const patchPath = path.join(IPC_DIR, 'config.patch.json');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function mockCtx(text) {
  const m = text.match(/^\/(\w+)(?:@[\w_]+)?\s*(.*)$/is);
  const cmd = m?.[1] || '';
  const payload = (m?.[2] || '').trim();
  return {
    from: { id: ADMIN_ID },
    message: { text },
    match: payload,
  };
}

function readPatch() {
  try {
    return fs.readJsonSync(patchPath);
  } catch {
    return {};
  }
}

async function main() {
  console.log('=== test-wa-live-ipc ===');
  console.log(`IPC: ${IPC_DIR}`);

  const baselineState = client.readState();
  const baselinePatch = readPatch();
  assert(baselineState, 'state.json ausente');
  console.log(
    `Baseline: connected=${baselineState.connected} max=${baselineState.maxGroups} postDelay=${baselineState.postDelayMin}ms`
  );

  assert(isWorkerOnline(client), 'Worker offline — inicie node src/bot.js com ZERO_DIVU_ENABLED=true');

  // Parse layer (mesmo caminho dos handlers Telegram)
  const parseCases = [
    ['/wa_delay post 15000', 'wa_delay', 'post 15000'],
    ['/wa_max 40', 'wa_max', '40'],
    ['/wa_limites', 'wa_limites', ''],
    ['/wa_status', 'wa_status', ''],
  ];
  for (const [text, cmd, expected] of parseCases) {
    const got = parseWaArgs(mockCtx(text), cmd);
    assert(got === expected, `parse ${text}: esperado "${expected}", got "${got}"`);
    console.log(`  ✅ parse ${cmd}`);
  }

  const ping = await client.sendCommand('wa.ping', {}, ADMIN_ID);
  assert(ping.ok, `wa.ping falhou: ${ping.message || ping.error}`);
  console.log('  ✅ wa.ping');

  const statusAck = await sendWaCommand(client, 'wa.get_status', {}, ADMIN_ID, { requireOnline: true });
  assert(statusAck.ok, `wa.get_status: ${statusAck.message}`);
  console.log(
    `  ✅ wa.get_status — ${statusAck.result?.activeGroups ?? '?'}/${statusAck.result?.maxGroups ?? '?'} grupos`
  );

  const limitsBefore = await sendWaCommand(client, 'wa.get_limits', {}, ADMIN_ID, { requireOnline: true });
  assert(limitsBefore.ok, `wa.get_limits: ${limitsBefore.message}`);
  console.log('  ✅ wa.get_limits (antes)');
  console.log(formatLimitsText(limitsBefore.result || {}).replace(/<[^>]+>/g, ''));

  const delayAck = await sendWaCommand(
    client,
    'wa.set_delay',
    { kind: 'post', ms: 15000 },
    ADMIN_ID,
    { requireOnline: true }
  );
  assert(delayAck.ok, `/wa_delay: ${delayAck.message}`);
  assert(delayAck.result?.ms === 15000, `delay ms=${delayAck.result?.ms}`);
  console.log('  ✅ wa.set_delay post 15000');

  const maxAck = await mutateWa(client, 'wa.set_max', { n: 40, max: 40 }, ADMIN_ID);
  assert(maxAck.ok, `/wa_max: ${maxAck.message}`);
  assert(maxAck.result?.maxGroups === 40, `maxGroups=${maxAck.result?.maxGroups}`);
  console.log('  ✅ wa.set_max 40');

  await new Promise((r) => setTimeout(r, 800));

  const st = client.readState();
  assert(st.postDelayMin === 15000, `state postDelayMin=${st.postDelayMin}`);
  assert(st.maxGroups === 40, `state maxGroups=${st.maxGroups}`);

  const patch = readPatch();
  assert(patch.POST_DELAY_MS === 15000, `patch POST_DELAY_MS=${patch.POST_DELAY_MS}`);
  assert(patch.MAX_GROUPS === 40, `patch MAX_GROUPS=${patch.MAX_GROUPS}`);
  console.log('  ✅ state.json + config.patch.json persistidos');

  const limitsAfter = await sendWaCommand(client, 'wa.get_limits', {}, ADMIN_ID, { requireOnline: true });
  assert(limitsAfter.ok, 'wa.get_limits pós-mutação');
  assert(limitsAfter.result?.maxGroups === 40, 'limites maxGroups=40');
  assert(limitsAfter.result?.postDelayMin === 15000, 'limites postDelayMin=15000');
  console.log('  ✅ wa.get_limits (depois) confere 15s / max 40');

  if (!NO_REVERT) {
    const origPost = baselinePatch.POST_DELAY_MS ?? baselineState.postDelayMin ?? 25000;
    const origMax = baselinePatch.MAX_GROUPS ?? baselineState.maxGroups ?? 50;
    await sendWaCommand(client, 'wa.set_delay', { kind: 'post', ms: origPost }, ADMIN_ID, {
      requireOnline: true,
    });
    await mutateWa(client, 'wa.set_max', { n: origMax, max: origMax }, ADMIN_ID);
    console.log(`  ↩ revertido post=${origPost}ms max=${origMax}`);
  } else {
    console.log('  ⚠ --no-revert: valores 15s / 40 mantidos');
  }

  console.log('\n--- live IPC OK ---');
}

main().catch((err) => {
  console.error('\nFALHA:', err.message);
  process.exit(1);
});
