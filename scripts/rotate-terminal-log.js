#!/usr/bin/env node
'use strict';

/**
 * Rota ~/.hanork/terminal.log quando > 200 MB ou idade > 7 dias.
 * Arquivo: ~/.hanork/archive/terminal-YYYY-MM-DD-HHMMSS.log.gz · mantém últimos 5.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream');
const { promisify } = require('util');

const pipe = promisify(pipeline);

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_ARCHIVES = 5;

function pad2(n) {
    return String(n).padStart(2, '0');
}

function archiveTimestamp(d = new Date()) {
    return (
        `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-` +
        `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
    );
}

function resolveLogFile() {
    if (process.env.HANORK_TERMINAL_LOG) {
        return path.resolve(process.env.HANORK_TERMINAL_LOG);
    }
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, '.hanork', 'terminal.log');
}

async function gzipFile(src, dest) {
    await pipe(fs.createReadStream(src), zlib.createGzip(), fs.createWriteStream(dest));
}

function pruneArchives(archiveDir) {
    const files = fs
        .readdirSync(archiveDir)
        .filter((name) => /^terminal-\d{4}-\d{2}-\d{2}-\d{6}\.log\.gz$/.test(name))
        .map((name) => ({
            name,
            mtime: fs.statSync(path.join(archiveDir, name)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

    for (const old of files.slice(KEEP_ARCHIVES)) {
        fs.unlinkSync(path.join(archiveDir, old.name));
    }
}

async function main() {
    const logFile = resolveLogFile();
    if (!fs.existsSync(logFile)) {
        return;
    }

    const stat = fs.statSync(logFile);
    const ageMs = Date.now() - stat.mtimeMs;
    if (stat.size <= MAX_BYTES && ageMs <= MAX_AGE_MS) {
        return;
    }

    const archiveDir = path.join(path.dirname(logFile), 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });

    const archivePath = path.join(archiveDir, `terminal-${archiveTimestamp()}.log.gz`);
    await gzipFile(logFile, archivePath);
    fs.truncateSync(logFile, 0);
    pruneArchives(archiveDir);

    const mb = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`[rotate-terminal-log] ${logFile} (${mb} MB) → ${archivePath}`);
}

main().catch((err) => {
    console.error('[rotate-terminal-log] erro:', err.message);
    process.exit(1);
});
