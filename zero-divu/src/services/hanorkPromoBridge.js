'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let promoModule = null;
let promoKv = null;
let promoKvDb = null;

function expandHome(p) {
  const s = String(p || '').trim();
  if (s.startsWith('~/')) return path.join(os.homedir(), s.slice(2));
  if (s === '~') return os.homedir();
  return s;
}

function resolveHanorkRoot() {
  const fromEnv = expandHome(process.env.HANORK_ROOT);
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);
  const guess = path.resolve(__dirname, '../../..');
  if (fs.existsSync(path.join(guess, 'src', 'data', 'hanorkBroadcastVariants.js'))) {
    return guess;
  }
  return guess;
}

function resolvePhotosDir() {
  const fromEnv = expandHome(process.env.HANORK_FOTOS_DIR || process.env.CAMINHO_FOTOS);
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);
  const root = resolveHanorkRoot();
  const guess = path.join(root, 'fotos');
  return fs.existsSync(guess) ? guess : guess;
}

function resolveHanorkDbPath() {
  const fromEnv = expandHome(process.env.HANORK_DB_PATH || process.env.ZERO_DIVU_DB_PATH);
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);
  const homeDb = path.join(os.homedir(), '.hanork', 'hanork.db');
  if (fs.existsSync(homeDb)) return homeDb;
  const root = resolveHanorkRoot();
  const local = path.join(root, 'hanork.db');
  if (fs.existsSync(local)) return local;
  return homeDb;
}

function loadPromoModule() {
  if (promoModule) return promoModule;
  const modPath = path.join(resolveHanorkRoot(), 'src', 'data', 'hanorkBroadcastVariants.js');
  promoModule = require(modPath);
  return promoModule;
}

function resolveBetterSqlite() {
  try {
    return require('better-sqlite3');
  } catch {
    const root = resolveHanorkRoot();
    return require(path.join(root, 'node_modules', 'better-sqlite3'));
  }
}

function getPromoKv() {
  if (promoKv) return promoKv;
  const mod = loadPromoModule();
  const dbPath = resolveHanorkDbPath();
  if (fs.existsSync(dbPath)) {
    try {
      const Database = resolveBetterSqlite();
      promoKvDb = new Database(dbPath);
      promoKv = mod.createHanorkPromoKv(() => promoKvDb);
      if (promoKv) return promoKv;
    } catch {
      /* fallback IPC */
    }
  }

  const { IPC_DIR } = require('../ipc/paths');
  const kvFile = path.join(IPC_DIR, 'hanork_promo_kv.json');
  let cache = {};
  try {
    if (fs.existsSync(kvFile)) cache = JSON.parse(fs.readFileSync(kvFile, 'utf8')) || {};
  } catch {
    cache = {};
  }
  promoKv = {
    get: (k) => (cache[k] != null ? String(cache[k]) : null),
    set: (k, v) => {
      cache[k] = String(v);
      try {
        fs.writeFileSync(kvFile, JSON.stringify(cache, null, 2));
      } catch {
        /* ignore */
      }
    },
  };
  return promoKv;
}

function isDynamicHanorkCatalog(overlay) {
  return Boolean(
    overlay?.dynamicPromo ||
      overlay?.source === 'hanork_dynamic_photos' ||
      overlay?.variacoes?.some((v) => v?.dynamic || v?.tipo === 'hanork-dynamic')
  );
}

function pickNextWaPost(opts = {}) {
  const mod = loadPromoModule();
  const photosDir = opts.photosDir || resolvePhotosDir();
  const kv = getPromoKv();
  const username =
    opts.username ||
    process.env.BOT_USERNAME ||
    process.env.HANORK_BOT_USERNAME ||
    'hanork_bot';
  return mod.pickHanorkWaPost(kv, photosDir, {
    username,
    productName: opts.productName,
    price: opts.price,
  });
}

function resolvePhotoFile(photoFile) {
  if (!photoFile) return null;
  const name = path.basename(String(photoFile));
  try {
    const { isManualPromoUpload } = require('../../../src/utils/promoUploadManifest');
    if (!isManualPromoUpload('hanork', name)) {
      return require('./menuPhotoFallback').nextMenuPhotoPath() || null;
    }
  } catch {
    /* fallback path join */
  }
  const photosDir = resolvePhotosDir();
  const fp = path.join(photosDir, name);
  if (fs.existsSync(fp)) return fp;
  return require('./menuPhotoFallback').nextMenuPhotoPath() || null;
}

module.exports = {
  resolveHanorkRoot,
  resolvePhotosDir,
  resolveHanorkDbPath,
  loadPromoModule,
  getPromoKv,
  isDynamicHanorkCatalog,
  pickNextWaPost,
  resolvePhotoFile,
};
