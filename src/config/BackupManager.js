'use strict';

/**
 * BackupManager — backup SQLite versionado, verificado e com rotação.
 * Usa better-sqlite3 .backup() (hot) ou checkpoint + cópia como fallback.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const logger = require('./logger');

const gzip = promisify(zlib.gzip);

const DB_PATH = path.join(__dirname, '../../hanork.db');
const BACKUP_DIR = path.join(__dirname, '../../backups');
const MANIFEST_PATH = path.join(BACKUP_DIR, 'backup_manifest.json');
const STARTUP_COUNT_FILE = path.join(BACKUP_DIR, '.last_counts.json');

const MAX_BACKUPS = Math.max(5, parseInt(process.env.BACKUP_MAX_COUNT || '30', 10));
const MIN_INTERVAL_MS = Math.max(60000, parseInt(process.env.BACKUP_MIN_INTERVAL_MS || '300000', 10));
const PERIODIC_HOURS = Math.max(1, parseInt(process.env.BACKUP_INTERVAL_HOURS || '6', 10));
const STARTUP_MIN_GAP_MS = Math.max(0, parseInt(process.env.BACKUP_STARTUP_MIN_GAP_MS || '14400000', 10)); // 4h
const COMPRESS = process.env.BACKUP_COMPRESS !== '0';

const CRITICAL_TABLES = [
    'users', 'orders', 'order_items', 'products', 'affiliates',
    'referrals', 'affiliate_commissions', 'subscriptions', 'coupons', 'cashback', 'cash_flow',
    'telegram_groups', 'tenants', 'kv_store',
];

let lastBackupTime = 0;
let _getOpenDb = null;
let _schedulerTimer = null;
let _backupInProgress = false;

function isDrvfsPath(p) {
    return /\/mnt\/[a-z]\//i.test(String(p).replace(/\\/g, '/'));
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/** WSL /mnt/c pode atrasar visibilidade do arquivo após backup ou cópia. */
async function waitForFile(filePath, attempts = 12, delayMs = 150) {
    for (let i = 0; i < attempts; i++) {
        try {
            if (fs.existsSync(filePath)) {
                const st = fs.statSync(filePath);
                if (st.isFile() && st.size > 0) return st;
            }
        } catch { /* retry */ }
        if (i < attempts - 1) await sleep(delayMs);
    }
    return null;
}

function cleanupWalSidecars(basePath) {
    const dir = path.dirname(basePath);
    const base = path.basename(basePath, '.db');
    for (const suffix of ['-wal', '-shm', '-journal']) {
        const sidecar = path.join(dir, base + '.db' + suffix);
        try {
            if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
        } catch (e) {
            if (e.code !== 'ENOENT') logger.warn('[BACKUP] sidecar cleanup:', e.message);
        }
    }
}

function safeUnlink(filePath) {
    try {
        if (typeof fs.rmSync === 'function') {
            fs.rmSync(filePath, { force: true });
        } else if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        if (e.code !== 'ENOENT') throw e;
    }
}

function setOpenDbProvider(fn) {
    _getOpenDb = typeof fn === 'function' ? fn : null;
}

function init() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        logger.info('[BACKUP] Pasta criada', { dir: BACKUP_DIR });
    }
    if (!fs.existsSync(MANIFEST_PATH)) {
        writeManifest({ version: 1, backups: [] });
    }
    purgeInvalidEntries();
}

function readManifest() {
    try {
        return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch {
        return { version: 1, backups: [] };
    }
}

function writeManifest(manifest) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function sha256(filePath) {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    } catch {
        return null;
    }
}

function getCounts(dbPath) {
    try {
        const Database = require('better-sqlite3');
        const conn = new Database(dbPath, { readonly: true, fileMustExist: true });
        const counts = {};
        let totalRows = 0;
        for (const table of CRITICAL_TABLES) {
            try {
                const c = conn.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c ?? 0;
                counts[table] = c;
                totalRows += c;
            } catch {
                counts[table] = -1;
            }
        }
        conn.close();
        counts._total = totalRows;
        return counts;
    } catch {
        return null;
    }
}

function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function purgeInvalidEntries() {
    try {
        const manifest = readManifest();
        const kept = [];
        let removed = 0;
        for (const entry of manifest.backups || []) {
            const dbPath = path.join(BACKUP_DIR, entry.name);
            const gzPath = dbPath + '.gz';
            const exists = fs.existsSync(dbPath) || fs.existsSync(gzPath);
            const size = entry.size || (fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0);
            if (!exists || size < 1024) {
                safeUnlink(dbPath);
                safeUnlink(gzPath);
                cleanupWalSidecars(dbPath);
                removed++;
                continue;
            }
            kept.push(entry);
        }
        if (removed > 0) {
            writeManifest({ ...manifest, backups: kept });
            logger.info('[BACKUP] Entradas inválidas removidas', { removed });
        }
    } catch (e) {
        logger.warn('[BACKUP] purgeInvalidEntries:', e.message);
    }
}

async function copyWithCheckpoint(dest) {
    const dbInstance = _getOpenDb?.();
    if (dbInstance?.open) {
        try {
            dbInstance.pragma('wal_checkpoint(TRUNCATE)');
        } catch { /* ignore */ }
    }
    if (!fs.existsSync(DB_PATH)) {
        throw new Error('Banco principal não encontrado');
    }
    fs.copyFileSync(DB_PATH, dest);
}

async function runHotBackup(dest) {
    const dbInstance = _getOpenDb?.();
    const onDrvfs = isDrvfsPath(dest) || isDrvfsPath(DB_PATH);
    const forceCopy = process.env.BACKUP_FORCE_COPY === '1' || onDrvfs;
    const staging = onDrvfs
        ? path.join(os.tmpdir(), `hanork-backup-${process.pid}-${Date.now()}.db`)
        : dest;

    const writeDest = async () => {
        if (!dbInstance?.open || forceCopy) {
            await copyWithCheckpoint(staging);
            return 'copy';
        }
        try {
            await dbInstance.backup(staging);
            return 'hot';
        } catch (e) {
            logger.warn('[BACKUP] Hot backup falhou, usando cópia:', e.message);
            await copyWithCheckpoint(staging);
            return 'copy';
        }
    };

    try {
        const method = await writeDest();
        const staged = await waitForFile(staging);
        if (!staged) {
            throw new Error(`Arquivo de backup não apareceu: ${staging}`);
        }
        if (staging !== dest) {
            fs.copyFileSync(staging, dest);
            safeUnlink(staging);
            cleanupWalSidecars(staging);
            const copied = await waitForFile(dest);
            if (!copied) {
                throw new Error(`Cópia para destino falhou: ${dest}`);
            }
        }
        cleanupWalSidecars(dest);
        return method;
    } catch (e) {
        safeUnlink(staging);
        cleanupWalSidecars(staging);
        throw e;
    }
}

async function maybeCompress(dbPath) {
    if (!COMPRESS) return { path: dbPath, compressed: false };
    const gzPath = dbPath + '.gz';
    const input = fs.readFileSync(dbPath);
    const compressed = await gzip(input, { level: 6 });
    fs.writeFileSync(gzPath, compressed);
    safeUnlink(dbPath);
    cleanupWalSidecars(dbPath);
    return { path: gzPath, compressed: true, ratio: compressed.length / input.length };
}

/**
 * @returns {Promise<object|null>}
 */
async function createBackup(reason = 'auto', force = false) {
    init();
    const now = Date.now();
    if (_backupInProgress) {
        logger.warn('[BACKUP] Já em andamento, ignorando', { reason });
        return null;
    }
    if (!force && now - lastBackupTime < MIN_INTERVAL_MS) {
        return null;
    }
    if (!fs.existsSync(DB_PATH)) {
        logger.warn('[BACKUP] Banco não encontrado', { path: DB_PATH });
        return null;
    }

    _backupInProgress = true;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseName = `hanork-${ts}-${reason}-${process.pid}.db`;
    const dest = path.join(BACKUP_DIR, baseName);

    try {
        const method = await runHotBackup(dest);
        const destStat = await waitForFile(dest);
        if (!destStat) {
            throw new Error(`Backup não encontrado após gravação: ${dest}`);
        }
        let size = destStat.size;
        if (size < 1024) {
            throw new Error(`Backup inválido (${size} bytes)`);
        }

        const integrity = verifyIntegrity(dest);
        if (!integrity.ok) {
            safeUnlink(dest);
            cleanupWalSidecars(dest);
            throw new Error(`Integridade falhou: ${integrity.result}`);
        }

        const counts = getCounts(dest);
        const hash = sha256(dest);
        let finalName = baseName;
        let compressed = false;

        if (COMPRESS) {
            const comp = await maybeCompress(dest);
            finalName = path.basename(comp.path);
            compressed = comp.compressed;
            size = fs.statSync(comp.path).size;
        }

        const entry = {
            id: crypto.randomBytes(4).toString('hex'),
            name: finalName,
            ts: new Date().toISOString(),
            reason,
            method,
            size,
            sha256: hash,
            compressed,
            counts,
            integrity: 'ok',
        };

        const manifest = readManifest();
        manifest.backups = manifest.backups || [];
        manifest.backups.push(entry);
        manifest.lastSuccess = entry.ts;
        writeManifest(manifest);
        rotate();
        lastBackupTime = now;

        logger.info('[BACKUP] OK', {
            name: finalName,
            size: formatBytes(size),
            method,
            reason,
            users: counts?.users,
            orders: counts?.orders,
        });

        return { ...entry, path: path.join(BACKUP_DIR, finalName) };
    } catch (e) {
        logger.error('[BACKUP] Falha', { reason, message: e.message });
        safeUnlink(dest);
        safeUnlink(dest + '.gz');
        cleanupWalSidecars(dest);
        return null;
    } finally {
        _backupInProgress = false;
    }
}

function rotate() {
    try {
        const manifest = readManifest();
        while ((manifest.backups || []).length > MAX_BACKUPS) {
            const oldest = manifest.backups.shift();
            if (!oldest?.name) continue;
            for (const p of [path.join(BACKUP_DIR, oldest.name), path.join(BACKUP_DIR, oldest.name + '.gz')]) {
                safeUnlink(p);
                cleanupWalSidecars(p);
            }
            logger.info('[BACKUP] Rotacionado', { name: oldest.name });
        }
        writeManifest(manifest);
    } catch (e) {
        logger.warn('[BACKUP] rotate:', e.message);
    }
}

function verifyIntegrity(dbPath = DB_PATH) {
    try {
        const Database = require('better-sqlite3');
        const conn = new Database(dbPath, { readonly: true, fileMustExist: true });
        const result = conn.pragma('integrity_check', { simple: true });
        const counts = getCounts(dbPath);
        conn.close();
        return { ok: result === 'ok', result, counts };
    } catch (e) {
        return { ok: false, result: e.message, counts: null };
    }
}

function detectDataLoss() {
    if (!fs.existsSync(STARTUP_COUNT_FILE)) return null;
    try {
        const last = JSON.parse(fs.readFileSync(STARTUP_COUNT_FILE, 'utf8'));
        const current = getCounts(DB_PATH);
        if (!current) return null;
        const losses = {};
        for (const [t, prev] of Object.entries(last)) {
            if (t.startsWith('_')) continue;
            if (current[t] !== undefined && current[t] >= 0 && prev >= 0 && current[t] < prev) {
                losses[t] = { before: prev, after: current[t], lost: prev - current[t] };
            }
        }
        return Object.keys(losses).length ? losses : null;
    } catch {
        return null;
    }
}

function saveCurrentCounts() {
    const counts = getCounts(DB_PATH);
    if (counts) fs.writeFileSync(STARTUP_COUNT_FILE, JSON.stringify(counts, null, 2));
}

function lastSuccessfulBackup() {
    const manifest = readManifest();
    const list = manifest.backups || [];
    for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        if (b.size >= 1024) return b;
    }
    return null;
}

function startupCheck() {
    init();
    logger.info('[BACKUP] Verificação na inicialização…');

    const integrity = verifyIntegrity();
    if (!integrity.ok) {
        logger.error('[BACKUP] Banco corrompido', { result: integrity.result });
        const restored = restoreLatestSync();
        return restored;
    }

    logger.info('[BACKUP] Integridade OK', {
        users: integrity.counts?.users,
        orders: integrity.counts?.orders,
        products: integrity.counts?.products,
    });

    const loss = detectDataLoss();
    if (loss) {
        logger.error('[BACKUP] Possível perda de dados', loss);
    }

    const last = lastSuccessfulBackup();
    const gap = last ? Date.now() - new Date(last.ts).getTime() : Infinity;
    if (gap >= STARTUP_MIN_GAP_MS) {
        createBackup('startup', true).catch((e) => logger.warn('[BACKUP] startup async:', e.message));
    } else {
        logger.info('[BACKUP] Startup skip — backup recente', {
            last: last?.name,
            agoMin: Math.round(gap / 60000),
        });
    }

    saveCurrentCounts();
    return true;
}

function resolveBackupPath(entry) {
    const plain = path.join(BACKUP_DIR, entry.name);
    if (fs.existsSync(plain)) return { path: plain, compressed: false };
    if (entry.name.endsWith('.gz') && fs.existsSync(plain)) return { path: plain, compressed: true };
    const gz = plain.endsWith('.gz') ? plain : plain + '.gz';
    if (fs.existsSync(gz)) return { path: gz, compressed: true };
    return null;
}

async function decompressToTemp(gzPath) {
    const gunzip = promisify(zlib.gunzip);
    const buf = await gunzip(fs.readFileSync(gzPath));
    const tmp = path.join(BACKUP_DIR, `.restore-${Date.now()}.db`);
    fs.writeFileSync(tmp, buf);
    return tmp;
}

function restoreLatestSync() {
    const manifest = readManifest();
    const candidates = (manifest.backups || [])
        .filter((b) => b.size >= 1024)
        .sort((a, b) => new Date(b.ts) - new Date(a.ts));

    for (const entry of candidates) {
        const resolved = resolveBackupPath(entry);
        if (!resolved) continue;
        try {
            let srcPath = resolved.path;
            let tmp = null;
            if (resolved.compressed || entry.name.endsWith('.gz')) {
                tmp = path.join(BACKUP_DIR, `.restore-sync-${Date.now()}.db`);
                fs.writeFileSync(tmp, zlib.gunzipSync(fs.readFileSync(resolved.path)));
                srcPath = tmp;
            }
            const check = verifyIntegrity(srcPath);
            if (!check.ok) {
                if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp);
                continue;
            }
            if (fs.existsSync(DB_PATH)) {
                fs.copyFileSync(DB_PATH, `${DB_PATH}.corrupt.${Date.now()}`);
            }
            fs.copyFileSync(srcPath, DB_PATH);
            if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp);
            logger.info('[BACKUP] Restaurado (sync)', { name: entry.name });
            return true;
        } catch (e) {
            logger.warn('[BACKUP] restore skip', { name: entry.name, message: e.message });
        }
    }
    return false;
}

async function restoreFromEntry(entry) {
    if (!entry?.name) return { ok: false, error: 'Entrada inválida' };
    const resolved = resolveBackupPath(entry);
    if (!resolved) return { ok: false, error: 'Arquivo não encontrado' };

    let srcPath = resolved.path;
    let tmp = null;
    try {
        if (resolved.compressed || entry.name.endsWith('.gz')) {
            tmp = await decompressToTemp(resolved.path);
            srcPath = tmp;
        }

        const check = verifyIntegrity(srcPath);
        if (!check.ok) return { ok: false, error: `Backup corrompido: ${check.result}` };

        if (fs.existsSync(DB_PATH)) {
            const corruptPath = `${DB_PATH}.before-restore.${Date.now()}`;
            fs.copyFileSync(DB_PATH, corruptPath);
            logger.info('[BACKUP] Snapshot pré-restore', { path: corruptPath });
        }

        fs.copyFileSync(srcPath, DB_PATH);
        const after = verifyIntegrity(DB_PATH);
        if (!after.ok) {
            return { ok: false, error: 'Restore falhou integridade pós-cópia' };
        }

        logger.info('[BACKUP] Restaurado', { name: entry.name, users: after.counts?.users });
        return { ok: true, name: entry.name, counts: after.counts };
    } catch (e) {
        return { ok: false, error: e.message };
    } finally {
        if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
}

function restoreLatest() {
    const manifest = readManifest();
    const candidates = (manifest.backups || [])
        .filter((b) => b.size >= 1024)
        .sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const best = candidates[0];
    if (!best) {
        logger.error('[BACKUP] Nenhum backup válido');
        return Promise.resolve(false);
    }
    return restoreFromEntry(best).then((r) => r.ok).catch(() => false);
}

function listBackups(limit = 20) {
    const manifest = readManifest();
    return (manifest.backups || [])
        .filter((b) => b.size >= 1024)
        .slice(-limit)
        .reverse();
}

function getStatus() {
    const manifest = readManifest();
    const list = listBackups(5);
    const last = list[0] || null;
    const integrity = verifyIntegrity();
    return {
        ok: integrity.ok,
        dir: BACKUP_DIR,
        total: (manifest.backups || []).filter((b) => b.size >= 1024).length,
        max: MAX_BACKUPS,
        intervalHours: PERIODIC_HOURS,
        compress: COMPRESS,
        last,
        integrity: integrity.result,
        counts: integrity.counts,
        inProgress: _backupInProgress,
    };
}

function startScheduler(options = {}) {
    const hours = options.intervalHours || PERIODIC_HOURS;
    const ms = hours * 60 * 60 * 1000;
    if (_schedulerTimer) clearInterval(_schedulerTimer);
    _schedulerTimer = setInterval(() => {
        createBackup('periodic').catch((e) => logger.warn('[BACKUP] periodic:', e.message));
    }, ms);
    logger.info('[BACKUP] Scheduler ativo', { everyHours: hours, max: MAX_BACKUPS, compress: COMPRESS });
}

/** Compat: sync fire-and-forget para código legado */
function createBackupLegacy(reason = 'auto', force = false) {
    createBackup(reason, force).catch((e) => logger.warn('[BACKUP] legacy:', e.message));
}

module.exports = {
    setOpenDbProvider,
    init,
    createBackup,
    createBackupLegacy,
    verifyIntegrity,
    startupCheck,
    restoreLatest,
    restoreLatestSync,
    restoreFromEntry,
    startScheduler,
    startPeriodicBackup: startScheduler,
    listBackups,
    getStatus,
    getCounts,
    detectDataLoss,
    saveCurrentCounts,
    purgeInvalidEntries,
    DB_PATH,
    BACKUP_DIR,
};
