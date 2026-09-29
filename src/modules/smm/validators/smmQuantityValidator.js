'use strict';

function validateQuantity(quantity, min, max) {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return 'quantity_invalid';
    if (qty < min) return 'quantity_below_min';
    if (qty > max) return 'quantity_above_max';
    return null;
}

module.exports = { validateQuantity };
