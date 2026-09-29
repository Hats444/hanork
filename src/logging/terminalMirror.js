'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { safeStreamWrite } = require('./safeStreamWrite');

function defaultTerminalLogPath() {
    return path.join(os.homedir(), '.hanork', 'terminal.log');
}

function resolveTerminalLogPath() {
    return process.env.HANORK_TERMINAL_LOG || defaultTerminalLogPath();
}

function ensureTerminalLogDir(filePath) {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    } catch { /* ignore */ }
}

/** Define ~/.hanork/terminal.log quando ainda não configurado (WSL / dev). */
function applyDefaultTerminalLogEnv() {
    if (!process.env.HANORK_TERMINAL_LOG) {
        process.env.HANORK_TERMINAL_LOG = defaultTerminalLogPath();
    }
}

function resetTerminalLog() {
    const filePath = resolveTerminalLogPath();
    ensureTerminalLogDir(filePath);
    const marker =
        `\n${'═'.repeat(60)}\n` +
        `[${new Date().toISOString()}] Nova sessão Hanork (PID ${process.pid})\n` +
        `${'═'.repeat(60)}\n`;
    try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
            fs.appendFileSync(filePath, marker);
        } else {
            fs.writeFileSync(filePath, marker);
        }
    } catch { /* ignore */ }
}

/** Erro fatal de pre-boot — gravado no log mesmo com nohup descartando stderr. */
function appendBootFatal(message) {
    const filePath = resolveTerminalLogPath();
    ensureTerminalLogDir(filePath);
    const line =
        `[${new Date().toISOString()}] [BOOT-FATAL] pid=${process.pid} ${String(message || '').trim()}\n`;
    try {
        fs.appendFileSync(filePath, line);
    } catch { /* ignore */ }
}

function stripAnsi(text) {
    return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

function appendTerminalLog(text) {
    const filePath = resolveTerminalLogPath();
    if (!filePath) return;
    ensureTerminalLogDir(filePath);
    const preserveColor = process.env.HANORK_TERMINAL_LOG_PLAIN !== '1';
    const payload = preserveColor ? String(text) : stripAnsi(text);
    const line = payload.endsWith('\n') ? payload : payload + '\n';
    // Assíncrono — appendFileSync bloqueava o event loop e congelava HTTP + Telegram.
    fs.appendFile(filePath, line, () => {});
}

function followTerminalLog({ lines = 100 } = {}) {
    const filePath = resolveTerminalLogPath();
    if (!fs.existsSync(filePath)) return false;
    const { spawnSync } = require('child_process');
    const tail = spawnSync('tail', ['-n', String(lines), '-F', filePath], { stdio: 'inherit' });
    if (tail.error && tail.error.code === 'ENOENT') {
        safeStreamWrite(process.stdout, fs.readFileSync(filePath, 'utf8'));
        return true;
    }
    return !tail.error;
}

module.exports = {
    defaultTerminalLogPath,
    resolveTerminalLogPath,
    applyDefaultTerminalLogEnv,
    resetTerminalLog,
    appendBootFatal,
    appendTerminalLog,
    followTerminalLog,
    stripAnsi,
};
