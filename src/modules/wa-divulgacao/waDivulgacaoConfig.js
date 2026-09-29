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
        return envFlag('WA_DIVULGACAO_ENABLED', false);
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
    botUsername() {
        return String(process.env.BOT_USERNAME || process.env.HANORK_BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
    },
    get botLink() {
        if (process.env.WA_DIVULGACAO_BOT_LINK) {
            return String(process.env.WA_DIVULGACAO_BOT_LINK).trim();
        }
        return `https://t.me/${this.botUsername()}?start=${this.startPayload}`;
    },
    /** Assinatura automática — só o link do bot (abre Hanork Div). */
    get watermarkDefault() {
        if (process.env.WA_DIVULGACAO_WATERMARK) {
            return String(process.env.WA_DIVULGACAO_WATERMARK).trim();
        }
        return this.botLink;
    },
    /** 1 = desconecta WA do assinante quando o plano expira (padrão 0 — mantém sessão no celular). */
    get logoutOnExpire() {
        return envFlag('WA_DIVULGACAO_LOGOUT_ON_EXPIRE', false);
    },
    /** Teto de grupos por assinante (disparo + auto-join + worker). */
    get maxGroupsDefault() {
        return Math.max(5, envNumber('WA_DIVULGACAO_MAX_GROUPS', 500));
    },
};

module.exports = WaDivulgacaoConfig;
