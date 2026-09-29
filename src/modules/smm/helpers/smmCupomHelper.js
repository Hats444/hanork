'use strict';

/**
 * Aplica cupom do Redis (cuponsAplicados) sobre total SMM — recalcula desconto no valor do serviço.
 */
function resolveCupomDiscount(baseTotal, cupomEntry) {
    const base = Number(baseTotal);
    if (!Number.isFinite(base) || base <= 0 || !cupomEntry?.coupon) {
        return { total: base, discount: 0, code: null };
    }
    const cupom = cupomEntry.coupon;
    if (cupom.min_total > 0 && base < Number(cupom.min_total)) {
        return { total: base, discount: 0, code: cupomEntry.code || null, rejected: 'min_total' };
    }
    const discount =
        cupom.type === 'percent'
            ? base * (Number(cupom.value) / 100)
            : Number(cupom.value);
    const applied = Math.min(Math.max(0, discount), base);
    return {
        total: Math.max(0, base - applied),
        discount: applied,
        code: cupomEntry.code || cupom.code || null,
    };
}

function formatCupomLine(discount, code) {
    if (!discount || discount <= 0 || !code) return '';
    return `\nCupom <code>${code}</code>: −R$ ${Number(discount).toFixed(2).replace('.', ',')}`;
}

module.exports = { resolveCupomDiscount, formatCupomLine };
