#!/usr/bin/env node
'use strict';

/**
 * Blast personalizado WhatsApp — CLI admin
 *
 * Uso:
 *   node scripts/wa-custom-blast.js "Texto da divulgação"
 *   node scripts/wa-custom-blast.js "Texto" --image /caminho/foto.jpg
 *   node scripts/wa-custom-blast.js "Texto" --session wa_a
 *   node scripts/wa-custom-blast.js "Texto" --all   # wa_a + wa_b (dual)
 */

const path = require('path');
const fs = require('fs');

process.chdir(path.resolve(__dirname, '..'));

require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const { getZeroDivuClient } = require('../src/plugins/zero-divu/ZeroDivuClient');
const { listSpawnableSessions, isDualWaEnabled } = require('../src/plugins/zero-divu/waSessionsManifest');

function parseArgs(argv) {
  const out = { text: '', image: null, sessions: [], all: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--image' || a === '-i') {
      out.image = argv[++i];
    } else if (a === '--session' || a === '-s') {
      out.sessions.push(argv[++i]);
    } else if (a === '--all' || a === '-a') {
      out.all = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      rest.push(a);
    }
  }
  out.text = rest.join(' ').trim();
  return out;
}

async function stageImage(client, imagePath) {
  const abs = path.resolve(imagePath);
  if (!fs.existsSync(abs)) throw new Error(`Imagem não encontrada: ${abs}`);
  client.ensureDir();
  const inbox = path.join(client.ipcDir, 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const name = `cli-${Date.now()}${path.extname(abs) || '.jpg'}`;
  fs.copyFileSync(abs, path.join(inbox, name));
  return name;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.text) {
    console.log(`Uso: node scripts/wa-custom-blast.js "Texto" [--image foto.jpg] [--all] [--session wa_a]

Blast forçado: todos os grupos, sem delay, ignora limite diário.`);
    process.exit(args.help ? 0 : 1);
  }

  let sessions = args.sessions.length ? args.sessions : [listSpawnableSessions()[0]];
  if (args.all || (isDualWaEnabled() && !args.sessions.length)) {
    sessions = listSpawnableSessions();
  }

  const results = [];
  for (const sessionId of sessions) {
    const client = getZeroDivuClient(sessionId);
    const payload = { text: args.text, force: true };
    if (args.image) {
      payload.stagingName = await stageImage(client, args.image);
      if (sessions.length > 1) {
        for (const other of sessions.filter((s) => s !== sessionId)) {
          const otherClient = getZeroDivuClient(other);
          const src = path.join(client.ipcDir, 'inbox', path.basename(payload.stagingName));
          otherClient.ensureDir();
          const inbox = path.join(otherClient.ipcDir, 'inbox');
          fs.mkdirSync(inbox, { recursive: true });
          fs.copyFileSync(src, path.join(inbox, path.basename(payload.stagingName)));
        }
      }
    }
    const ack = await client.sendCommand('wa.custom_blast', payload, null);
    results.push({ sessionId, ack });
  }

  for (const { sessionId, ack } of results) {
    const r = ack.result?.result || ack.result || {};
    if (ack.ok) {
      console.log(`✅ ${sessionId}: blast iniciado · ~${r.total ?? '?'} grupos · job ${r.jobId || '?'}`);
    } else {
      console.error(`❌ ${sessionId}: ${ack.message || ack.error || 'falha'}`);
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
