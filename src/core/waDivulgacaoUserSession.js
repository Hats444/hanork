'use strict';

const os = require('os');
const path = require('path');

function resolveUserSession(telegramId) {
    const uid = String(telegramId || '').trim();
    const base = path.join(os.homedir(), '.hanork', 'wa-users', uid);
    return {
        sessionId: `wadv_u${uid}`,
        telegramId: uid,
        ipcDir: path.join(base, 'ipc'),
        sessionDir: path.join(base, 'session'),
        dbPath: path.join(base, 'zero-divu.db'),
        label: 'Hanork Div',
        displayName: 'Hanork Div',
    };
}

module.exports = { resolveUserSession };
