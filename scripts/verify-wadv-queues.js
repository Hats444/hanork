#!/usr/bin/env node
'use strict';

/**
 * Verifica snapshot de filas Hanork Div (P3.1 observabilidade).
 * Uso: node scripts/verify-wadv-queues.js [--refresh]
 */

require('dotenv').config();

const {
    collectQueueMetrics,
    refreshQueueSnapshotCache,
    readSnapshotCache,
    TRACKED_QUEUES,
} = require('../src/modules/wa-divulgacao/waDivulgacaoQueueMetrics');

async function main() {
    const refresh = process.argv.includes('--refresh');
    const snap = refresh ? await refreshQueueSnapshotCache(true) : readSnapshotCache() || (await refreshQueueSnapshotCache(true));

    console.log('=== Hanork Div — filas (P3.1) ===');
    console.log('Atualizado:', snap?.at ? new Date(snap.at).toISOString() : '—');
    console.log('Campanhas na fila (waiting+delayed+active):', snap?.scheduledTotal ?? '—');
    console.log('');

    for (const name of TRACKED_QUEUES) {
        const q = snap?.queues?.[name];
        if (!q) {
            console.log(`${name}: (sem dados)`);
            continue;
        }
        if (!q.ok) {
            console.log(`${name}: ERRO — ${q.error}`);
            continue;
        }
        console.log(
            `${name}: waiting=${q.waiting} active=${q.active} delayed=${q.delayed} failed=${q.failed} completed=${q.completed}`
        );
    }

    const camp = snap?.queues?.['wadv:campaign'];
    if (camp?.ok && (camp.waiting > 0 || camp.delayed > 0 || camp.active > 0)) {
        console.log('\nOK — fila wadv:campaign com jobs.');
        process.exit(0);
    }
    console.log('\nOK — snapshot lido (fila campanhas vazia ou idle).');
    process.exit(0);
}

main().catch((e) => {
    console.error('Falha:', e.message);
    process.exit(1);
});
