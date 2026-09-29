'use strict';

require('./env');

const TZ = process.env.CAMPAIGN_TIMEZONE || 'America/Sao_Paulo';

/** Janela após o horário do slot em que o tick (5min) ainda pode disparar. */
function slotWindowMs() {
    return Math.max(5 * 60 * 1000, parseInt(process.env.CAMPAIGN_SLOT_WINDOW_MS || '3600000', 10));
}

function isCampaignOrchestratorEnabled() {
    const v = String(process.env.CAMPAIGN_ORCHESTRATOR || '0').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

/** 00/06 → HANORK · 12/18 → SMM */
function groupSlots() {
    const raw = process.env.CAMPAIGN_GROUP_SLOTS;
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) return parsed;
        } catch {
            /* fallback */
        }
    }
    return [
        { hour: 0, type: 'hanork' },
        { hour: 6, type: 'hanork' },
        { hour: 12, type: 'smm' },
        { hour: 18, type: 'smm' },
    ];
}

/** 10h → 1 divulgação PV/dia (Hanork). Sobrescreva com CAMPAIGN_PV_SLOTS no .env. */
function pvSlots() {
    const raw = process.env.CAMPAIGN_PV_SLOTS;
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) return parsed;
        } catch {
            /* fallback */
        }
    }
    return [{ hour: 10, type: 'hanork' }];
}

function maxPvCampaignsPerDay() {
    return Math.max(1, Math.min(2, parseInt(process.env.CAMPAIGN_PV_MAX_PER_DAY || '1', 10)));
}

/** Intervalo mínimo entre divulgações no mesmo grupo (6h por spec). */
function groupCooldownMs() {
    return Math.max(
        6 * 60 * 60 * 1000,
        parseInt(process.env.CAMPAIGN_GROUP_COOLDOWN_MS || String(6 * 60 * 60 * 1000), 10)
    );
}

module.exports = {
    CAMPAIGN_TIMEZONE: TZ,
    slotWindowMs,
    isCampaignOrchestratorEnabled,
    groupSlots,
    pvSlots,
    maxPvCampaignsPerDay,
    groupCooldownMs,
};
