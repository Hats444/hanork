#!/usr/bin/env node
'use strict';

/**
 * Smoke test modos de campanha Hanork Div: status · payment · status_payment · mídia · mídia+texto.
 * Uso: node scripts/verify-wadv-campaign-modes.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
let failed = 0;

function ok(label) {
    console.log(`[OK] ${label}`);
}

function fail(label, detail = '') {
    failed += 1;
    console.log(`[FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
    return fs.existsSync(path.join(ROOT, rel));
}

const MODES = ['status', 'payment', 'status_payment'];
const MODE_CALLBACKS = MODES.map((m) => `wadv:camp:mode:${m}`);

const campPath = 'src/modules/wa-divulgacao/waDivulgacaoCampaignService.js';
if (exists(campPath)) {
    const camp = read(campPath);
    for (const cb of MODE_CALLBACKS) {
        if (camp.includes(cb)) ok(`callback ${cb}`);
        else fail(`callback ${cb}`);
    }
    for (const token of [
        "_modeLabel(mode)",
        "_needsCycles(mode)",
        "_isPaymentMode(mode)",
        "_isPaymentOnlyMode(mode)",
        "_requiresText(mode)",
        '_mediaAllowedForMode(mode)',
        "mode === 'status_payment'",
        "mode === 'payment'",
        "return mode === 'status' || mode === 'status_payment'",
    ]) {
        if (camp.includes(token)) ok(`campaign service ${token}`);
        else fail(`campaign service ${token}`);
    }
} else {
    fail(campPath, 'arquivo ausente');
}

const handlersPath = 'src/modules/wa-divulgacao/callbacks/waDivulgacaoHandlers.js';
if (exists(handlersPath)) {
    const h = read(handlersPath);
    for (const prefix of ['wadv:camp:mode:', 'wadv:camp:go']) {
        if (h.includes(prefix)) ok(`handler prefix ${prefix}`);
        else fail(`handler prefix ${prefix}`);
    }
    if (/reuseMedia|pick_media|wadv:camp:.*media|buildMediaPanel/.test(h)) ok('handler media/caption wizard');
    else fail('handler media/caption wizard');
} else {
    fail(handlersPath);
}

const blastPaths = [
    'zero-divu/src/services/divBlast.js',
    'zero-divu/src/services/customBlast.js',
    'zero-divu/src/services/blastCoordinator.js',
];
for (const rel of blastPaths) {
    if (!exists(rel)) {
        fail(rel, 'arquivo ausente');
        continue;
    }
    const src = read(rel);
    if (rel.includes('divBlast')) {
        for (const token of ['status_payment', 'payment', 'caption']) {
            if (src.includes(token)) ok(`divBlast ${token}`);
            else fail(`divBlast ${token}`);
        }
        if (/sendMessage|relayMessage|sock\.send|imageMessage|videoMessage/.test(src)) {
            ok('divBlast send path');
        } else {
            fail('divBlast send path');
        }
    }
    if (rel.includes('customBlast') && /caption|status_payment|payment/.test(src)) {
        ok('customBlast modos/caption');
    } else if (rel.includes('customBlast')) {
        fail('customBlast modos/caption');
    }
    if (rel.includes('blastCoordinator') && /status_payment|payment|mode|blast|divBlast/.test(src)) {
        ok('blastCoordinator wiring');
    } else if (rel.includes('blastCoordinator')) {
        fail('blastCoordinator wiring');
    }
}

const statusPath = 'zero-divu/src/services/statusMessage.js';
if (exists(statusPath)) {
    const st = read(statusPath);
    if (/caption|media|image|video/.test(st)) ok('statusMessage mídia/caption');
    else fail('statusMessage mídia/caption');
} else {
    fail(statusPath);
}

try {
    const svc = require(path.join(ROOT, campPath));
    const proto = svc?.WaDivulgacaoCampaignService?.prototype || Object.getPrototypeOf(svc);
    const inst =
        typeof svc === 'function'
            ? Object.create(svc.prototype)
            : svc;
    for (const mode of MODES) {
        const labelFn = inst._modeLabel || proto?._modeLabel;
        if (typeof labelFn === 'function') {
            const label = labelFn.call(inst, mode);
            if (label && String(label).length > 2) ok(`_modeLabel(${mode}) → ${String(label).slice(0, 40)}`);
            else fail(`_modeLabel(${mode})`);
        }
        const mediaFn = inst._mediaAllowedForMode || proto?._mediaAllowedForMode;
        if (typeof mediaFn === 'function') {
            const allowed = mediaFn.call(inst, mode);
            const expectMedia = mode === 'status' || mode === 'status_payment';
            if (Boolean(allowed) === expectMedia) ok(`_mediaAllowedForMode(${mode})=${allowed}`);
            else fail(`_mediaAllowedForMode(${mode})`, `esperado ${expectMedia}, got ${allowed}`);
        }
        const payFn = inst._isPaymentMode || proto?._isPaymentMode;
        if (typeof payFn === 'function') {
            const isPay = payFn.call(inst, mode);
            const expectPay = mode === 'payment' || mode === 'status_payment';
            if (Boolean(isPay) === expectPay) ok(`_isPaymentMode(${mode})=${isPay}`);
            else fail(`_isPaymentMode(${mode})`);
        }
    }
} catch (e) {
    fail('WaDivulgacaoCampaignService runtime', e.message);
}

console.log('');
if (failed === 0) {
    console.log('verify-wadv-campaign-modes: ALL OK');
    process.exit(0);
}
console.log(`verify-wadv-campaign-modes: ${failed} falha(s)`);
process.exit(1);
