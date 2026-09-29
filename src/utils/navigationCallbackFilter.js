'use strict';

/** Callbacks de navegação — não spammar PV admin nem reprocessar painel a cada clique. */
function isLowSignalNavigationCallback(data) {
    const d = String(data || '');
    if (!d) return false;

    if (d === 'menu:home' || d === 'catalog:view' || d === 'cat_hub' || d === 'cat_search') return true;
    if (/^cat_\d/.test(d)) return true;
    if (/^cat_list_/.test(d)) return true;
    if (/^cat_f_/.test(d)) return true;
    if (/^cat_pg_/.test(d)) return true;

    if (d === 'virtuo:home') return true;
    if (/^virtuo:ctyp:/.test(d)) return true;
    if (/^virtuo:svc:/.test(d)) return true;
    if (/^virtuo:srch:/.test(d)) return true;
    if (/^virtuo:docs:/.test(d)) return true;
    if (d === 'virtuo:bal:refresh' || d === 'sup:bal:refresh' || d === 'smm:bal:refresh') return true;

    if (/^virtuo:(buy|checkout|ord:cancel|ord:cp|ord:cc|pend:)/.test(d)) return false;
    if (/^virtuo:ord:refresh:/.test(d)) return false;
    if (/^virtuo:/.test(d)) return true;

    if (/^smm:home/.test(d) || /^smm:svc:/.test(d) || /^smm:page:/.test(d)) return true;

    if (d.startsWith('wadv:')) {
        if (/^wadv:(buy|connect|cancel|resume|pair|qr|phone)/.test(d)) return false;
        if (/^wadv:camp:go/.test(d)) return false;
        return true;
    }

    return false;
}

function navigationDebounceMs(data) {
    const d = String(data || '');
    if (isLowSignalNavigationCallback(d)) return 3000;
    if (/^payment:|^checkout:/.test(d)) return 2000;
    return 2000;
}

module.exports = {
    isLowSignalNavigationCallback,
    navigationDebounceMs,
};
