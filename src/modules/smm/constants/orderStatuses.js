'use strict';

const LOCAL_STATUSES = {
    PENDING: 'pending',
    AWAITING_PAYMENT: 'awaiting_payment',
    PAID: 'paid',
    SUBMITTED: 'submitted',
    PROCESSING: 'processing',
    PARTIAL: 'partial',
    COMPLETED: 'completed',
    CANCELED: 'canceled',
    FAILED: 'failed',
    REFILL_PENDING: 'refill_pending',
};

/** Alias usado pelos services */
const ORDER_STATUS = LOCAL_STATUSES;

const MONITOR_STATUSES = [
    LOCAL_STATUSES.SUBMITTED,
    LOCAL_STATUSES.PROCESSING,
    LOCAL_STATUSES.PARTIAL,
];

const PROVIDER_STATUS_MAP = {
    Pending: LOCAL_STATUSES.PROCESSING,
    'In progress': LOCAL_STATUSES.PROCESSING,
    Processing: LOCAL_STATUSES.PROCESSING,
    Partial: LOCAL_STATUSES.PARTIAL,
    Completed: LOCAL_STATUSES.COMPLETED,
    Canceled: LOCAL_STATUSES.CANCELED,
    Cancelled: LOCAL_STATUSES.CANCELED,
};

function mapProviderStatus(raw) {
    if (!raw || raw.error) return null;
    const key = raw.status ?? raw.order_status ?? raw.state;
    if (!key) return LOCAL_STATUSES.SUBMITTED;
    return PROVIDER_STATUS_MAP[key] || String(key).toLowerCase();
}

module.exports = {
    LOCAL_STATUSES,
    ORDER_STATUS,
    MONITOR_STATUSES,
    PROVIDER_STATUS_MAP,
    mapProviderStatus,
};
