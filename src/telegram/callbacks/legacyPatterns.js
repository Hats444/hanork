'use strict';

const { CB, LEGACY_STATIC } = require('./constants');

function resolveDynamicLegacy(s) {
    if (/^ck_(.+)$/.test(s)) return CB.PAYMENT_CHECK(s.match(/^ck_(.+)$/)[1]);
    if (/^aff_pay_(.+)$/.test(s)) return CB.PAYMENT_AFF(s.match(/^aff_pay_(.+)$/)[1]);
    return null;
}

/** Callbacks ainda registrados via bot.action() legado (admin.js, bot.js).
 *  O router tenta o CallbackRegistry ANTES de delegar aqui — ver router.js */
const LEGACY_BOT_ACTION_EXACT = new Set([
    'cupom_boas_vindas', 'ob_skip', 'ver_afiliado', 'suporte_start', 'suporte_btn', 'hanork:open', 'hanork:human', 'hanork:ticket', 'hanork:play_hint',
    'prod_create', 'prod_cancel', 'prod_menu_back', 'prod_edit_list', 'prod_delete_list',
    'prod_list_all', 'prod_stats', 'prod_publish', 'prod_edit_desc', 'prod_draft_refresh', 'home_user',
    'gw_create', 'gw_cancel_list', 'email_broadcast', 'email_test', 'grupos_status_cb', 'a_destinos',
]);

const LEGACY_BOT_ACTION_PATTERNS = [
    /^a_/,
    /^bcast_/,
    /^grp_/,
    /^toggle_prod_/,
    /^adm_deliver_confirm_/,
    /^adm_deliver_(?!confirm_)/,
    /^a_users_p_/,
    /^a_grupos_p_/,
    /^a_canais_p_/,
    /^email_/,
    /^grupos_/,
    /^gw_/,
    /^ticket_/,
    /^tchat_/,
    /^tclose_/,
    /^view_giveaway_/,
    /^fs_cancel_/,
    /^ep_/,
    /^ob_/,
    /^pp_/,
    /^pc_/,
    /^check_/,
    /^cancel_/,
    /^copypix_/,
    /^payment_methods_/,
    /^help_sec_/,
    /^aff_wd_/,
    /^fin_(daily|monthly)$/,
    /^prod_edit_pg_/,
    /^prod_del_pg_/,
    /^prod_list_pg_/,
    /^prod_del_confirm_/,
    /^prod_reactivate_/,
    /^refund_/,
    /^fs_/,
    /^notify_restock_/,
    /^resend_/,
    /^rate_/,
    /^saas_/,
    /^onb_/,
    /^usuarios_pg_/,
    /^ui_/,
    /^cat_pg_/,
    /^cat_hub$/,
    /^cat_list_/,
    /^cat_f_/,
    /^cat_search$/,
    /^add_\d+$/,
    /^buy_\d+$/,
    /^p_\d+$/,
    /^play:scancel:|^play:pick:/,
    /^tiktok:scancel:|^tiktok:pick:/,
    /^instagram:scancel:|^instagram:pick:/,
    /^smm:/,
    /^prodtype_/,
    /^prod_edit_\d+$/,
    /^prod_del_\d+$/,
    /^prod_flash_\d+$/,
    /^prod_draft_(name|desc|price|photo|file|type|refresh)$/,
];

function shouldDelegateToLegacyBotAction(data) {
    const s = String(data || '');
    if (!s) return false;
    if (LEGACY_BOT_ACTION_EXACT.has(s)) return true;
    return LEGACY_BOT_ACTION_PATTERNS.some((re) => re.test(s));
}

function normalizeCallbackData(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || s.length > 64) return null;
    if (LEGACY_STATIC[s]) return LEGACY_STATIC[s];
    const d = resolveDynamicLegacy(s);
    if (d) return d;
    return s;
}

/** payment:pix|card|check → pp_|pc_|check_ para bot.action legado */
function delegatePaymentNamespaceToLegacy(data) {
    const m = String(data).match(/^payment:(pix|card|check):(.+)$/);
    if (!m) return null;
    const p = { pix: 'pp_', card: 'pc_', check: 'check_' };
    return `${p[m[1]]}${m[2]}`;
}

module.exports = {
    normalizeCallbackData,
    delegatePaymentNamespaceToLegacy,
    shouldDelegateToLegacyBotAction,
    LEGACY_STATIC,
};
