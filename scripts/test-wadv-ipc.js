'use strict';

process.chdir('/home/vendetta/hanork');
require('dotenv').config({ path: '/home/vendetta/hanork/.env' });

const { ensureUserWorkerReady } = require('../src/modules/wa-divulgacao/waDivulgacaoWorkerService');

(async () => {
    const uid = '8115302402';
    const t0 = Date.now();
    const ready = await ensureUserWorkerReady(uid);
    console.log('ready', Date.now() - t0, ready.ok, ready.pid || ready.spawned);
    if (!ready.ok) {
        console.log(ready.message || ready.reason);
        process.exit(1);
    }
    const c = ready.client;
    const t1 = Date.now();
    const ping = await c.sendCommand('wa.ping', {}, Number(uid), { timeoutMs: 10000 });
    console.log('ping', Date.now() - t1, ping?.ok);
    const t2 = Date.now();
    const pair = await c.sendCommand(
        'wa.start_pairing',
        { phone: '5493364693436', forceSwap: true },
        Number(uid),
        { timeoutMs: 15000 }
    );
    console.log('pair', Date.now() - t2, pair?.ok, JSON.stringify(pair?.result || pair?.error));
})();
