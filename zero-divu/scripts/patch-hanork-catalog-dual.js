'use strict';

const fs = require('fs');

const HANORK = '/home/vendetta/hanork';
const syncPath = `${HANORK}/src/plugins/zero-divu/hanorkAutoSync.js`;
const aiPath = `${HANORK}/src/plugins/zero-divu/catalogAiSync.js`;
const catalogMirrorPath = `${HANORK}/src/plugins/zero-divu/waCatalogMirror.js`;

const mirrorModule = `'use strict';

const fs = require('fs-extra');
const path = require('path');
const { listSpawnableSessions, resolveSession } = require('./waSessionsManifest');

const CATALOG_FILE = 'hanork_auto_catalog.json';

async function writeCatalogToAllWaSessions(payload) {
  const written = [];
  for (const sessionId of listSpawnableSessions()) {
    try {
      const conf = resolveSession(sessionId);
      await fs.ensureDir(conf.ipcDir);
      const outPath = path.join(conf.ipcDir, CATALOG_FILE);
      await fs.writeJson(outPath, payload, { spaces: 2 });
      written.push(outPath);
    } catch {
      /* sessão opcional */
    }
  }
  return written;
}

module.exports = { CATALOG_FILE, writeCatalogToAllWaSessions };
`;

fs.writeFileSync(catalogMirrorPath, mirrorModule, 'utf8');
console.log('Created waCatalogMirror.js');

let sync = fs.readFileSync(syncPath, 'utf8');
if (!sync.includes("require('./waCatalogMirror')")) {
  sync = sync.replace(
    "const { getZeroDivuClient } = require('./ZeroDivuClient');",
    "const { getZeroDivuClient } = require('./ZeroDivuClient');\nconst { writeCatalogToAllWaSessions } = require('./waCatalogMirror');"
  );
}

if (!sync.includes('writeCatalogToAllWaSessions(payload)')) {
  sync = sync.replace(
    '  const outPath = path.join(client.ipcDir, CATALOG_FILE);\n  await fs.writeJson(outPath, payload, { spaces: 2 });\n\n  return { ok: true, count: variacoes.length, skippedNoPhoto, eligible: active.length, path: outPath };',
    '  const paths = await writeCatalogToAllWaSessions(payload);\n  const outPath = paths[0] || path.join(client.ipcDir, CATALOG_FILE);\n\n  return { ok: true, count: variacoes.length, skippedNoPhoto, eligible: active.length, path: outPath, paths };'
  );
}

if (sync.includes('writeHanorkOnlyCatalogFile(hanorkOnlyProduct')) {
  sync = sync.replace(
    `    const outPath = path.join(client.ipcDir, CATALOG_FILE);
    const payload = writeHanorkOnlyCatalogFile(hanorkOnlyProduct, {
      username,
      photosDir,
      catalogPath: outPath,
    });
    return {
      ok: true,
      count: payload.productCount || payload.variacoes?.length || 0,
      skippedNoPhoto: 0,
      eligible: active.length,
      path: outPath,
      dynamicPromo: true,
      photoPool: payload.photoPool || [],
    };`,
    `    const outPath = path.join(client.ipcDir, CATALOG_FILE);
    const payload = writeHanorkOnlyCatalogFile(hanorkOnlyProduct, {
      username,
      photosDir,
      catalogPath: outPath,
    });
    const paths = await writeCatalogToAllWaSessions(payload);
    return {
      ok: true,
      count: payload.productCount || payload.variacoes?.length || 0,
      skippedNoPhoto: 0,
      eligible: active.length,
      path: paths[0] || outPath,
      paths,
      dynamicPromo: true,
      photoPool: payload.photoPool || [],
    };`
  );
}

fs.writeFileSync(syncPath, sync, 'utf8');
console.log('Patched hanorkAutoSync.js');

let ai = fs.readFileSync(aiPath, 'utf8');
if (!ai.includes("require('./waCatalogMirror')")) {
  ai = ai.replace(
    "const { CATALOG_FILE, buildPlainProductText } = require('./hanorkAutoSync');",
    "const { CATALOG_FILE, buildPlainProductText } = require('./hanorkAutoSync');\nconst { writeCatalogToAllWaSessions } = require('./waCatalogMirror');"
  );
}

if (!ai.includes('writeCatalogToAllWaSessions(payload)')) {
  ai = ai.replace(
    `async function writeCatalogPayload(payload) {
  const client = getZeroDivuClient();
  client.ensureDir();
  const outPath = catalogFilePath();
  await fs.writeJson(outPath, payload, { spaces: 2 });
  return outPath;
}`,
    `async function writeCatalogPayload(payload) {
  const client = getZeroDivuClient();
  client.ensureDir();
  const paths = await writeCatalogToAllWaSessions(payload);
  return paths[0] || catalogFilePath();
}`
  );
}

fs.writeFileSync(aiPath, ai, 'utf8');
console.log('Patched catalogAiSync.js');

// Mirror catalog now for WA2
const src = `${HANORK}/shared/zero-ipc/hanork_auto_catalog.json`;
const dst = `${HANORK}/shared/zero-ipc-b/hanork_auto_catalog.json`;
if (fs.existsSync(src)) {
  fs.copyFileSync(src, dst);
  console.log('Copied catalog to zero-ipc-b');
}
