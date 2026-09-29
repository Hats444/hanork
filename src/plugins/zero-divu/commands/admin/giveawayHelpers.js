'use strict';

/**
 * B3 — painel de sorteios admin (move-only de bot.js).
 */
function createBuildGiveawaysPanel({ prisma, dbRaw }) {
    return async function buildGiveawaysPanel() {
        const active = prisma.giveaway.findActive() || [];
        let txt = `<b>🎉 Sorteios</b>\n\n`;
        const rows = [];
        if (!active.length) {
            txt += 'Nenhum sorteio ativo no momento.';
        } else {
            txt += `Ativos: <b>${active.length}</b>\n\n`;
            for (const g of active.slice(0, 8)) {
                const parts =
                    dbRaw().prepare('SELECT COUNT(*) as c FROM giveaway_participants WHERE giveaway_id=?').get(g.id)?.c || 0;
                txt += `• <b>#${g.id}</b> ${g.name} — ${parts} participante(s)\n`;
                rows.push([{ text: `🎲 Sortear #${g.id}`, callback_data: `gw_draw_${g.id}` }]);
            }
        }
        rows.push([{ text: '➕ Criar sorteio', callback_data: 'gw_create' }]);
        rows.push([{ text: '❌ Cancelar sorteio', callback_data: 'gw_cancel_list' }]);
        rows.push([{ text: '🔙 Admin', callback_data: 'a_menu' }]);
        return { txt, rows };
    };
}

module.exports = { createBuildGiveawaysPanel };
