'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Prefere caminho nativo WSL quando .env aponta para /mnt/c/... mas os arquivos
 * estão em /home/vendetta/hanork (evita EIO e mídia ausente no broadcast).
 */
function preferResolvableMediaPath(inputPath, fallbackPath) {
    const candidates = [];

    if (inputPath && String(inputPath).trim()) {
        candidates.push(path.normalize(String(inputPath).trim()));
    }
    if (fallbackPath) {
        candidates.push(path.normalize(fallbackPath));
    }

    const cwd = process.cwd();
    const seen = new Set();

    for (const raw of candidates) {
        if (!raw || seen.has(raw)) continue;
        seen.add(raw);

        const extras = [raw];

        if (raw.startsWith('/mnt/c/')) {
            const native = raw.replace(/^\/mnt\/c\/Users\/boots\/Downloads\/hanork/i, '/home/vendetta/hanork');
            if (native !== raw) extras.unshift(native);
            const cwdSibling = path.join(cwd, path.basename(raw));
            extras.unshift(cwdSibling);
        }

        if (raw.startsWith('/home/vendetta/hanork')) {
            const winMount = raw.replace(/^\/home\/vendetta\/hanork/i, '/mnt/c/Users/boots/Downloads/hanork');
            if (winMount !== raw) extras.push(winMount);
        }

        for (const p of extras) {
            if (!p || seen.has(p)) continue;
            seen.add(p);
            try {
                if (fs.existsSync(p)) return p;
            } catch {
                /* ignore */
            }
        }
    }

    return candidates[0] || (fallbackPath ? path.normalize(fallbackPath) : null);
}

function listResolvableMediaDirs(preferredDir, fallbackDir) {
    const dirs = [];
    const push = (p) => {
        if (!p) return;
        const n = path.normalize(String(p));
        if (!dirs.includes(n)) dirs.push(n);
    };

    push(preferResolvableMediaPath(preferredDir, fallbackDir));
    push(preferredDir);
    push(fallbackDir);
    push(path.join(process.cwd(), path.basename(preferredDir || fallbackDir || 'fotos')));

    return dirs.filter(Boolean);
}

module.exports = { preferResolvableMediaPath, listResolvableMediaDirs };
