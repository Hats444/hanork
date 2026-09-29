'use strict';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function runSubscriptionMaintenance(deps) {
    const { bot, prisma, dbRaw, CustomerSubscriptionService, log } = deps;

    const expired = CustomerSubscriptionService.expireDueSubscriptions();
    if (expired > 0) log.info('[Subscription] Manutenção: expiradas', { count: expired });

    const expiring = CustomerSubscriptionService.findExpiringSoon();
    for (const sub of expiring) {
        const chatId = sub.user_telegram_id || sub.telegram_id;
        if (!chatId) continue;
        const key = `sub_reminder:${sub.id}:${sub.next_payment_date?.slice?.(0, 10) || ''}`;
        const db = dbRaw();
        if (db.prepare('SELECT key FROM kv_store WHERE key = ?').get(key)) continue;
        db.prepare('INSERT OR IGNORE INTO kv_store (key, value) VALUES (?, ?)').run(key, '1');
        const days = Math.max(0, Math.ceil((new Date(sub.next_payment_date) - Date.now()) / 86400000));
        bot.telegram
            .sendMessage(
                chatId,
                `⏰ <b>Assinatura Premium</b>\n\n` +
                    `Seu plano vence em <b>${days} dia(s)</b>.\n\n` +
                    `Renove comprando o plano novamente para manter os benefícios.\n` +
                    `Use /assinatura para ver detalhes.`,
                { parse_mode: 'HTML' }
            )
            .catch(() => {});
    }

    try {
        prisma.cashback?.processPending?.();
    } catch {
        /* ignore */
    }
}

function startSubscriptionMaintenanceScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    deps.log.info('[Subscription] Scheduler ativo (expiração + lembretes)', { intervalMs });

    return setInterval(async () => {
        try {
            await runSubscriptionMaintenance(deps);
        } catch (e) {
            deps.log.warn('[Subscription] Manutenção:', e.message);
        }
    }, intervalMs);
}

module.exports = {
    runSubscriptionMaintenance,
    startSubscriptionMaintenanceScheduler,
    DEFAULT_INTERVAL_MS,
};
