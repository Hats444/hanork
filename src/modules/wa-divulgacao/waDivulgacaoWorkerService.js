'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ZERO_DIVU_CONFIG, isZeroDivuEnabled, getIpcToken } = require('../../plugins/zero-divu/config');
const { getWaDivulgacaoClient, USER_PING_TIMEOUT_MS } = require('./waDivulgacaoClient');
const WaDivulgacaoConfig = require('./waDivulgacaoConfig');
const logger = require('../../config/logger');

const userWorkers = new Map();
const spawningSessions = new Set();
const WORKER_BOOT_WAIT_MS = Number(process.env.WA_DIVULGACAO_WORKER_BOOT_MS) || 60000;
const WORKER_RECLAIM_WAIT_MS = Number(process.env.WA_DIVULGACAO_RECLAIM_WAIT_MS) || 600;
/** Login (QR/código): curto — fila IPC aceita comando mesmo com worker subindo. */
const LOGIN_FAST_WAIT_MS = Number(process.env.WA_DIV_LOGIN_WAIT_MS) || 5000;
const LOGIN_FAST_PING_MS = Number(process.env.WA_DIV_LOGIN_PING_MS) || 1500;

let shutdownHooked = false;

function isPidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e?.code === 'EPERM';
    }
}

function workerMarkerPath(conf) {
    return path.join(conf.ipcDir, 'hanork-worker.json');
}

function readWorkerMarker(conf) {
    try {
        const raw = fs.readFileSync(workerMarkerPath(conf), 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeWorkerMarker(conf, workerPid) {
    fs.mkdirSync(conf.ipcDir, { recursive: true });
    fs.writeFileSync(
        workerMarkerPath(conf),
        JSON.stringify(
            {
                hanorkPid: process.pid,
                workerPid: workerPid || null,
                telegramId: conf.telegramId,
                sessionId: conf.sessionId,
                at: new Date().toISOString(),
            },
            null,
            2
        )
    );
}

function killPidGraceful(pid, signal = 'SIGTERM') {
    if (!pid || pid === process.pid || !isPidAlive(pid)) return false;
    try {
        process.kill(pid, signal);
        return true;
    } catch {
        return false;
    }
}

function readProcEnv(pid) {
    if (!pid || process.platform !== 'linux') return '';
    try {
        return fs.readFileSync(`/proc/${pid}/environ`).toString('utf8');
    } catch {
        return '';
    }
}

/** §6.5 — nunca encerrar wa_a/wa_b nem worker fora do escopo assinante. */
function isAdminWaProcess(pid) {
    const env = readProcEnv(pid);
    if (!env) return false;
    const m = env.match(/WA_SESSION_ID=([^\0]+)/);
    const sid = m ? m[1] : '';
    return sid === 'wa_a' || sid === 'wa_b';
}

function isSubscriberWaProcess(pid) {
    return readProcEnv(pid).includes('WA_DIVULGACAO_USER=1');
}

function safeKillSubscriberWorker(pid, signal = 'SIGTERM') {
    if (!pid || pid === process.pid || !isPidAlive(pid)) return false;
    if (isAdminWaProcess(pid)) {
        logger.warn('[WaDivulgacao] kill bloqueado — worker admin (wa_a/wa_b)', { pid });
        return false;
    }
    if (!isSubscriberWaProcess(pid)) {
        logger.warn('[WaDivulgacao] kill bloqueado — não é worker assinante', { pid });
        return false;
    }
    return killPidGraceful(pid, signal);
}

function findWorkerPidForIpc(conf) {
    if (process.platform !== 'linux') return null;
    const needle = `ZERO_DIVU_IPC_DIR=${conf.ipcDir}`;
    try {
        for (const name of fs.readdirSync('/proc')) {
            if (!/^\d+$/.test(name)) continue;
            const pid = Number(name);
            if (!pid || pid === process.pid) continue;
            try {
                const env = fs.readFileSync(`/proc/${pid}/environ`).toString('utf8');
                if (env.includes(needle) && env.includes('WA_DIVULGACAO_USER=1')) return pid;
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* ignore */
    }
    return null;
}

function readHanorkParentFromProc(pid) {
    if (!pid || process.platform !== 'linux') return null;
    try {
        const env = fs.readFileSync(`/proc/${pid}/environ`).toString('utf8');
        const m = env.match(/HANORK_PARENT_PID=(\d+)/);
        return m ? Number(m[1]) : null;
    } catch {
        return null;
    }
}

/** Mata worker órfão (bot reiniciou) ou duplicado na mesma sessão. */
async function reclaimStaleUserWorker(conf) {
    const marker = readWorkerMarker(conf);
    const ipcPid = findWorkerPidForIpc(conf);
    const targetPid = ipcPid || marker?.workerPid || null;
    let killed = false;
    const reasons = [];

    if (targetPid && isPidAlive(targetPid)) {
        const parentFromProc = readHanorkParentFromProc(targetPid);
        const parentDead = parentFromProc ? !isPidAlive(parentFromProc) : marker?.hanorkPid ? !isPidAlive(marker.hanorkPid) : true;
        const wrongParent =
            (parentFromProc && parentFromProc !== process.pid) ||
            (marker?.hanorkPid && marker.hanorkPid !== process.pid);
        if (parentDead || wrongParent || !marker) {
            if (safeKillSubscriberWorker(targetPid)) {
                killed = true;
                reasons.push(parentDead ? 'parent_dead' : wrongParent ? 'parent_mismatch' : 'legacy_untracked');
            }
            await new Promise((r) => setTimeout(r, 800));
            if (isPidAlive(targetPid)) {
                safeKillSubscriberWorker(targetPid, 'SIGKILL');
                killed = true;
                reasons.push('sigkill');
            }
        }
    }

    const tracked = userWorkers.get(conf.sessionId);
    if (tracked?.proc?.pid && tracked.proc.pid !== marker?.workerPid) {
        if (!isPidAlive(tracked.proc.pid)) {
            userWorkers.delete(conf.sessionId);
        }
    }

    if (killed) {
        try {
            const statePath = path.join(conf.ipcDir, 'state.json');
            if (fs.existsSync(statePath)) {
                const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                st.ipcOnline = false;
                st.updatedAt = new Date().toISOString();
                fs.writeFileSync(statePath, JSON.stringify(st, null, 2));
            }
        } catch {
            /* ignore */
        }
        logger.warn('[WaDivulgacao] Worker órfão encerrado', {
            telegramId: conf.telegramId,
            pid: marker?.workerPid,
            reasons,
        });
        await new Promise((r) => setTimeout(r, WORKER_RECLAIM_WAIT_MS));
    }

    return killed;
}

function isWorkerHealthy(conf, client) {
    const ipcPid = findWorkerPidForIpc(conf);
    const marker = readWorkerMarker(conf);
    const tracked = userWorkers.get(conf.sessionId);

    if (tracked?.proc?.pid && isPidAlive(tracked.proc.pid)) {
        return true;
    }

    if (ipcPid) {
        const parent = readHanorkParentFromProc(ipcPid);
        if (parent && parent !== process.pid) return false;
        if (marker?.hanorkPid && marker.hanorkPid !== process.pid) return false;
        return isPidAlive(ipcPid);
    }

    if (marker?.workerPid) {
        if (!isPidAlive(marker.workerPid)) return false;
        if (marker.hanorkPid && marker.hanorkPid !== process.pid) return false;
        return true;
    }

    return client.isWorkerLikelyOnline();
}

async function pingWorkerIpc(telegramId, timeoutMs = USER_PING_TIMEOUT_MS) {
    const { client } = getWaDivulgacaoClient(telegramId);
    const raw = client.rawSendCommand;
    if (!raw) return null;
    return raw('wa.ping', {}, telegramId, { timeoutMs, _noRecover: true }).catch(() => null);
}

function buildUserWorkerEnv(conf) {
    const sessionDir = path.join(conf.sessionDir, 'auth');
    const token = getIpcToken();
    return {
        ...process.env,
        HANORK_ZERO_WORKER: '1',
        HANORK_PARENT_PID: String(process.pid),
        ZERO_DIVU_NO_RESTART: '1',
        ZERO_DIVU_IPC_DIR: conf.ipcDir,
        ZERO_DIVU_SESSION_DIR: sessionDir,
        ZERO_DIVU_DB_PATH: conf.dbPath,
        ZERO_DIVU_USE_HANORK_DB: '0',
        ZERO_DIVU_STORAGE: 'sql',
        ZERO_DIVU_MULTI_SESSION: '1',
        WA_SESSION_ID: conf.sessionId,
        WA_DISPLAY_NAME: conf.displayName,
        WA_DIVULGACAO_USER: '1',
        STATUS_MIRROR_TO_CHAT: '0',
        ZERO_MAX_GROUPS: String(WaDivulgacaoConfig.maxGroupsDefault),
        ZERO_DIVU_PROFILE: process.env.WA_DIVULGACAO_PROFILE || 'safe',
        CONNECTION_WARMUP_MS: '0',
        PROMO_QUEUE_POLL_MS: '0',
        BOT_USERNAME: process.env.BOT_USERNAME || process.env.HANORK_BOT_USERNAME || 'hanork_bot',
        ...(token ? { ZERO_IPC_TOKEN: token } : {}),
    };
}

function attachWorkerLogs(proc, conf) {
    const tag = `[WaDivulgacao:${conf.telegramId}]`;
    proc.stdout?.on('data', (buf) => {
        const line = String(buf || '').trim();
        if (line) logger.debug(`${tag} stdout`, { line: line.slice(0, 500) });
    });
    proc.stderr?.on('data', (buf) => {
        const line = String(buf || '').trim();
        if (line) logger.warn(`${tag} stderr`, { line: line.slice(0, 500) });
    });
    proc.on('exit', (code, signal) => {
        userWorkers.delete(conf.sessionId);
        const marker = readWorkerMarker(conf);
        if (marker?.workerPid === proc.pid) {
            try {
                fs.unlinkSync(workerMarkerPath(conf));
            } catch {
                /* ignore */
            }
        }
        if (code !== 0 && code != null) {
            logger.warn('[WaDivulgacao] Worker usuário encerrou', {
                telegramId: conf.telegramId,
                code,
                signal,
            });
            try {
                const { bumpMetric } = require('./waDivulgacaoOpsMetrics');
                bumpMetric('worker_restarts');
            } catch {
                /* ignore */
            }
            const tid = conf.telegramId;
            const { deferBackground } = require('../../utils/defer');
            deferBackground(`wadv-worker-restart-${tid}`, async () => {
                await new Promise((r) => setTimeout(r, 1500));
                if (!isPidAlive(process.pid)) return;
                try {
                    await ensureUserWorkerReady(tid, { maxWaitMs: WORKER_BOOT_WAIT_MS });
                    logger.info('[WaDivulgacao] Worker usuário reiniciado após crash', { telegramId: tid });
                } catch (e) {
                    logger.warn('[WaDivulgacao] worker auto-restart failed', {
                        telegramId: tid,
                        error: e?.message,
                    });
                }
            });
        }
    });
}

function registerShutdownHook() {
    if (shutdownHooked) return;
    shutdownHooked = true;
    const stopAll = () => {
        for (const [, entry] of userWorkers) {
            if (entry?.proc?.pid) safeKillSubscriberWorker(entry.proc.pid);
        }
    };
    process.once('SIGTERM', stopAll);
    process.once('SIGINT', stopAll);
}

async function waitForWorkerOnline(client, telegramId, maxMs = WORKER_BOOT_WAIT_MS) {
    const stepMs = 400;
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        const ping = await pingWorkerIpc(telegramId, Math.min(USER_PING_TIMEOUT_MS, deadline - Date.now()));
        if (ping?.ok) return true;
        if (client.isWorkerLikelyOnline()) {
            const retry = await pingWorkerIpc(telegramId, Math.min(3000, deadline - Date.now()));
            if (retry?.ok) return true;
        }
        await new Promise((r) => setTimeout(r, stepMs));
    }
    return false;
}

async function ensureUserWorker(telegramId) {
    if (!isZeroDivuEnabled()) return { ok: false, reason: 'zero_divu_off' };
    registerShutdownHook();

    const { client, conf } = getWaDivulgacaoClient(telegramId);

    const liveIpcPid = findWorkerPidForIpc(conf);
    if (liveIpcPid && isPidAlive(liveIpcPid)) {
        const parent = readHanorkParentFromProc(liveIpcPid);
        if (!parent || parent === process.pid) {
            return { ok: true, online: true, pid: liveIpcPid, conf, client };
        }
    }

    await reclaimStaleUserWorker(conf);

    if (spawningSessions.has(conf.sessionId)) {
        const existing = userWorkers.get(conf.sessionId);
        if (existing?.proc?.pid && isPidAlive(existing.proc.pid)) {
            return { ok: true, starting: true, pid: existing.proc.pid, conf, client };
        }
        await new Promise((r) => setTimeout(r, 400));
        const retryPid = findWorkerPidForIpc(conf);
        if (retryPid && isPidAlive(retryPid)) {
            return { ok: true, online: true, pid: retryPid, conf, client };
        }
    }

    if (isWorkerHealthy(conf, client)) {
        const ping = await pingWorkerIpc(telegramId, 3000);
        if (ping?.ok) {
            return { ok: true, online: true, conf, client };
        }
    }

    const existing = userWorkers.get(conf.sessionId);
    if (existing?.proc && !existing.proc.killed && isPidAlive(existing.proc.pid)) {
        return { ok: true, starting: true, pid: existing.proc.pid, conf, client };
    }

    if (isWorkerHealthy(conf, client) && !userWorkers.has(conf.sessionId)) {
        const ipcPid = findWorkerPidForIpc(conf);
        if (ipcPid) {
            return { ok: true, online: true, pid: ipcPid, conf, client };
        }
    }

    const zeroRoot = ZERO_DIVU_CONFIG.zeroRoot;
    const connectJs = path.join(zeroRoot, 'connect.js');
    if (!fs.existsSync(connectJs)) {
        logger.error('[WaDivulgacao] connect.js ausente', { zeroRoot, telegramId });
        return { ok: false, reason: 'connect_missing' };
    }

    fs.mkdirSync(conf.ipcDir, { recursive: true });
    fs.mkdirSync(path.join(conf.sessionDir, 'auth'), { recursive: true });

    spawningSessions.add(conf.sessionId);
    let proc;
    try {
        proc = spawn(process.execPath, [connectJs], {
            cwd: zeroRoot,
            env: buildUserWorkerEnv(conf),
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
        });
        if (proc.unref) proc.unref();
    } finally {
        spawningSessions.delete(conf.sessionId);
    }

    attachWorkerLogs(proc, conf);
    writeWorkerMarker(conf, proc.pid);
    userWorkers.set(conf.sessionId, { proc, conf, startedAt: Date.now() });
    logger.info('[WaDivulgacao] Worker usuário iniciado', {
        telegramId: conf.telegramId,
        pid: proc.pid,
        ipc: conf.ipcDir,
        zeroRoot,
    });

    return { ok: true, spawned: true, pid: proc.pid, conf, client };
}

/**
 * Login QR/código — estilo Zero Two: dispara worker + IPC sem esperar 45–60s.
 * Se o processo existe ou state.json recente, retorna na hora (comando fila no jsonl).
 */
async function ensureUserWorkerForLogin(telegramId) {
    const boot = await ensureUserWorker(telegramId);
    if (!boot.ok) return boot;

    const { client, conf } = boot;
    const st = client.readState() || {};
    const stateFresh =
        st?.ipcOnline && Date.now() - new Date(st.updatedAt || 0).getTime() < 15000;

    if (stateFresh || boot.online || boot.pid) {
        return { ok: true, client, conf, fast: true };
    }
    if (isWorkerHealthy(conf, client) || client.isWorkerLikelyOnline()) {
        const ping = await pingWorkerIpc(telegramId, LOGIN_FAST_PING_MS);
        if (ping?.ok) return { ok: true, client, conf, fast: true };
    }
    if (boot.spawned || boot.starting) {
        return { ok: true, client, conf, optimistic: true };
    }

    const deadline = Date.now() + LOGIN_FAST_WAIT_MS;
    while (Date.now() < deadline) {
        const ping = await pingWorkerIpc(
            telegramId,
            Math.min(LOGIN_FAST_PING_MS, deadline - Date.now())
        );
        if (ping?.ok) return { ok: true, client, conf };
        await new Promise((r) => setTimeout(r, 180));
    }

    return { ok: true, client, conf, optimistic: true };
}

/** Bloqueia até IPC responder wa.ping — sem mensagem “preparando” ao usuário. */
async function ensureUserWorkerReady(telegramId, opts = {}) {
    const maxWaitMs = opts.maxWaitMs ?? WORKER_BOOT_WAIT_MS;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
        const boot = await ensureUserWorker(telegramId);
        if (!boot.ok) return boot;

        const { client, conf } = boot;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        const ping = await pingWorkerIpc(telegramId, Math.min(USER_PING_TIMEOUT_MS, remaining));
        if (ping?.ok) {
            return { ok: true, client, conf };
        }

        await new Promise((r) => setTimeout(r, 500));
    }

    return { ok: false, reason: 'ipc_not_ready' };
}

function scheduleWorkerPrewarm(telegramId, reason = 'flow') {
    if (!isZeroDivuEnabled()) return;
    const { deferBackground } = require('../../utils/defer');
    deferBackground(`wadv-prewarm-${telegramId}`, () => prewarmUserWorker(telegramId, reason));
}

async function prewarmUserWorker(telegramId, reason = 'flow') {
    if (!isZeroDivuEnabled()) return { ok: false, reason: 'zero_divu_off' };
    try {
        const result = await ensureUserWorkerReady(telegramId, { maxWaitMs: WORKER_BOOT_WAIT_MS });
        if (result.ok) {
            logger.info('[WaDivulgacao] Worker pronto', { telegramId, reason });
        }
        return result;
    } catch (e) {
        logger.warn('[WaDivulgacao] prewarm failed', { telegramId, reason, error: e?.message });
        return { ok: false, error: e?.message };
    }
}

/** 3× ping + reconnect — sem erro ao usuário até esgotar tentativas (Always-On v5i). */
async function _ensureWorkerReady(telegramId, opts = {}) {
    const maxWaitMs = opts.maxWaitMs ?? 60000;
    const maxPings = opts.maxPings ?? 3;
    const deadline = Date.now() + maxWaitMs;
    const { getWaDivulgacaoLoginService } = require('./waDivulgacaoLoginService');

    while (Date.now() < deadline) {
        const boot = await ensureUserWorkerReady(telegramId, {
            maxWaitMs: Math.min(20000, deadline - Date.now()),
        });
        if (!boot.ok) {
            await new Promise((r) => setTimeout(r, 600));
            continue;
        }

        let pingOk = false;
        for (let i = 0; i < maxPings; i++) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            const ping = await pingWorkerIpc(telegramId, Math.min(5000, remaining));
            if (ping?.ok) {
                pingOk = true;
                break;
            }
            await new Promise((r) => setTimeout(r, 400));
        }
        if (!pingOk) {
            await new Promise((r) => setTimeout(r, 600));
            continue;
        }

        const login = getWaDivulgacaoLoginService();
        const { client, conf } = boot;
        if (login.hasSavedWaSession(conf)) {
            const state = client.readState() || {};
            if (!login.isEffectivelyWaConnected(state, conf)) {
                await client
                    .sendCommand('wa.reconnect_session', {}, telegramId, { timeoutMs: 12000 })
                    .catch(() => null);
                await new Promise((r) => setTimeout(r, 1200));
            }
        }
        return { ok: true, client, conf };
    }

    return { ok: false, reason: 'ipc_not_ready' };
}

/** Painel aberto — worker + reconnect + sync_groups em background. */
async function syncPanelBackground(telegramId) {
    const ready = await _ensureWorkerReady(telegramId, { maxWaitMs: 30000 });
    if (!ready.ok) return ready;
    const { getWaDivulgacaoLoginService } = require('./waDivulgacaoLoginService');
    const login = getWaDivulgacaoLoginService();
    await login.resolveConnectionForPanel(telegramId, { fastOnly: true }).catch(() => null);
    await ready.client
        .sendCommand('wa.sync_groups', {}, telegramId, { timeoutMs: 30000 })
        .catch(() => null);
    const { syncUserSettingsToWorker } = require('./waDivulgacaoWorkerSync');
    await syncUserSettingsToWorker(telegramId, ready.client).catch(() => null);
    return ready;
}

module.exports = {
    ensureUserWorker,
    ensureUserWorkerForLogin,
    ensureUserWorkerReady,
    _ensureWorkerReady,
    syncPanelBackground,
    waitForWorkerOnline,
    reclaimStaleUserWorker,
    scheduleWorkerPrewarm,
    prewarmUserWorker,
    pingWorkerIpc,
    isWorkerHealthy,
    findWorkerPidForIpc,
    isPidAlive,
};
