'use strict';

/** Modelos rápidos (§18.6) — definem modo, delay e repetições padrão. */
const CAMPAIGN_PRESETS = [
    {
        id: 'leve',
        label: '🪶 Leve',
        mode: 'status',
        delayMs: 5000,
        cycles: 1,
        hint: 'Status · delay 5s',
    },
    {
        id: 'status',
        label: '📲 Só Status',
        mode: 'status',
        delayMs: 15000,
        cycles: 1,
        hint: 'Status · delay 15s',
    },
    {
        id: 'pagamento',
        label: '💰 Pagamento',
        mode: 'payment',
        delayMs: 30000,
        cycles: 3,
        hint: 'Pagamento · 3× · 30s',
    },
    {
        id: 'completa',
        label: '📲+💰 Completa',
        mode: 'status_payment',
        delayMs: 30000,
        cycles: 3,
        hint: 'Status+pagamento · 3×',
    },
    {
        id: 'pesada',
        label: '🔥 Pesada',
        mode: 'status_payment',
        delayMs: 120000,
        cycles: 5,
        hint: 'Máximo alcance · 5× · 120s',
    },
];

function getPreset(id) {
    return CAMPAIGN_PRESETS.find((p) => p.id === id) || null;
}

module.exports = { CAMPAIGN_PRESETS, getPreset };
