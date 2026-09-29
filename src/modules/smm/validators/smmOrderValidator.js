'use strict';

const { validateTargetInput, validateComments } = require('./smmLinkValidator');
const { validateQuantity } = require('../validators/smmQuantityValidator');
const { getServiceInputProfile } = require('../constants/serviceTypes');

function assertCheckoutInput(service, link, quantity, comments = null) {
    const profile = getServiceInputProfile(service);

    const targetErr = validateTargetInput(link, service.platform, profile.targetMode);
    if (targetErr) return { ok: false, error: targetErr };

    const qtyErr = validateQuantity(quantity, service.min_quantity, service.max_quantity);
    if (qtyErr) return { ok: false, error: qtyErr };

    if (profile.needsComments) {
        const commentsErr = validateComments(comments, quantity);
        if (commentsErr) return { ok: false, error: commentsErr };
    }

    return { ok: true };
}

module.exports = { assertCheckoutInput };
