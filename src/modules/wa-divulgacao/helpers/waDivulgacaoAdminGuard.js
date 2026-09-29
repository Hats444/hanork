'use strict';

const WaDivulgacaoConfig = require('../waDivulgacaoConfig');
const { denySilent } = require('../../../utils/silencedAccess');

function requireWadvAdmin(ctx, isAdmin, Msg) {
    if (!WaDivulgacaoConfig.enabled) {
        Msg?.reply?.(ctx, 'ℹ️ Hanork Div desligado (WA_DIVULGACAO_ENABLED=0).');
        return false;
    }
    if (!isAdmin?.(ctx.from?.id)) {
        denySilent('wadv_admin', ctx);
        return false;
    }
    if (ctx.chat?.type !== 'private') {
        ctx.answerCbQuery?.().catch(() => {});
        return false;
    }
    return true;
}

module.exports = { requireWadvAdmin };
