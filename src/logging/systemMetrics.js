'use strict';

const os = require('os');

const bootAt = Date.now();

function formatBytes(n) {
    if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024).toFixed(0)} KB`;
}

function getMemory() {
    const m = process.memoryUsage();
    return {
        rss: formatBytes(m.rss),
        heapUsed: formatBytes(m.heapUsed),
        heapTotal: formatBytes(m.heapTotal),
        external: formatBytes(m.external),
    };
}

function getCpuLoad() {
    const load = os.loadavg();
    const cores = os.cpus().length || 1;
    return {
        load1: load[0]?.toFixed(2) ?? '—',
        cores,
        percentApprox: Math.min(100, Math.round((load[0] / cores) * 100)),
    };
}

function getUptime() {
    const sec = Math.floor(process.uptime());
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function getBootIso() {
    return new Date(bootAt).toISOString();
}

function getHostSummary() {
    return {
        platform: `${os.platform()} ${os.arch()}`,
        node: process.version,
        hostname: os.hostname(),
        bootAt: getBootIso(),
    };
}

function getSystemRam() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return { total: formatBytes(total), used: formatBytes(used) };
}

function getOsUptime() {
    const sec = Math.floor(os.uptime());
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${sec}s`;
}

module.exports = {
    bootAt,
    formatBytes,
    getMemory,
    getCpuLoad,
    getUptime,
    getBootIso,
    getHostSummary,
    getSystemRam,
    getOsUptime,
};
