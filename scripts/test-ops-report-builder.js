'use strict';

/**
 * Smoke test: monta relatório ops (sem enviar Telegram).
 * Uso: node scripts/test-ops-report-builder.js
 */

const { buildHanorkOpsReport } = require('../src/services/ops/HanorkOpsReportBuilder');

async function main() {
    const date = new Date().toISOString().slice(0, 10);
    const html = await buildHanorkOpsReport({ date, botUsername: process.env.BOT_USERNAME || 'bot' });
    if (!html || html.length < 200) {
        console.error('FAIL: relatório muito curto');
        process.exit(1);
    }
    const required = ['Financeiro', 'Telegram', 'WhatsApp', 'Host'];
    for (const token of required) {
        if (!html.includes(token)) {
            console.error(`FAIL: seção ausente — ${token}`);
            process.exit(1);
        }
    }
    console.log('OK ops report builder');
    console.log('--- preview (800 chars) ---');
    console.log(html.slice(0, 800));
}

main().catch((e) => {
    console.error('FAIL:', e.message);
    process.exit(1);
});
