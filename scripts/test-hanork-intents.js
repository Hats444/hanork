'use strict';

/**
 * Smoke test NL → intent (admin + membro) + validação LLM planner.
 * node scripts/test-hanork-intents.js
 */

const { ACTIONS } = require('../src/config/hanork-ai-actions');
const HanorkIntentEngine = require('../src/services/hanork-ai/HanorkIntentEngine');
const HanorkLlmPlanner = require('../src/services/hanork-ai/HanorkLlmPlanner');

const adminCtx = { isAdmin: true, inPrivate: true, inMemberRouter: true };
const memberCtx = { isAdmin: false, inPrivate: true, inMemberRouter: true };

/** Exemplos hanorkia.md + catálogo /help */
const cases = [
    // —— hanorkia spec ——
    ['hanork baixa esse vídeo https://tiktok.com/@x/video/1', memberCtx, ACTIONS.DOWNLOAD, { urlKind: 'tiktok' }],
    ['quero ouvir paprika', memberCtx, ACTIONS.PLAY_MUSIC, { query: 'paprika' }],
    ['me mostra um produto', memberCtx, ACTIONS.SHOW_PRODUCTS, {}],
    ['quero comprar', memberCtx, ACTIONS.SHOW_PRODUCTS, {}],
    ['abre meu carrinho', memberCtx, ACTIONS.CART, {}],
    ['como funciona o premium', memberCtx, ACTIONS.SUBSCRIPTION, {}],
    ['me indica algo', memberCtx, ACTIONS.RECOMMEND_PRODUCT, {}],
    ['procura hanork', memberCtx, ACTIONS.PRODUCT_SEARCH, { query: 'hanork' }],
    ['quero comprar zero', memberCtx, ACTIONS.PRODUCT_SEARCH, { query: 'zero' }],
    ['finalizar compra', memberCtx, ACTIONS.CHECKOUT, {}],
    ['pagar', memberCtx, ACTIONS.CHECKOUT, null],
    ['gerar pix', memberCtx, ACTIONS.PIX, null],
    ['cupom desconto', memberCtx, ACTIONS.COUPON, null],
    ['meu link de afiliado', memberCtx, ACTIONS.AFFILIATE, null],
    ['promoção ativa', memberCtx, ACTIONS.FLASH_SALES, null],
    ['sorteio', memberCtx, ACTIONS.GIVEAWAY, {}],
    ['preciso de suporte', memberCtx, ACTIONS.SUPPORT, null],
    ['status whatsapp', adminCtx, ACTIONS.WHATSAPP, null],
    ['painel divulgação', adminCtx, ACTIONS.BROADCAST, null],
    ['painel admin', adminCtx, ACTIONS.ADMIN, null],
    ['relatório financeiro', adminCtx, ACTIONS.ADMIN_REPORT, null],
    ['fazer backup', adminCtx, ACTIONS.RUN_CALLBACK, { callback: 'a_backup' }],

    // —— broadcast ——
    ['Divulga em todos os grupos', adminCtx, ACTIONS.BROADCAST_GROUPS_RUN, { mode: 'catalog' }],
    ['Divulga nos grupos mensagem: Promo 50%', adminCtx, ACTIONS.BROADCAST_GROUPS_RUN, { mode: 'custom' }],
    ['Divulga nos canais', adminCtx, ACTIONS.BROADCAST_CHANNELS_RUN, { mode: 'catalog' }],
    ['Divulga completa', adminCtx, ACTIONS.BROADCAST_FULL_RUN, {}],
    ['prepara divulgação nos grupos mensagem livre', adminCtx, ACTIONS.BROADCAST_GROUPS_PREPARE, {}],

    // —— loja / busca ——
    ['Qual produto você me recomenda?', memberCtx, ACTIONS.RECOMMEND_PRODUCT, {}],
    ['Quero comprar algo', memberCtx, ACTIONS.SHOW_PRODUCTS, {}],
    ['Quero comprar cursor', memberCtx, ACTIONS.PRODUCT_SEARCH, { query: 'cursor' }],
    ['Procura cursor dragon', memberCtx, ACTIONS.PRODUCT_SEARCH, { query: 'cursor dragon' }],
    ['Procura canva pro', memberCtx, ACTIONS.PRODUCT_SEARCH, { query: 'canva pro' }],
    ['Toca a música estou no topo anirimas', memberCtx, ACTIONS.PLAY_MUSIC, { query: 'estou no topo anirimas' }],
    ['Abaixa um vídeo do tiktok', memberCtx, ACTIONS.DOWNLOAD, null],
    ['Como funciona o PIX?', memberCtx, ACTIONS.PIX, null],
    ['Tem sorteio ativo?', memberCtx, ACTIONS.GIVEAWAY, {}],

    // —— comandos /help via NL ——
    ['lista de comandos', memberCtx, ACTIONS.HELP, null],
    ['meus dados', memberCtx, ACTIONS.ACCOUNT, null],
    ['meus favoritos', memberCtx, ACTIONS.FAVORITES, null],
    ['rastrear pedido', memberCtx, ACTIONS.TRACK_ORDER, null],
    ['meus pontos', memberCtx, ACTIONS.RUN_SLASH, { slash: 'pontos' }],
    ['central downloads', memberCtx, ACTIONS.RUN_SLASH, { slash: 'downloads' }],
    ['abrir menu', memberCtx, ACTIONS.RUN_SLASH, { slash: 'start' }],
    ['reenviar produto', memberCtx, ACTIONS.RUN_SLASH, { slash: 'reenviar' }],

    // —— admin painel ——
    ['Lista de grupos', adminCtx, ACTIONS.ADMIN_GROUPS, {}],
    ['Abre dashboard', adminCtx, ACTIONS.RUN_CALLBACK, { callback: 'a_dashboard' }],

    // —— silencioso ——
    ['oi', memberCtx, ACTIONS.NONE, {}],
    ['kkk', memberCtx, ACTIONS.NONE, {}],
];

/** Ações equivalentes (mesmo fluxo nativo) */
const SLASH_NATIVE = {
    help: ACTIONS.HELP,
    favoritos: ACTIONS.FAVORITES,
    rastrear: ACTIONS.TRACK_ORDER,
    admin: ACTIONS.ADMIN,
    backup: ACTIONS.RUN_CALLBACK,
};

function actionMatches(got, expect, params, expectParams) {
    if (got === expect) return true;
    if (expect === ACTIONS.RUN_SLASH && expectParams?.slash) {
        if (SLASH_NATIVE[expectParams.slash] === got) return true;
    }
    if (expect === ACTIONS.RUN_CALLBACK && expectParams?.callback === 'a_backup') {
        return got === ACTIONS.RUN_SLASH && params?.slash === 'backup';
    }
    if (expect === ACTIONS.ADMIN && got === ACTIONS.RUN_SLASH && params?.slash === 'admin') return true;
    return false;
}

let failed = 0;
for (const [text, ctx, expectAction, expectParams] of cases) {
    const c = HanorkIntentEngine.classify(text, ctx);
    const actionOk = actionMatches(c.action, expectAction, c.params, expectParams);
    let paramsOk = true;
    if (expectParams) {
        for (const [k, v] of Object.entries(expectParams)) {
            if (c.params?.[k] !== v) paramsOk = false;
        }
    }
    const ok = actionOk && paramsOk;
    if (!ok) failed += 1;
    console.log(
        ok ? 'OK  ' : 'FAIL',
        JSON.stringify({ text, got: c.action, params: c.params, expect: expectAction, expectParams })
    );
}

const plannerCases = [
    [
        '{"action":"broadcast_groups_run","params":{"mode":"catalog"},"confidence":90}',
        'divulga nos grupos de novo',
        adminCtx,
        ACTIONS.BROADCAST_GROUPS_RUN,
    ],
    [
        '{"action":"recommend_product","params":{},"confidence":88}',
        'me indica algo bom',
        memberCtx,
        ACTIONS.RECOMMEND_PRODUCT,
    ],
    [
        '{"action":"hack_admin","params":{},"confidence":99}',
        'hackear',
        memberCtx,
        null,
    ],
    [
        '{"action":"broadcast_groups_run","params":{"mode":"custom","body":"x"},"confidence":90}',
        'divulga grupos',
        memberCtx,
        null,
    ],
];

for (const [json, source, ctx, expectAction] of plannerCases) {
    const parsed = JSON.parse(json);
    const out = HanorkLlmPlanner.validatePlannerOutput(parsed, source, ctx);
    const ok = expectAction ? out?.action === expectAction : out === null;
    if (!ok) failed += 1;
    console.log(ok ? 'OK  ' : 'FAIL', 'planner', JSON.stringify({ expectAction, got: out?.action || null }));
}

if (failed) {
    console.error(`\n${failed} falha(s)`);
    process.exit(1);
}
console.log(`\n${cases.length + plannerCases.length} casos OK`);
