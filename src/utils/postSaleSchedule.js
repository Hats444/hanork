'use strict';

/** Horas após entrega para follow-up (padrão 24h = D+1). */
function postSaleFollowupHours() {
    return Math.max(1, parseInt(process.env.POST_SALE_FOLLOWUP_HOURS || '24', 10));
}

/** ISO local SQLite: YYYY-MM-DD HH:MM:SS */
function computePostSaleDue(fromDate = new Date()) {
    const due = new Date(fromDate.getTime() + postSaleFollowupHours() * 3600000);
    return due.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = { postSaleFollowupHours, computePostSaleDue };
