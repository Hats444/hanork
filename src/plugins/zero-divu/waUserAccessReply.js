'use strict';

const { denySilent } = require('../../utils/silencedAccess');

/** Usuário comum tentou /wa_* — só log, sem mensagem no chat. */
async function replyWaAccessDenied(_Msg, ctx) {
    denySilent('wa_command', ctx);
}

module.exports = { replyWaAccessDenied };
