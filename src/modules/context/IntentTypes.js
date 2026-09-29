'use strict';

/** Tipos de intenção operacional (camada passiva). */
const INTENT_TYPES = Object.freeze({
    PAYMENT_CONFIRMATION: 'payment_confirmation',
    SERVICE_REGISTER: 'service_register',
    APPOINTMENT_SCHEDULE: 'appointment_schedule',
    DEBT_TRACKING: 'debt_tracking',
    REMINDER_CREATION: 'reminder_creation',
    NEGOTIATION: 'negotiation',
    UNKNOWN: 'unknown',
});

/** Confiança mínima padrão (sobrescrevível via env). */
const DEFAULT_THRESHOLDS = Object.freeze({
    execute: 0.85,
    suggest: 0.65,
    ignore: 0.4,
});

module.exports = { INTENT_TYPES, DEFAULT_THRESHOLDS };
