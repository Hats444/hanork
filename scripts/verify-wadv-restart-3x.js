#!/usr/bin/env node
'use strict';
/**
 * §18.25.5 — 3 restarts + verify assinantes após boot.
 * Uso: node scripts/verify-wadv-restart-3x.js
 */
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.env.HANORK_NODE || '/home/vendetta/.nvm/versions/node/v20.20.2/bin/node';
const LOG = process.env.HANORK_LOG || path.join(require('os').homedir(), '.hanork', 'terminal.log');
const ROUNDS = Number(process.env.WADV_RESTART_ROUNDS) || 3;
const BOOT_WAIT_MS = Number(process.env.WADV_BOOT_WAIT_MS) || 130000;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function tailLog(marker) {
    try {
        const buf = fs.readFileSync(LOG);
        const text = buf.toString('utf8', Math.max(0, buf.length - 80000));
        return text.includes(marker);
    } catch {
        return false;
    }
}

function run(cmd, opts = {}) {
    return spawnSync(cmd, { shell: true, encoding: 'utf8', cwd: ROOT, ...opts });
}

async function main() {
    const results = [];
    for (let i = 1; i <= ROUNDS; i++) {
        console.log(`\n=== Restart ${i}/${ROUNDS} ===`);
        const stop = run('bash scripts/hanork-ctl.sh restart-bg');
        if (stop.status !== 0) {
            results.push({ round: i, ok: false, step: 'restart', detail: stop.stderr || stop.stdout });
            continue;
        }
        const pidMatch = (stop.stdout || '').match(/PID (\d+)/);
        console.log('restart:', (stop.stdout || '').trim().split('\n').pop());
        await sleep(BOOT_WAIT_MS);
        const bootOk = tailLog('"bootComplete":1') || tailLog('pronto');
        const verify = run(`${NODE} scripts/verify-wadv-always-on.js`);
        const verifyOk = verify.status === 0 && /ALL OK/.test(verify.stdout || '');
        const subs = (verify.stdout || '').match(/subscribers_active:\s*(\d+)/);
        const connected = (verify.stdout || '').match(/workers_connected:\s*(\d+)/);
        results.push({
            round: i,
            ok: bootOk && verifyOk,
            pid: pidMatch ? pidMatch[1] : null,
            bootOk,
            verifyOk,
            subscribers: subs ? Number(subs[1]) : null,
            workersConnected: connected ? Number(connected[1]) : null,
        });
        console.log(verify.stdout || verify.stderr);
    }
    console.log('\n=== RESUMO ===');
    console.log(JSON.stringify(results, null, 2));
    const allOk = results.every((r) => r.ok);
    process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
