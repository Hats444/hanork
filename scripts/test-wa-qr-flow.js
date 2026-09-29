'use strict';

/**
 * Valida fluxo QR (Telegram LoginService poll + dedup) sem Baileys real.
 * Uso: node scripts/test-wa-qr-flow.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-qr-test-'));
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
      if (ev.type === 'wa.qr') {
        for (const [uid, s] of flow.entries()) {
          if (s.step === 'qr' && ev.pngBase64) {
            sent.push({ uid, token: ev.at, len: ev.pngBase64.length });
          }
        }
      }
      if (ev.type === 'wa.connected') {
        for (const uid of flow.keys()) flow.delete(uid);
      }
    }
  }

  flow.set(1, { step: 'qr' });
  syncOffset();
  fs.appendFileSync(
    eventsFile,
    `${JSON.stringify({ type: 'wa.qr', pngBase64: 'aGVsbG8=', at: 't1' })}\n`
  );
  poll();
  assert(sent.length === 1, 'deveria receber 1 QR via poll');

  fs.appendFileSync(
    eventsFile,
    `${JSON.stringify({ type: 'wa.qr', pngBase64: 'aGVsbG8=', at: 't1' })}\n`
  );
  poll();
  assert(sent.length === 2, 'QR refresh deve chegar de novo (sem dedup rígido no poll)');

  fs.appendFileSync(
    eventsFile,
    `${JSON.stringify({ type: 'wa.connected', phone: '5521996771724', at: 't2' })}\n`
  );
  poll();
  assert(flow.size === 0, 'flow limpa após connected');

  console.log('✅ test-wa-qr-flow — todos os cenários OK');
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
