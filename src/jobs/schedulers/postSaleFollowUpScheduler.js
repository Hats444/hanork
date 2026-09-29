'use strict';

const { logSchedulerOn } = require('./cronBootLog');
const { getSalesRefChannelUrl } = require('../../config/salesReferenceChannel');

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const BATCH_LIMIT = 20;
const MESSAGE_DELAY_MS = 500;

const DUE_SQL = `
    SELECT o.id, u.telegram_id FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.status = 'DELIVERED'
      AND o.post_sale_due IS NOT NULL
      AND o.post_sale_sent = 0
      AND datetime('now') >= o.post_sale_due
    LIMIT ${BATCH_LIMIT}
`;

async function runPostSaleFollowUpCycle(deps) {
    const { bot, dbRaw, Markup, config, bannedUsers, log } = deps;
    if (!bot?.botInfo) return { sent: 0, skipped: 'bot_not_ready' };

    const db = dbRaw();
    const due = db.prepare(DUE_SQL).all();
    let sent = 0;

    for (const row of due) {
        db.prepare('UPDATE orders SET post_sale_sent=1 WHERE id=?').run(row.id);
        try {
            const tid = parseInt(row.telegram_id, 10);
            if (bannedUsers?.has?.(tid)) continue;
            const refUrl = getSalesRefChannelUrl();
            const smmLine =
                process.env.SMM_ENABLED === '1'
                    ? `\n\n📈 Conheça também nossos serviços SMM (seguidores, views): /smm`
                    : '';
            await bot.telegram.sendMessage(
                tid,
                `📦 <b>Olá! Tudo certo com seu produto?</b>\n\nEsperamos que esteja aproveitando sua compra! 😄\n\n` +
                    `📢 Referências: ${refUrl}\n🎫 Suporte: /suporte\n🔄 Mais produtos: /catalogo` +
                    smmLine,
                {
                    parse_mode: 'HTML',
                    reply_markup: Markup.inlineKeyboard([
                        [{ text: '🛍️ Ver Mais Produtos', callback_data: 'cat' }],
                        ...(process.env.SMM_ENABLED === '1'
                            ? [[{ text: '📈 Serviços SMM', callback_data: 'smm:home' }]]
                            : []),
                        [{ text: '🎫 Abrir Suporte', callback_data: 'suporte_btn' }],
                    ]).reply_markup,
                }
            );
            sent++;
        } catch {
            /* bloqueio / erro Telegram */
        }
        await new Promise((r) => setTimeout(r, MESSAGE_DELAY_MS));
    }

    if (sent > 0) log.info('[POST-SALE] Mensagens enviadas', { count: sent });
    return { sent };
}

function startPostSaleFollowUpScheduler(deps, options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    logSchedulerOn(deps.log, '[CRON] Post-sale follow-up ON', { intervalMs });

    return setInterval(async () => {
        try {
            await runPostSaleFollowUpCycle(deps);
        } catch (e) {
            deps.log.error('[POST-SALE] Erro no ciclo:', e.message);
        }
    }, intervalMs);
}

module.exports = {
    runPostSaleFollowUpCycle,
    startPostSaleFollowUpScheduler,
    DEFAULT_INTERVAL_MS,
};
