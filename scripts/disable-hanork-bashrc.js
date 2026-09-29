#!/usr/bin/env node
/**
 * @deprecated Use: npm run terminal:restore
 * Mantido para compatibilidade — delega ao terminalBootstrap.
 */
'use strict';

const { restoreTerminal } = require('../src/system/terminalBootstrap');

const result = restoreTerminal();
console.log('OK — bloco Hanork removido / backup restaurado');
for (const r of result.restored) {
    console.log(`  ${r.shell}: ${r.rcPath} (${r.method})`);
}
