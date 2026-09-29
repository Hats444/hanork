'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Resolve arquivo local dentro de baseDir (anti path traversal).
 * Usa apenas path.basename(ref) e valida que o resultado permanece em baseDir.
 *
 * @param {string} baseDir - Diretório permitido (absoluto ou relativo)
 * @param {string} ref - Referência do produto/foto (nome ou caminho)
 * @param {{ checkExists?: boolean }} [options]
 * @returns {string|null} Caminho absoluto seguro, ou null
 */
function resolveLocalFile(baseDir, ref, options = {}) {
    const { checkExists = true } = options;
    if (!ref || typeof ref !== 'string') return null;

    const trimmed = ref.trim();
    if (!trimmed || trimmed.includes('\0')) return null;
    if (trimmed.startsWith('text:')) return null;

    const segments = trimmed.split(/[/\\]/);
    if (segments.some((s) => s === '..')) return null;

    const base = path.resolve(baseDir);
    const name = path.basename(trimmed);
    if (!name || name === '.' || name === '..') return null;

    const resolved = path.resolve(base, name);
    const rel = path.relative(base, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;

    if (checkExists && !fs.existsSync(resolved)) return null;
    return resolved;
}

/** Ref segura para sendDocument remoto (file_id ou URL) — bloqueia paths locais. */
function isRemoteDocumentRef(ref) {
    const t = String(ref || '').trim();
    if (!t || t.includes('..') || t.includes('\0')) return false;
    if (/^https?:\/\//i.test(t)) return true;
    if (/[/\\]/.test(t)) return false;
    return true;
}

module.exports = { resolveLocalFile, isRemoteDocumentRef };
