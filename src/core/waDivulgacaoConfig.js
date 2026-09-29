'use strict';

function envFlag(name, defaultOn = true) {
    const v = String(process.env[name] ?? (defaultOn ? '1' : '0')).toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

function envNumber(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) ? n : fallback;
}

const WaDivulgacaoConfig = {
    get enabled() {
        return envFlag('WA_DIVULGACAO_ENABLED', true);
    },
    get productCategory() {
        return 'wa_divulgacao';
    },
    get planPrefix() {
        return 'Hanork Div';
    },
    get displayBrand() {
        const v = process.env.WA_DIVULGACAO_BRAND;
        return v && String(v).trim() ? String(v).trim() : '𝗛𝗮𝗻𝗼𝗿𝗸 𝗗𝗶𝘃';
    },
    get startPayload() {
        return 'handiv';
    },
    get watermarkDefault() {
        if (process.env.WA_DIVULGACAO_WATERMARK) {
            return process.env.WA_DIVULGACAO_WATERMARK;
        }
        const botUser = String(process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
        return `https://t.me/${botUser}?start=handiv`;
    },
    get botLink() {
        if (process.env.WA_DIVULGACAO_BOT_LINK) {
            return String(process.env.WA_DIVULGACAO_BOT_LINK).trim();
        }
        const botUser = String(process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
        return `https://t.me/${botUser}?start=handiv`;
    },
};

module.exports = WaDivulgacaoConfig;
