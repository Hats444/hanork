'use strict';

const { formatDiscardedNote, appendDiscardedNote } = require('./BotSessionService');

/** @deprecated Use BotSessionService — mantido para compatibilidade com fluxo de produtos */
function formatProductSessionDiscardedNote(cleared) {
    if (!cleared) return '';
    return formatDiscardedNote({
        productWizard: cleared.wizard,
        editProduct: cleared.edit,
    });
}

/** @deprecated Use BotSessionService.appendDiscardedNote */
function appendProductSessionDiscardedNote(text, cleared) {
    return appendDiscardedNote(text, {
        productWizard: cleared?.wizard,
        editProduct: cleared?.edit,
    });
}

module.exports = {
    formatProductSessionDiscardedNote,
    appendProductSessionDiscardedNote,
};
