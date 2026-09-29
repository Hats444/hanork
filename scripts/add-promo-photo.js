#!/usr/bin/env node
'use strict';

/**
 * Adiciona imagem de divulgação Hanork ou SMM em pastas separadas.
 *
 * Uso:
 *   node scripts/add-promo-photo.js hanork ./minha-foto.jpg
 *   node scripts/add-promo-photo.js smm ./capa-smm.png --slot 3
 *   node scripts/add-promo-photo.js --status
 */

const fs = require('fs');
const path = require('path');

process.chdir(path.resolve(__dirname, '..'));
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const {
  savePromoPhoto,
  formatStatusText,
  reloadWaAfterUpload,
  PROMO_TYPES,
} = require('../src/services/promoPhotoUploadService');

function parseArgs(argv) {
  const out = { status: false, type: null, file: null, slot: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--status' || a === '-s') out.status = true;
    else if (a === '--slot' || a === '-n') out.slot = Number(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else rest.push(a);
  }
  if (rest[0] === 'hanork' || rest[0] === 'smm') {
    out.type = rest[0];
    out.file = rest[1] || null;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`Uso:
  node scripts/add-promo-photo.js hanork caminho/foto.jpg [--slot N]
  node scripts/add-promo-photo.js smm caminho/foto.jpg [--slot N]
  node scripts/add-promo-photo.js --status

Hanork → fotos/hanork/ + zero-divu/src/media/hanork/
SMM    → fotos/ssm/ + zero-divu/src/media/ssm/  (nunca mistura)`);
    process.exit(0);
  }

  if (args.status) {
    console.log(formatStatusText().replace(/<[^>]+>/g, ''));
    process.exit(0);
  }

  if (!args.type || !PROMO_TYPES[args.type]) {
    console.error('Informe hanork ou smm');
    process.exit(1);
  }
  if (!args.file) {
    console.error('Informe o caminho da imagem');
    process.exit(1);
  }

  const abs = path.resolve(args.file);
  if (!fs.existsSync(abs)) {
    console.error(`Arquivo não encontrado: ${abs}`);
    process.exit(1);
  }

  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs) || '.jpg';
  const norm = args.slot != null ? require('../src/services/promoPhotoUploadService').normalizeSlot(args.slot, args.type) : null;
  if (args.slot != null && !norm) {
    console.error('Slot inválido (use 1–20)');
    process.exit(1);
  }
  const result = savePromoPhoto(args.type, buf, { slot: norm?.slot ?? args.slot, ext });

  if (!result.ok) {
    console.error(result.message || result.error);
    process.exit(1);
  }

  console.log(`✅ ${result.label}: ${result.fileName} (slot ${result.slot})`);
  console.log(`   ${result.paths.length} pasta(s):`);
  for (const p of result.paths) console.log(`   · ${p}`);

  const wa = await reloadWaAfterUpload(args.type);
  for (const w of wa) {
    console.log(w.ok ? `   WA ${w.sessionId}: config recarregada` : `   WA: ${w.error || 'skip'}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
