'use strict';

/**
 * V4 M0 — boot antes do compositor (lock, env, paths WSL, native modules).
 * Entry point: node src/bot.js
 */
require('../config/env');
require('../utils/gramJsEnv');

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const botInstanceLock = require('../modules/security/botInstanceLock');
const logger = require('../config/logger');
const { validateSecurityEnv } = require('../config/securityEnv');
const {
    applyDefaultTerminalLogEnv,
    resetTerminalLog,
    appendBootFatal,
    followTerminalLog,
    resolveTerminalLogPath,
} = require('../logging/terminalMirror');

const REPO_ROOT = path.join(__dirname, '../..');
const CTL_SCRIPT = path.join(REPO_ROOT, 'scripts/hanork-ctl.sh');

function printControlHints() {
    console.log(`    Parar:        bash ${CTL_SCRIPT} stop`);
    console.log(`    Reiniciar:    bash ${CTL_SCRIPT} restart`);
    console.log(`    Status:       bash ${CTL_SCRIPT} status`);
    console.log(`    Logs:         tail -F ${resolveTerminalLogPath()}`);
    console.log('    Aliases (hanork-stop, …): npm run terminal:init && source ~/.bashrc');
}

function applyHanorkRuntimePaths() {
    const cwd = process.cwd();
    const onWslMount = (p) => /^\/mnt\//.test(String(p || ''));
    const wsl = onWslMount(cwd) || onWslMount(REPO_ROOT);

    const clientPack = process.env.HANORK_CLIENT_PACK === '1';

    if ((wsl || clientPack) && !process.env.HANORK_DB_PATH) {
        process.env.HANORK_DB_PATH = path.join(os.homedir(), '.hanork', 'hanork.db');
    }
    if ((wsl || clientPack) && !process.env.SQLITE_JOURNAL_MODE) {
        const { isDrvfsPath } = require('../utils/sqliteJournal');
        const dbPath = process.env.HANORK_DB_PATH || path.join(os.homedir(), '.hanork', 'hanork.db');
        // DELETE só em /mnt/c (drvfs); ~/.hanork suporta WAL e evita lock no boot.
        process.env.SQLITE_JOURNAL_MODE = isDrvfsPath(dbPath) ? 'DELETE' : 'WAL';
    }
    if (!process.env.ZERO_DIVU_DB_PATH) {
        process.env.ZERO_DIVU_DB_PATH = path.join(os.homedir(), '.zero-divu', 'zero-divu.db');
    }
    if (process.env.ZERO_DIVU_USE_HANORK_DB == null || process.env.ZERO_DIVU_USE_HANORK_DB === '') {
        process.env.ZERO_DIVU_USE_HANORK_DB = '0';
    }

    const dirs = [
        path.dirname(process.env.HANORK_DB_PATH || path.join(os.homedir(), '.hanork', 'hanork.db')),
        path.dirname(process.env.ZERO_DIVU_DB_PATH),
        path.join(REPO_ROOT, 'shared', 'zero-ipc'),
        path.join(REPO_ROOT, 'uploads'),
    ];
    for (const dir of dirs) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch { /* ignore */ }
    }
}

function ensureNativeModules() {
    try {
        require('../../scripts/ensure-native-sqlite.js').main();
        return;
    } catch (e) {
        appendBootFatal(`better-sqlite3: ${e?.message || e}`);
        throw e;
    }
}

function checkRequiredEnv() {
    const { isPlaceholderToken } = require('../system/firstRunBootstrap');
    const required = ['TOKEN_TELEGRAM', 'ID_DONO'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
        const msg = `[ENV] Variáveis obrigatórias ausentes: ${missing.join(', ')} — preencha o .env`;
        appendBootFatal(msg);
        console.error(msg);
        process.exit(1);
    }
    if (isPlaceholderToken(process.env.TOKEN_TELEGRAM)) {
        const msg = '[ENV] TOKEN_TELEGRAM ainda é placeholder — crie o bot no @BotFather e cole o token no .env';
        appendBootFatal(msg);
        console.error(msg);
        console.error('[ENV] Depois reinicie: node src/bot.js');
        process.exit(1);
    }
    if (!process.env.TOKEN_MP || process.env.TOKEN_MP.length <= 10) {
        console.warn('[ENV] TOKEN_MP não configurado — Mercado Pago desativado.');
        console.warn('[ENV] Bot funcionará normalmente, mas pagamentos serão redirecionados ao suporte.');
    }
}

function acquireInstanceLock() {
    try {
        const result = botInstanceLock.acquireBotInstanceLock();
        if (result.duplicate) {
            const pid = result.pid || botInstanceLock.readLockPid();
            const phase = result.starting ? 'iniciando' : 'rodando';
            console.log(`[✓] Bot já ${phase}${pid ? ` (PID ${pid})` : ''} — conectando aos logs…`);
            console.log('[i] Este terminal só mostra logs — fechar ou Ctrl+C não para o bot.');
            printControlHints();
            console.log('');
            const logPath = resolveTerminalLogPath();
            if (fs.existsSync(logPath)) {
                console.log(`[→] Logs ao vivo (${logPath}) — Ctrl+C só fecha este terminal\n`);
                followTerminalLog({ lines: 120 });
            } else {
                console.log(`[…] Aguardando log em ${logPath} (bot ainda carregando)…\n`);
                const deadline = Date.now() + 120000;
                while (Date.now() < deadline && !fs.existsSync(logPath)) {
                    if (pid && !botInstanceLock.isHanorkBotPid(pid)) break;
                    // eslint-disable-next-line no-sync
                    require('child_process').spawnSync('sleep', ['1'], { stdio: 'ignore' });
                }
                if (fs.existsSync(logPath)) followTerminalLog({ lines: 120 });
            }
            process.exit(0);
        }
        resetTerminalLog();
        const { printStartupBanner } = require('../logging/banner');
        printStartupBanner();
        const pid = process.pid;
        if (result.replaced) {
            console.warn(`[LOCK] Instância anterior encerrada — bot ativo com PID ${pid}`);
        } else if (result.acquired) {
            logger.info(`[LOCK] Instância única adquirida (PID ${pid})`);
        }
        return result;
    } catch (e) {
        console.warn('[LOCK] Aviso lock file:', e.message);
        return { acquired: false, duplicate: false };
    }
}

function runPreBoot() {
    // WSL/SSH: fechar terminal manda SIGHUP — Node encerra por padrão sem log.
    process.on('SIGHUP', () => {
        try {
            console.warn('[SYSTEM] SIGHUP ignorado — bot continua (terminal fechado?)');
        } catch { /* ignore */ }
    });

    applyHanorkRuntimePaths();
    applyDefaultTerminalLogEnv();

    try {
        const { runFirstBootSetup } = require('../system/firstRunBootstrap');
        runFirstBootSetup({ repoRoot: REPO_ROOT });
    } catch (e) {
        console.warn('[FIRST-RUN] Bootstrap ignorado:', e.message);
    }

    try {
        const { initializeTerminal } = require('../system/terminalBootstrap');
        const terminal = initializeTerminal({ repoRoot: REPO_ROOT });
        if (terminal.ok && !terminal.skipped) {
            console.log('[TERMINAL] Personalização aplicada — abra um novo terminal para o dashboard Hanork.');
        }
    } catch (e) {
        console.warn('[TERMINAL] Bootstrap ignorado:', e.message);
    }

    acquireInstanceLock();
    ensureNativeModules();

    try {
        const { initializeClientDatabases } = require('../system/firstRunBootstrap');
        initializeClientDatabases({ repoRoot: REPO_ROOT });
    } catch (e) {
        console.warn('[FIRST-RUN] Bancos (serão criados no boot):', e.message);
    }

    checkRequiredEnv();
    validateSecurityEnv();
    try {
        const { assertZerotwoApiKeyAtBoot } = require('../config/zerotwoEnv');
        assertZerotwoApiKeyAtBoot(logger);
    } catch (e) {
        appendBootFatal(`API_KEY_ZEROTWO: ${e?.message || e}`);
        throw e;
    }
}

module.exports = {
    runPreBoot,
    applyHanorkRuntimePaths,
    ensureNativeModules,
    checkRequiredEnv,
    acquireInstanceLock,
    printControlHints,
};
