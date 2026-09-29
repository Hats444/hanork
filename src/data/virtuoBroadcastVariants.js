'use strict';

const path = require('path');
const fs = require('fs');
const { resolvePairedPromoPhoto } = require('../utils/promoMediaPaths');
const { isVirtuoEnabled } = require('../modules/virtuo/virtuoEnabled');
const { isVirtuoPublicAccess } = require('../modules/virtuo/virtuoAccess');

const { appendVirtuoCta, virtuoDeepLink } = require('../utils/broadcastDeepLinks');

const themesPath = path.join(__dirname, 'virtuoPromoThemes.json');
const VARIANTS = JSON.parse(fs.readFileSync(themesPath, 'utf8'));

const VIRTUO_QUEUE_MARKER = '__virtuo__';
const DEFAULT_PHOTO = 'virtuo_01.jpg';
const KV_VARIANT_QUEUE = 'virtuo_broadcast_variant_queue';

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function isVirtuoBroadcastEnabled() {
    if (!isVirtuoEnabled()) return false;
    if (!isVirtuoPublicAccess()) return false;
    const v = String(process.env.AUTO_BROADCAST_VIRTUO ?? '1').toLowerCase();
    return v !== '0' && v !== 'false';
}

function virtuoEveryN() {
    return Math.max(2, parseInt(process.env.AUTO_BROADCAST_VIRTUO_EVERY_N || '4', 10));
}

function pickFromQueue(ids, kv, queueKey) {
    let queue = [];
    try {
        const raw = kv.get?.(queueKey);
        queue = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(queue)) queue = [];
    } catch {
        queue = [];
    }
    queue = queue.filter((id) => ids.includes(id));
    if (!queue.length) queue = shuffle(ids);
    const picked = queue.shift();
    kv.set?.(queueKey, JSON.stringify(queue));
    return picked;
}

function variantIndex(variant) {
    const idx = VARIANTS.findIndex((v) => v.id === variant?.id);
    return idx >= 0 ? idx : 0;
}

function pickVirtuoVariant(kv = {}) {
    const ids = VARIANTS.map((v) => v.id);
    const picked = pickFromQueue(ids, kv, KV_VARIANT_QUEUE);
    return VARIANTS.find((v) => v.id === picked) || VARIANTS[0];
}

function resolveVirtuoPhotoForVariant(variant, photosDir) {
    const idx = variantIndex(variant);
    return resolvePairedPromoPhoto('virtuo', variant, idx, photosDir);
}

function pickVirtuoBroadcast(kv = {}, photosDir = null) {
    const variant = pickVirtuoVariant(kv);
    const idx = variantIndex(variant);
    const paired = resolvePairedPromoPhoto('virtuo', variant, idx, photosDir);
    return { variant, ...paired };
}

function virtuoBotLink(username) {
    return virtuoDeepLink(username);
}

function formatVirtuoTelegramHtml(variant, opts = {}) {
    const botLink = opts.botLink || virtuoBotLink(opts.username);
    const headline = variant.headline || 'Números SMS Virtuo';
    const body = String(variant.tgBody || '').trim();
    return (
        `<b>${headline}</b>\n\n` +
        `${body}\n\n` +
        `<a href="${botLink}">Comprar número SMS</a>\n` +
        `<i>PIX ou cartão. Suporte: /suporte</i>`
    );
}

function buildVirtuoWaText(variant, opts = {}) {
    const link = virtuoBotLink(opts.username);
    const body = String(variant.waBody || variant.tgBody || '').trim();
    return `${body}\n\n${link}\nSuporte no PV: /suporte`;
}

function mixVirtuoIntoProductQueue(productIds, existing = []) {
    if (!isVirtuoBroadcastEnabled() || !productIds.length) {
        return existing.length ? existing : shuffle(productIds);
    }
    const base = existing.length ? [...existing] : shuffle(productIds);
    const every = virtuoEveryN();
    const mixed = [];
    for (let i = 0; i < base.length; i++) {
        mixed.push(base[i]);
        if ((i + 1) % every === 0) mixed.push(VIRTUO_QUEUE_MARKER);
    }
    return shuffle(mixed);
}

function filterVirtuoQueueMarkers(queue, activeProductIds, { allowSmm = false, allowVirtuo = null } = {}) {
    const active = new Set(activeProductIds);
    const virtuoOk = allowVirtuo != null ? allowVirtuo : isVirtuoBroadcastEnabled();
    const { SMM_QUEUE_MARKER, isSmmBroadcastEnabled } = require('./smmBroadcastVariants');
    const smmOk = allowSmm != null ? allowSmm : isSmmBroadcastEnabled();
    return queue.filter(
        (id) =>
            (id === VIRTUO_QUEUE_MARKER && virtuoOk) ||
            (id === SMM_QUEUE_MARKER && smmOk) ||
            active.has(id)
    );
}

module.exports = {
    VIRTUO_QUEUE_MARKER,
    DEFAULT_PHOTO,
    VARIANTS,
    isVirtuoBroadcastEnabled,
    virtuoEveryN,
    pickVirtuoVariant,
    pickVirtuoBroadcast,
    resolveVirtuoPhotoForVariant,
    virtuoBotLink,
    formatVirtuoTelegramHtml,
    buildVirtuoWaText,
    mixVirtuoIntoProductQueue,
    filterVirtuoQueueMarkers,
    KV_VARIANT_QUEUE,
};
