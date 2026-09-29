'use strict';

/**
 * Formata métricas no estilo Prometheus exposition (text/plain).
 */

function escapeLabelValue(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function labelsStr(labels) {
    if (!labels || !Object.keys(labels).length) return '';
    const parts = Object.entries(labels)
        .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
        .join(',');
    return `{${parts}}`;
}

function metricLine(name, value, labels, type = 'gauge') {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return `${name}${labelsStr(labels)} ${num}`;
}

/**
 * @param {Array<{ name: string, value: number, labels?: object, type?: string, help?: string }>} entries
 */
function formatPrometheus(entries) {
    const lines = [];
    const helpDone = new Set();

    for (const e of entries) {
        if (!e || e.value == null) continue;
        const type = e.type || 'gauge';
        if (e.help && !helpDone.has(e.name)) {
            lines.push(`# HELP ${e.name} ${e.help}`);
            lines.push(`# TYPE ${e.name} ${type}`);
            helpDone.add(e.name);
        } else if (!helpDone.has(e.name)) {
            lines.push(`# TYPE ${e.name} ${type}`);
            helpDone.add(e.name);
        }
        const line = metricLine(e.name, e.value, e.labels, type);
        if (line) lines.push(line);
    }

    return `${lines.join('\n')}\n`;
}

module.exports = {
    formatPrometheus,
    metricLine,
    labelsStr,
};
