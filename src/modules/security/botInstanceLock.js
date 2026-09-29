'use strict';

/**
 * Lock de instância única — evita erro 409 do Telegram.
 * Pensado para PM2 + autostart no Ubuntu (lock órfão, dupla inicialização).
 */
const fs = require('fs');
const path = require('path');

const LOCK_FILE = path.join(__dirname, '../../../.bot.lock');

const BOOT_GRACE_MS = Math.max(15000, parseInt(process.env.BOT_LOCK_BOOT_GRACE_MS || '45000', 10));
const MAX_WAIT_MS = Math.max(BOOT_GRACE_MS, parseInt(process.env.BOT_LOCK_MAX_WAIT_MS || '120000', 10));
const POLL_MS = Math.max(200, parseInt(process.env.BOT_LOCK_POLL_MS || '1500', 10));

let _lockFd = null;

function sleepSync(ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { /* sync wait */ }
}

function readLockPid() {
    try {
        if (!fs.existsSync(LOCK_FILE)) return null;
        const n = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
        return Number.isFinite(n) && n > 1 ? n : null;
    } catch {
        return null;
    }
}

function lockFileAgeMs() {
    try {
        return Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    } catch {
        return Infinity;
    }
}

function pidAlive(pid) {
    const n = parseInt(pid, 10);
    if (!Number.isFinite(n) || n <= 1) return false;
    try {
        process.kill(n, 0);
        return true;
    } catch {
        return false;
    }
}

function readProcCwd(pid) {
    try {
        return fs.realpathSync(`/proc/${pid}/cwd`);
    } catch {
        return '';
    }
}

function isHanorkBotCmdline(cmd, cwd) {
    if (/hanork[/\\].*[/\\]src[/\\]bot\.js/i.test(cmd)) return true;
    if (/ecosystem\.config\.js/i.test(cmd) && /hanork/i.test(cmd)) return true;
    if (/\bsrc[/\\]bot\.js\b/i.test(cmd) && /hanork/i.test(cwd || cmd)) return true;
    return false;
}

function isHanorkBotPid(pid) {
    const n = parseInt(pid, 10);
    if (!Number.isFinite(n) || n <= 1 || n === process.pid) return false;
    if (!pidAlive(n)) return false;

    if (process.platform === 'linux') {
        try {
            const cmd = fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').replace(/\0/g, ' ');
            const cwd = readProcCwd(n);
            return isHanorkBotCmdline(cmd, cwd);
        } catch {
            return false;
        }
    }
    return true;
}

function removeLockFileQuiet() {
    try {
        if (typeof fs.rmSync === 'function') {
            fs.rmSync(LOCK_FILE, { force: true });
        } else if (fs.existsSync(LOCK_FILE)) {
            fs.unlinkSync(LOCK_FILE);
        }
    } catch (e) {
        if (e.code !== 'ENOENT') throw e;
    }
}

function releaseLockHandle() {
    try {
        if (_lockFd != null) {
            fs.closeSync(_lockFd);
            _lockFd = null;
        }
    } catch { /* ignore */ }
    removeLockFileQuiet();
}

function stopHanorkBotPid(pid) {
    if (!isHanorkBotPid(pid)) return false;
    console.warn(`[LOCK] Encerrando instância anterior (PID ${pid})…`);
    try {
        process.kill(pid, 'SIGTERM');
    } catch { /* ignore */ }
    for (let i = 0; i < 50; i++) {
        if (!isHanorkBotPid(pid)) return true;
        sleepSync(200);
    }
    try {
        if (isHanorkBotPid(pid)) {
            process.kill(pid, 'SIGKILL');
            console.warn(`[LOCK] SIGKILL no PID ${pid}`);
        }
    } catch { /* ignore */ }
    sleepSync(400);
    return true;
}

/** Lock órfão: PID morto, inválido ou arquivo sem PID legível. */
function isStaleLock() {
    if (!fs.existsSync(LOCK_FILE)) return false;
    const pid = readLockPid();
    if (!pid) return true;
    if (!pidAlive(pid)) return true;
    if (!isHanorkBotPid(pid)) {
        const age = lockFileAgeMs();
        if (age > 60000) return true;
    }
    return false;
}

function tryAcquireOnce() {
    _lockFd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeFileSync(_lockFd, String(process.pid));
    return true;
}

function underPm2() {
    return !!(process.env.PM2_HOME || process.env.pm_id != null);
}

function shouldWaitForExistingBoot() {
    return process.env.BOT_LOCK_WAIT_FOR_BOOT === '1' || underPm2();
}

function registerExitRelease() {
    process.on('exit', () => {
        try {
            releaseLockHandle();
        } catch { /* ignore */ }
    });
    // Mantém .bot.lock alinhado ao PID vivo (evita lock órfão após restart)
    const refreshMs = Math.max(30000, parseInt(process.env.BOT_LOCK_REFRESH_MS || '60000', 10));
    setInterval(() => {
        try {
            refreshLockPid();
        } catch { /* ignore */ }
    }, refreshMs).unref?.();
}

/**
 * @returns {{ acquired: boolean, replaced: boolean, duplicate: boolean, pid?: number, starting?: boolean }}
 */
function duplicateLockResult(pid) {
    const starting = lockFileAgeMs() < BOOT_GRACE_MS;
    return {
        acquired: false,
        replaced: false,
        duplicate: true,
        pid: pid || readLockPid(),
        starting,
    };
}

function acquireBotInstanceLock() {
    if (process.env.DISABLE_BOT_LOCK === '1') {
        console.warn('[LOCK] Lock desativado (DISABLE_BOT_LOCK=1)');
        return { acquired: true, replaced: false, duplicate: false };
    }

    if (process.env.BOT_LOCK_NO_REPLACE === '1') {
        const oldPid = readLockPid();
        if (isHanorkBotPid(oldPid)) {
            console.error(`[LOCK] Outra instância ativa (PID ${oldPid}).`);
            process.exit(1);
        }
        removeLockFileQuiet();
    }

    const waitForExisting = shouldWaitForExistingBoot();
    const deadline = Date.now() + MAX_WAIT_MS;
    let lastWaitLogAt = 0;

    while (Date.now() < deadline) {
        if (isStaleLock()) {
            releaseLockHandle();
            removeLockFileQuiet();
        }

        const existingPid = readLockPid();
        if (isHanorkBotPid(existingPid)) {
            if (!waitForExisting) {
                return duplicateLockResult(existingPid);
            }

            const left = Math.max(0, Math.round((BOOT_GRACE_MS - lockFileAgeMs()) / 1000));
            const now = Date.now();
            if (now - lastWaitLogAt >= 10000) {
                lastWaitLogAt = now;
                const phase = left > 0 ? `iniciando (~${left}s restantes)` : 'encerrando';
                console.warn(`[LOCK] Outra instância Hanork ${phase} (PID ${existingPid}). Aguardando…`);
            }
            sleepSync(POLL_MS);
            continue;
        }

        if (existingPid && pidAlive(existingPid) && !isHanorkBotPid(existingPid)) {
            removeLockFileQuiet();
        }

        try {
            tryAcquireOnce();
            registerExitRelease();
            return { acquired: true, replaced: false, duplicate: false };
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
        }

        const oldPid = readLockPid();
        if (!oldPid || !pidAlive(oldPid) || !isHanorkBotPid(oldPid)) {
            removeLockFileQuiet();
            sleepSync(300);
            continue;
        }

        if (!waitForExisting) {
            return duplicateLockResult(oldPid);
        }

        sleepSync(POLL_MS);
    }

    const oldPid = readLockPid();
    if (isHanorkBotPid(oldPid)) {
        return duplicateLockResult(oldPid);
    }

    if (isStaleLock()) {
        removeLockFileQuiet();
        try {
            tryAcquireOnce();
            registerExitRelease();
            return { acquired: true, replaced: false, duplicate: false };
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
        }
    }

    console.error('[LOCK] Não foi possível adquirir lock após várias tentativas.');
    console.error('[LOCK] Tente: rm -f .bot.lock && node src/bot.js');
    process.exit(1);
}

function refreshLockPid() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            fs.writeFileSync(LOCK_FILE, String(process.pid));
        }
    } catch { /* ignore */ }
}

module.exports = {
    LOCK_FILE,
    acquireBotInstanceLock,
    releaseLockHandle,
    refreshLockPid,
    readLockPid,
    isHanorkBotPid,
    isStaleLock,
    removeLockFileQuiet,
};
