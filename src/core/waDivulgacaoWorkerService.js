'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ZERO_DIVU_CONFIG, isZeroDivuEnabled, getIpcToken } = require('../../plugins/zero-divu/config');
const { getWaDivulgacaoClient, USER_PING_TIMEOUT_MS } = require('./waDivulgacaoClient');
const logger = require('../../config/logger');

const userWorkers = new Map();
const WORKER_BOOT_WAIT_MS = Number(process.env.WA_DIVULGACAO_WORKER_BOOT_MS) || 60000;
const WORKER_RECLAIM_WAIT_MS = Number(process.env.WA_DIVULGACAO_RECLAIM_WAIT_MS) || 2500;

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

function findWorkerPidForIpc(conf) {
    if (process.platform !== 'linux') return null;
    const needle = `ZERO_DIVU_IPC_DIR=${conf.ipcDir}`;
    try {
        for (const name of fs.readdirSync('/proc')) {
            if (!/^\d+$/.test(name)) continue;
            const pid = Number(name);
            if (!pid || pid === process.pid) continue;
            try {
                const env = fs.readFileSync(`/proc/${pid}/environ`);
                if (env.includes(needle)) return pid;
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
            if (killPidGraceful(targetPid)) {
                killed = true;
                reasons.push(parentDead ? 'parent_dead' : wrongParent ? 'parent_mismatch' : 'legacy_untracked');
            }
            await new Promise((r) => setTimeout(r, 800));
            if (isPidAlive(targetPid)) {
                killPidGraceful(targetPid, 'SIGKILL');
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

    if (ipcPid) {
        const parent = readHanorkParentFromProc(ipcPid);
        if (parent && parent !== process.pid) return false;
        if (marker?.hanorkPid && marker.hanorkPid !== process.pid) return false;
        if (!client.isWorkerLikelyOnline()) return false;
        return isPidAlive(ipcPid);
    }

    if (!client.isWorkerLikelyOnline()) return false;
    if (marker?.workerPid) {
        if (!isPidAlive(marker.workerPid)) return false;
        if (marker.hanorkPid && marker.hanorkPid !== process.pid) return false;
    }
    return false;
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
        ZERO_MAX_GROUPS: String(process.env.WA_DIVULGACAO_MAX_GROUPS || '20'),
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
            const tid = conf.telegramId;
            const { deferBackground } = require('../../utils/defer');
            deferBackground(`wadv-worker-restart-${tid}`, async () => {
                await new Promise((r) => setTimeout(r, 3000));
                if (!isPidAlive(process.pid)) return;
                try {
                    await ensureUserWorker(tid);
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
            if (entry?.proc?.pid) killPidGraceful(entry.proc.pid);
        }
    };
    process.once('SIGTERM', stopAll);
    process.once('SIGINT', stopAll);
}

async function waitForWorkerOnline(client, maxMs = WORKER_BOOT_WAIT_MS) {
    const stepMs = 400;
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        if (client.isWorkerLikelyOnline()) return true;
        await new Promise((r) => setTimeout(r, stepMs));
    }
    return client.isWorkerLikelyOnline();
}

async function ensureUserWorker(telegramId) {
    if (!isZeroDivuEnabled()) return { ok: false, reason: 'zero_divu_off' };
    registerShutdownHook();

    const { client, conf } = getWaDivulgacaoClient(telegramId);
    await reclaimStaleUserWorker(conf);

    if (isWorkerHealthy(conf, client)) {
        return { ok: true, online: true, conf, client };
    }

    const existing = userWorkers.get(conf.sessionId);
    if (existing?.proc && !existing.proc.killed && isPidAlive(existing.proc.pid)) {
        return { ok: true, starting: true, pid: existing.proc.pid, conf, client };
    }

    const zeroRoot = ZERO_DIVU_CONFIG.zeroRoot;
    const connectJs = path.join(zeroRoot, 'connect.js');
    if (!fs.existsSync(connectJs)) {
        logger.error('[WaDivulgacao] connect.js ausente', { zeroRoot, telegramId });
        return { ok: false, reason: 'connect_missing' };
    }

    fs.mkdirSync(conf.ipcDir, { recursive: true });
    fs.mkdirSync(path.join(conf.sessionDir, 'auth'), { recursive: true });

    const proc = spawn(process.execPath, [connectJs], {
        cwd: zeroRoot,
        env: buildUserWorkerEnv(conf),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });

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

async function ensureUserWorkerReady(telegramId, opts = {}) {
    const maxWaitMs = opts.maxWaitMs ?? WORKER_BOOT_WAIT_MS;
    const boot = await ensureUserWorker(telegramId);
    if (!boot.ok) return boot;

    const { client, conf } = boot;
    if (isWorkerHealthy(conf, client)) {
        return { ok: true, client, conf };
    }

    const online = await waitForWorkerOnline(client, maxWaitMs);
    if (online && isWorkerHealthy(conf, client)) {
        return { ok: true, client, conf };
    }

    const ping = await client
        .sendCommand('wa.ping', {}, telegramId, { timeoutMs: USER_PING_TIMEOUT_MS })
        .catch(() => null);
    if (ping?.ok) {
        return { ok: true, client, conf };
    }

    return {
        ok: false,
        message:
            '⏳ <b>Iniciando seu WhatsApp…</b>\n\n' +
            'O serviço está subindo — aguarde ~30 segundos e toque em <b>Código</b> de novo.',
    };
}

/** Sobe o worker do usuário em background (home / pós-pagamento). */
function scheduleWorkerPrewarm(telegramId, reason = 'flow') {
    if (!isZeroDivuEnabled()) return;
    const { deferBackground } = require('../../utils/defer');
    deferBackground(`wadv-prewarm-${telegramId}`, () => prewarmUserWorker(telegramId, reason));
}

async function prewarmUserWorker(telegramId, reason = 'flow') {
    if (!isZeroDivuEnabled()) return { ok: false, reason: 'zero_divu_off' };
    try {
        const result = await ensureUserWorkerReady(telegramId);
        if (result.ok) {
            logger.info('[WaDivulgacao] Worker pré-aquecido', { telegramId, reason });
        }
        return result;
    } catch (e) {
        logger.warn('[WaDivulgacao] prewarm failed', { telegramId, reason, error: e?.message });
        return { ok: false, error: e?.message };
    }
}

module.exports = {
    ensureUserWorker,
    ensureUserWorkerReady,
    waitForWorkerOnline,
    reclaimStaleUserWorker,
    scheduleWorkerPrewarm,
    prewarmUserWorker,
};
