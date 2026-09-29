'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const results = [];

function ok(name, detail = '') {
  results.push({ ok: true, name, detail });
  console.log(`[OK] ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ ok: false, name, detail });
  console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  // 1. Always-on
  const alwaysOn = require('../src/modules/wa-divulgacao/waDivulgacaoAlwaysOnService');
  if (alwaysOn.isEnabled()) ok('WA_DIVULGACAO_ALWAYS_ON');
  else fail('WA_DIVULGACAO_ALWAYS_ON', 'desligado');

  const ids = alwaysOn.listActiveSubscriberTelegramIds();
  ok('assinantes ativos', `${ids.length} subscriber(s)`);

  for (const tid of ids) {
    const stPath = path.join(
      process.env.HOME || '/home/vendetta',
      '.hanork',
      'wa-users',
      String(tid),
      'ipc',
      'state.json'
    );
    let st = {};
    try {
      st = JSON.parse(fs.readFileSync(stPath, 'utf8'));
    } catch {
      fail(`state.json ${tid}`, 'ausente');
      continue;
    }
    const age = st.updatedAt ? Math.round((Date.now() - new Date(st.updatedAt)) / 1000) : 999;
    const staleMs = Number(process.env.WA_DIVULGACAO_WORKER_STALE_MS) || 45000;
    if (st.ipcOnline && age * 1000 < staleMs) {
      ok(`worker ${tid}`, `ipcOnline connected=${st.connected} age=${age}s phone=${st.phone || '-'}`);
    } else if (st.ipcOnline) {
      fail(`worker ${tid}`, `stale age=${age}s`);
    } else {
      fail(`worker ${tid}`, 'ipcOnline=false');
    }
  }

  // 2. Notifier dual
  const { createAdminActivityNotifier } = require('../src/telegram/admin/AdminActivityNotifier');
  const n = createAdminActivityNotifier({
    token: process.env.TOKEN_TELEGRAM_NOTIFY,
    fallbackToken: process.env.TOKEN_TELEGRAM,
    adminIds: (process.env.ADMIN_NOTIFY_IDS || '')
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter(Boolean),
  });
  if (n.mirrorTelegram && n.mainTelegram) ok('notifier dual-bot', 'mirror + main');
  else fail('notifier dual-bot');
  if (n.isConsoleMirrorEnabled()) ok('ADMIN_NOTIFY_CONSOLE_MIRROR');
  else fail('ADMIN_NOTIFY_CONSOLE_MIRROR');

  // 3. Copy messages — no worker jargon
  const Copy = require('../src/modules/wa-divulgacao/waDivulgacaoCopy');
  const msgs = [
    Copy.workerPreparingMessage(),
    Copy.waIpcRetryMessage(),
    Copy.planExpiredMessage(),
  ];
  const bad = /worker offline|ZERO_DIVU|IPC/i.test(msgs.join(' '));
  if (!bad) ok('mensagens assinante sem jargão técnico');
  else fail('mensagens assinante', 'contém termo proibido');

  // 4. IPC ping for first subscriber
  if (ids.length) {
    const { getWaDivulgacaoClient } = require('../src/modules/wa-divulgacao/waDivulgacaoClient');
    const { client } = getWaDivulgacaoClient(ids[0]);
    const ping = await client.sendCommand('wa.ping', {}, ids[0], { timeoutMs: 8000 }).catch(() => null);
    if (ping?.ok) ok(`wa.ping ${ids[0]}`, `pid=${ping.result?.pid || '?'}`);
    else fail(`wa.ping ${ids[0]}`, ping?.message || ping?.error || 'timeout');
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\ntest-approval-suite: ${passed}/${total} OK`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
