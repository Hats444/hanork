'use strict';

const fs = require('fs');
const path = require('path');
const { ZeroDivuClient } = require('../../plugins/zero-divu/ZeroDivuClient');
const { resolveUserSession } = require('./waDivulgacaoUserSession');
const Copy = require('./waDivulgacaoCopy');

const clients = new Map();

const USER_IPC_TIMEOUT_MS = Number(process.env.WA_DIVULGACAO_IPC_TIMEOUT_MS) || 30000;
const USER_PING_TIMEOUT_MS = Number(process.env.WA_DIVULGACAO_PING_TIMEOUT_MS) || 8000;
/** ACK de wa.start_login / wa.start_pairing — worker responde na hora; não bloquear 90s. */
const USER_LOGIN_IPC_TIMEOUT_MS = Number(process.env.WA_DIVULGACAO_LOGIN_IPC_TIMEOUT_MS) || 5000;
const USER_PAIRING_TIMEOUT_MS = Number(process.env.WA_DIVULGACAO_PAIR_TIMEOUT_MS) || 90000;
const USER_WORKER_STALE_MS = Number(process.env.WA_DIVULGACAO_WORKER_STALE_MS) || 45000;
const USER_IPC_RETRIES = Number(process.env.WA_DIVULGACAO_IPC_RETRIES) || 4;

function hasSavedWaSession(conf) {
    const credsPath = path.join(conf.sessionDir, 'auth', 'creds.json');
    if (!fs.existsSync(credsPath)) return false;
    try {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
        return Boolean(creds?.registered || creds?.me?.id);
    } catch {
        return false;
    }
}

function isRetryableIpcAck(ack) {
    if (!ack || ack.ok) return false;
    return Copy.isSubscriberIpcSyncingError(ack);
}

function sanitizeSubscriberIpcAck(ack, conf) {
    return Copy.sanitizeSubscriberIpcAck(ack, { hasSession: hasSavedWaSession(conf) });
}

function wrapSubscriberClient(base, conf) {
    const rawSend = base.sendCommand.bind(base);
    return new Proxy(base, {
        get(target, prop) {
            if (prop === 'rawSendCommand') {
                return rawSend;
            }
            if (prop === 'sendCommand') {
                return async (cmd, args = {}, adminId = null, options = {}) => {
                    const telegramId = conf.telegramId;
                    const attempts = options._noRecover ? 1 : USER_IPC_RETRIES;
                    let lastAck = { ok: false, error: 'timeout', message: '' };
                    for (let i = 0; i < attempts; i++) {
                        lastAck = await rawSend(cmd, args, adminId ?? telegramId, options);
                        if (lastAck?.ok) return sanitizeSubscriberIpcAck(lastAck, conf);
                        if (lastAck?.error === 'timeout') {
                            try {
                                const { bumpMetric } = require('./waDivulgacaoOpsMetrics');
                                bumpMetric('ipc_timeouts');
                            } catch {
                                /* ignore */
                            }
                        }
                        if (!isRetryableIpcAck(lastAck) || i >= attempts - 1) break;
                        const { ensureUserWorkerReady } = require('./waDivulgacaoWorkerService');
                        await ensureUserWorkerReady(telegramId, {
                            maxWaitMs: Math.min(30000, 10000 * (i + 1)),
                        }).catch(() => null);
                        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
                    }
                    return sanitizeSubscriberIpcAck(lastAck, conf);
                };
            }
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

function getWaDivulgacaoClient(telegramId) {
    const conf = resolveUserSession(telegramId);
    if (!clients.has(conf.sessionId)) {
        const base = new ZeroDivuClient({
            ipcDir: conf.ipcDir,
            sessionId: conf.sessionId,
            commandTimeoutMs: USER_IPC_TIMEOUT_MS,
            workerStaleMs: USER_WORKER_STALE_MS,
        });
        base.ensureDir();
        const client = wrapSubscriberClient(base, conf);
        clients.set(conf.sessionId, { client, base, conf });
    }
    return clients.get(conf.sessionId);
}

module.exports = {
    getWaDivulgacaoClient,
    sanitizeSubscriberIpcAck,
    hasSavedWaSession,
    USER_PING_TIMEOUT_MS,
    USER_LOGIN_IPC_TIMEOUT_MS,
    USER_PAIRING_TIMEOUT_MS,
    USER_IPC_TIMEOUT_MS,
};
