'use strict';

/** Admin em fluxo de criar ou editar produto — outros modos não devem interceptar texto/mídia. */
async function isAdminInProductAdminFlow(uid, { editProductMode, productWizard } = {}) {
    if (!uid) return false;
    if (editProductMode && (await editProductMode.has(uid))) return true;
    if (productWizard?.has?.(uid)) return true;
    return false;
}

module.exports = { isAdminInProductAdminFlow };
