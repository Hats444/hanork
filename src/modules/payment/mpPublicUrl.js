'use strict';

/** Origem HTTPS pública do bot (SITE_HANORK ou domínio do WEBHOOK_URL). */
function resolvePublicOrigin() {
    const site = (process.env.SITE_HANORK || process.env.BASE_URL || '').trim().replace(/\/$/, '');
    if (site.startsWith('https://')) return site;

    const webhook = (process.env.WEBHOOK_URL || '').trim();
    if (webhook.startsWith('https://')) {
        try {
            return new URL(webhook).origin;
        } catch {
            /* ignore */
        }
    }
    return null;
}

/** URL intermediária — abre melhor no navegador interno do Telegram. */
function buildTelegramCheckoutUrl(preferenceId) {
    const origin = resolvePublicOrigin();
    const id = String(preferenceId || '').trim();
    if (!origin || !id) return null;
    return `${origin}/mp/go/${encodeURIComponent(id)}`;
}

/** Botão inline: wrapper HTTPS quando possível, senão init_point direto. */
function resolveCheckoutButtonUrl(preferenceId, initPoint) {
    return buildTelegramCheckoutUrl(preferenceId) || initPoint || null;
}

module.exports = {
    resolvePublicOrigin,
    buildTelegramCheckoutUrl,
    resolveCheckoutButtonUrl,
};
