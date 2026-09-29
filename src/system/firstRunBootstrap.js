'use strict';

/**
 * Setup automático na primeira subida do Hanork (pacote cliente / instalação nova).
 * - IPC Zero Divu
 * - Patch Baileys (Status WhatsApp)
 * - Pastas runtime
 * - Marcador ~/.hanork/bootstrapped
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = path.join(os.homedir(), '.hanork', 'bootstrapped');

function resolveRepoRoot(explicit) {
    return path.resolve(explicit || path.join(__dirname, '../..'));
}

function appendLog(repoRoot, message, extra) {
    try {
        const logDir = path.join(repoRoot, 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        const line = JSON.stringify({
            ts: new Date().toISOString(),
            message,
            ...(extra || {}),
        });
        fs.appendFileSync(path.join(logDir, 'first-run-bootstrap.log'), `${line}\n`, 'utf8');
    } catch {
        /* ignore */
    }
}

function setupIpc(repoRoot) {
    const ipcDir = process.env.ZERO_DIVU_IPC_DIR
        ? path.resolve(repoRoot, process.env.ZERO_DIVU_IPC_DIR)
        : path.join(repoRoot, 'shared', 'zero-ipc');

    fs.mkdirSync(path.join(ipcDir, 'inbox'), { recursive: true });

    const files = {
        'commands.jsonl': '',
        'events.jsonl': '',
        'commands.ack': {},
        'state.json': {
            updatedAt: null,
            ipcOnline: false,
            connected: false,
            phone: null,
            profile: 'balanced',
            maxGroups: 20,
            activeGroups: 0,
            paused: false,
            lastPostAt: null,
            workerPid: null,
        },
        'config.patch.json': {},
        'wa_runtime.json': {
            hanorkCampaignEnabled: true,
            hanorkAutoSyncEnabled: true,
        },
        'idempotency.json': {},
    };

    for (const [name, def] of Object.entries(files)) {
        const fp = path.join(ipcDir, name);
        if (fs.existsSync(fp)) continue;
        if (typeof def === 'string') {
            fs.writeFileSync(fp, def, 'utf8');
        } else {
            fs.writeFileSync(fp, `${JSON.stringify(def, null, 2)}\n`, 'utf8');
        }
    }
    return ipcDir;
}

function ensureRuntimeDirs(repoRoot) {
    const home = os.homedir();
    const dirs = [
        path.join(home, '.hanork'),
        path.join(home, '.zero-divu'),
        path.join(repoRoot, 'shared', 'zero-ipc'),
        path.join(repoRoot, 'uploads'),
        path.join(repoRoot, 'produtos'),
        path.join(repoRoot, 'fotos'),
        path.join(repoRoot, 'infos'),
        path.join(repoRoot, 'logs'),
        path.join(repoRoot, 'backups'),
        path.join(repoRoot, 'zero-divu', 'database', 'runtime'),
        path.join(repoRoot, 'zero-divu', 'database'),
    ];
    for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function applyClientDbPaths() {
    const home = os.homedir();
    if (!process.env.HANORK_DB_PATH) {
        process.env.HANORK_DB_PATH = path.join(home, '.hanork', 'hanork.db');
    }
    if (!process.env.ZERO_DIVU_DB_PATH) {
        process.env.ZERO_DIVU_DB_PATH = path.join(home, '.zero-divu', 'zero-divu.db');
    }
    if (process.env.ZERO_DIVU_USE_HANORK_DB == null || process.env.ZERO_DIVU_USE_HANORK_DB === '') {
        process.env.ZERO_DIVU_USE_HANORK_DB = '0';
    }
}

function initializeClientDatabases(opts = {}) {
    const repoRoot = resolveRepoRoot(opts.repoRoot);
    applyClientDbPaths();

    const hanorkDb = process.env.HANORK_DB_PATH;
    const zeroDb = process.env.ZERO_DIVU_DB_PATH;
    const result = { hanorkDb, zeroDb, hanork: false, zeroDivu: false };

    try {
        fs.mkdirSync(path.dirname(hanorkDb), { recursive: true });
        const { connect } = require('../config/database-sqlite');
        connect();
        result.hanork = true;
        appendLog(repoRoot, 'hanork.db inicializado', { path: hanorkDb });
    } catch (e) {
        appendLog(repoRoot, 'hanork.db pendente', { error: e.message, path: hanorkDb });
    }

    try {
        fs.mkdirSync(path.dirname(zeroDb), { recursive: true });
        const zdSqlite = require(path.join(repoRoot, 'zero-divu', 'src', 'storage', 'sqlite'));
        zdSqlite.init({ path: zeroDb });
        result.zeroDivu = true;
        appendLog(repoRoot, 'zero-divu.db inicializado', { path: zeroDb });
    } catch (e) {
        appendLog(repoRoot, 'zero-divu.db pendente', { error: e.message, path: zeroDb });
    }

    return result;
}

function patchBaileys(repoRoot) {
    const script = path.join(repoRoot, 'zero-divu', 'scripts', 'patch-baileys-newsletter.js');
    if (!fs.existsSync(script)) return false;
    try {
        execSync(`node "${script}"`, { stdio: 'pipe', cwd: path.join(repoRoot, 'zero-divu'), timeout: 30000 });
        return true;
    } catch {
        return false;
    }
}

function isPlaceholderToken(value) {
    const v = String(value || '').trim().toLowerCase();
    if (!v) return true;
    return (
        v.includes('cole_seu') ||
        v.includes('seu_token') ||
        v.includes('botfather') ||
        v === 'x' ||
        v.length < 20
    );
}

function printFirstRunGuide(repoRoot) {
    const dashUser = process.env.DASHBOARD_USER || 'admin';
    const dashPass = process.env.DASHBOARD_PASS || '(veja .env)';
    const port = process.env.PORT || '3000';

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  HANORK — PRIMEIRA EXECUÇÃO                              ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    if (isPlaceholderToken(process.env.TOKEN_TELEGRAM)) {
        console.log('║  1. Cole seu token do @BotFather em TOKEN_TELEGRAM (.env) ║');
        console.log('║  2. Reinicie: node src/bot.js                            ║');
    } else {
        console.log('║  ✓ Token Telegram configurado                            ║');
    }
    console.log('║  ✓ Mercado Pago, ID admin e Zero Divu (WA Status) prontos ║');
    console.log('║  ✓ Dependências e Baileys patchado no pacote             ║');
    console.log('║  ✓ Bancos em ~/.hanork e ~/.zero-divu (criados automaticamente) ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  Painel web: http://localhost:${port}/dashboard`.padEnd(59) + '║');
    console.log(`║  Login: ${dashUser} / ${dashPass}`.padEnd(59) + '║');
    console.log('║  WhatsApp: /wa no Telegram → escanear QR                 ║');
    console.log('║  Terminal: abra NOVO terminal → dashboard Hanork         ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
}

function runFirstBootSetup(opts = {}) {
    const repoRoot = resolveRepoRoot(opts.repoRoot);
    const force = Boolean(opts.force);

    if (!force && fs.existsSync(MARKER)) {
        return { ok: true, skipped: true };
    }

    try {
        ensureRuntimeDirs(repoRoot);
        const ipcDir = setupIpc(repoRoot);
        const patched = patchBaileys(repoRoot);

        fs.mkdirSync(path.dirname(MARKER), { recursive: true });
        fs.writeFileSync(
            MARKER,
            JSON.stringify(
                {
                    at: new Date().toISOString(),
                    ipcDir,
                    baileysPatched: patched,
                    zeroDivu: process.env.ZERO_DIVU_ENABLED === 'true',
                },
                null,
                2
            ) + '\n',
            'utf8'
        );

        appendLog(repoRoot, 'first boot setup ok', { ipcDir, patched });
        printFirstRunGuide(repoRoot);

        return { ok: true, ipcDir, patched };
    } catch (e) {
        appendLog(repoRoot, 'first boot setup failed', { error: e.message });
        console.warn('[FIRST-RUN] Setup parcial:', e.message);
        return { ok: false, error: e.message };
    }
}

module.exports = {
    MARKER,
    runFirstBootSetup,
    initializeClientDatabases,
    applyClientDbPaths,
    isPlaceholderToken,
    setupIpc,
    patchBaileys,
};
