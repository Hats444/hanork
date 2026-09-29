'use strict';

const Msg = require('../Msg');
const {
    buildTempBanMessage,
    buildWarningMessage,
    buildCooldownMessage,
    buildStillBannedMessage,
    buildBlacklistMessage,
    buildManualBanMessage,
    Violation,
} = require('../../modules/security/BanMessages');

/**
 * Responde ao usuário conforme resultado do anti-spam (mensagens claras, sem spam de alertas).
 * @returns {boolean} true se a requisição deve ser bloqueada
 */
async function handleSpamCheck(ctx, result, { manualBanReason } = {}) {
    if (result.allowed) return false;

    if (result.reason === 'cooldown') {
        try {
            const t = buildCooldownMessage(result.retryAfterMs || 350);
            if (ctx.chat?.type === 'private') await Msg.reply(ctx, t);
            else await ctx.reply(t, { parse_mode: 'HTML' });
        } catch { /* ignore */ }
        return true;
    }

    let text;
    if (manualBanReason) {
        text = buildManualBanMessage(manualBanReason);
    } else if (result.reason === 'blacklist' || result.permanent) {
        text = buildBlacklistMessage();
    } else if (result.reason === 'banned') {
        text = buildStillBannedMessage({
            violation: result.violation,
            remaining: result.remaining,
            strike: result.count,
        });
    } else if (result.reason === 'warning') {
        text = buildWarningMessage({
            violation: result.violation,
            strikesLeft: result.warnsLeft ?? 0,
        });
    } else if (result.reason === 'flood_ban') {
        text = buildTempBanMessage({
            violation: result.violation || Violation.RATE_5S,
            strike: result.count,
            durationSec: result.duration,
        });
    } else {
        return true;
    }

    const mustSend = result.reason === 'warning' || result.notify !== false;
    if (!mustSend) return true;

    try {
        if (ctx.chat?.type === 'private') {
            await Msg.reply(ctx, text);
        } else {
            await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true });
        }
    } catch { /* ignore */ }

    return true;
}

module.exports = { handleSpamCheck };
