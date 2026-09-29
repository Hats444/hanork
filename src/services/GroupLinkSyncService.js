'use strict';

const fs = require('fs');
const path = require('path');

const ENV_LINK_KEYS = ['LINKGP', 'DOWNLOADS_GROUP_LINK'];
const ENV_ID_KEY = 'GRUPO_ID';

/** Arquivos/pastas onde links expirados costumam ficar (sem varrer node_modules) */
const DOC_SCAN_REL = [
    '.env',
    '.env.example',
    'README.md',
    'docs',
    'data',
];

function projectRoot() {
    return path.join(__dirname, '../..');
}

function normalizeInviteUrl(url) {
    return String(url || '')
        .trim()
        .replace(/[.,;)]+$/, '');
}

function isTelegramInviteUrl(url) {
    const u = normalizeInviteUrl(url);
    return /^https?:\/\/(t\.me\/\+|t\.me\/joinchat\/|telegram\.me\/\+)/i.test(u) || /^https?:\/\/t\.me\/\w+/i.test(u);
}

function readText(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function readEnvValue(content, key) {
    if (!content) return null;
    const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? normalizeInviteUrl(m[1].replace(/^["']|["']$/g, '')) : null;
}

function updateEnvLine(content, key, value) {
    const safe = String(value).replace(/\r?\n/g, '');
    const line = `${key}=${safe}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) return content.replace(re, line);
    const sep = content.endsWith('\n') || !content.length ? '' : '\n';
    return `${content}${sep}${line}\n`;
}

function writeEnvUpdates(envPath, updates) {
    let content = readText(envPath);
    if (content == null) return { ok: false, reason: 'env_missing' };

    for (const [key, val] of Object.entries(updates)) {
        if (val == null || val === '') continue;
        content = updateEnvLine(content, key, val);
    }

    const tmp = `${envPath}.linksync.tmp`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, envPath);
    return { ok: true };
}

function collectPreviousUrls(groupSettings) {
    const urls = new Set();
    const add = (u) => {
        const n = normalizeInviteUrl(u);
        if (n && /t\.me|telegram\.me/i.test(n)) urls.add(n);
    };

    try {
        add(groupSettings?.getVipGroupUrl?.());
    } catch {
        /* ignore */
    }
    add(process.env.LINKGP);
    add(process.env.DOWNLOADS_GROUP_LINK);

    const envPath = path.join(projectRoot(), '.env');
    const envContent = readText(envPath);
    for (const key of ENV_LINK_KEYS) add(readEnvValue(envContent, key));

    return [...urls];
}

function replaceUrlsInText(content, oldUrls, newUrl) {
    let out = content;
    let changed = false;
    for (const old of oldUrls) {
        if (!old || old === newUrl) continue;
        if (out.includes(old)) {
            out = out.split(old).join(newUrl);
            changed = true;
        }
    }
    return { content: out, changed };
}

function replaceInFile(filePath, oldUrls, newUrl) {
    const content = readText(filePath);
    if (content == null) return false;
    const { content: next, changed } = replaceUrlsInText(content, oldUrls, newUrl);
    if (!changed) return false;
    fs.writeFileSync(filePath, next, 'utf8');
    return true;
}

function shouldScanFile(name) {
    if (name.endsWith('.linksync.tmp')) return false;
    const ext = path.extname(name).toLowerCase();
    return ['.md', '.json', '.txt', '.html', '.example', ''].includes(ext) || name === '.env';
}

function scanDirectory(dir, root, oldUrls, newUrl, updated, limit) {
    if (updated.length >= limit) return;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of entries) {
        if (updated.length >= limit) break;
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'zero-divu') continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            scanDirectory(full, root, oldUrls, newUrl, updated, limit);
        } else if (shouldScanFile(ent.name)) {
            try {
                if (replaceInFile(full, oldUrls, newUrl)) {
                    updated.push(path.relative(root, full).replace(/\\/g, '/'));
                }
            } catch {
                /* arquivo bloqueado — ignora */
            }
        }
    }
}

function syncDocumentationFiles(oldUrls, newUrl) {
    const root = projectRoot();
    const updated = [];
    const limit = 80;

    for (const rel of DOC_SCAN_REL) {
        const full = path.join(root, rel);
        try {
            const st = fs.statSync(full);
            if (st.isFile()) {
                if (replaceInFile(full, oldUrls, newUrl)) updated.push(rel);
            } else if (st.isDirectory()) {
                scanDirectory(full, root, oldUrls, newUrl, updated, limit);
            }
        } catch {
            /* path opcional */
        }
    }

    return updated;
}

/**
 * Persiste link do grupo VIP e propaga para runtime, .env e docs.
 * @returns {{ ok: boolean, url?: string, envUpdated?: boolean, filesUpdated?: string[], oldUrls?: string[], error?: string }}
 */
function syncGroupInviteLink({ url, groupSettings, groupId = null, logger = null } = {}) {
    const newUrl = normalizeInviteUrl(url);
    if (!newUrl || !/^https?:\/\//i.test(newUrl)) {
        return { ok: false, error: 'invalid_url' };
    }

    const oldUrls = collectPreviousUrls(groupSettings).filter((u) => u !== newUrl);

    groupSettings.setVipGroupUrl(newUrl);
    if (groupId != null) {
        groupSettings.setVipGroupId(groupId);
    }

    process.env.LINKGP = newUrl;
    process.env.DOWNLOADS_GROUP_LINK = newUrl;

    const envUpdates = {
        LINKGP: newUrl,
        DOWNLOADS_GROUP_LINK: newUrl,
    };
    if (groupId != null) {
        envUpdates.GRUPO_ID = String(groupId);
        process.env.GRUPO_ID = String(groupId);
    }

    const envPath = path.join(projectRoot(), '.env');
    const envResult = writeEnvUpdates(envPath, envUpdates);

    const filesUpdated = syncDocumentationFiles(oldUrls, newUrl);

    logger?.info?.('[GroupLinkSync] link atualizado', {
        url: newUrl,
        groupId: groupId ?? null,
        env: envResult.ok,
        docs: filesUpdated.length,
        replaced: oldUrls,
    });

    return {
        ok: true,
        url: newUrl,
        envUpdated: envResult.ok,
        filesUpdated,
        oldUrls,
        groupId: groupId ?? null,
    };
}

function formatSyncReport(result) {
    if (!result?.ok) return '';
    const lines = [];
    if (result.envUpdated) {
        lines.push('• <code>.env</code> — LINKGP + DOWNLOADS_GROUP_LINK');
        if (result.groupId != null) lines.push(`• <code>.env</code> — GRUPO_ID=<code>${result.groupId}</code>`);
    }
    if (result.filesUpdated?.length) {
        const shown = result.filesUpdated.slice(0, 8);
        lines.push(`• Docs/arquivos (${result.filesUpdated.length}): <code>${shown.join('</code>, <code>')}</code>`);
        if (result.filesUpdated.length > 8) lines.push(`• … e mais ${result.filesUpdated.length - 8} arquivo(s)`);
    }
    if (result.oldUrls?.length) {
        lines.push(`• Substituído link antigo expirado`);
    }
    lines.push('• Menu, downloads e botões usam o link novo <b>agora</b> (sem reiniciar).');
    return lines.join('\n');
}

module.exports = {
    syncGroupInviteLink,
    formatSyncReport,
    normalizeInviteUrl,
    isTelegramInviteUrl,
    projectRoot,
};
