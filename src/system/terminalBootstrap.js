'use strict';

/**
 * Personalização segura do terminal Linux na primeira execução do Hanork.
 * - Backup antes de alterar rc files
 * - Bloco delimitado # HANORK START / # HANORK END
 * - Marcador ~/.hanork_initialized (executa uma vez)
 * - Rollback: npm run terminal:restore
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const MARKER_START = '# HANORK START';
const MARKER_END = '# HANORK END';
const INIT_MARKER = path.join(os.homedir(), '.hanork_initialized');

const SUPPORTED_IDS = new Set(['ubuntu', 'debian', 'linuxmint', 'pop', 'elementary', 'zorin', 'kali']);

const APT_PACKAGES = [
    { cmd: 'neofetch', pkgs: ['neofetch'] },
    { cmd: 'fastfetch', pkgs: ['fastfetch'] },
    { cmd: 'figlet', pkgs: ['figlet'] },
    { cmd: 'lolcat', pkgs: ['lolcat'] },
    { cmd: 'toilet', pkgs: ['toilet'] },
];

function resolveRepoRoot(explicit) {
    return path.resolve(explicit || path.join(__dirname, '../..'));
}

/** WSL prod: terminal deve usar ~/hanork (LF), não /mnt/c/ (CRLF do Windows). */
function resolveTerminalRoot(explicit) {
    const root = resolveRepoRoot(explicit);
    if (process.platform !== 'linux') return root;
    const posix = root.replace(/\\/g, '/');
    if (!/^\/mnt\/[a-z]\//i.test(posix)) return root;
    const wslHanork = path.join(os.homedir(), 'hanork');
    try {
        if (fs.existsSync(path.join(wslHanork, 'package.json'))) {
            return wslHanork;
        }
    } catch {
        /* ignore */
    }
    return root;
}

function resolveLogPath(repoRoot) {
    const dir = path.join(repoRoot, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'terminal-bootstrap.log');
}

function appendLog(repoRoot, level, message, extra) {
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        user: os.userInfo().username,
        message,
        ...(extra || {}),
    });
    try {
        fs.appendFileSync(resolveLogPath(repoRoot), `${line}\n`, 'utf8');
    } catch {
        /* ignore */
    }
}

function commandExists(cmd) {
    try {
        execSync(`command -v ${cmd}`, { stdio: 'pipe', shell: '/bin/bash' });
        return true;
    } catch {
        return false;
    }
}

function readOsRelease() {
    try {
        return fs.readFileSync('/etc/os-release', 'utf8');
    } catch {
        return '';
    }
}

function isSupportedLinux() {
    if (process.platform !== 'linux') return false;
    const content = readOsRelease().toLowerCase();
    if (!content) return false;
    for (const id of SUPPORTED_IDS) {
        if (content.includes(`id=${id}`) || content.includes(`id_like=${id}`) || content.includes(`${id}`)) {
            return true;
        }
    }
    return /debian|ubuntu/i.test(content);
}

function detectShellConfigs() {
    const home = os.homedir();
    const configs = [];

    if (process.env.SHELL?.includes('fish') || fs.existsSync(path.join(home, '.config/fish/config.fish'))) {
        configs.push({ shell: 'fish', rcPath: path.join(home, '.config/fish/config.fish') });
    }
    if (process.env.SHELL?.includes('zsh') || fs.existsSync(path.join(home, '.zshrc'))) {
        configs.push({ shell: 'zsh', rcPath: path.join(home, '.zshrc') });
    }
    configs.push({ shell: 'bash', rcPath: path.join(home, '.bashrc') });

    const seen = new Set();
    return configs.filter((c) => {
        if (seen.has(c.rcPath)) return false;
        seen.add(c.rcPath);
        return true;
    });
}

function validateRcPath(rcPath) {
    const home = os.homedir();
    const resolved = path.resolve(rcPath);
    if (!resolved.startsWith(home)) {
        throw new Error(`Caminho fora do home: ${resolved}`);
    }
    return resolved;
}

function backupRcFile(rcPath) {
    const safe = validateRcPath(rcPath);
    const backup = `${safe}.hanork.backup`;
    if (fs.existsSync(backup)) return backup;
    if (fs.existsSync(safe)) {
        fs.copyFileSync(safe, backup);
    }
    return backup;
}

function removeHanorkBlock(content) {
    const re = new RegExp(
        `${MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
        'g'
    );
    return content.replace(re, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function buildHanorkBlock(repoRoot, shell) {
    const posix = repoRoot.replace(/\\/g, '/');
    if (shell === 'fish') {
        return [
            MARKER_START,
            '# Gerado por Hanork — restaurar: npm run terminal:restore',
            `set -gx HANORK_ROOT "${posix}"`,
            'if test -f "$HANORK_ROOT/scripts/hanork-terminal-welcome.fish"',
            '    source "$HANORK_ROOT/scripts/hanork-terminal-welcome.fish"',
            'end',
            MARKER_END,
            '',
        ].join('\n');
    }
    return [
        MARKER_START,
        '# Gerado por Hanork — restaurar: npm run terminal:restore',
        `export HANORK_ROOT="${posix}"`,
        'export HANORK_AUTOSTART="${HANORK_AUTOSTART:-1}"',
        'export HANORK_TERMINAL_LOG="${HANORK_TERMINAL_LOG:-$HOME/.hanork/terminal.log}"',
        'if [ -f "$HANORK_ROOT/scripts/hanork-terminal-welcome.sh" ]; then',
        '  # shellcheck source=/dev/null',
        '  . "$HANORK_ROOT/scripts/hanork-terminal-welcome.sh"',
        'fi',
        MARKER_END,
        '',
    ].join('\n');
}

function configureShell(shell, rcPath, repoRoot) {
    const safe = validateRcPath(rcPath);
    const dir = path.dirname(safe);
    fs.mkdirSync(dir, { recursive: true });

    backupRcFile(safe);
    const existing = fs.existsSync(safe) ? fs.readFileSync(safe, 'utf8') : '';
    const cleaned = removeHanorkBlock(existing);
    const block = buildHanorkBlock(repoRoot, shell);
    const next = cleaned ? `${cleaned}\n\n${block}` : block;
    fs.writeFileSync(safe, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
    return safe;
}

function ensureProfileSourcesBashrc() {
    const profile = path.join(os.homedir(), '.profile');
    const line = '[ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"';
    if (!fs.existsSync(profile)) {
        fs.writeFileSync(profile, `${line}\n`, 'utf8');
        return;
    }
    const content = fs.readFileSync(profile, 'utf8');
    if (!content.includes('.bashrc')) {
        fs.appendFileSync(profile, `\n${line}\n`, 'utf8');
    }
}

function tryInstallPackage(pkgs) {
    const list = pkgs.join(' ');
    try {
        execSync(`sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y ${list}`, {
            stdio: 'pipe',
            timeout: 180000,
            shell: '/bin/bash',
        });
        return { ok: true, method: 'apt' };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

function installDependencies(repoRoot) {
    const results = [];
    const needNeofetch = !commandExists('neofetch') && !commandExists('fastfetch');

    for (const item of APT_PACKAGES) {
        if (commandExists(item.cmd)) {
            results.push({ cmd: item.cmd, status: 'present' });
            continue;
        }
        if (item.cmd === 'fastfetch' && !needNeofetch) {
            results.push({ cmd: item.cmd, status: 'skipped' });
            continue;
        }
        if (item.cmd === 'neofetch' && !needNeofetch && commandExists('fastfetch')) {
            results.push({ cmd: item.cmd, status: 'skipped_fastfetch' });
            continue;
        }

        const install = tryInstallPackage(item.pkgs);
        results.push({
            cmd: item.cmd,
            status: install.ok ? 'installed' : 'missing',
            detail: install.ok ? install.method : install.error,
        });
        appendLog(repoRoot, install.ok ? 'INFO' : 'WARN', `pacote ${item.cmd}`, results[results.length - 1]);
    }
    return results;
}

function writeInitMarker(repoRoot, meta) {
    const payload = {
        initializedAt: new Date().toISOString(),
        hanorkVersion: require(path.join(repoRoot, 'package.json')).version,
        user: os.userInfo().username,
        hostname: os.hostname(),
        platform: process.platform,
        shells: meta.shells,
        packages: meta.packages,
    };
    fs.writeFileSync(INIT_MARKER, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function isInitialized() {
    return fs.existsSync(INIT_MARKER);
}

function initializeTerminal(opts = {}) {
    const repoRoot = resolveTerminalRoot(opts.repoRoot);
    const force = Boolean(opts.force);

    if (!force && isInitialized()) {
        appendLog(repoRoot, 'INFO', 'skip — já inicializado', { marker: INIT_MARKER });
        return { ok: true, skipped: true, reason: 'already_initialized' };
    }

    if (!isSupportedLinux()) {
        appendLog(repoRoot, 'INFO', 'skip — SO não suportado', { platform: process.platform });
        return { ok: true, skipped: true, reason: 'unsupported_os' };
    }

    const shells = detectShellConfigs();
    const packages = installDependencies(repoRoot);
    const configured = [];

    try {
        for (const { shell, rcPath } of shells) {
            const target = configureShell(shell, rcPath, repoRoot);
            configured.push({ shell, rcPath: target });
            appendLog(repoRoot, 'INFO', `shell configurado: ${shell}`, { rcPath: target });
        }
        if (shells.some((s) => s.shell === 'bash')) {
            ensureProfileSourcesBashrc();
        }
        writeInitMarker(repoRoot, { shells: configured, packages });
        appendLog(repoRoot, 'INFO', 'terminal bootstrap concluído', { configured });
        return { ok: true, configured, packages };
    } catch (e) {
        appendLog(repoRoot, 'ERROR', 'falha no bootstrap', { error: e.message });
        return { ok: false, error: e.message };
    }
}

function restoreFromBackup(rcPath) {
    const safe = validateRcPath(rcPath);
    const backup = `${safe}.hanork.backup`;
    if (!fs.existsSync(backup)) return false;
    fs.copyFileSync(backup, safe);
    return true;
}

function restoreTerminal(opts = {}) {
    const repoRoot = resolveRepoRoot(opts.repoRoot);
    const shells = detectShellConfigs();
    const restored = [];

    for (const { shell, rcPath } of shells) {
        const safe = validateRcPath(rcPath);
        if (restoreFromBackup(safe)) {
            restored.push({ shell, rcPath: safe, method: 'backup' });
            appendLog(repoRoot, 'INFO', `restaurado via backup: ${shell}`, { rcPath: safe });
            continue;
        }
        if (fs.existsSync(safe)) {
            const cleaned = `${removeHanorkBlock(fs.readFileSync(safe, 'utf8'))}\n`;
            fs.writeFileSync(safe, cleaned, 'utf8');
            restored.push({ shell, rcPath: safe, method: 'block_removed' });
            appendLog(repoRoot, 'INFO', `bloco removido: ${shell}`, { rcPath: safe });
        }
    }

    if (fs.existsSync(INIT_MARKER)) {
        const archive = `${INIT_MARKER}.restored.${Date.now()}`;
        fs.renameSync(INIT_MARKER, archive);
        appendLog(repoRoot, 'INFO', 'marcador arquivado', { archive });
    }

    appendLog(repoRoot, 'INFO', 'rollback concluído', { restored });
    return { ok: true, restored };
}

function createBanner() {
    return [
        '██╗  ██╗ █████╗ ███╗   ██╗ ██████╗ ██████╗ ██╗  ██╗',
        '██║  ██║██╔══██╗████╗  ██║██╔═══██╗██╔══██╗██║ ██╔╝',
        '███████║███████║██╔██╗ ██║██║   ██║██████╔╝█████╔╝ ',
        '██╔══██║██╔══██║██║╚██╗██║██║   ██║██╔══██╗██╔═██╗ ',
        '██║  ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║██║  ██╗',
        '╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝',
        '',
        'Hanork Platform',
        'Telegram Commerce Engine',
    ].join('\n');
}

function runCli(argv = process.argv.slice(2)) {
    const cmd = argv[0];
    const repoRoot = resolveTerminalRoot(argv.find((a) => a.startsWith('/') || /^[A-Za-z]:/.test(a)));

    if (cmd === 'restore') {
        const result = restoreTerminal({ repoRoot });
        console.log('[HANORK] Terminal restaurado.');
        for (const r of result.restored) {
            console.log(`  - ${r.shell}: ${r.rcPath} (${r.method})`);
        }
        console.log(`Log: ${resolveLogPath(repoRoot)}`);
        return result;
    }

    if (cmd === 'init' || cmd === 'install') {
        const result = initializeTerminal({ repoRoot, force: argv.includes('--force') });
        if (result.skipped) {
            console.log(`[HANORK] Bootstrap ignorado (${result.reason}). Use --force para reexecutar.`);
        } else if (result.ok) {
            console.log('[HANORK] Terminal configurado. Abra um novo terminal para ver o dashboard.');
            for (const c of result.configured || []) {
                console.log(`  - ${c.shell}: ${c.rcPath}`);
            }
        } else {
            console.error('[HANORK] Falha:', result.error);
            process.exitCode = 1;
        }
        return result;
    }

    console.log('Uso: node scripts/hanork-terminal.js <init|restore> [--force]');
    process.exitCode = 1;
    return null;
}

module.exports = {
    MARKER_START,
    MARKER_END,
    INIT_MARKER,
    initializeTerminal,
    installDependencies,
    configureShell,
    createBanner,
    restoreTerminal,
    isSupportedLinux,
    isInitialized,
    detectShellConfigs,
    appendLog,
    resolveLogPath,
    runCli,
};

if (require.main === module) {
    runCli();
}
