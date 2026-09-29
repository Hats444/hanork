'use strict';

const path = require('path');

/** Valores legados de categoria semântica — ignorados se houver file_url para recalcular */
const LEGACY_CATEGORIES = new Set([
    'geral',
    'assinatura',
    'serviço',
    'servico',
    'arquivo',
    'fotos',
    'video',
    'audio',
    'outros',
]);

/** Rótulo curto por extensão (sem emoji — tag textual). */
const FORMAT_TAG = {
    ZIP: 'ZIP',
    RAR: 'RAR',
    '7Z': '7Z',
    TAR: 'TAR',
    GZ: 'GZ',
    BZ2: 'BZ2',
    XZ: 'XZ',
    APK: 'APK',
    IPA: 'IPA',
    EXE: 'EXE',
    DMG: 'DMG',
    MSI: 'MSI',
    PDF: 'PDF',
    DOC: 'DOC',
    DOCX: 'DOCX',
    ODT: 'ODT',
    XLS: 'XLS',
    XLSX: 'XLSX',
    CSV: 'CSV',
    PPT: 'PPT',
    PPTX: 'PPTX',
    TXT: 'TXT',
    MD: 'MD',
    RTF: 'RTF',
    JSON: 'JSON',
    XML: 'XML',
    YAML: 'YAML',
    YML: 'YML',
    HTML: 'HTML',
    HTM: 'HTM',
    EPUB: 'EPUB',
    MOBI: 'MOBI',
    JPG: 'JPG',
    JPEG: 'JPEG',
    PNG: 'PNG',
    GIF: 'GIF',
    WEBP: 'WEBP',
    SVG: 'SVG',
    BMP: 'BMP',
    ICO: 'ICO',
    HEIC: 'HEIC',
    HEIF: 'HEIF',
    TIFF: 'TIFF',
    TIF: 'TIF',
    PSD: 'PSD',
    MP4: 'MP4',
    MKV: 'MKV',
    AVI: 'AVI',
    MOV: 'MOV',
    WEBM: 'WEBM',
    WMV: 'WMV',
    FLV: 'FLV',
    M4V: 'M4V',
    MPEG: 'MPEG',
    MPG: 'MPG',
    '3GP': '3GP',
    MP3: 'MP3',
    WAV: 'WAV',
    OGG: 'OGG',
    M4A: 'M4A',
    FLAC: 'FLAC',
    AAC: 'AAC',
    WMA: 'WMA',
    OPUS: 'OPUS',
    MID: 'MID',
    MIDI: 'MIDI',
    JS: 'JS',
    TS: 'TS',
    TSX: 'TSX',
    JSX: 'JSX',
    PY: 'PY',
    PHP: 'PHP',
    JAVA: 'JAVA',
    SQL: 'SQL',
    SH: 'SH',
    BAT: 'BAT',
    PS1: 'PS1',
    ENV: 'ENV',
    INI: 'INI',
    CFG: 'CFG',
    ASSINATURA: 'Assinatura',
};

/** @deprecated alias — use FORMAT_TAG */
const FORMAT_EMOJI = FORMAT_TAG;

const TYPE_TO_FORMAT = {
    photo: 'JPG',
    video: 'MP4',
    audio: 'MP3',
    file: null,
    text: 'TXT',
};

/**
 * Extrai extensão de file_url (nome local ou path).
 * @param {string} fileUrl
 * @returns {string|null}
 */
function extensionFromFileUrl(fileUrl) {
    const raw = String(fileUrl || '').trim();
    if (!raw || raw.startsWith('text:')) return null;
    if (!raw.includes('.') && !raw.includes('/') && !raw.includes('\\')) return null;
    const base = path.basename(raw.split('?')[0]);
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return null;
    const ext = base.slice(dot + 1).toLowerCase();
    if (!/^[a-z0-9]{1,12}$/i.test(ext)) return null;
    return ext;
}

function formatEmoji(fmt) {
    if (!fmt) return 'Arquivo';
    const u = String(fmt).toUpperCase();
    return FORMAT_TAG[u] || u;
}

/** Tag entre colchetes para botões compactos. */
function formatTag(fmt) {
    const label = formatEmoji(fmt);
    return label === 'Arquivo' ? label : `[${label}]`;
}

/** Chave do catálogo (callback cat_f_<key>_0) — só [a-z0-9] */
function formatCatalogKey(fmt) {
    if (!fmt) return 'outros';
    const u = String(fmt).toUpperCase();
    if (u === 'ASSINATURA') return 'assinatura';
    const key = u.toLowerCase().replace(/[^a-z0-9]/g, '');
    return key || 'outros';
}

/** Rótulo exibido no hub de formatos (ex.: MP4, ZIP, Assinatura). */
function formatBucketLabel(fmtOrKey) {
    if (!fmtOrKey || fmtOrKey === 'outros') return 'Outros';
    if (fmtOrKey === 'assinatura') return 'Assinatura';
    const fmt = String(fmtOrKey).toUpperCase();
    return FORMAT_TAG[fmt] || fmt;
}

/**
 * @param {object} product — { file_url, category, is_subscription, type? }
 * @returns {string|null} Formato em maiúsculas (ZIP, TXT, …) ou null
 */
function resolveProductFormat(product) {
    if (!product) return null;

    const fileUrl = String(product.file_url || '').trim();
    const isSubscription = product.is_subscription === 1 || product.is_subscription === true;

    if (fileUrl.startsWith('text:')) return 'TXT';

    const ext = extensionFromFileUrl(fileUrl);
    if (ext) return ext.toUpperCase();

    if (isSubscription) return 'ASSINATURA';

    const wizardType = product.type || product.product_type;
    if (wizardType && TYPE_TO_FORMAT[wizardType]) {
        if (wizardType === 'service' || wizardType === 'subscription') {
            if (!fileUrl) return wizardType === 'subscription' ? 'ASSINATURA' : null;
        }
        const mapped = TYPE_TO_FORMAT[wizardType];
        if (mapped) return mapped;
    }

    const cat = String(product.category || '').trim();
    if (cat && !LEGACY_CATEGORIES.has(cat.toLowerCase())) {
        const fromCat = cat.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (fromCat) return fromCat;
    }

    return null;
}

/**
 * Valor para gravar em products.category (minúsculo, extensão).
 * @param {object} product
 * @returns {string}
 */
function formatForStorage(product) {
    const resolved = resolveProductFormat(product);
    if (resolved) return resolved.toLowerCase();
    return '';
}

/**
 * Enriquece produto com campo `format` para APIs/UI.
 * @param {object} product
 * @returns {object}
 */
function withFormatField(product) {
    if (!product) return product;
    return {
        ...product,
        format: resolveProductFormat(product),
    };
}

module.exports = {
    resolveProductFormat,
    formatForStorage,
    withFormatField,
    extensionFromFileUrl,
    formatCatalogKey,
    formatBucketLabel,
    formatEmoji,
    formatTag,
    LEGACY_CATEGORIES,
    FORMAT_EMOJI,
    FORMAT_TAG,
};
