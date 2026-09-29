'use strict';

const {
    ACTIONS,
    CONFIDENCE_AUTO,
    CONFIDENCE_CONFIRM,
    CONFIDENCE_EXECUTE,
    CONFIDENCE_EXECUTE_WITH_HANORK,
    CONFIDENCE_EXECUTE_PRIVATE,
    OPERATIONAL_OVERRIDE_ACTIONS,
    PARAMETRIC_ACTIONS,
} = require('../../config/hanork-ai-actions');
const HanorkUniversalRegistry = require('./HanorkUniversalRegistry');
const HanorkRouterContext = require('./HanorkRouterContext');
const HanorkTextNormalize = require('./HanorkTextNormalize');
const NL = require('./HanorkNlExtractors');
const COPY = require('../../config/hanork-router-copy');

const HANORK_RE = /\bhanor?k{1,2}\b/i;
const HANORK_TYPO_RE = /\bhanro{1,2}k{1,2}\b/i;
const SMM_NOUN_RE =
    /\b(seguidor\w*|curtida\w*|likes?|views?|visualiza\w*|coment\w*|compartilh\w*|membros?|inscrit\w*|engajamento)\b/i;
const SMM_PLATFORM_RE = /\b(instagram|insta|tiktok|tt|youtube|yt|telegram|tg|twitter|x)\b/i;
const VIRTUO_NUMBERS_RE =
    /\b(n[uú]meros?\s+(sms|virtuais?)|sms\s+virtuais?|n[uú]mero\s+virtual|n[uú]meros?\s+para\s+(whatsapp|telegram|instagram|discord)|n[uú]mero\s+para\s+(whatsapp|telegram|instagram)|c[oó]digo\s+(sms|de\s+verifica)|receber\s+(o\s+)?c[oó]digo|activa[cç][aã]o\s+sms|verifica[cç][aã]o\s+sms)\b/i;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

const SMALL_TALK_RE =
    /^(?:oi|ol[aá]|hey|e\s*a[ií]|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|td\s+bem|e\s*a[ií]\??|opa|fala|salve)(?:\s*[!.,?👋😎🙂🤙]*)?$/i;
const TRIVIAL_RE = /^(?:kk+|haha|rs+|rsrs|ok+|sim|n[aã]o|blz|tmj|vlw|obg|obrigad[oa]|valeu|👍|🙏|😂|🤣)$/i;

/** Mensagens claramente não direcionadas ao bot (ex.: pedido de música em grupo). */
function isObviousNonBotMessage(text, { inPrivate = false, inGroup = false } = {}) {
    if (inPrivate && !inGroup) return false;
    const raw = String(text || '').trim();
    if (!raw) return true;
    if (hasHanorkMention(raw) || hasImplicitBotAddress(raw)) return false;
    if (NL.hasExplicitMusicIntent(raw) || NL.extractMusicQuery(raw)) return true;
    const n = normalize(raw).toLowerCase();
    if (/\b(toca|tocar|ouvir|escutar|play|m[uú]sica|musica|mp3)\b/.test(n)) return true;
    return false;
}

function botUsernamePattern() {
    const user = String(process.env.BOT_USERNAME || 'hanork_bot').replace(/^@/, '');
    return user ? new RegExp(`@${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null;
}

function stripHanorkAddress(text) {
    let s = String(text || '');
    const botRe = botUsernamePattern();
    if (botRe) s = s.replace(botRe, ' ');
    s = s
        .replace(HANORK_RE, ' ')
        .replace(HANORK_TYPO_RE, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[,.\s!?]+/, '')
        .trim();
    return s;
}

function normalize(text) {
    return stripHanorkAddress(text);
}

function hasHanorkMention(text) {
    const raw = String(text || '');
    if (HANORK_RE.test(raw) || HANORK_TYPO_RE.test(raw)) return true;
    const botRe = botUsernamePattern();
    return botRe ? botRe.test(raw) : false;
}

/** No PV, "você" / "me manda" = falando com o bot (Hanork) */
function hasImplicitBotAddress(text) {
    const raw = String(text || '');
    if (/\b(você|voce|vc|cê|ce)\b/i.test(raw)) return true;
    if (/\b(me\s+(?:manda|envia|passa|busca|acha|mostra))|(?:pra|para)\s+mim\b/i.test(raw)) return true;
    if (/\b(você|voce)\s+(?:pode|consegue|sabe)\b/i.test(raw)) return true;
    return false;
}

function stripBotRequestTail(query) {
    return String(query || '')
        .replace(/\s*(?:e\s+)?(?:me\s+)?(?:manda|envia|passa|mandar|enviar)\s+(?:ela|ele|isso|a[ií]|o\s+link).*$/i, '')
        .trim();
}

function isOperationalAction(action) {
    return OPERATIONAL_OVERRIDE_ACTIONS.includes(action);
}

function extractUrls(text) {
    return (String(text || '').match(URL_RE) || []).map((u) => u.replace(/[.,;)]+$/, ''));
}

/** LAN/localhost/dashboard — não tratar como download TikTok/YouTube. */
function isInternalOrDashboardUrl(url) {
    try {
        const parsed = new URL(String(url || '').trim());
        const host = parsed.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1') return true;
        if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
        if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
        if (/\/admin\b/.test(parsed.pathname)) return true;
    } catch {
        /* ignore */
    }
    return false;
}

/** Link t.me?start= do Hanork — não é download de mídia. */
function resolveHanorkBotDeepLinkIntent(text) {
    const { parseBotStartDeepLink } = require('../../utils/broadcastDeepLinks');
    const payload = parseBotStartDeepLink(text);
    if (!payload) return null;

    const p = String(payload).toLowerCase();
    const HANDIV = new Set([
        'handiv',
        'hanorkdiv',
        'wadv',
        'wadiv',
        'zap',
        'zappro',
        'divulgacao',
        'div',
    ]);
    if (HANDIV.has(p)) {
        try {
            const { isWaDivulgacaoEnabled } = require('../../modules/wa-divulgacao/waDivulgacaoAccess');
            if (!isWaDivulgacaoEnabled()) return null;
        } catch {
            return null;
        }
        return {
            action: ACTIONS.RUN_CALLBACK,
            confidence: 98,
            params: { callback: 'wadv:plans', label: '📲 Hanork Div' },
        };
    }
    if (p === 'downloads' || p === 'download') {
        return {
            action: ACTIONS.RUN_CALLBACK,
            confidence: 98,
            params: { callback: 'downloads:open', label: '⬇️ Downloads' },
        };
    }
    if (p === 'smm' || p === 'servicos') {
        return {
            action: ACTIONS.RUN_CALLBACK,
            confidence: 98,
            params: { callback: 'smm:home', label: '📈 SMM' },
        };
    }
    if (p === 'sms' || p === 'virtuo' || p === 'numero' || p === 'numeros') {
        return {
            action: ACTIONS.RUN_CALLBACK,
            confidence: 98,
            params: { callback: 'virtuo:home', label: '📱 Números SMS' },
        };
    }
    if (p.startsWith('buy_')) {
        const pid = parseInt(p.replace(/^buy_/, ''), 10);
        if (!Number.isNaN(pid)) {
            return {
                action: ACTIONS.RUN_CALLBACK,
                confidence: 96,
                params: { callback: `buy_${pid}`, label: '🛒 Comprar' },
            };
        }
    }
    if (p.startsWith('produto_')) {
        const pid = parseInt(p.replace('produto_', ''), 10);
        if (!Number.isNaN(pid)) {
            return {
                action: ACTIONS.RUN_CALLBACK,
                confidence: 96,
                params: { callback: `p_${pid}`, label: '🛍 Produto' },
            };
        }
    }
    try {
        const { isShopAreaStartPayload } = require('../../telegram/botInviteCopy');
        if (isShopAreaStartPayload(payload)) {
            return {
                action: ACTIONS.RUN_CALLBACK,
                confidence: 96,
                params: { callback: 'catalog:view', label: '🛍 Catálogo' },
            };
        }
    } catch {
        /* ignore */
    }
    return null;
}

function isHanorkBotDeepLinkText(text) {
    return Boolean(resolveHanorkBotDeepLinkIntent(text));
}

function resolveDashboardLanIntent(text, ctx) {
    const raw = String(text || '').trim();
    const urls = extractUrls(raw);
    if (urls.length !== 1) return null;
    const url = urls[0];
    if (!isInternalOrDashboardUrl(url)) return null;
    const rest = raw.replace(url, '').trim();
    if (rest && !/^[\s.,!?]+$/.test(rest)) return null;
    if (ctx?.isAdmin && /\/admin\b/.test(url)) {
        return { action: ACTIONS.ADMIN, confidence: 98, params: { _dashboardUrl: url } };
    }
    return { action: ACTIONS.NONE, confidence: 100, params: {} };
}

function resolveDashboardTextIntent(text, ctx) {
    if (!ctx?.isAdmin) return null;
    const raw = String(text || '').trim();
    const n = normalize(raw).toLowerCase();
    if (/\b(dashboard|painel\s+web|dash)\b/.test(n) && /\b(celular|mobile|wifi|wi\s*fi|navegador|browser)\b/.test(n)) {
        return { action: ACTIONS.ADMIN, confidence: 97, params: { _dashboardMobile: true } };
    }
    if (/^(dashboard|painel|dash|painel\s+admin)$/i.test(raw)) {
        return {
            action: ACTIONS.RUN_CALLBACK,
            confidence: 94,
            params: { callback: 'a_dashboard', label: 'Dashboard' },
        };
    }
    return null;
}

function detectUrlKind(url) {
    const u = String(url || '').toLowerCase();
    if (/youtu(\.be|be\.com)/.test(u) || /youtube\.com/.test(u)) return 'youtube';
    if (/tiktok\.com|vt\.tiktok|vm\.tiktok/.test(u)) return 'tiktok';
    if (/instagram\.com|instagr\.am/.test(u)) return 'instagram';
    return 'generic';
}

function extractPlayQuery(text) {
    return NL.extractMusicQuery(text);
}

function extractBroadcastBody(text) {
    return NL.extractBroadcastBody(text);
}

function isGroupCatalogBroadcast(text) {
    return NL.isGroupCatalogBroadcast(text);
}

function resolveAdminBroadcastIntent(text) {
    const raw = String(text || '').trim();
    const n = normalize(raw).toLowerCase();
    const customBody = NL.extractBroadcastBody(raw);
    const iaTheme = NL.extractIaTheme(raw);
    const prep = NL.wantsBroadcastPrepare(raw);

    if (customBody) {
        if (/\bgrupos?\b/.test(n)) {
            return {
                action: ACTIONS.BROADCAST_GROUPS_RUN,
                confidence: 96,
                params: { mode: 'custom', body: customBody },
            };
        }
        if (/\bcanais?\b/.test(n)) {
            return {
                action: ACTIONS.BROADCAST_CHANNELS_RUN,
                confidence: 96,
                params: { mode: 'custom', body: customBody },
            };
        }
        return {
            action: ACTIONS.BROADCAST_FULL_RUN,
            confidence: 95,
            params: { mode: 'custom', body: customBody },
        };
    }

    if (NL.isGroupCatalogBroadcast(raw)) {
        return { action: ACTIONS.BROADCAST_GROUPS_RUN, confidence: 97, params: { mode: 'catalog' } };
    }
    if (NL.isChannelCatalogBroadcast(raw)) {
        return { action: ACTIONS.BROADCAST_CHANNELS_RUN, confidence: 97, params: { mode: 'catalog' } };
    }
    if (NL.isFullCatalogBroadcast(raw)) {
        return { action: ACTIONS.BROADCAST_FULL_RUN, confidence: 97, params: {} };
    }

    if (iaTheme) {
        return { action: ACTIONS.BROADCAST_IA_PREPARE, confidence: 90, params: { theme: iaTheme } };
    }
    if (prep === 'ia' || (/\b(divulga|broadcast).*\b(ia|inteligente)\b/.test(n) && !iaTheme)) {
        return { action: ACTIONS.BROADCAST_IA_PREPARE, confidence: 92, params: {} };
    }
    if (prep === 'grupos') {
        return { action: ACTIONS.BROADCAST_GROUPS_PREPARE, confidence: 92, params: {} };
    }
    if (prep === 'texto' || /\b(divulga|broadcast).*\b(texto|mensagem\s+livre)\b/.test(n)) {
        return { action: ACTIONS.BROADCAST_TEXT_PREPARE, confidence: 92, params: {} };
    }

    if (/\b(divulga|anuncia|promo)\b.*\bprodutos?\b/.test(n)) {
        return { action: ACTIONS.BROADCAST_FULL_RUN, confidence: 94, params: {} };
    }
    if (/\b(divulgar|anunciar)\s+produto\b/.test(n)) {
        return { action: ACTIONS.BROADCAST_PRODUCT_PICK, confidence: 91, params: {} };
    }

    return null;
}

function stripColloquialTail(query) {
    return String(query || '')
        .replace(/\s+(?:ai|a[ií]|pfv|pf|por\s+favor|please)\s*$/i, '')
        .trim();
}

function isRecommendIntent(text) {
    const n = normalize(text).toLowerCase();
    return (
        /\b(recomend\w*|indic\w*|suger\w*)\b/.test(n) ||
        /\bqual\s+(?:o\s+|um\s+|uma\s+)?(?:produto|item|plano|curso|servi[cç]o)\b.*\b(recomend|indic|suger|melhor|comprar|escolh)\b/.test(n) ||
        /\b(?:produto|item)\s+(?:que\s+)?(?:voc[eê]|vc|c[eê])\s+(?:me\s+)?(?:recomend|indic|suger)/.test(n) ||
        /\b(melhor|bom)\s+(?:produto|item|compra)\b/.test(n) ||
        /\bme\s+indica\b.*\b(produto|comprar|loja|algo)\b/.test(n) ||
        /\bme\s+ajuda\b.*\b(produto|comprar|loja|escolh)\b/.test(n) ||
        /\balgo\s+(?:pra|para)\s+comprar\b/.test(n) ||
        /\bo\s+que\s+(?:voc[eê]|vc)\s+(?:me\s+)?(?:recomend|indic|suger)/.test(n)
    );
}

/** Texto parece pergunta NL — não usar como termo literal de busca no catálogo */
function isCatalogSearchQuery(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length < 2) return false;
    if (isRecommendIntent(raw)) return false;
    const n = normalize(raw).toLowerCase();
    if (NL.hasExplicitMusicIntent(raw) || NL.extractMusicQuery(raw)) return false;
    if (/\b(m[uú]sica|musica|mp3|tocar|ouvir|escutar|play|baixar|download|youtube|tiktok|instagram)\b/.test(n)) {
        return false;
    }
    if (/^(?:qual|quais|como|onde|quando|por\s?que|o\s?que|tem|voc[eê]|vc)\b/.test(n)) return false;
    if (/\?\s*$/.test(raw) && /\b(recomend|indic|produto|melhor|comprar|ajuda)\b/.test(n)) return false;
    if (/\b(procura|busca|buscar|tem|achar)\b/.test(n)) return true;
    const words = n.split(/\s+/).filter(Boolean);
    if (words.length <= 4 && !/\b(procura|busca|buscar)\b/.test(n)) return true;
    return words.length <= 6;
}

function resolveCatalogSearchQuery(text) {
    if (!isCatalogSearchQuery(text)) return null;
    const extracted = extractProductSearchQuery(text);
    if (extracted && !isRecommendIntent(extracted)) return extracted;
    const cleaned = NL.lightNorm(text)
        .replace(/^(?:procura|busca|buscar|tem|achar)\s+(?:pelo\s+)?(?:produto\s+)?(?:o\s+|a\s+|um\s+|uma\s+)?/i, '')
        .replace(/^(?:produto|produtos|catalogo|catálogo|loja|bot)\s+/gi, '')
        .trim();
    if (cleaned.length >= 2 && !isRecommendIntent(cleaned)) {
        return NL.sanitizeProductSearchQuery(cleaned) || cleaned;
    }
    return null;
}

function extractProductSearchQuery(text) {
    if (isRecommendIntent(text)) return null;
    const n = NL.lightNorm(text);
    if (/\b(sorteio|giveaway)\b/.test(n)) return null;
    if (/^quero\s+comprar(?:\s+(?:algo|uma\s+coisa|coisas?|qualquer\s+coisa))?\s*\.?$/.test(n)) {
        return null;
    }
    return NL.extractProductQuery(text);
}

function scoreAction(action, text, ctx = {}) {
    const n = normalize(text).toLowerCase();
    const urls = extractUrls(text);
    let score = 0;
    const params = {};

    switch (action) {
        case ACTIONS.PLAY_MUSIC: {
            if (NL.isHypotheticalWish(text)) {
                return { score: 0, params };
            }
            if (/\b(carrinho|checkout|pix|cupom|catalogo|produto)\b/.test(n)) {
                return { score: 0, params };
            }
            const yt = urls.find((u) => detectUrlKind(u) === 'youtube');
            if (yt) {
                const wantsVideo =
                    /\b(v[ií]deo|video|mp4|shorts?|baixar|baixa|abaixa)\b/.test(n) &&
                    !/\b(m[uú]sica|musica|mp3|tocar|ouvir|play)\b/.test(n);
                if (wantsVideo) return { score: 0, params };
                return { score: 95, params: { query: yt, via: 'url' } };
            }
            const q = extractPlayQuery(text);
            if (q && NL.hasExplicitMusicIntent(text)) {
                const sendIntent = NL.isSendMusicIntent(text);
                return {
                    score: 90,
                    params: sendIntent ? { query: q, sendIntent: true } : { query: q },
                };
            }
            const hasMusicIntent = /\b(toca|tocar|ouvir|escutar|play|m[uú]sica|musica|mp3)\b/.test(n);
            if (hasMusicIntent) {
                const late = NL.extractMusicQuery(text);
                if (late) {
                    const sendIntent = NL.isSendMusicIntent(text);
                    return {
                        score: 88,
                        params: sendIntent ? { query: late, sendIntent: true } : { query: late },
                    };
                }
                score += 58;
            }
            return { score, params };
        }

        case ACTIONS.DOWNLOAD: {
            if (isHanorkBotDeepLinkText(text)) {
                return { score: 0, params };
            }
            if (/\b(m[uú]sica|musica|tocar|ouvir|toca|play)\b/.test(n) && !urls.length) {
                return { score: 0, params };
            }
            if (urls.length) {
                if (urls.every(isInternalOrDashboardUrl)) {
                    return { score: 0, params };
                }
                const url = urls.find((u) => !isInternalOrDashboardUrl(u)) || urls[0];
                if (isInternalOrDashboardUrl(url)) {
                    return { score: 0, params };
                }
                const kind = detectUrlKind(url);
                let score = 93;
                if (kind === 'youtube' && /\/shorts\//.test(url)) score = 96;
                const sendIntent =
                    NL.isSendDownloadIntent(text) ||
                    NL.hasSendVerb(text) ||
                    /\b(baixar|baixa|abaixa|manda|envia|passa|salvar|puxar)\b/.test(n);
                return {
                    score,
                    params: sendIntent ? { url, urlKind: kind, sendIntent: true } : { url, urlKind: kind },
                };
            }
            const ttQ = NL.extractTiktokSearchQuery(text);
            if (ttQ && NL.hasExplicitTiktokIntent(text)) {
                const sendIntent =
                    NL.isSendTiktokIntent(text) ||
                    NL.isSendVideoIntent(text) ||
                    NL.hasSendVerb(text);
                return { score: 91, params: { tiktokQuery: ttQ, sendIntent: !!sendIntent } };
            }
            const igP = NL.extractInstagramNLQuery(text);
            if (igP && NL.hasExplicitInstagramIntent(text)) {
                const sendIntent = NL.isSendInstagramIntent(text) || NL.hasSendVerb(text);
                return { score: 89, params: { instagramParsed: igP, sendIntent: !!sendIntent } };
            }
            if (!NL.hasExplicitDownloadIntent(text) && !urls.length) {
                return { score: 0, params };
            }
            const downloadVerb =
                /\b(baixar|baixa|abaixa|abaixar|download|salvar|puxar|extrair|converter|manda|envia|passa)\b/.test(
                    n
                );
            const mediaNoun =
                /\b(v[ií]deo|video|tiktok|reels?|shorts?|youtube|youtu|mp3|m[ií]dia)\b/.test(n) ||
                (/\b(audio|[aá]udio|link|url)\b/.test(n) &&
                    !/\b(m[uú]sica|musica|tocar|ouvir)\b/.test(n));
            if (downloadVerb && mediaNoun) score += 90;
            else if (/\b(manda|envia|passa)\b.*\b(link|url)\b/.test(n)) score += 86;
            else if (/\b(baixa|abaixa)\s+esse\b/.test(n)) score += 82;
            else if (downloadVerb || /\b(baixar\s+esse|salvar\s+v[ií]deo|converter\s+mp3)\b/.test(n)) {
                score += 78;
            }
            return { score, params };
        }

        case ACTIONS.SHOW_PRODUCTS:
            if (/\b(ver\s+produtos|cat[aá]logo|loja|vendas|mostrar\s+produtos|abrir\s+loja|abrir\s+cat[aá]logo)\b/.test(n)) {
                score += 88;
            }
            if (/\babre\b.*\b(cat[aá]logo|loja)\b/.test(n)) score += 90;
            if (/\b(me\s+)?mostra(r)?\s+(um\s+)?produto/.test(n)) score += 92;
            if (/\bquero\s+comprar\b/.test(n) && !extractProductSearchQuery(text)) score += 78;
            if (/\bprodutos\b/.test(n) && !/\b(indic|recomend|procura|busca|melhor|gerenciar|editar|add)\b/.test(n)) {
                score += 62;
            }
            return { score, params };

        case ACTIONS.RECOMMEND_PRODUCT:
            if (isRecommendIntent(text)) score += 94;
            return { score, params };

        case ACTIONS.PRODUCT_SEARCH: {
            if (isVirtuoNumbersContext(text)) {
                return { score: 0, params };
            }
            if (/\b(m[uú]sica|musica|mp3|tocar|ouvir|play)\b/.test(n)) {
                return { score: 0, params };
            }
            if (isRecommendIntent(text)) return { score: 0, params };
            const q = extractProductSearchQuery(text);
            if (q && q.length >= 2 && NL.hasExplicitProductIntent(text)) {
                const sendIntent = NL.isSendProductIntent(text);
                return {
                    score: 89,
                    params: sendIntent ? { query: q, sendIntent: true } : { query: q },
                };
            }
            if (/\b(?:manda|envia|passa)\b.*\bproduto\b/.test(n)) {
                const late = NL.extractProductQuery(text);
                if (late) return { score: 86, params: { query: late } };
            }
            if (
                NL.hasExplicitProductIntent(text) &&
                /\b(procura|busca|buscar|achar)\b/.test(n) &&
                n.length > 8
            ) {
                score += 68;
            }
            return { score, params };
        }

        case ACTIONS.CART:
            if (/\b(carrinho|minhas\s+compras|itens\s+no\s+carrinho|abre\s+(?:meu\s+)?carrinho|ver\s+carrinho)\b/.test(n)) {
                score += 91;
            }
            return { score, params };

        case ACTIONS.CHECKOUT:
            if (/\b(finalizar\s+compra|checkout|pagar\s+pedido|fechar\s+compra)\b/.test(n)) score += 90;
            if (/\b(quero\s+)?pagar\b/.test(n) && !/\b(como|pix|premium|assinatura)\b/.test(n)) score += 86;
            return { score, params };

        case ACTIONS.PIX: {
            const lines = String(text || '').split(/\n/).filter((l) => l.trim()).length;
            if (String(text || '').length > 140 || lines > 2) return { score: 0, params };
            if (/\b(pix|c[oó]digo\s+pix|gerar\s+pix|mercado\s+pago)\b/.test(n)) score += 91;
            if (/\bcomo\s+(funciona\s+o\s+)?pix\b/.test(n)) score += 90;
            if (/\bcomo\s+(funciona\s+o\s+)?pago|como\s+pagar\b/.test(n) && !/\bpremium\b/.test(n)) score += 78;
            return { score, params };
        }

        case ACTIONS.COUPON:
            if (/\b(cupom|desconto|c[oó]digo\s+promo)\b/.test(n)) score += 89;
            return { score, params };

        case ACTIONS.AFFILIATE:
            if (/\b(afiliado|comiss[aã]o|meu\s+link|link\s+de\s+indica)\b/.test(n)) score += 88;
            if (/\bdivulga[cç][aã]o\b/.test(n) && !ctx.isAdmin) score += 70;
            return { score, params };

        case ACTIONS.SUBSCRIPTION:
            if (/\b(premium|assinatura|plano|como\s+funciona\s+o\s+premium|vip)\b/.test(n)) score += 90;
            return { score, params };

        case ACTIONS.FLASH_SALES:
            if (/\b(divulga|broadcast|grupos?|canais)\b/.test(n)) return { score: 0, params };
            if (/\b(flash\s*sale|oferta\s+rel[aâ]mpago|promo[cç][aã]o\s+ativa)\b/.test(n)) score += 88;
            if (/\b(promo[cç][aã]o|oferta)\b/.test(n) && !/\bproduto\b/.test(n)) score += 58;
            return { score, params };

        case ACTIONS.GIVEAWAY:
            if (/\b(sorteio|giveaway)\b/.test(n)) score += 89;
            return { score, params };

        case ACTIONS.SUPPORT: {
            if (/\b(produto|music|video|baix|tocar|ouvir|carrinho|pix|catalogo|comprar|download|premium)\b/.test(n)) {
                return { score: 0, params };
            }
            if (
                /\b(abrir\s+)?ticket\b|\bsuporte\s+humano\b|\batendente\b|\bequipe\s+humana\b|\breclama[cç][aã]o\b/.test(
                    n
                )
            ) {
                score += 90;
            } else if (/\b(falar\s+com\s+(a\s+)?equipe|preciso\s+de\s+suporte|preciso\s+de\s+ajuda)\b/.test(n)) {
                score += 88;
            } else if (/\b(ajuda|suporte)\b/.test(n) && !/\b(comandos|help|produto|loja|pix)\b/.test(n)) {
                score += 82;
            }
            return { score, params };
        }

        case ACTIONS.WHATSAPP:
            if (/\b(whatsapp|whats|status\s+whatsapp|campanhas?\s+whatsapp|zero\s*divu)\b/.test(n)) {
                score += ctx.isAdmin ? 91 : 0;
            }
            return { score, params };

        case ACTIONS.BROADCAST_GROUPS_RUN: {
            if (!ctx.isAdmin) return { score: 0, params };
            const resolved = resolveAdminBroadcastIntent(text);
            if (resolved?.action === ACTIONS.BROADCAST_GROUPS_RUN) {
                return { score: resolved.confidence, params: resolved.params };
            }
            if (/\bdivulga.*\bgrupos?\b/.test(n)) {
                return { score: 70, params: { mode: 'catalog' } };
            }
            return { score, params };
        }

        case ACTIONS.BROADCAST_CHANNELS_RUN: {
            if (!ctx.isAdmin) return { score: 0, params };
            const resolved = resolveAdminBroadcastIntent(text);
            if (resolved?.action === ACTIONS.BROADCAST_CHANNELS_RUN) {
                return { score: resolved.confidence, params: resolved.params };
            }
            if (NL.isChannelCatalogBroadcast(text)) {
                return { score: 70, params: { mode: 'catalog' } };
            }
            return { score, params };
        }

        case ACTIONS.BROADCAST_GROUPS_PREPARE:
            if (
                ctx.isAdmin &&
                (/\b(inicia|come[cç]a|prepara|abre)\b.*\b(divulga)/.test(n) ||
                    /\b(divulga).*\b(nos?\s+)?grupos?\b.*\b(mensagem|texto)\b/.test(n) ||
                    /\b(mensagem|texto)\s+(?:livre|custom)\b.*\bgrupos?\b/.test(n)) &&
                !extractBroadcastBody(text)
            ) {
                score += 92;
            }
            return { score, params };

        case ACTIONS.BROADCAST_FULL_RUN:
            if (!ctx.isAdmin) return { score: 0, params };
            {
                const resolved = resolveAdminBroadcastIntent(text);
                if (resolved?.action === ACTIONS.BROADCAST_FULL_RUN) {
                    return { score: resolved.confidence, params: resolved.params };
                }
            }
            if (
                /\b(inicia|dispara|executa|come[cç]a|rodar)\b.*\b(divulga|broadcast)\b/.test(n) &&
                !/\b(s[oó]\s+)?grupos?\b/.test(n)
            ) {
                score += 91;
            }
            if (/\bdivulga[cç][aã]o\s+(completa|geral|autom[aá]tica|agora)\b/.test(n)) {
                score += 88;
            }
            return { score, params };

        case ACTIONS.BROADCAST_IA_PREPARE:
            if (ctx.isAdmin && /\b(divulga|broadcast).*\b(ia|inteligente|autom[aá]tica)\b/.test(n)) {
                score += 90;
            }
            return { score, params };

        case ACTIONS.BROADCAST_TEXT_PREPARE:
            if (ctx.isAdmin && /\b(divulga|broadcast).*\b(texto|mensagem\s+livre)\b/.test(n)) {
                score += 88;
            }
            return { score, params };

        case ACTIONS.BROADCAST_PRODUCT_PICK:
            if (ctx.isAdmin && /\b(divulga|anuncia|promo).*\b(produto)\b/.test(n)) {
                score += 90;
            }
            return { score, params };

        case ACTIONS.BROADCAST:
            if (ctx.isAdmin && /\b(painel\s+divulga|painel\s+broadcast)\b/.test(n)) {
                score += 94;
            } else if (ctx.isAdmin && /\b(divulgar|divulga[cç][aã]o|an[uú]ncio|campanha)\b/.test(n)) {
                score += 75;
            }
            return { score, params };

        case ACTIONS.ADMIN_STATS:
            if (ctx.isAdmin && /\b(stats|estat[ií]stica|resumo\s+da\s+loja)\b/.test(n)) score += 88;
            return { score, params };

        case ACTIONS.ADMIN_ORDERS:
            if (ctx.isAdmin && /\b(pedidos|orders|vendas\s+pendentes)\b/.test(n)) score += 88;
            return { score, params };

        case ACTIONS.ADMIN_PRODUCTS:
            if (ctx.isAdmin && /\b(gerenciar\s+)?produtos|cat[aá]logo\s+admin|addproduto\b/.test(n)) {
                score += 87;
            }
            return { score, params };

        case ACTIONS.ADMIN_GROUPS:
            if (ctx.isAdmin && /\b(grupos|lista\s+de\s+grupos)\b/.test(n) && !/divulga/.test(n)) score += 85;
            return { score, params };

        case ACTIONS.ADMIN_CHANNELS:
            if (ctx.isAdmin && /\b(canais|lista\s+de\s+canais)\b/.test(n)) score += 85;
            return { score, params };

        case ACTIONS.ADMIN_TICKETS:
            if (ctx.isAdmin && /\b(tickets|chamados\s+abertos)\b/.test(n)) score += 86;
            return { score, params };

        case ACTIONS.ADMIN_FINANCE:
            if (ctx.isAdmin && /\b(financeiro|caixa|entradas\s+e\s+sa[ií]das)\b/.test(n)) score += 87;
            return { score, params };

        case ACTIONS.ADMIN_REPORT:
            if (ctx.isAdmin && /\b(relat[oó]rio|relatorio|report)\b/.test(n)) score += 92;
            return { score, params };

        case ACTIONS.ADMIN_USERS:
            if (ctx.isAdmin && /\b(usu[aá]rios|clientes\s+cadastrados)\b/.test(n)) score += 86;
            return { score, params };

        case ACTIONS.HELP:
            if (/\b(comandos|help|\/help|lista\s+de\s+comandos|quais\s+comandos|o\s+que\s+(voc[eê]|o\s+bot)\s+faz)\b/.test(n)) {
                score += 90;
            } else if (/\bajuda\b/.test(n) && n.length > 35 && !/\b(suporte|ticket|atendente)\b/.test(n)) {
                score += 72;
            }
            return { score, params };

        case ACTIONS.ACCOUNT:
            if (/\b(meus\s+dados|minha\s+conta|perfil|dados\s+da\s+conta)\b/.test(n)) score += 88;
            return { score, params };

        case ACTIONS.TRACK_ORDER:
            if (/\b(rastrear|status\s+do\s+pedido|meu\s+pedido|pedido\s+#?\d+)\b/.test(n)) score += 86;
            return { score, params };

        case ACTIONS.FAVORITES:
            if (/\b(favoritos|produtos\s+favoritos)\b/.test(n)) score += 88;
            return { score, params };

        case ACTIONS.PRODUCT_EDIT_PRICE: {
            if (!ctx.isAdmin) return { score: 0, params };
            const edit = HanorkRouterContext.enrichProductPriceEdit(
                text,
                NL.extractProductPriceEdit(text),
                ctx.routerContext || {}
            );
            if (!edit) return { score: 0, params };
            let s = 88;
            if (edit.price && (edit.productId || edit.productQuery)) s = 94;
            if (edit.needsPrice && (edit.productId || edit.productQuery)) s = 82;
            if (edit.needsProduct && edit.price) s = 80;
            return {
                score: s,
                params: {
                    productId: edit.productId || null,
                    productQuery: edit.productQuery || null,
                    price: edit.price,
                    needsPrice: edit.needsPrice,
                    needsProduct: edit.needsProduct,
                },
            };
        }

        case ACTIONS.PRODUCT_EDIT_FIELD: {
            if (!ctx.isAdmin) return { score: 0, params };
            const fe = HanorkRouterContext.enrichProductFieldEdit(
                text,
                NL.extractProductFieldEdit(text),
                ctx.routerContext || {}
            );
            if (!fe?.field) return { score: 0, params };
            let s = 86;
            if (fe.value && (fe.productId || fe.productQuery)) s = 91;
            if (fe.needsValue && (fe.productId || fe.productQuery)) s = 78;
            if (fe.needsProduct) s = 70;
            return {
                score: s,
                params: {
                    field: fe.field,
                    value: fe.value,
                    productId: fe.productId,
                    productQuery: fe.productQuery,
                    needsValue: fe.needsValue,
                    needsProduct: fe.needsProduct,
                },
            };
        }

        case ACTIONS.PRODUCT_PAUSE:
        case ACTIONS.PRODUCT_REACTIVATE: {
            if (!ctx.isAdmin) return { score: 0, params };
            const lc = HanorkRouterContext.enrichProductLifecycle(
                text,
                NL.extractProductLifecycle(text),
                ctx.routerContext || {}
            );
            if (!lc) return { score: 0, params };
            const action =
                lc.op === 'pause' ? ACTIONS.PRODUCT_PAUSE : ACTIONS.PRODUCT_REACTIVATE;
            if (action !== ACTIONS.PRODUCT_PAUSE && action !== ACTIONS.PRODUCT_REACTIVATE) {
                return { score: 0, params };
            }
            let s = lc.op === 'pause' ? 84 : 88;
            if (lc.productId || lc.productQuery) s = lc.op === 'pause' ? 88 : 92;
            if (lc.needsProduct) s = 72;
            return {
                score: s,
                params: {
                    productId: lc.productId || null,
                    productQuery: lc.productQuery || null,
                    needsProduct: lc.needsProduct,
                    op: lc.op,
                },
            };
        }

        case ACTIONS.ADMIN:
            if (
                ctx.isAdmin &&
                /\b(abrir\s+painel|painel\s+admin|painel\s+administrativo|modo\s+admin)\b/.test(n)
            ) {
                score += 94;
            } else if (
                ctx.isAdmin &&
                /\b(dashboard|dashbord|painel\s+web|pedidos|financeiro|relat[oó]rio|usu[aá]rios|manuten[cç][aã]o)\b/.test(
                    n
                )
            ) {
                score += 91;
            } else if (ctx.isAdmin && /\badmin\b/.test(n) && !/\b(produto|grupo|canal)\b/.test(n)) {
                score += 88;
            }
            if (ctx.isAdmin && /\b(abre|abrir|mostra|ver)\b.*\b(dashboard|dashbord)\b/.test(n)) {
                score += 94;
            }
            return { score, params };

        default:
            return { score: 0, params };
    }
}

const DISPATCH_ACTIONS = new Set([ACTIONS.RUN_SLASH, ACTIONS.RUN_CALLBACK]);
const GENERIC_PANEL_ACTIONS = new Set([ACTIONS.ADMIN, ACTIONS.BROADCAST]);

/** Ações admin sensíveis: 70–89% pedem confirmação (router.md) */
const ADMIN_CONFIRM_ACTIONS = new Set([
    ACTIONS.PRODUCT_EDIT_PRICE,
    ACTIONS.PRODUCT_EDIT_FIELD,
    ACTIONS.PRODUCT_PAUSE,
    ACTIONS.BROADCAST_GROUPS_RUN,
    ACTIONS.BROADCAST_CHANNELS_RUN,
    ACTIONS.BROADCAST_FULL_RUN,
]);

/** Destrutivas: sempre confirmar, mesmo com confiança alta (router.md) */
const ADMIN_ALWAYS_CONFIRM = new Set([ACTIONS.PRODUCT_PAUSE]);

/** Desempate: fluxos nativos da spec antes de dispatch genérico de /comando */
function tieBreak(a, b) {
    const aGeneric = GENERIC_PANEL_ACTIONS.has(a.action);
    const bGeneric = GENERIC_PANEL_ACTIONS.has(b.action);
    if (aGeneric !== bGeneric) return aGeneric ? 1 : -1;

    const aDispatch = DISPATCH_ACTIONS.has(a.action);
    const bDispatch = DISPATCH_ACTIONS.has(b.action);
    if (aDispatch !== bDispatch) return aDispatch ? 1 : -1;

    const order = [
        ACTIONS.PRODUCT_EDIT_PRICE,
        ACTIONS.PRODUCT_PAUSE,
        ACTIONS.PRODUCT_REACTIVATE,
        ACTIONS.BROADCAST_GROUPS_RUN,
        ACTIONS.BROADCAST_CHANNELS_RUN,
        ACTIONS.BROADCAST_GROUPS_PREPARE,
        ACTIONS.BROADCAST_FULL_RUN,
        ACTIONS.BROADCAST_IA_PREPARE,
        ACTIONS.BROADCAST_PRODUCT_PICK,
        ACTIONS.DOWNLOAD,
        ACTIONS.RECOMMEND_PRODUCT,
        ACTIONS.PRODUCT_SEARCH,
        ACTIONS.PLAY_MUSIC,
        ACTIONS.SHOW_PRODUCTS,
        ACTIONS.CHECKOUT,
        ACTIONS.CART,
        ACTIONS.SUPPORT,
        ACTIONS.HELP,
        ACTIONS.ADMIN_REPORT,
        ACTIONS.ADMIN_FINANCE,
        ACTIONS.ADMIN_ORDERS,
    ];
    const da = order.indexOf(a.action);
    const db = order.indexOf(b.action);
    if (da !== -1 && db !== -1 && da !== db) return da < db ? -1 : 1;
    return b.confidence - a.confidence;
}

function buildClarifyQuestion(action) {
    const key = {
        [ACTIONS.DOWNLOAD]: 'download',
        [ACTIONS.PLAY_MUSIC]: 'play_music',
        [ACTIONS.PRODUCT_SEARCH]: 'product_search',
        [ACTIONS.BROADCAST_GROUPS_PREPARE]: 'broadcast_groups',
        [ACTIONS.PRODUCT_EDIT_PRICE]: 'product_edit_price',
        [ACTIONS.PRODUCT_EDIT_FIELD]: 'product_edit_field',
        [ACTIONS.PRODUCT_PAUSE]: 'product_pause',
        [ACTIONS.PRODUCT_REACTIVATE]: 'product_reactivate',
        [ACTIONS.HELP]: 'help',
    }[action];
    return COPY.clarify[key] || COPY.clarify.default;
}

function buildConfirmQuestion(candidate) {
    const { action, params = {} } = candidate;
    if (action === ACTIONS.PRODUCT_EDIT_FIELD) {
        const label = params.productQuery || (params.productId ? `#${params.productId}` : 'produto');
        const fieldLabel = { name: 'nome', description: 'descrição', stock: 'estoque' }[params.field] || params.field;
        const val = params.value ? ` para <b>${String(params.value).slice(0, 80)}</b>` : '';
        return (
            `Confirma alterar o <b>${fieldLabel}</b> de <b>${label}</b>${val}?\n\n` +
            `Responda <b>sim</b> ou <b>não</b>.`
        );
    }
    if (action === ACTIONS.PRODUCT_EDIT_PRICE) {
        const label = params.productQuery || (params.productId ? `#${params.productId}` : 'produto');
        const price =
            params.price != null
                ? `R$ ${Number(params.price).toFixed(2)}`
                : 'o valor informado';
        return (
            `Confirma alterar o preço de <b>${label}</b> para <b>${price}</b>?\n\n` +
            `Responda <b>sim</b> para aplicar ou <b>não</b> para cancelar.`
        );
    }
    if (action === ACTIONS.PRODUCT_PAUSE) {
        const label = params.productQuery || (params.productId ? `#${params.productId}` : 'produto');
        return (
            `Confirma <b>pausar</b> o produto <b>${label}</b> no catálogo?\n\n` +
            `<i>O histórico de pedidos é mantido. Reative depois com linguagem natural ou </i><code>/reativarproduto</code>.\n\n` +
            `Responda <b>sim</b> para pausar ou <b>não</b> para cancelar.`
        );
    }
    if (action === ACTIONS.PRODUCT_REACTIVATE) {
        const label = params.productQuery || (params.productId ? `#${params.productId}` : 'produto');
        return (
            `Confirma <b>reativar</b> o produto <b>${label}</b> no catálogo?\n\n` +
            `Responda <b>sim</b> para aplicar ou <b>não</b> para cancelar.`
        );
    }
    return 'Confirma esta ação? Responda <b>sim</b> ou <b>não</b>.';
}

function needsAdminConfirmation(candidate, ctx = {}) {
    if (!ctx.isAdmin) return false;
    if (candidate.params?.confirmed) return false;
    if (ADMIN_ALWAYS_CONFIRM.has(candidate.action)) {
        const hasTarget = candidate.params?.productId || candidate.params?.productQuery;
        return hasTarget && (candidate.confidence || 0) >= CONFIDENCE_CONFIRM;
    }
    if (!ADMIN_CONFIRM_ACTIONS.has(candidate.action)) return false;
    const c = candidate.confidence || 0;
    return c >= CONFIDENCE_CONFIRM && c < CONFIDENCE_AUTO;
}

/**
 * Política unificada de confiança (router.md) — regras, LLM e bypass usam o mesmo fluxo.
 * ≥90% executa · 70–89% admin sensível confirma · <70% esclarece.
 */
function applyConfidencePolicy(candidate, ctx = {}) {
    if (!candidate || candidate.action === ACTIONS.NONE || candidate.action === ACTIONS.ASK) {
        return candidate;
    }

    let best = { ...candidate };

    if (needsAdminConfirmation(best, ctx)) {
        return {
            action: ACTIONS.ASK,
            confidence: best.confidence,
            params: { ...best.params, confirmIntent: true },
            pendingAction: best.action,
            question: buildConfirmQuestion(best),
        };
    }

    if (best.confidence < CONFIDENCE_CONFIRM && needsClarify(best)) {
        return {
            action: ACTIONS.ASK,
            confidence: best.confidence,
            params: best.params,
            pendingAction: best.action,
            question: buildClarifyQuestion(best.action),
        };
    }

    if (best.confidence < CONFIDENCE_EXECUTE && needsClarify(best)) {
        return {
            action: ACTIONS.ASK,
            confidence: best.confidence,
            params: best.params,
            pendingAction: best.action,
            question: buildClarifyQuestion(best.action),
        };
    }

    return best;
}

/**
 * @returns {{ action: string, confidence: number, params: object, pendingAction?: string, question?: string }}
 */
function classify(text, ctx = {}) {
    const raw = HanorkTextNormalize.normalizeForIntent(String(text || '').trim()) || String(text || '').trim();
    const norm = normalize(raw);

    const onlySmallTalk =
        !hasHanorkMention(raw) && (SMALL_TALK_RE.test(norm) || TRIVIAL_RE.test(norm));
    if (!norm || onlySmallTalk) {
        return { action: ACTIONS.NONE, confidence: 100, params: {} };
    }
    if (isObviousNonBotMessage(raw, ctx)) {
        return { action: ACTIONS.NONE, confidence: 100, params: {} };
    }
    if (/^(?:cancelar|sair|voltar)$/.test(norm)) {
        return { action: ACTIONS.NONE, confidence: 100, params: {} };
    }

    const virtuoIntent = resolveVirtuoIntent(raw);
    if (virtuoIntent) return applyConfidencePolicy(virtuoIntent, ctx);

    const unifiedIntent = resolveUnifiedSearchIntent(raw);
    if (unifiedIntent) return applyConfidencePolicy(unifiedIntent, ctx);

    const smmIntent = resolveSmmIntent(raw);
    if (smmIntent) return applyConfidencePolicy(smmIntent, ctx);

    const botDeepLink = resolveHanorkBotDeepLinkIntent(raw);
    if (botDeepLink) return applyConfidencePolicy(botDeepLink, ctx);

    if (isRecommendIntent(raw)) {
        return { action: ACTIONS.RECOMMEND_PRODUCT, confidence: 96, params: {} };
    }

    const normLower = normalize(raw).toLowerCase();
    if (/\b(sorteio|giveaway)\b/.test(normLower)) {
        return { action: ACTIONS.GIVEAWAY, confidence: 91, params: {} };
    }

    const productFromBuy = extractProductSearchQuery(raw);
    if (/\bquero\s+comprar\b/.test(normLower)) {
        if (productFromBuy) {
            return { action: ACTIONS.PRODUCT_SEARCH, confidence: 91, params: { query: productFromBuy } };
        }
        return { action: ACTIONS.SHOW_PRODUCTS, confidence: 91, params: {} };
    }

    if (ctx.isAdmin) {
        const dashText = resolveDashboardTextIntent(raw, ctx);
        if (dashText) return dashText;
        const dashLan = resolveDashboardLanIntent(raw, ctx);
        if (dashLan) return dashLan;
        const adminBroadcast = resolveAdminBroadcastIntent(raw);
        if (adminBroadcast) return adminBroadcast;
    }

    const parametric = PARAMETRIC_ACTIONS.map((action) => {
        const { score, params } = scoreAction(action, raw, ctx);
        return { action, confidence: Math.min(100, score), params };
    });

    const universal = HanorkUniversalRegistry.matchUniversal(raw, ctx);
    const candidates = universal ? [...parametric, universal] : parametric;

    candidates.sort((a, b) => {
        const d = b.confidence - a.confidence;
        if (Math.abs(d) <= 12) return tieBreak(a, b);
        return d !== 0 ? d : tieBreak(a, b);
    });

    let best = candidates[0];
    if (!best || best.confidence < 40) {
        return { action: ACTIONS.NONE, confidence: 100, params: {} };
    }

    if (
        best.action !== ACTIONS.RUN_SLASH &&
        best.action !== ACTIONS.RUN_CALLBACK &&
        PARAMETRIC_ACTIONS.includes(best.action)
    ) {
        const enriched = scoreAction(best.action, raw, ctx);
        best = {
            action: best.action,
            confidence: Math.max(best.confidence, Math.min(100, enriched.score)),
            params: { ...best.params, ...enriched.params },
        };
    }

    if (ctx.routerContext && Object.keys(ctx.routerContext).length) {
        best = HanorkRouterContext.enrichClassification(raw, best, ctx.routerContext, {
            isAdmin: ctx.isAdmin,
        });
    }

    return applyConfidencePolicy(best, ctx);
}

function extractSmmSearchQuery(text) {
    let n = normalize(String(text || '')).toLowerCase();
    n = n
        .replace(
            /\b(quero|preciso|comprar|manda|me\s+manda|busca|buscar|procura|procurar|abre|abrir|ver|mostra|mostrar|no|na|do|da|de|um|uma|uns|umas|pra|para|por|servi[cç]os?|smm)\b/g,
            ' '
        )
        .replace(/\s+/g, ' ')
        .trim();
    if (n.length < 3) return '';
    if (!SMM_NOUN_RE.test(n) && !SMM_PLATFORM_RE.test(n)) return '';
    return n;
}

function isVirtuoNumbersContext(text) {
    const n = normalize(String(text || '')).toLowerCase();
    if (!n) return false;
    if (/\b(pedidos?|vendas?|estat[ií]stica|relat[oó]rio|financeiro)\b/.test(n) && /\bn[uú]meros?\b/.test(n)) {
        return false;
    }
    if (VIRTUO_NUMBERS_RE.test(n)) return true;
    if (/\b(procuro|procurar|busco|buscar|compro|comprar|quero|preciso)\b.*\bn[uú]meros?\b/.test(n)) return true;
    if (/\bn[uú]meros?\b.*\b(whatsapp|telegram|instagram|sms|zap|wpp)\b/.test(n)) return true;
    if (/\bcomo\b.*\bn[uú]meros?\b/.test(n)) return true;
    return false;
}

function isVirtuoHelpIntent(text) {
    const n = normalize(String(text || '')).toLowerCase();
    if (!isVirtuoNumbersContext(text)) return false;
    return /\b(como|onde|qual|o\s+que)\b.*\b(procuro|procurar|busco|buscar|compro|comprar|uso|funciona|ache|encontro|pego)\b/.test(n);
}

function extractVirtuoSearchQuery(text) {
    try {
        const { parseVirtuoQuery } = require('../../modules/virtuo/utils/virtuoQueryParser');
        const parsed = parseVirtuoQuery(normalize(String(text || '')));
        const parts = [];
        if (parsed.serviceCode) parts.push(parsed.serviceCode);
        if (parsed.countryQuery) parts.push(parsed.countryQuery);
        return parts.join(' ').trim();
    } catch {
        return '';
    }
}

function resolveVirtuoIntent(text) {
    try {
        const { isVirtuoEnabled } = require('../../modules/virtuo/virtuoEnabled');
        if (!isVirtuoEnabled()) return null;
    } catch {
        return null;
    }

    const raw = String(text || '').trim();
    if (isObviousNonBotMessage(raw)) return null;
    if (!isVirtuoNumbersContext(raw)) return null;

    const n = normalize(raw).toLowerCase();

    if (isVirtuoHelpIntent(raw)) {
        return {
            action: ACTIONS.RUN_CALLBACK,
            confidence: 97,
            params: { callback: 'virtuo:home', label: COPY.virtuoNumbersHelp },
        };
    }

    if (/\b(abre|abrir|mostra|ver|menu)\b.*\b(n[uú]meros?|sms|virtuo)\b/.test(n)) {
        return { action: ACTIONS.RUN_CALLBACK, confidence: 94, params: { callback: 'virtuo:home' } };
    }

    const query = extractVirtuoSearchQuery(raw);
    if (query.length >= 2) {
        return { action: ACTIONS.RUN_SLASH, confidence: 96, params: { slash: 'numeros', args: query } };
    }

    return { action: ACTIONS.RUN_CALLBACK, confidence: 90, params: { callback: 'virtuo:home' } };
}

function extractUnifiedSearchQuery(text) {
    let n = normalize(String(text || ''))
        .toLowerCase()
        .replace(
            /\b(hanork|buscar|busca|procurar|procuro|procura|pesquisar|pesquisa|quero|preciso|como\s+eu?|como|ache|achar|encontrar|me\s+manda|manda|mostra|ver)\b/g,
            ' '
        )
        .replace(/\s+/g, ' ')
        .trim();
    return n;
}

function resolveUnifiedSearchIntent(text) {
    const raw = String(text || '').trim();
    const n = normalize(raw).toLowerCase();
    if (!n) return null;

    if (NL.hasExplicitMusicIntent(raw) || NL.extractMusicQuery(raw)) return null;
    if (/\b(m[uú]sica|musica|mp3|tocar|ouvir|escutar|play)\b/.test(n)) return null;
    if (/\b(baixar|baixa|abaixa|abaixar|download|puxar|salvar|salva)\b/.test(n)) return null;
    if (/\b(tiktok|instagram|youtube|youtu\.be|shorts)\b/.test(n) && /\b(v[ií]deo|video|link|url)\b/.test(n)) {
        return null;
    }

    const query = extractUnifiedSearchQuery(raw);
    const hasVerb = /\b(buscar|busca|procurar|procuro|procura|pesquisar|pesquisa|achar|ache|encontrar)\b/.test(n);

    if (hasVerb && query.length >= 2) {
        return { action: ACTIONS.RUN_SLASH, confidence: 93, params: { slash: 'buscar', args: query } };
    }

    if (query.length >= 3 && !NL.hasExplicitProductIntent(raw) && !isVirtuoHelpIntent(raw)) {
        const smmHint = SMM_NOUN_RE.test(query) || SMM_PLATFORM_RE.test(query);
        const virtuoHint =
            VIRTUO_NUMBERS_RE.test(query) ||
            /\b(brasil|brazil|portugal|india|indonesia|espanha|spain|mexico|argentina|eua|usa)\b/.test(query);
        if (smmHint || virtuoHint) {
            return { action: ACTIONS.RUN_SLASH, confidence: 88, params: { slash: 'buscar', args: query } };
        }
    }

    return null;
}

function resolveSmmIntent(text) {
    const raw = String(text || '').trim();
    const n = normalize(raw).toLowerCase();
    if (!n) return null;

    if (
        /\b(abre|abrir|mostra|ver)\b.*\b(smm|servi[cç]os?)\b/.test(n) ||
        /\bcomprar\s+servi[cç]os?\b/.test(n) ||
        /\bmenu\s+smm\b/.test(n)
    ) {
        return { action: ACTIONS.RUN_SLASH, confidence: 94, params: { slash: 'smm', args: '' } };
    }

    const hasNoun = SMM_NOUN_RE.test(n);
    const hasPlatform = SMM_PLATFORM_RE.test(n);
    if (!hasNoun && !(hasPlatform && /\b(quero|preciso|comprar|buscar|procura)\b/.test(n))) {
        return null;
    }

    const query = extractSmmSearchQuery(raw);
    if (!query || query.length < 3) return null;

    return {
        action: ACTIONS.RUN_SLASH,
        confidence: 96,
        params: { slash: 'buscar', args: query },
    };
}

function isExplicitHelpIntent(text) {
    const n = normalize(String(text || '')).toLowerCase();
    return /\b(comandos|help|lista\s+de\s+comandos|quais\s+comandos|o\s+que\s+(voc[eê]|o\s+bot)\s+faz)\b/.test(n);
}

function isHanorkMetaSlash(params = {}) {
    return (
        String(params.slash || '')
            .replace(/^\//, '')
            .split(/\s+/)[0]
            .toLowerCase() === 'hanork'
    );
}

function isHanorkGreeting(text) {
    const s = String(text || '').trim();
    if (!s || s.length > 32) return false;
    return /^(?:oi|ol[aá]|e\s*a[ií]|hey|opa|fala|salve|bom\s+dia|boa\s+tarde|boa\s+noite)(?:\s*[!.,?👋😎🙂🤙]*)?$/i.test(
        s
    );
}

function isAddressedToHanork(text, { fromCommand = false, inPrivate = false, inGroup = false } = {}) {
    if (fromCommand) return true;
    if (hasHanorkMention(text)) return true;
    if (inPrivate && hasImplicitBotAddress(text)) return true;
    if (inGroup && hasImplicitBotAddress(text) && hasHanorkMention(text)) return true;
    return false;
}

function getIntentText(text, { fromCommand = false } = {}) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    if (fromCommand) return raw;
    if (hasHanorkMention(raw)) return stripHanorkAddress(raw);
    return raw;
}

function needsPlannerFallback(classification, { fromCommand = false, rawText = '', inPrivate = false, inGroup = false } = {}) {
    if (!classification) return false;
    if (!isAddressedToHanork(rawText, { fromCommand, inPrivate, inGroup })) return false;
    if (classification.action === ACTIONS.NONE) return true;
    const src = classification.sourceText || rawText;
    if (classification.action === ACTIONS.HELP && !isExplicitHelpIntent(src)) return true;
    if (classification.action === ACTIONS.RUN_SLASH && isHanorkMetaSlash(classification.params)) return true;
    return false;
}

function needsCommandLlmFallback(classification, opts = {}) {
    return needsPlannerFallback(classification, opts);
}

function needsClarify(candidate) {
    const { action, params, confidence } = candidate;
    if (confidence >= CONFIDENCE_AUTO) return false;
    if (confidence >= CONFIDENCE_CONFIRM && ADMIN_CONFIRM_ACTIONS.has(action)) return false;
    if (confidence >= CONFIDENCE_EXECUTE) return false;
    if (action === ACTIONS.RUN_SLASH || action === ACTIONS.RUN_CALLBACK) return false;
    if (action === ACTIONS.DOWNLOAD && !params.url && !params.tiktokQuery && !params.instagramParsed) {
        return true;
    }
    if (action === ACTIONS.PLAY_MUSIC && !params.query) return true;
    if (action === ACTIONS.PRODUCT_SEARCH && !params.query) return true;
    return confidence >= 50 && confidence < CONFIDENCE_EXECUTE;
}

/**
 * Detecta se a mensagem deve ir ao Hanork mesmo com ticket/suporte/busca catálogo ativos.
 */
function peekOperationalRoute(text, classifyCtx = {}, activateOpts = {}) {
    const classification = classify(text, classifyCtx);
    if (classification.action === ACTIONS.NONE || classification.action === ACTIONS.SUPPORT) {
        return { route: false, classification };
    }
    const activateCtx = {
        fromCommand: false,
        inPrivate: activateOpts.inPrivate ?? classifyCtx.inPrivate ?? false,
        inGroup: activateOpts.inGroup ?? classifyCtx.inGroup ?? false,
        ...activateOpts,
    };
    if (classification.action === ACTIONS.ASK) {
        const gate = shouldActivate(text, classification, activateCtx);
        const shopPending =
            classification.pendingAction &&
            classification.pendingAction !== ACTIONS.SUPPORT &&
            classification.pendingAction !== ACTIONS.NONE;
        return { route: gate.activate && shopPending, classification, gate };
    }
    if (!isOperationalAction(classification.action)) {
        return { route: false, classification };
    }
    const gate = shouldActivate(text, classification, activateCtx);
    return { route: gate.activate, classification, gate };
}

function shouldActivate(rawText, classification, { fromCommand = false, inPrivate = false, inGroup = false } = {}) {
    if (fromCommand) return { activate: true, reason: 'command' };

    const addressed = isAddressedToHanork(rawText, { fromCommand, inPrivate, inGroup });

    if (classification.action === ACTIONS.ASK) {
        if (addressed || inPrivate) return { activate: true, reason: 'clarify' };
        return { activate: false, reason: 'ask_no_hanork' };
    }

    if (classification.action === ACTIONS.NONE) {
        if (addressed) return { activate: true, reason: 'hanork_no_intent' };
        return { activate: false, reason: 'none' };
    }

    const conf = classification.confidence;
    if (addressed && conf >= CONFIDENCE_EXECUTE_WITH_HANORK) {
        return { activate: true, reason: 'hanork_intent' };
    }
    if (inGroup && !addressed) {
        return { activate: false, reason: 'group_no_address' };
    }
    if (
        inPrivate &&
        (hasImplicitBotAddress(rawText) || hasHanorkMention(rawText)) &&
        conf >= CONFIDENCE_EXECUTE_PRIVATE &&
        isOperationalAction(classification.action)
    ) {
        return { activate: true, reason: 'private_bot_chat' };
    }
    if (inPrivate && conf >= CONFIDENCE_EXECUTE_PRIVATE && isOperationalAction(classification.action)) {
        return { activate: true, reason: 'private_intent' };
    }
    if (conf >= CONFIDENCE_EXECUTE) {
        if (inGroup && !addressed) return { activate: false, reason: 'group_clear_no_address' };
        return { activate: true, reason: 'clear_intent' };
    }
    return { activate: false, reason: 'low_confidence' };
}

function parseCommandArgs(args) {
    const q = String(args || '').trim();
    if (!q) return { ok: false, reason: 'command_empty' };
    return { ok: true, question: q };
}

module.exports = {
    classify,
    applyConfidencePolicy,
    shouldActivate,
    peekOperationalRoute,
    hasHanorkMention,
    hasImplicitBotAddress,
    isOperationalAction,
    isRecommendIntent,
    isCatalogSearchQuery,
    isGroupCatalogBroadcast,
    resolveCatalogSearchQuery,
    extractProductSearchQuery,
    resolveAdminBroadcastIntent,
    normalize,
    parseCommandArgs,
    buildClarifyQuestion,
    detectUrlKind,
    stripBotRequestTail,
    resolveSmmIntent,
    resolveVirtuoIntent,
    isVirtuoNumbersContext,
    isVirtuoHelpIntent,
    resolveUnifiedSearchIntent,
    extractUnifiedSearchQuery,
    isExplicitHelpIntent,
    isHanorkMetaSlash,
    isHanorkGreeting,
    isAddressedToHanork,
    getIntentText,
    stripHanorkAddress,
    needsPlannerFallback,
    needsCommandLlmFallback,
    isObviousNonBotMessage,
    HINT_MENTION_ONLY: COPY.hintInvoke,
};
