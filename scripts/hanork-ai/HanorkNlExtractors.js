'use strict';

/**
 * Extração segura de parâmetros NL — só captura payload com delimitador explícito.
 * Evita tratar o resto da frase de comando como mensagem/texto/query.
 */

function normalize(text) {
    return String(text || '')
        .replace(/\bhanork\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractExplicitPayload(text, labels = ['mensagem', 'texto']) {
    const raw = normalize(text);
    for (const label of labels) {
        const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
            new RegExp(`${esc}\\s*[:=]\\s*(.+)`, 'i'),
            new RegExp(`(?:com\\s+(?:a\\s+)?${esc})\\s*[:.]?\\s*(.+)`, 'i'),
        ];
        for (const re of patterns) {
            const m = raw.match(re);
            if (m?.[1]?.trim().length >= 3) return m[1].trim();
        }
    }
    return null;
}

function extractBroadcastBody(text) {
    return extractExplicitPayload(text, ['mensagem', 'texto']);
}

function extractIaTheme(text) {
    const raw = normalize(text);
    const direct = extractExplicitPayload(text, ['tema', 'sobre', 'assunto']);
    if (direct) return direct;
    const m = raw.match(/\b(?:divulga|broadcast).*\b(?:ia|inteligente)\b.*\b(?:sobre|tema)\s+(.+)/i);
    if (m?.[1]?.trim().length >= 4) return m[1].trim();
    return null;
}

const BROADCAST_CMD_WORDS =
    /\b(divulga|divulgacao|divulgação|broadcast|dispara|executa|roda|publica|publique|envia|mande|manda|todos?|grupos?|canais?|produtos?|catalogo|catálogo|loja|completa|geral|em|nos|nas|no|na|que|o|a|bot|esta|está|ok|por|favor|pfv|ia|inteligente|mensagem|texto|livre|custom|prepara|inicia|abre)\b/gi;

function isMostlyCommandWords(text) {
    const raw = normalize(text).toLowerCase();
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const stripped = raw.replace(BROADCAST_CMD_WORDS, ' ').replace(/\s+/g, ' ').trim();
    return stripped.length < 3 || stripped.split(/\s+/).length <= 1;
}

function isLikelyAccidentalBroadcastText(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    if (t.length <= 2) return true;
    if (/^(?:ok|blz|sim|nao|não|a|e|oi)$/i.test(t)) return true;
    if (/^(?:divulga|dispara|broadcast)/i.test(t) && isMostlyCommandWords(t)) return true;
    return false;
}

function isGroupCatalogBroadcast(text) {
    const n = normalize(text).toLowerCase();
    if (extractBroadcastBody(text)) return false;
    if (/\b(mensagem|texto)\s+(?:livre|custom|personalizad)/.test(n)) return false;
    if (/\b(prepara|inicia|abre)\b.*\b(divulga|broadcast)\b/.test(n)) return false;
    if (/\bcanais?\b/.test(n) && !/\bgrupos?\b/.test(n)) return false;
    return (
        (/\b(produtos?|cat[aá]logo|loja|promo)\b/.test(n) && /\bgrupos?\b/.test(n)) ||
        /\bdivulga\b.*\b(em|nos?|todos?\s+os?)\s+.*\bgrupos?\b/.test(n) ||
        /\b(em|nos?|todos?\s+os?)\s+.*\bgrupos?\b.*\bdivulga\b/.test(n)
    );
}

function isChannelCatalogBroadcast(text) {
    const n = normalize(text).toLowerCase();
    if (extractBroadcastBody(text)) return false;
    if (/\bgrupos?\b/.test(n)) return false;
    return (
        (/\b(produtos?|cat[aá]logo|loja|promo)\b/.test(n) && /\bcanais?\b/.test(n)) ||
        /\bdivulga\b.*\b(?:nos?\s+)?canais?\b/.test(n)
    );
}

function isFullCatalogBroadcast(text) {
    const n = normalize(text).toLowerCase();
    if (extractBroadcastBody(text)) return false;
    if (isGroupCatalogBroadcast(text) || isChannelCatalogBroadcast(text)) return false;
    if (/\b(prepara|inicia|abre)\b.*\b(divulga|broadcast)\b/.test(n)) return false;
    if (/\b(mensagem|texto)\s+(?:livre|custom)/.test(n)) return false;
    if (/\b(?:so\s+)?grupos?\b/.test(n) && !/\b(completa|geral|tudo|pv|usu[aá]rios|canais|produtos?)\b/.test(n)) {
        return false;
    }
    return (
        /\bdivulga[cç][aã]o\s+(?:completa|geral)\b/.test(n) ||
        /\bdivulga\s+(?:completa|geral|tudo|em\s+tudo)\b/.test(n) ||
        /\b(dispara|executa|roda)\b.*\bdivulga/.test(n) ||
        (/\bdivulga\b/.test(n) &&
            /\b(produtos?|cat[aá]logo|loja)\b/.test(n) &&
            !/\bgrupos?\b/.test(n) &&
            !/\bcanais?\b/.test(n)) ||
        (/\bdivulga\b/.test(n) &&
            /\b(todos?|completa|geral|tudo)\b/.test(n) &&
            /\b(pv|usu[aá]rios|grupos|canais|ponte)\b/.test(n))
    );
}

function wantsBroadcastPrepare(text) {
    const n = normalize(text).toLowerCase();
    if (extractBroadcastBody(text) || extractIaTheme(text)) return null;
    if (!/\b(prepara|inicia|abre|configura)\b.*\b(divulga|broadcast)\b/.test(n)) return null;
    if (/\bgrupos?\b/.test(n) && /\b(mensagem|texto)\s+(?:livre|custom)/.test(n)) return 'grupos';
    if (/\b(ia|inteligente)\b/.test(n)) return 'ia';
    if (/\b(texto|mensagem)\s+(?:livre|custom)/.test(n)) return 'texto';
    if (/\bgrupos?\b/.test(n) && /\b(mensagem|texto)\b/.test(n)) return 'grupos';
    return 'panel';
}

const PRODUCT_QUERY_STOP = new Set([
    'que', 'quem', 'como', 'onde', 'quando', 'qual', 'quais', 'você', 'voce', 'vc',
    'me', 'recomenda', 'recomendar', 'indica', 'indicar', 'melhor', 'produto', 'produtos',
    'loja', 'bot', 'catalogo', 'catálogo', 'algo', 'uma', 'coisa', 'coisas',
    'grupos', 'grupo', 'todos', 'em', 'nos', 'nas', 'ok', 'esta', 'está', 'por', 'favor',
    'pelo', 'pela', 'pelos', 'pelas',
]);

/** Só remove ruído de intenção — nunca nomes de produto/música/link */
const MUSIC_INTENT_STOP = new Set([
    'toca', 'tocar', 'ouvir', 'play', 'da', 'em', 'no', 'na',
    'musica', 'música', 'mp3', 'audio', 'áudio',
    'busca', 'buscar', 'procura', 'procurar', 'quero', 'preciso', 'hanork', 'bot',
    'por', 'favor', 'pfv', 'pf', 'me', 'manda', 'envia', 'passa', 'ai', 'aí', 'ae',
    'carai', 'cara', 'video', 'vídeo',
]);

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

function lightNorm(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function stripTrailingRequestTail(q) {
    return String(q || '')
        .replace(/\s+(?:ai|a[ií]|pfv|pf|por\s+favor|carai|cara)\s*$/i, '')
        .replace(/\s*(?:e\s+)?(?:me\s+)?(?:manda|envia|passa|mandar|enviar).*$/i, '')
        .trim();
}

function stripLeadingArticles(q) {
    return String(q || '')
        .replace(/^(?:a\s+|o\s+|as\s+|os\s+|uma\s+|um\s+|uns\s+|umas\s+|da\s+|do\s+|de\s+)+/i, '')
        .trim();
}

function stripIntentWords(words, stopSet) {
    return words.filter((w) => w.length >= 2 && !stopSet.has(w));
}

function sanitizeProductSearchQuery(query) {
    let q = lightNorm(query);
    q = q
        .replace(/^(?:produto|produtos|catalogo|catálogo|loja|bot)\s+/gi, ' ')
        .replace(/\s+(?:produto|produtos)$/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!q || q.length < 2) return null;
    const words = q.split(/\s+/).filter((w) => w.length >= 2 && !PRODUCT_QUERY_STOP.has(w));
    if (!words.length) return null;
    if (words.length === 1) return words[0];
    const joined = words.join(' ');
    if (joined.length < 2) return null;
    if (words.length > 1 && isMostlyCommandWords(joined)) return null;
    return joined;
}

function stripPlayFiller(q) {
    return String(q || '')
        .replace(/^(?:em|no|na)\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Gírias só no início — não remove "tipo" no meio do título da faixa. */
function stripSlangPrefix(q) {
    let s = String(q || '').trim();
    for (let i = 0; i < 3; i++) {
        const next = s
            .replace(
                /^(?:crlh?|caralho|porra|pqp|fdp|vsf|krlh?|mano|mn|vei|veio|brother|damn|wtf|aff|sla)[,!.\s:]+/i,
                ''
            )
            .trim();
        if (next === s) break;
        s = next;
    }
    return s;
}

function sanitizePlayQuery(query) {
    let q = stripSlangPrefix(String(query || '').trim());
    q = stripTrailingRequestTail(q);
    q = stripPlayFiller(q);
    q = stripLeadingArticles(q);
    q = q.replace(/^(?:hanork|bot)\s+/i, '').replace(/\s+(?:hanork|bot)$/i, '').trim();
    q = lightNorm(q);
    if (q.length < 2) return null;
    const words = stripIntentWords(q.split(/\s+/), MUSIC_INTENT_STOP);
    if (words.length === 1 && words[0].length >= 2) return words[0];
    if (words.length) q = words.join(' ');
    if (q.length < 2) return null;
    if (words.length > 1 && isMostlyCommandWords(q)) return null;
    return q;
}

/** Extrai termo de produto de frases variadas — preserva o nome real (hanork, cursor, etc.) */
function extractProductQuery(text, { allowBareReply = false } = {}) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const n = lightNorm(raw);

    const patterns = [
        /^(?:procura|busca|buscar|tem|achar)\s+pelo\s+produto\s+(.+)/i,
        /^(?:procura|busca|buscar|tem|achar)\s+produto\s+(.+)/i,
        /^(?:me\s+)?(?:manda|envia|passa)(?:-me)?\s+(?:o\s+|a\s+|um\s+|uma\s+)?produto\s+(.+)/i,
        /^(?:você|voce|vc)\s+tem\s+(?:o\s+|a\s+|um\s+|uma\s+)?produto\s+(.+)/i,
        /quero\s+comprar\s+(?:o\s+|a\s+|um\s+|uma\s+)?(.+)/i,
        /(?:me\s+)?(?:mostra|mostrar|ver)\s+(?:o\s+|a\s+|um\s+|uma\s+)?produto\s+(.+)/i,
    ];
    for (const re of patterns) {
        const m = n.match(re);
        if (m?.[1]) {
            const sanitized = sanitizeProductSearchQuery(m[1]);
            if (sanitized) return sanitized;
        }
    }
    if (/\bproduto\s+(.+)/i.test(n) && !/\b(qual|recomend|indic|suger|melhor)\b/i.test(n)) {
        const m = n.match(/\bproduto\s+(.+)/i);
        const sanitized = sanitizeProductSearchQuery(m?.[1] || '');
        if (sanitized) return sanitized;
    }
    if (allowBareReply) {
        return sanitizeProductSearchQuery(raw);
    }
    return null;
}

/** Modo 🔍 Buscar — termo solto ou frase de busca */
function normalizeRawSearchQuery(text) {
    const fromPhrase = extractProductQuery(text);
    if (fromPhrase) return fromPhrase;
    return sanitizeProductSearchQuery(text);
}

/** Desejo hipotético — "bem que eu poderia ouvir…" não é pedido ao bot. */
function isHypotheticalWish(text) {
    const n = lightNorm(text);
    if (!n) return false;
    if (SEND_VERB_RE.test(n)) return false;
    if (/\b(?:quero|queria)\s+(?:ouvir|escutar|tocar)\b/.test(n)) return false;
    if (/\b(?:manda|envia|passa)(?:-me)?\s+(?:a\s+)?(?:m[uú]sica|musica)\b/.test(n)) return false;
    if (
        /\b(?:bem\s+que|seria\s+(?:legal|bom|massa|daora|top)|se\s+eu\s+pudesse|talvez\s+eu)\b/.test(
            n
        )
    ) {
        return true;
    }
    if (/\b(?:poderia|podia)\s+(?:ouvir|escutar|tocar)\b/.test(n)) return true;
    return false;
}

/** Pedido explícito de música — evita rotear conversa solta ("tesão insano"). */
function hasExplicitMusicIntent(text) {
    const n = lightNorm(text);
    if (!n) return false;
    if (isHypotheticalWish(text)) return false;
    if (/\b(?:m[uú]sica|musica|mp3)\b/.test(n)) return true;
    if (/\b(?:quero|queria)\s+(?:ouvir|escutar|tocar)\b/.test(n)) return true;
    if (SEND_VERB_RE.test(n) && /\b(?:m[uú]sica|musica|mp3)\b/.test(n)) return true;
    if (/\b(?:busca|procura|achar)\b/.test(n) && /\b(?:m[uú]sica|musica)\b/.test(n)) return true;
    if (/\b(?:toca|tocar|ouvir|escutar|play)\b/.test(n)) {
        return SEND_VERB_RE.test(n) || /\b(?:m[uú]sica|musica|mp3)\b/.test(n);
    }
    return false;
}

/** Extrai nome/link de música — preserva título completo */
function extractMusicQuery(text, { allowBareReply = false } = {}) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    if (isHypotheticalWish(raw)) return null;

    const urlMatch = raw.match(URL_RE);
    if (urlMatch?.[0]) return urlMatch[0].replace(/[.,;)]+$/, '');

    const n = lightNorm(raw);
    const patterns = [
        /^(?:da\s+)?(?:quero\s+)?(?:ouvir|escutar|tocar|toca|play)\s+(?:em\s+)?(?:a\s+|o\s+|uma\s+|um\s+)?(?:m[uú]sica\s+|musica\s+)?(.+)/i,
        /^(?:me\s+)?(?:manda|envia|passa)(?:-me)?\s+(?:a\s+|o\s+|uma\s+|um\s+)?(?:m[uú]sica|musica)\s+(.+)/i,
        /^(?:busca|procura|achar)\s+(?:a\s+|o\s+)?(?:m[uú]sica|musica)\s+(.+)/i,
        /^(?:m[uú]sica|musica)\s+(.+)/i,
        /(?:procura|busca)\s+(?:a\s+)?m[uú]sica\s+(.+)/i,
        /(?:quero|queria)\s+(?:ouvir|escutar)\s+(?:a\s+)?(?:m[uú]sica\s+)?(.+)/i,
    ];
    for (const re of patterns) {
        const m = n.match(re);
        if (m?.[1]) {
            const q = sanitizePlayQuery(m[1]);
            if (q) return q;
        }
    }

    // "hanork me manda a música montagem noche" — música no meio da frase
    const musicTail = n.match(/\b(?:m[uú]sica|musica)\s+(.+)/i);
    if (musicTail?.[1]) {
        const q = sanitizePlayQuery(musicTail[1]);
        if (q) return q;
    }

    if (/\b(toca|tocar|ouvir|escutar|play)\b/i.test(raw)) {
        const tail = n
            .replace(
                /^(?:da\s+)?(?:quero\s+)?(?:ouvir|escutar|tocar|toca|play)\s+(?:em\s+)?(?:a\s+|o\s+|uma\s+|um\s+)?(?:m[uú]sica\s+|musica\s+)?/i,
                ''
            )
            .trim();
        const q = sanitizePlayQuery(tail);
        if (q) return q;
    }

    // Só após clarificação do bot ("qual música?") — não em mensagem solta no grupo
    if (allowBareReply && !/\b(?:m[uú]sica|musica|tocar|ouvir|play|baixar|produto|carrinho|pix)\b/i.test(n)) {
        const q = sanitizePlayQuery(raw);
        if (q && q.split(/\s+/).length >= 2) return q;
    }

    return null;
}

const SEND_VERB_RE =
    /\b(?:manda|envia|passa|baixa|baixar|abaixa|abaixar|puxa|salva|salvar)(?:-me)?\b/;

function hasSendVerb(text) {
    return SEND_VERB_RE.test(lightNorm(text));
}

/** Pedido explícito de envio — "manda a música X", "quero ouvir X". */
function isSendMusicIntent(text) {
    const n = lightNorm(text);
    if (!n) return false;
    if (SEND_VERB_RE.test(n) && /\b(?:m[uú]sica|musica|mp3)\b/.test(n)) {
        return true;
    }
    if (/\b(?:quero|queria)\s+(?:ouvir|escutar)\b/.test(n)) return true;
    return false;
}

function isSendTiktokIntent(text) {
    const n = lightNorm(text);
    if (!n) return false;
    return (SEND_VERB_RE.test(n) || /\bquero\b/.test(n)) && /\b(tiktok|tt)\b/.test(n);
}

function isSendVideoIntent(text) {
    const n = lightNorm(text);
    if (!n) return false;
    if (/\b(?:m[uú]sica|musica|mp3|tocar|ouvir|play)\b/.test(n)) return false;
    return (SEND_VERB_RE.test(n) || /\bquero\b/.test(n)) && /\b(v[ií]deo|video|reels?|shorts?)\b/.test(n);
}

function isSendInstagramIntent(text) {
    const n = lightNorm(text);
    if (!n) return false;
    return (
        (SEND_VERB_RE.test(n) || /\bquero\b/.test(n)) &&
        /\b(instagram|insta|ig|stories?|destaques?|highlights?)\b/.test(n)
    );
}

function isSendProductIntent(text) {
    const n = lightNorm(text);
    if (!n) return false;
    return SEND_VERB_RE.test(n) && /\bproduto\b/.test(n);
}

function isSendDownloadIntent(text) {
    return (
        isSendTiktokIntent(text) ||
        isSendVideoIntent(text) ||
        isSendInstagramIntent(text) ||
        (hasSendVerb(text) && /\b(link|url)\b/.test(lightNorm(text)))
    );
}

function hasExplicitProductIntent(text) {
    const n = lightNorm(text);
    if (!n) return false;
    if (/\bprodutos?\b/.test(n)) return true;
    if (/\bquero\s+comprar\b/.test(n)) return true;
    if (/\b(?:cat[aá]logo|loja)\b/.test(n)) return true;
    if (/\b(?:procura|busca|buscar|achar)\b/.test(n) && /\bprodutos?\b/.test(n)) return true;
    if (SEND_VERB_RE.test(n) && /\bprodutos?\b/.test(n)) return true;
    if (/\b(?:voc[eê]|voce|vc)\s+tem\b/.test(n) && /\bprodutos?\b/.test(n)) return true;
    return false;
}

function hasExplicitTiktokIntent(text) {
    const n = lightNorm(text);
    if (!n) return false;
    if (/tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(String(text || ''))) return true;
    if (/\b(tiktok|tt)\b/.test(n)) return true;
    if (SEND_VERB_RE.test(n) && /\b(tiktok|tt)\b/.test(n)) return true;
    if (/\b(?:busca|procura|achar)\b/.test(n) && /\b(tiktok|tt)\b/.test(n)) return true;
    return false;
}

function hasExplicitInstagramIntent(text) {
    const n = lightNorm(text);
    if (!n) return false;
    if (/instagram\.com|instagr\.am/i.test(String(text || ''))) return true;
    if (/\b(instagram|insta|ig|stories?|destaques?|highlights?)\b/.test(n)) return true;
    if (SEND_VERB_RE.test(n) && /\b(instagram|insta|ig)\b/.test(n)) return true;
    if (SEND_VERB_RE.test(n) && /\b(?:stories?|destaques?|highlights?)\b/.test(n)) return true;
    return false;
}

function hasExplicitDownloadIntent(text) {
    const n = lightNorm(text);
    if (!n) return false;
    if (/https?:\/\//i.test(String(text || ''))) return true;
    if (hasExplicitTiktokIntent(text) || hasExplicitInstagramIntent(text)) return true;
    if (isSendVideoIntent(text) || isSendDownloadIntent(text)) return true;
    if (
        /\b(baixar|baixa|abaixa|abaixar|download|salvar|puxar|extrair|converter)\b/.test(n) &&
        /\b(v[ií]deo|video|tiktok|reels?|shorts?|youtube|youtu|link|url|m[ií]dia)\b/.test(n)
    ) {
        return true;
    }
    if (/\b(manda|envia|passa)\b/.test(n) && /\b(link|url)\b/.test(n)) return true;
    return false;
}

/** Busca TikTok por texto — "manda o tiktok @user", "tiktok montagem". */
function extractTiktokSearchQuery(text, { allowBareReply = false } = {}) {
    const raw = String(text || '').trim();
    if (!raw || /tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(raw)) return null;
    const n = lightNorm(raw);

    const patterns = [
        /^(?:me\s+)?(?:manda|envia|passa|baixa|puxa)(?:-me)?\s+(?:o\s+)?(?:v[ií]deo\s+)?(?:do\s+)?tiktok\s+(.+)/i,
        /^(?:me\s+)?(?:manda|envia|passa|baixa|puxa)(?:-me)?\s+(?:o\s+)?(?:v[ií]deo\s+)?(?:do\s+)?tt\s+(.+)/i,
        /^(?:busca|procura|achar)\s+(?:no\s+)?tiktok\s+(.+)/i,
        /^tiktok\s+(.+)/i,
    ];
    for (const re of patterns) {
        const m = n.match(re) || raw.match(re);
        if (m?.[1]) {
            const q = String(m[1]).replace(/^@/, '').trim();
            if (q.length >= 2) return q;
        }
    }

    if (allowBareReply) {
        const atM = n.match(/^@([a-z0-9._]{2,})$/i) || raw.match(/^@([a-z0-9._]{2,})$/i);
        if (atM?.[1]) return atM[1];
        const q = String(raw).replace(/^@/, '').trim();
        if (/^[a-z0-9._]{2,}$/i.test(q)) return q.toLowerCase();
    }

    if (/\btiktok\b/.test(n) && SEND_VERB_RE.test(n)) {
        const tail = n.replace(/^.*\btiktok\b\s*/i, '').trim().replace(/^@/, '');
        if (tail.length >= 2) return tail;
    }

    if (/\btt\b/.test(n) && SEND_VERB_RE.test(n)) {
        const tail = n.replace(/^.*\btt\b\s*/i, '').trim().replace(/^@/, '');
        if (tail.length >= 2) return tail;
    }

    return null;
}

/** Instagram por NL — stories/highlights/@user sem URL. */
function extractInstagramNLQuery(text, { allowBareReply = false } = {}) {
    const raw = String(text || '').trim();
    if (!raw || /instagram\.com|instagr\.am/i.test(raw)) return null;
    const n = lightNorm(raw);

    const storiesPatterns = [
        /^(?:me\s+)?(?:manda|envia|passa|baixa|puxa)(?:-me)?\s+(?:os\s+)?stories?\s+(?:do\s+|de\s+|da\s+)?@?([a-z0-9._]{2,})/i,
        /^(?:me\s+)?(?:manda|envia|passa|baixa|puxa)(?:-me)?\s+(?:o\s+)?(?:instagram|insta|ig)\s+(?:do\s+|de\s+)?@?([a-z0-9._]{2,})/i,
        /^stories?\s+@([a-z0-9._]{2,})/i,
    ];
    for (const re of storiesPatterns) {
        const m = n.match(re) || raw.match(re);
        if (m?.[1]) return { type: 'stories', value: m[1].toLowerCase() };
    }

    const highlightsPatterns = [
        /^(?:me\s+)?(?:manda|envia|passa|baixa|puxa)(?:-me)?\s+(?:os\s+)?(?:destaques?|highlights?)\s+(?:do\s+|de\s+)?@?([a-z0-9._]{2,})/i,
        /^(?:me\s+)?(?:manda|envia|passa|baixa|puxa)(?:-me)?\s+(?:os\s+)?(?:destaques?|highlights?)\s+(?:do\s+|de\s+)?@?([a-z0-9._]{2,})/i,
        /^highlights?\s+@?([a-z0-9._]{2,})/i,
    ];
    for (const re of highlightsPatterns) {
        const m = n.match(re) || raw.match(re);
        if (m?.[1]) return { type: 'highlights', value: m[1].toLowerCase() };
    }

    if (SEND_VERB_RE.test(n) && /\b(?:instagram|insta|ig)\b/.test(n)) {
        const userM = n.match(/@([a-z0-9._]{2,})/);
        if (userM?.[1]) return { type: 'stories', value: userM[1].toLowerCase() };
        const tailM = n.match(/\b(?:instagram|insta|ig)\b\s+(?:do\s+|de\s+)?@?([a-z0-9._]{2,})/i);
        if (tailM?.[1]) return { type: 'stories', value: tailM[1].toLowerCase() };
    }

    if (allowBareReply) {
        const atM = n.match(/^@([a-z0-9._]{2,})$/i) || raw.match(/^@([a-z0-9._]{2,})$/i);
        if (atM?.[1]) return { type: 'stories', value: atM[1].toLowerCase() };
        const bare = String(raw).replace(/^@/, '').trim().toLowerCase();
        if (/^[a-z0-9._]{2,}$/.test(bare)) return { type: 'stories', value: bare };
    }

    return null;
}

function formatInstagramRouterInput(parsed) {
    if (!parsed) return '';
    if (typeof parsed === 'string') return parsed;
    if (parsed.type === 'url') return parsed.value;
    if (parsed.type === 'stories') return `stories @${parsed.value}`;
    if (parsed.type === 'highlights') return `highlights @${parsed.value}`;
    return String(parsed.value || '');
}

function tokenizeMediaQuery(query) {
    const stop = new Set(['de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'e', 'o', 'a']);
    return lightNorm(query)
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !stop.has(w));
}

function tokenizePlayQuery(query) {
    return tokenizeMediaQuery(query);
}

function scoreMediaSearchMatch(query, hit, fields = ['title', 'artist']) {
    const tokens = tokenizeMediaQuery(query);
    if (!tokens.length) return { matched: 0, ratio: 0, score: 0, tokens: 0 };
    const hay = lightNorm(fields.map((f) => hit?.[f] || '').join(' '));
    let matched = 0;
    let score = 0;
    for (const t of tokens) {
        if (hay.includes(t)) {
            matched += 1;
            score += Math.min(t.length, 8);
        }
    }
    return { matched, ratio: matched / tokens.length, score, tokens: tokens.length };
}

function scoreSearchMatch(query, hit) {
    return scoreMediaSearchMatch(query, hit, ['title', 'artist']);
}

function pickBestMediaIndex(query, results = [], fields = ['title', 'artist']) {
    if (!results.length) return 0;
    let best = 0;
    let bestScore = -1;
    results.forEach((hit, i) => {
        const s = scoreMediaSearchMatch(query, hit, fields);
        if (s.score > bestScore) {
            bestScore = s.score;
            best = i;
        }
    });
    return best;
}

function pickBestSearchIndex(query, results = []) {
    return pickBestMediaIndex(query, results, ['title', 'artist']);
}

function shouldAutoPickMedia(query, results, { sendIntent = false } = {}, fields = ['title', 'artist']) {
    if (!results?.length) return false;
    if (results.length === 1) return true;
    if (sendIntent) return true;
    return false;
}

function shouldAutoPickSearch(query, results, opts = {}) {
    return shouldAutoPickMedia(query, results, opts, ['title', 'artist']);
}

function parseMoneyValue(text) {
    const raw = String(text || '').trim();
    const m =
        raw.match(/(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\s*\$?/i) ||
        raw.match(/\b(\d{1,6}[.,]\d{1,2})\b/);
    if (!m) return null;
    const v = parseFloat(String(m[1]).replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0 || v > 999999) return null;
    return Math.round(v * 100) / 100;
}

/** Admin: alteração de preço com produto + valor na mesma frase. */
function extractProductPriceEdit(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length < 4) return null;

    const n = lightNorm(raw);
    const priceIntent =
        /\b(?:muda|mudar|altera|alterar|troca|trocar|coloca|colocar|deixa|deixar|atualiza|atualizar|ajusta|ajustar|define|definir)\b.*\b(?:pre[cç]o|valor)\b/.test(
            n
        ) ||
        /\b(?:pre[cç]o|valor)\s+(?:do\s+)?(?:produto\s+)?/.test(n) ||
        /\b(?:pre[cç]o|valor)\s+(?:desse|deste|esse|este)\s+produto\b/.test(n) ||
        /\b(?:muda|altera|troca)\s+(?:o\s+)?(?:valor|pre[cç]o)\s+(?:desse|deste|esse|este)\b/.test(n) ||
        /\b(?:muda|altera|troca)\s+(?:esse|este)\s+item\b/.test(n) ||
        /\b(?:mais\s+barato|mais\s+caro)\b/.test(n) ||
        /\b(?:deixa|coloca)\s+por\s+\d/.test(n) ||
        /\bcoloca\s+(?:ele|o\s+produto)\s+(?:por|pra|a|em)\s+\d/.test(n);

    const priceOnly = /^\d{1,6}(?:[.,]\d{1,2})?\s*\$?$/.test(raw.trim());
    if (!priceIntent && !priceOnly) return null;

    const price = parseMoneyValue(raw);
    if (!price && !priceIntent) return null;

    let productId = null;
    const idM =
        raw.match(/\bproduto\s*#(\d{1,6})\b/i) ||
        raw.match(/#(\d{1,6})\b/) ||
        raw.match(/\bid\s*(?:do\s+produto\s*)?(\d{1,6})\b/i);
    if (idM) productId = parseInt(idM[1], 10);

    let productQuery = null;
    const productPatterns = [
        /(?:pre[cç]o|valor)\s+do\s+produto\s+(.+?)\s+pra\s+/i,
        /coloca\s+o\s+pre[cç]o\s+do\s+produto\s+(.+?)\s+pra\s+/i,
        /(?:muda|altera|troca)\s+o\s+(?:pre[cç]o|valor)\s+(?:do\s+)?produto\s+(.+?)\s+(?:pra|para|por|a|em)\s+/i,
        /(?:muda|altera|troca)\s+o\s+(?:pre[cç]o|valor)\s+(?:de|do)\s+(.+?)\s+(?:pra|para|por|a|em)\s+/i,
        /produto\s+(.+?)\s+pra\s+\d/i,
        /(?:deixa|coloca)\s+(?:ele|o\s+produto)\s+(?:por|pra|a|em)\s+\d/i,
    ];
    for (const re of productPatterns) {
        const m = raw.match(re);
        if (m?.[1]) {
            const q = sanitizeProductSearchQuery(m[1]) || String(m[1]).trim();
            if (q && q.length >= 2) {
                productQuery = q;
                break;
            }
        }
    }

    if (!productQuery && !productId) {
        const loose = raw.match(
            /(?:pre[cç]o|valor).*?(?:produto\s+)?([a-zA-Z0-9À-ÿ#][a-zA-Z0-9À-ÿ#\s]{2,50}?)\s+(?:pra|para|por|a|em)\s+(?:r\$?\s*)?\d/i
        );
        if (loose?.[1]) {
            productQuery = sanitizeProductSearchQuery(loose[1]) || loose[1].trim();
        }
    }

    if (!price && priceIntent) {
        return { productId, productQuery, price: null, needsPrice: true };
    }
    if (!productId && !productQuery && priceOnly) {
        return { productId: null, productQuery: null, price, needsProduct: true };
    }
    if (!productId && !productQuery && priceIntent && price) {
        return { productId: null, productQuery: null, price, needsProduct: true };
    }
    if (!productId && !productQuery) return null;

    return { productId, productQuery, price, needsPrice: false, needsProduct: false };
}

/** Referência a produto (ID, nome ou pronome). */
function extractProductRef(text) {
    const raw = String(text || '').trim();
    const n = lightNorm(raw);
    let productId = null;
    const idM =
        raw.match(/\bproduto\s*#(\d{1,6})\b/i) ||
        raw.match(/#(\d{1,6})\b/) ||
        raw.match(/\bid\s*(?:do\s+produto\s*)?(\d{1,6})\b/i);
    if (idM) productId = parseInt(idM[1], 10);

    let productQuery = null;
    const namePatterns = [
        /\b(?:produto|item)\s+(.+?)\s*$/i,
        /\b(?:apaga|exclui|remove|pausa|desativa|reativa|ativa)\s+(?:o\s+)?(?:produto|item)\s+(.+?)\s*$/i,
    ];
    for (const re of namePatterns) {
        const m = raw.match(re);
        if (m?.[1]) {
            const q = sanitizeProductSearchQuery(m[1]) || String(m[1]).trim();
            if (q && q.length >= 2) {
                productQuery = q;
                break;
            }
        }
    }

    const deictic = /\b(?:isso|esse|este|essa|esta|aquele|aquela|ele|ela)\b/.test(n);
    return { productId, productQuery, deictic };
}

/**
 * Admin: pausar ou reativar produto no catálogo.
 * @returns {{ op: 'pause'|'reactivate', productId, productQuery, deictic, needsProduct } | null}
 */
function extractProductLifecycle(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length < 3) return null;
    const n = lightNorm(raw);

    if (
        /\b(?:promo|promocao|flash|sorteio|manutencao|modo\s+loja|grupo|carrinho|checkout|ticket)\b/.test(n) &&
        !/\bproduto\b/.test(n) &&
        !/\b(?:isso|esse|este|aquele|ele)\b/.test(n)
    ) {
        return null;
    }

    const pauseVerb = /\b(?:apaga|apagar|exclui|excluir|remove|remover|deleta|deletar|pausa|pausar|desativa|desativar|tira|tirar)\b/.test(
        n
    );
    const activeVerb = /\b(?:reativa|reativar|ativa|ativar|liga|ligar)\b/.test(n);
    if (!pauseVerb && !activeVerb) return null;

    let op = null;
    if (pauseVerb && !activeVerb) op = 'pause';
    else if (activeVerb && !pauseVerb) op = 'reactivate';
    else return null;

    const ref = extractProductRef(text);
    const needsProduct = !ref.productId && !ref.productQuery && ref.deictic;

    if (!ref.productId && !ref.productQuery && !ref.deictic && op === 'reactivate' && /^(?:ativa|ativar|liga|ligar)\s*$/i.test(raw)) {
        return { op, ...ref, needsProduct: true };
    }
    if (!ref.productId && !ref.productQuery && !ref.deictic) return null;

    return { op, ...ref, needsProduct };
}

const FIELD_EDIT_PATTERNS = [
    { field: 'name', re: /\b(?:muda|altera|troca|coloca|define)\s+(?:o\s+)?nome\b/ },
    { field: 'description', re: /\b(?:muda|altera|troca|coloca)\s+(?:a\s+)?(?:descricao|desc)\b/ },
    { field: 'stock', re: /\b(?:muda|altera|coloca|define)\s+(?:o\s+)?estoque\b/ },
];

/**
 * Admin: editar campo textual do produto (exceto preço — usar extractProductPriceEdit).
 */
function extractProductFieldEdit(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length < 6) return null;
    const priceEdit = extractProductPriceEdit(raw);
    if (priceEdit?.price != null) return null;

    const n = lightNorm(raw);
    let field = null;
    for (const p of FIELD_EDIT_PATTERNS) {
        if (p.re.test(n)) {
            field = p.field;
            break;
        }
    }
    if (!field) return null;

    const ref = extractProductRef(text);
    let value = null;

    const valuePatterns = [
        /\b(?:nome|descricao|desc|estoque)\b.*?(?:para|pra|por|em|como)\s+(.+)/i,
        /\bproduto\s+.+?\s+(?:para|pra|por|em)\s+(.+)/i,
        /\b(?:muda|altera|troca|coloca)\s+(?:o\s+)?(?:nome|descricao|desc|estoque)\s+(?:do\s+)?produto\s+.+?\s+(?:para|pra|por|em)\s+(.+)/i,
    ];
    for (const re of valuePatterns) {
        const m = raw.match(re);
        if (m?.[1]?.trim().length >= 2) {
            value = m[1].trim();
            break;
        }
    }

    if (!value && field === 'stock') {
        const sm = raw.match(/\bestoque\s+(?:para\s+)?(\d{1,6})\b/i) || raw.match(/\b(?:para|pra|por)\s+(\d{1,6})\b/i);
        if (sm) value = sm[1];
    }

    return {
        field,
        value,
        productId: ref.productId,
        productQuery: ref.productQuery,
        needsProduct: !ref.productId && !ref.productQuery && ref.deictic,
        needsValue: !value,
    };
}

module.exports = {
    normalize,
    lightNorm,
    extractExplicitPayload,
    extractBroadcastBody,
    extractIaTheme,
    isGroupCatalogBroadcast,
    isChannelCatalogBroadcast,
    isFullCatalogBroadcast,
    wantsBroadcastPrepare,
    isLikelyAccidentalBroadcastText,
    isMostlyCommandWords,
    sanitizeProductSearchQuery,
    stripSlangPrefix,
    sanitizePlayQuery,
    extractProductQuery,
    extractMusicQuery,
    hasExplicitMusicIntent,
    isHypotheticalWish,
    hasExplicitProductIntent,
    hasExplicitTiktokIntent,
    hasExplicitInstagramIntent,
    hasExplicitDownloadIntent,
    hasSendVerb,
    isSendMusicIntent,
    isSendTiktokIntent,
    isSendVideoIntent,
    isSendInstagramIntent,
    isSendProductIntent,
    isSendDownloadIntent,
    extractTiktokSearchQuery,
    extractInstagramNLQuery,
    formatInstagramRouterInput,
    tokenizeMediaQuery,
    tokenizePlayQuery,
    scoreMediaSearchMatch,
    scoreSearchMatch,
    pickBestMediaIndex,
    pickBestSearchIndex,
    shouldAutoPickMedia,
    shouldAutoPickSearch,
    normalizeRawSearchQuery,
    parseMoneyValue,
    extractProductPriceEdit,
    extractProductRef,
    extractProductLifecycle,
    extractProductFieldEdit,
};
