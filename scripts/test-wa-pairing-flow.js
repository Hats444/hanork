'use strict';

/**
 * Valida fluxo de pairing (Telegram LoginService + IPC events) sem Baileys real.
 * Uso: node scripts/test-wa-pairing-flow.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-pair-test-'));
  const eventsFile = path.join(tmp, 'events.jsonl');

  const mockClient = {
    files: { events: eventsFile },
    readEventsSince(offset = 0) {
      const raw = fs.readFileSync(eventsFile, 'utf8');
      const body = raw.slice(offset);
      const events = body
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      return { events, nextOffset: raw.length };
    },
  };

  // Simula ZeroDivuLoginService poll logic
  let eventOffset = 0;
  const flow = new Map();
  const sent = [];

  function syncOffset() {
    if (fs.existsSync(eventsFile)) {
      eventOffset = fs.statSync(eventsFile).size;
    }
  }

  function poll() {
    const { events, nextOffset } = mockClient.readEventsSince(eventOffset);
    eventOffset = nextOffset;
    for (const ev of events) {
      if (ev.type === 'wa.pairing_code') {
        for (const [uid, s] of flow.entries()) {
          if (s.step !== 'pair' || !(ev.formatted || ev.code)) continue;
          const token = ev.formatted || ev.code;
          if (s.pairCodeSent === token) continue;
          s.pairCodeSent = token;
          sent.push({ uid, token, phone: ev.phone });
        }
      }
      if (ev.type === 'wa.connected') {
        for (const uid of flow.keys()) flow.delete(uid);
      }
    }
  }

  // 1) Fluxo async: waiting → evento pairing_code
  flow.set(123, { step: 'pair', pairPhone: '5511999999999', pairCodeSent: null });
  syncOffset();
  fs.appendFileSync(
    eventsFile,
    `${JSON.stringify({ type: 'wa.pairing_code', phone: '5511999999999', formatted: 'ABCD-EFGH', at: new Date().toISOString() })}\n`
  );
  poll();
  assert(sent.length === 1, 'deveria receber 1 código via poll');
  assert(sent[0].token === 'ABCD-EFGH', 'código incorreto');

  // 2) Dedup: mesmo código não reenvia
  fs.appendFileSync(
    eventsFile,
    `${JSON.stringify({ type: 'wa.pairing_code', phone: '5511999999999', formatted: 'ABCD-EFGH', at: new Date().toISOString() })}\n`
  );
  poll();
  assert(sent.length === 1, 'não deveria duplicar código');

  // 3) Sync path: pairCodeSent antes do poll
  flow.delete(123);
  flow.set(456, { step: 'pair', pairPhone: '5521995930864', pairCodeSent: 'WXYZ-1234' });
  syncOffset();
  fs.appendFileSync(
    eventsFile,
    `${JSON.stringify({ type: 'wa.pairing_code', phone: '5521995930864', formatted: 'WXYZ-1234', at: new Date().toISOString() })}\n`
  );
  poll();
  assert(sent.length === 1, 'sync path não deveria reenviar via poll');

  // 4) connected limpa flow
  fs.appendFileSync(
    eventsFile,
    `${JSON.stringify({ type: 'wa.connected', phone: '5521995930864', at: new Date().toISOString() })}\n`
  );
  poll();
  assert(flow.size === 0, 'flow deveria limpar após connected');

  console.log('✅ test-wa-pairing-flow — todos os cenários OK');
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
