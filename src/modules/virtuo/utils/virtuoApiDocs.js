'use strict';

const fs = require('fs');
const path = require('path');
const { Markup } = require('telegraf');
const VirtuoConfig = require('../virtuoConfig');

const DOCS_PATH = path.join(__dirname, '../../../../docs/virtuo/virtuo-esim-api-docs.md');
const PAGE_MAX = 3600;

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatPageContent(raw) {
    const lines = raw.split('\n');
    const out = [];
    let inCode = false;
    let codeBuf = [];

    for (const line of lines) {
        if (line.startsWith('```')) {
            if (!inCode) {
                inCode = true;
                codeBuf = [];
            } else {
                inCode = false;
                out.push(`<pre>${escapeHtml(codeBuf.join('\n'))}</pre>`);
            }
            continue;
        }
        if (inCode) {
            codeBuf.push(line);
            continue;
        }
        if (line.startsWith('# ')) {
            out.push(`<b>${escapeHtml(line.slice(2))}</b>`);
        } else if (line.startsWith('## ')) {
            out.push(`\n<b>${escapeHtml(line.slice(3))}</b>`);
        } else if (line.startsWith('### ')) {
            out.push(`\n<b>${escapeHtml(line.slice(4))}</b>`);
        } else if (line.startsWith('> ')) {
            out.push(`<i>${escapeHtml(line.slice(2))}</i>`);
        } else if (line.trim() === '---') {
            continue;
        } else {
            out.push(escapeHtml(line));
        }
    }
    return out.join('\n').trim();
}

function loadDocsRaw() {
    return fs.readFileSync(DOCS_PATH, 'utf8');
}

function splitIntoPages(raw) {
    const parts = raw.split(/\n(?=## )/);
    const pages = [];
    let buf = '';

    for (const part of parts) {
        const candidate = buf ? `${buf}\n\n${part}` : part;
        if (candidate.length > PAGE_MAX) {
            if (buf.trim()) pages.push(buf.trim());
            if (part.length > PAGE_MAX) {
                let start = 0;
                while (start < part.length) {
                    pages.push(part.slice(start, start + PAGE_MAX).trim());
                    start += PAGE_MAX;
                }
                buf = '';
            } else {
                buf = part;
            }
        } else {
            buf = candidate;
        }
    }
    if (buf.trim()) pages.push(buf.trim());
    return pages.length ? pages : [raw.slice(0, PAGE_MAX)];
}

let cachedPages = null;
let cachedMtimeMs = 0;

function getPages() {
    const stat = fs.statSync(DOCS_PATH);
    const mtimeMs = stat.mtimeMs;
    if (!cachedPages || cachedMtimeMs !== mtimeMs) {
        cachedPages = splitIntoPages(loadDocsRaw());
        cachedMtimeMs = mtimeMs;
    }
    return cachedPages;
}

function getDocsPage(index) {
    const pages = getPages();
    const total = pages.length;
    const i = Math.max(0, Math.min(Number(index) || 0, total - 1));
    return {
        index: i,
        total,
        html: formatPageContent(pages[i]),
        path: DOCS_PATH,
    };
}

function docsKeyboard(pageIndex, total) {
    const row = [];
    if (pageIndex > 0) {
        row.push({ text: '◀️ Anterior', callback_data: `virtuo:docs:${pageIndex - 1}` });
    }
    row.push({ text: `${pageIndex + 1}/${total}`, callback_data: 'virtuo:noop' });
    if (pageIndex < total - 1) {
        row.push({ text: '▶️ Próxima', callback_data: `virtuo:docs:${pageIndex + 1}` });
    }
    return Markup.inlineKeyboard([
        row,
        [{ text: '📥 Baixar .md completo', callback_data: 'virtuo:docs:file' }],
    ]);
}

function apiBaseUrlV1() {
    return `${VirtuoConfig.apiUrl.replace(/\/+$/, '')}/v1`;
}

function buildDocsIntroHtml() {
    return (
        `<b>📚 API Virtuo E-SIM (v1)</b>\n\n` +
        `Documentação oficial extraída do painel Virtuo.\n` +
        `Base URL em uso no Hanork: <code>${apiBaseUrlV1()}</code>\n` +
        `Autenticação: <code>Authorization: Bearer vtk_…</code>\n\n` +
        `<i>Use os botões para navegar ou baixe o arquivo completo.</i>`
    );
}

module.exports = {
    DOCS_PATH,
    loadDocsRaw,
    getDocsPage,
    docsKeyboard,
    buildDocsIntroHtml,
    apiBaseUrlV1,
};
