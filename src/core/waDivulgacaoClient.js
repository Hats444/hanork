'use strict';

const { ZeroDivuClient } = require('../../plugins/zero-divu/ZeroDivuClient');
const { resolveUserSession } = require('./waDivulgacaoUserSession');

const clients = new Map();

const USER_IPC_TIMEOUT_MS = Number(process.env.WA_DIVULGACAO_IPC_TIMEOUT_MS) || 30000;
const USER_PING_TIMEOUT_MS = Number(process.env.WA_DIVULGACAO_PING_TIMEOUT_MS) || 8000;
const USER_PAIRING_TIMEOUT_MS = Number(process.env.WA_DIVULGACAO_PAIR_TIMEOUT_MS) || 90000;

function getWaDivulgacaoClient(telegramId) {
    const conf = resolveUserSession(telegramId);
    if (!clients.has(conf.sessionId)) {
        const client = new ZeroDivuClient({
            ipcDir: conf.ipcDir,
            sessionId: conf.sessionId,
            commandTimeoutMs: USER_IPC_TIMEOUT_MS,
        });
        client.ensureDir();
        clients.set(conf.sessionId, { client, conf });
    }
    return clients.get(conf.sessionId);
}

module.exports = { getWaDivulgacaoClient, USER_PING_TIMEOUT_MS, USER_PAIRING_TIMEOUT_MS };
