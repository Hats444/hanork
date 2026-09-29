'use strict';

/**
 * Adapter Mercado Pago — delega para PaymentService (compat legado MP.*).
 */
class MpAdapter {
    static async pix(valor, desc, ref, email = null) {
        const PaymentService = require('../payment/PaymentService');
        return PaymentService.createPix(valor, desc, ref, email);
    }

    static async checkout(valor, desc, ref) {
        const PaymentService = require('../payment/PaymentService');
        return PaymentService.createCheckout(valor, desc, ref);
    }

    static async status(paymentId) {
        const PaymentService = require('../payment/PaymentService');
        return PaymentService.getStatus(paymentId);
    }

    static async search(ref, opts = null) {
        const PaymentService = require('../payment/PaymentService');
        return PaymentService.findByReference(ref, null, opts);
    }

    static async searchByPreference(preferenceId, opts = null) {
        const PaymentService = require('../payment/PaymentService');
        return PaymentService.findByPreference(preferenceId, null, opts);
    }

    static async cancel(paymentId) {
        const PaymentService = require('../payment/PaymentService');
        return PaymentService.cancel(paymentId);
    }
}

module.exports = MpAdapter;
