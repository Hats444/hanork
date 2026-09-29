'use strict';

/**
 * Padroniza dual WA em produção WSL:
 * - config.patch.json simétrico (balanced, autoProfile off)
 * - catálogo Hanork espelhado com texto completo
 * - waCatalogMirror com merge de texto
 * - catalogAiSync espelha em todas as sessões
 * - mídia hanork nos dois workers
 */

const fs = require('fs');
const path = require('path');

const HANORK = '/home/vendetta/hanork';
const ZERO = `${HANORK}/zero-divu`;
const PLUGIN = `${HANORK}/src/plugins/zero-divu`;
const IPC_A = `${HANORK}/shared/zero-ipc`;
const IPC_B = `${HANORK}/shared/zero-ipc-b`;
const MEDIA_A = '/home/vendetta/.zero-divu/media/hanork';
const MEDIA_B = '/home/vendetta/.zero-divu-b/media/hanork';
const FOTOS_HANORK = `${HANORK}/fotos/hanork`;

const STANDARD_PATCH = {
  MAX_GROUPS: 25,
  maxGroupsPinned: true,
  OPERATION_PROFILE: 'balanced',
  autoProfileEnabled: false,
  MAX_JOIN_PER_HOUR: 7,
  MAX_POSTS_PER_HOUR: 14,
  MAX_GROUPS_PER_CYCLE: 1,
  JOIN_DELAY_MS: 75000,
  STATUS_DELAY_MS: 120000,
  POST_DELAY_MS: 25000,
  ACTIVE_HOURS_ENABLED: true,
  QUIET_HOURS_ENABLED: true,
  AUTO_POST_ON_JOIN: true,
  AUTO_JOIN_GROUPS: true,
  postsPaused: false,
};

function mergePatch(existing) {
  return { ...existing, ...STANDARD_PATCH };
}

function mergeCatalogPayload(incoming, existing) {
  if (!existing?.variacoes?.length) return incoming;
  if (!incoming?.variacoes?.length) return existing;
  const byKey = new Map();
  for (const v of existing.variacoes) {
    const key = v.productId != null ? `p:${v.productId}` : `t:${v.tipo}`;
    byKey.set(key, { ...v });
  }
  for (const v of incoming.variacoes) {
    const key = v.productId != null ? `p:${v.productId}` : `t:${v.tipo}`;
    const prev = byKey.get(key) || {};
    byKey.set(key, {
      ...prev,
      ...v,
      texto: String(v.texto || '').trim() ? v.texto : prev.texto,
      textoChat: String(v.textoChat || '').trim() ? v.textoChat : prev.textoChat,
    });
  }
  return {
    ...existing,
    ...incoming,
    variacoes: [...byKey.values()],
    photoPool: incoming.photoPool?.length ? incoming.photoPool : existing.photoPool,
  };
}

function writeWaCatalogMirror() {
  const content = `'use strict';

const fs = require('fs-extra');
const path = require('path');
const { listSpawnableSessions, resolveSession } = require('./waSessionsManifest');

const CATALOG_FILE = 'hanork_auto_catalog.json';

function mergeCatalogPayload(incoming, existing) {
  if (!existing?.variacoes?.length) return incoming;
  if (!incoming?.variacoes?.length) return existing;
  const byKey = new Map();
  for (const v of existing.variacoes) {
    const key = v.productId != null ? \`p:\${v.productId}\` : \`t:\${v.tipo}\`;
    byKey.set(key, { ...v });
  }
  for (const v of incoming.variacoes) {
    const key = v.productId != null ? \`p:\${v.productId}\` : \`t:\${v.tipo}\`;
    const prev = byKey.get(key) || {};
    byKey.set(key, {
      ...prev,
      ...v,
      texto: String(v.texto || '').trim() ? v.texto : prev.texto,
      textoChat: String(v.textoChat || '').trim() ? v.textoChat : prev.textoChat,
    });
  }
  return {
    ...existing,
    ...incoming,
    variacoes: [...byKey.values()],
    photoPool: incoming.photoPool?.length ? incoming.photoPool : existing.photoPool,
  };
}

async function writeCatalogToAllWaSessions(payload) {
  const written = [];
  for (const sessionId of listSpawnableSessions()) {
    try {
      const conf = resolveSession(sessionId);
      await fs.ensureDir(conf.ipcDir);
      const outPath = path.join(conf.ipcDir, CATALOG_FILE);
      let merged = payload;
      try {
        if (await fs.pathExists(outPath)) {
          const existing = await fs.readJson(outPath);
          merged = mergeCatalogPayload(payload, existing);
        }
      } catch {
        /* ignore */
      }
      await fs.writeJson(outPath, merged, { spaces: 2 });
      written.push(outPath);
    } catch {
      /* sessão opcional */
    }
  }
  return written;
}

module.exports = { CATALOG_FILE, writeCatalogToAllWaSessions, mergeCatalogPayload };
`;
  fs.writeFileSync(`${PLUGIN}/waCatalogMirror.js`, content, 'utf8');
  console.log('Updated waCatalogMirror.js (merge texto)');
}

function patchCatalogAiSync() {
  const aiPath = `${PLUGIN}/catalogAiSync.js`;
  let ai = fs.readFileSync(aiPath, 'utf8');

  if (!ai.includes("require('./waCatalogMirror')")) {
    ai = ai.replace(
      "const { CATALOG_FILE, buildPlainProductText } = require('./hanorkAutoSync');",
      "const { CATALOG_FILE, buildPlainProductText } = require('./hanorkAutoSync');\nconst { writeCatalogToAllWaSessions } = require('./waCatalogMirror');"
    );
  }

  if (!ai.includes('writeCatalogToAllWaSessions(payload)')) {
    ai = ai.replace(
      /async function writeCatalogPayload\(payload\) \{[\s\S]*?return outPath;\n\}/,
      `async function writeCatalogPayload(payload) {
  const client = getZeroDivuClient();
  client.ensureDir();
  const paths = await writeCatalogToAllWaSessions(payload);
  return paths[0] || catalogFilePath();
}`
    );
    console.log('Patched catalogAiSync writeCatalogPayload → all sessions');
  } else {
    console.log('catalogAiSync already mirrors catalog');
  }

  fs.writeFileSync(aiPath, ai, 'utf8');
}

function syncMedia() {
  const sources = [FOTOS_HANORK, `${HANORK}/fotos`];
  const targets = [MEDIA_A, MEDIA_B];
  for (const target of targets) {
    fs.mkdirSync(target, { recursive: true });
  }
  let copied = 0;
  for (const srcDir of sources) {
    if (!fs.existsSync(srcDir)) continue;
    for (const name of fs.readdirSync(srcDir)) {
      if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;
      for (const target of targets) {
        const dest = path.join(target, name);
        try {
          fs.copyFileSync(path.join(srcDir, name), dest);
          copied++;
        } catch {
          /* ignore */
        }
      }
    }
  }
  console.log(`Media hanork synced (${copied} file ops)`);
}

function syncCatalogNow() {
  const src = `${IPC_A}/hanork_auto_catalog.json`;
  const dst = `${IPC_B}/hanork_auto_catalog.json`;
  if (!fs.existsSync(src)) {
    console.warn('No catalog at', src);
    return;
  }
  const a = JSON.parse(fs.readFileSync(src, 'utf8'));
  let b = null;
  try {
    b = JSON.parse(fs.readFileSync(dst, 'utf8'));
  } catch {
    /* ignore */
  }
  const merged = mergeCatalogPayload(a, b || a);
  fs.writeFileSync(src, JSON.stringify(merged, null, 2));
  fs.writeFileSync(dst, JSON.stringify(merged, null, 2));
  const withText = (merged.variacoes || []).filter((v) => String(v?.texto || '').trim()).length;
  console.log(`Catalog synced: ${merged.variacoes?.length || 0} variacao(oes), ${withText} com texto`);
}

function applyConfigPatches() {
  for (const ipcDir of [IPC_A, IPC_B]) {
    const patchPath = path.join(ipcDir, 'config.patch.json');
    let existing = {};
    try {
      existing = JSON.parse(fs.readFileSync(patchPath, 'utf8'));
    } catch {
      /* new */
    }
    const merged = mergePatch(existing);
    fs.writeFileSync(patchPath, JSON.stringify(merged, null, 2) + '\n');
    console.log('config.patch.json →', ipcDir);
  }
}

function deployZeroDivuFiles(localRoot) {
  const files = [
    'src/ipc/hanorkAutoCatalog.js',
    'src/services/hanorkAutoOverlay.js',
  ];
  for (const rel of files) {
    const src = path.join(localRoot, rel);
    const dst = path.join(ZERO, rel);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      console.log('Deployed', rel);
    }
  }
}

const localRoot = path.resolve(__dirname, '..');
applyConfigPatches();
writeWaCatalogMirror();
patchCatalogAiSync();
syncCatalogNow();
syncMedia();
deployZeroDivuFiles(localRoot);
console.log('Dual WA standardization complete — restart Hanork to apply.');
