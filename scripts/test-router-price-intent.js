'use strict';

const assert = require('assert');
const NL = require('../src/services/hanork-ai/HanorkNlExtractors');
const { classify } = require('../src/services/hanork-ai/HanorkIntentEngine');
const { ACTIONS } = require('../src/config/hanork-ai-actions');

const adminCtx = { isAdmin: true, inPrivate: true, inMemberRouter: true };

const edit = NL.extractProductPriceEdit('Coloca o preço do produto likes FF pra 20$');
assert.ok(edit?.price === 20, 'extract price');
assert.ok(edit?.productQuery, 'extract product query');

const r1 = classify('Coloca o preço do produto likes FF pra 20$', adminCtx);
assert.strictEqual(r1.action, ACTIONS.PRODUCT_EDIT_PRICE, 'route price edit');
assert.ok(r1.confidence >= 90, 'auto execute confidence');

const r2 = classify('Consultas mind7\n\nConsultas mind7\n\nReúne as principais fontes de consulta.', adminCtx);
assert.notStrictEqual(r2.action, ACTIONS.PIX, 'no false pix on catalog paste');

const r3 = classify('como funciona o pix', { isAdmin: false, inPrivate: true, inMemberRouter: true });
assert.strictEqual(r3.action, ACTIONS.PIX, 'pix FAQ still works');

const ctxLikes = {
    lastProductQuery: 'likes ff',
    lastFocus: 'product',
    pendingField: 'price',
};
const r4 = classify('coloca ele por 20', { ...adminCtx, routerContext: ctxLikes });
assert.strictEqual(r4.action, ACTIONS.PRODUCT_EDIT_PRICE, 'pronoun price with context');
assert.strictEqual(r4.params?.price, 20, 'context price value');
assert.ok(r4.params?.productQuery || r4.confidence >= 82, 'context product');

const pronoun = NL.extractProductPriceEdit('coloca ele por 20');
assert.ok(pronoun?.needsProduct && !pronoun?.productId, 'pronoun marks needsProduct without false id');

const HanorkRouterContext = require('../src/services/hanork-ai/HanorkRouterContext');
const deictic = HanorkRouterContext.enrichClassification(
    'muda o valor desse produto',
    { action: ACTIONS.NONE, confidence: 50, params: {} },
    { lastProductQuery: 'likes ff', lastFocus: 'product', pendingField: 'price' },
    { isAdmin: true }
);
assert.strictEqual(deictic.action, ACTIONS.PRODUCT_EDIT_PRICE, 'deictic price from context');

const divulga = HanorkRouterContext.enrichClassification(
    'quero divulgar mais',
    { action: ACTIONS.NONE, confidence: 40, params: {} },
    { lastFocus: 'broadcast', lastBroadcastAction: ACTIONS.BROADCAST_GROUPS_RUN, lastBroadcastParams: { mode: 'catalog' } },
    { isAdmin: true }
);
assert.strictEqual(divulga.action, ACTIONS.BROADCAST_GROUPS_RUN, 'divulgar mais repeats broadcast');

const typo = classify('muda o prco do produto likes pra 25', adminCtx);
assert.strictEqual(typo.action, ACTIONS.PRODUCT_EDIT_PRICE, 'typo preco still routes');

const pauseCtx = { ...adminCtx, routerContext: { lastProductQuery: 'likes ff', lastFocus: 'product' } };
const pauseDeictic = classify('apaga aquele', pauseCtx);
assert.strictEqual(pauseDeictic.action, ACTIONS.ASK, 'pause deictic asks confirm');
assert.strictEqual(pauseDeictic.pendingAction, ACTIONS.PRODUCT_PAUSE, 'pause pending');

const reactivate = classify('reativa o produto likes ff', adminCtx);
assert.ok(
    reactivate.action === ACTIONS.PRODUCT_REACTIVATE || reactivate.action === ACTIONS.ASK,
    'reactivate routes'
);

const lc = NL.extractProductLifecycle('pausa produto likes ff');
assert.strictEqual(lc?.op, 'pause', 'lifecycle pause op');

const playQ = NL.extractMusicQuery('Da play em elite do mundo kaito');
assert.ok(playQ && !/^em\s/i.test(playQ), 'play strips leading em');

const playManda = NL.extractMusicQuery('Hanork, me manda a música montagem noche');
assert.strictEqual(playManda, 'montagem noche', 'manda musica extracts title');

const playSlang = NL.extractMusicQuery('Crl, montagem noche', { allowBareReply: true });
assert.strictEqual(playSlang, 'montagem noche', 'slang prefix stripped from clarify reply');

const playRoute = classify('Hanork, me manda a música montagem noche', {
    isAdmin: false,
    inPrivate: false,
    inMemberRouter: true,
});
assert.strictEqual(playRoute.action, ACTIONS.PLAY_MUSIC, 'manda musica executes without clarify');
assert.strictEqual(playRoute.params?.query, 'montagem noche', 'query on first message');
assert.ok(playRoute.confidence >= 80, 'high confidence with extracted query');

assert.ok(NL.isSendMusicIntent('Manda a música tipo kaleb do mhrap'), 'manda musica = send intent');

const playRoute2 = classify('Manda a música tipo kaleb do mhrap', {
    isAdmin: false,
    inPrivate: false,
    inMemberRouter: true,
});
assert.strictEqual(playRoute2.action, ACTIONS.PLAY_MUSIC, 'manda musica routes play');
assert.strictEqual(playRoute2.params?.sendIntent, true, 'sendIntent flag set');
assert.strictEqual(playRoute2.params?.query, 'tipo kaleb do mhrap', 'query extracted');

const casual = classify('Tesao insano', {
    isAdmin: false,
    inPrivate: false,
    inMemberRouter: true,
});
assert.notStrictEqual(casual.action, ACTIONS.PLAY_MUSIC, 'casual chat does not route play');
assert.ok(!NL.extractMusicQuery('Tesao insano'), 'casual chat no bare music extract');

const hypothetical = 'Bem que eu poderia ouvir demon slayer genjutsu beats ultra slowed';
assert.ok(!NL.hasExplicitMusicIntent(hypothetical), 'hypothetical ouvir is not music intent');
const hypoRoute = classify(hypothetical, {
    isAdmin: false,
    inPrivate: false,
    inMemberRouter: true,
});
assert.notStrictEqual(hypoRoute.action, ACTIONS.PLAY_MUSIC, 'hypothetical wish does not route play');

const { fixPromoPortuguese } = require('../src/utils/broadcastTextClean');
assert.ok(
    fixPromoPortuguese('Divulgacao liberado com entrega automatico').includes('divulgação liberada'),
    'promo PT fixes gender and accents'
);

const casualDl = classify('Tesao insano', { isAdmin: false, inPrivate: false, inMemberRouter: true });
assert.notStrictEqual(casualDl.action, ACTIONS.DOWNLOAD, 'casual chat not download');

const atUser = classify('@nike', { isAdmin: false, inPrivate: false, inMemberRouter: true });
assert.notStrictEqual(atUser.action, ACTIONS.DOWNLOAD, '@user alone not download');

const tiktokOk = classify('Manda o tiktok montagem noche', {
    isAdmin: false,
    inPrivate: false,
    inMemberRouter: true,
});
assert.strictEqual(tiktokOk.action, ACTIONS.DOWNLOAD, 'explicit tiktok still routes');
assert.ok(tiktokOk.params?.tiktokQuery, 'tiktok query present');

const temCursor = classify('tem cursor', { isAdmin: false, inPrivate: false, inMemberRouter: true });
assert.notStrictEqual(temCursor.action, ACTIONS.PRODUCT_SEARCH, 'tem X alone not product search');

const prodOk = classify('tem produto cursor', { isAdmin: false, inPrivate: false, inMemberRouter: true });
assert.strictEqual(prodOk.action, ACTIONS.PRODUCT_SEARCH, 'tem produto X routes');

const clarifyBare = NL.extractMusicQuery('montagem noche', { allowBareReply: true });
assert.strictEqual(clarifyBare, 'montagem noche', 'clarify reply still extracts');

const ttQ = NL.extractTiktokSearchQuery('Manda o tiktok montagem noche');
assert.strictEqual(ttQ, 'montagem noche', 'tiktok query extracted');

const ttRoute = classify('Manda o tiktok montagem noche', {
    isAdmin: false,
    inPrivate: false,
    inMemberRouter: true,
});
assert.strictEqual(ttRoute.action, ACTIONS.DOWNLOAD, 'manda tiktok routes download');
assert.strictEqual(ttRoute.params?.tiktokQuery, 'montagem noche', 'tiktok query on intent');
assert.ok(ttRoute.params?.sendIntent, 'tiktok sendIntent');

const igQ = NL.extractInstagramNLQuery('Manda os stories do @nike');
assert.strictEqual(igQ?.type, 'stories', 'instagram stories type');
assert.strictEqual(igQ?.value, 'nike', 'instagram username');

const igRoute = classify('Manda os stories do @nike', {
    isAdmin: false,
    inPrivate: false,
    inMemberRouter: true,
});
assert.strictEqual(igRoute.action, ACTIONS.DOWNLOAD, 'manda stories routes download');
assert.strictEqual(igRoute.params?.instagramParsed?.value, 'nike', 'instagram parsed on intent');
assert.ok(igRoute.params?.sendIntent, 'instagram sendIntent');

const ytUrlRoute = classify('Manda esse video https://youtube.com/watch?v=abc123', {
    isAdmin: false,
    inPrivate: false,
    inMemberRouter: true,
});
assert.strictEqual(ytUrlRoute.action, ACTIONS.DOWNLOAD, 'manda youtube url routes download');
assert.ok(ytUrlRoute.params?.sendIntent, 'youtube url sendIntent');

const nameEdit = classify('muda o nome do produto likes ff para Pack VIP', adminCtx);
assert.ok(
    nameEdit.action === ACTIONS.PRODUCT_EDIT_FIELD || nameEdit.action === ACTIONS.ASK,
    'field name edit'
);

console.log('[OK] router intent —', 40, 'checks');
