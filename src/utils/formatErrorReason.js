'use strict';

/** Normaliza erro Telegram/bridge para log legível (evita "[object Object]"). */
function formatErrorReason(err, fallback = 'erro_desconhecido') {
    if (err == null || err === '') return fallback;
    if (typeof err === 'string') {
        return err.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
    }
    if (typeof err === 'object') {
        const parts = [
            err.message,
            err.description,
            err.errorMessage,
            err.reason,
            err.code != null ? String(err.code) : null,
            typeof err.error === 'string' ? err.error : err.error?.message || err.error?.errorMessage,
            err.hint,
            typeof err.hint === 'object' ? err.hint?.message || err.hint?.description : null,
            err.className,
            err.type,
        ].filter((p) => p != null && String(p).trim() && String(p) !== '[object Object]');
        if (parts.length) {
            return formatErrorReason(String(parts[0]), fallback);
        }
        try {
            const flat = {};
            for (const [k, v] of Object.entries(err)) {
                if (v == null) continue;
                if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                    flat[k] = v;
                } else if (typeof v === 'object' && (v.message || v.errorMessage || v.description)) {
                    flat[k] = v.message || v.errorMessage || v.description;
                }
            }
            if (Object.keys(flat).length) {
                return JSON.stringify(flat).slice(0, 200);
            }
            return JSON.stringify(err).slice(0, 200);
        } catch {
            return fallback;
        }
    }
    return String(err);
}

module.exports = { formatErrorReason };
