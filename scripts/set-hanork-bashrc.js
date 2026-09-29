#!/usr/bin/env node
/**
 * @deprecated Use: npm run terminal:init
 * Mantido para compatibilidade — delega ao terminalBootstrap.
 */
'use strict';

const path = require('path');
const { initializeTerminal } = require('../src/system/terminalBootstrap');

const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const result = initializeTerminal({ repoRoot, force: true });

if (result.skipped) {
    console.log('[HANORK] Já inicializado. Use: npm run terminal:init -- --force');
    process.exit(0);
}
if (!result.ok) {
    console.error('[HANORK] Falha:', result.error);
    process.exit(1);
}

console.log('OK — terminal Hanork configurado (bloco # HANORK START em ~/.bashrc / ~/.zshrc / fish)');
console.log('Pasta bot:', repoRoot);
console.log('Rollback: npm run terminal:restore');
