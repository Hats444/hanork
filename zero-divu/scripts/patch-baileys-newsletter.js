'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../node_modules/@kurtucoben/baileys');
const messagesPath = path.join(root, 'lib/Utils/messages.js');
const indexPath = path.join(root, 'lib/index.js');

const MSG_MARKER = 'zero-divu: no default newsletter annotations';
const BANNER_MARKER = 'zero-divu: silent banner';

if (!fs.existsSync(root)) {
  console.warn('[patch-baileys] @kurtucoben/baileys não instalado');
  process.exit(0);
}

function patchMessages() {
  if (!fs.existsSync(messagesPath)) return false;
  let src = fs.readFileSync(messagesPath, 'utf8');
  if (src.includes(MSG_MARKER)) return true;

  if (!src.includes('newsletterName: "Kurtu Coben"')) return false;

  const replacement = `    const uploadData = {
        ...message,
        /* ${MSG_MARKER} */
        ...(message.annotations ? { annotations: message.annotations } : {}),
        media: message[mediaType]
    };`;

  const pattern =
    /const uploadData = \{\s*\.\.\.message,\s*\.\.\.\(message\.annotations \? \{[\s\S]*?newsletterName: "Kurtu Coben",[\s\S]*?\}\),\s*media: message\[mediaType\]\s*\};/;

  if (!pattern.test(src)) return false;
  src = src.replace(pattern, replacement);
  fs.writeFileSync(messagesPath, src, 'utf8');
  console.log('[patch-baileys] Canal KurtuCoben removido (messages.js)');
  return true;
}

function patchBanner() {
  if (!fs.existsSync(indexPath)) return false;
  let src = fs.readFileSync(indexPath, 'utf8');
  if (src.includes(BANNER_MARKER)) return true;

  const next = src.replace(
    /eval\(Buffer\.from\([\s\S]*?\)\.toString\(\)\);\s*/,
    `/* ${BANNER_MARKER} */\n`
  );
  if (next === src) return false;
  fs.writeFileSync(indexPath, next, 'utf8');
  console.log('[patch-baileys] Banner da lib suprimido (index.js)');
  return true;
}

patchMessages();
patchBanner();
console.log('[patch-baileys] Concluído');
