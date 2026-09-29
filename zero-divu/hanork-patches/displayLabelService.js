'use strict';

const { familyDisplayLabel } = require('./familyService');
const { normalizeServiceType } = require('../constants/serviceTypes');

const GENERIC_SUB = new Set(['', 'Outros']);
const GENERIC_PLATFORM = new Set(['', 'Outros']);

const PLATFORM_UI = {
    Outros: 'Mais serviços',
};

/** Subcategoria amigável quando o catálogo caiu em "Outros". */
const SUBCATEGORY_UI_BY_PLATFORM = {
    IPTV: 'Planos IPTV',
    'Free Fire': 'Pacotes Free Fire',
    Canva: 'Assinatura Canva',
};

function truncate(str, max = 80) {
    const s = String(str || '').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
}

function platformDisplayLabel(platform) {
    const p = String(platform || '').trim();
    if (GENERIC_PLATFORM.has(p)) return PLATFORM_UI.Outros;
    return p;
}

function subcategoryDisplayLabel(subcategory, platform) {
    const sub = String(subcategory || '').trim();
    if (!GENERIC_SUB.has(sub)) return sub;
    const plat = String(platform || '').trim();
    if (SUBCATEGORY_UI_BY_PLATFORM[plat]) return SUBCATEGORY_UI_BY_PLATFORM[plat];
    if (!GENERIC_PLATFORM.has(plat)) return 'Geral';
    return 'Serviços diversos';
}

/**
 * Título comercial do serviço — nunca mostra só "Outros" quando há plataforma/nome.
 */
function serviceDisplayLabel(svc, opts = {}) {
    if (!svc) return 'Serviço';
    const max = opts.max ?? 80;
    const platform = svc.platform || '';
    const sub = svc.subcategory || '';
    const name = truncate(svc.name || 'Serviço', max);
    const serviceType = normalizeServiceType(svc.service_type);

    if (GENERIC_SUB.has(sub)) {
        if (!GENERIC_PLATFORM.has(platform)) {
            return truncate(`${platform} — ${name}`, max);
        }
        return name;
    }

    if (svc.service_family) {
        const fam = familyDisplayLabel(svc.service_family, sub);
        if (!GENERIC_PLATFORM.has(platform)) {
            return truncate(`${platform} · ${fam}`, max);
        }
        return truncate(fam, max);
    }

    if (serviceType === 'Package') {
        if (!GENERIC_PLATFORM.has(platform)) {
            return truncate(`${platform} — ${name}`, max);
        }
        return name;
    }

    if (!GENERIC_PLATFORM.has(platform)) {
        return truncate(`${platform} · ${sub}`, max);
    }
    return truncate(sub, max);
}

function categoryBreadcrumb(platform, subcategory) {
    const p = platformDisplayLabel(platform);
    const subRaw = String(subcategory || '').trim();
    const subLabel = subcategoryDisplayLabel(subRaw, platform);
    return `<b>${p}</b> › <b>${subLabel}</b>`;
}

module.exports = {
    platformDisplayLabel,
    subcategoryDisplayLabel,
    serviceDisplayLabel,
    categoryBreadcrumb,
    GENERIC_SUB,
    GENERIC_PLATFORM,
};
