'use strict';

const { sanitizeTelegramHtml } = require('./persuasiveProductCopy');
const { repairTelegramHtml } = require('./broadcastTextClean');

const CTA_LINE_PATTERNS = [
    /\bclique\s+(aqui|no\s+botão|abaixo)\b/i,
    /\btoque\s+(aqui|no\s+botão|abaixo)\b/i,
    /\bacesse\s+(o\s+)?bot\b/i,
    /\babra\s+(o\s+)?bot\b/i,
    /\bcompre\s+agora\b/i,
    /\bcomprar\s+agora\b/i,
    /\bfaça\s+seu\s+pedido\b/i,
    /\buse\s+\/cat\b/i,
    /\buse\s+\/start\b/i,
    /\bhttps?:\/\/\S+/i,
    /\bt\.me\/\S+/i,
    /\btelegram\.me\/\S+/i,
];

/** Resposta persona/erro da API Zero Two — não é copy utilizável. */
const PERSONA_JUNK_PATTERNS = [
    /desculpe,?\s+darling/i,
    /meus sistemas est[aã]o (um pouco )?confus/i,
    /sou a zero[\s-]*two/i,
    /criador.*lucas/i,
    /lucas[_\s]*mod/i,
    /zero[\s-]*two.*darling/i,
    /n[aã]o consigo (gerar|processar|responder)/i,
    /indispon[ií]vel no momento/i,
];

function isPersonaJunkResponse(text) {
    const t = String(text || '').trim();
    if (!t || t.length < 10) return true;
    if (PERSONA_JUNK_PATTERNS.some((re) => re.test(t))) return true;
    if (t.length < 90 && /desculpe|sorry|confus|💔/i.test(t)) return true;
    return false;
}

function stripPersonaFragments(line) {
    return String(line || '')
        .replace(/^(darling|zero\s*two|lucas\s*mod)\s*[,:\-–—]?\s*/gi, '')
        .replace(/\b(darling|zero\s*two|lucas\s*mod)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * Remove links, CTAs e elementos que o sistema já injeta (título, preço, botão).
 * A IA deve gerar apenas corpo de texto.
 */
function sanitizeAiBodyText(text, options = {}) {
    let s = String(text || '').trim();
    if (!s) return '';

    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    s = s.replace(/<\s*a\s+[^>]*>([\s\S]*?)<\s*\/\s*a\s*>/gi, '$1');
    s = s.replace(/https?:\/\/[^\s<>"']+/gi, '');
    s = s.replace(/\bt\.me\/[^\s<>"']+/gi, '');
    s = s.replace(/\btelegram\.me\/[^\s<>"']+/gi, '');

    s = s.replace(/\*\*/g, '').replace(/\*/g, '');

    s = s
        .split('\n')
        .filter((line) => {
            const t = line.trim();
            if (!t) return true;
            if (isPersonaJunkResponse(t)) return false;
            if (/zero\s*two|lucas[_\s]*mod|darling|criador.*lucas/i.test(t)) {
                const cleaned = stripPersonaFragments(t);
                return cleaned.length >= 12;
            }
            if (CTA_LINE_PATTERNS.some((re) => re.test(t))) return false;
            if (/^🛒|^📦|^🏠|^💰|^➜|^→/u.test(t)) return false;
            return true;
        })
        .map((line) => {
            const t = line.trim();
            if (!t) return line;
            if (/darling|zero\s*two|lucas/i.test(t)) return stripPersonaFragments(t);
            return line;
        })
        .join('\n');

    s = sanitizeTelegramHtml(s);
    s = repairTelegramHtml(s);
    return s.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Sanitiza resposta de assistente (suporte) — texto puro, sem links extras.
 */
function sanitizeAssistantReply(text) {
    let s = sanitizeAiBodyText(text, { allowFooter: true });
    s = s.replace(/<\s*a\s+[^>]*>[\s\S]*?<\s*\/\s*a\s*>/gi, '');
    return repairTelegramHtml(sanitizeTelegramHtml(s));
}

/**
 * Segunda passagem mais leve quando a sanitização agressiva esvazia texto útil.
 */
function recoverPromoBody(raw, productName = '') {
    let s = String(raw || '').trim();
    if (!s || isPersonaJunkResponse(s)) return '';

    s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
    s = s.replace(/\*\*/g, '').replace(/\*/g, '');
    s = s.replace(/https?:\/\/[^\s<>"']+/gi, '');
    s = s.replace(/\bt\.me\/[^\s<>"']+/gi, '');

    const lines = s
        .split('\n')
        .map((line) => stripPersonaFragments(line.trim()))
        .filter((t) => t.length >= 12 && !CTA_LINE_PATTERNS.some((re) => re.test(t)));

    s = lines.join('\n').trim();
    if (!s) return '';

    const { stripHtml } = require('./persuasiveProductCopy');
    const name = String(productName || '').trim();
    if (name) {
        const nameNorm = name.toLowerCase();
        const first = stripHtml(s.split('\n')[0] || '').toLowerCase();
        if (first === nameNorm || first.startsWith(`${nameNorm} `)) {
            s = s.split('\n').slice(1).join('\n').trim();
        }
    }

    return sanitizeTelegramHtml(repairTelegramHtml(s)).trim();
}

/** Exemplos físicos que a IA costuma inventar em lojas digitais. */
const HALLUCINATED_PHYSICAL_RE =
    /\b(camiseta|camisetas|moletom|boné|bone|blusa|calça|calca|tênis|tenis|sapato|roupa|vestuário|vestuario|acessório|acessorio)\b/i;

function mentionsPhysicalGoods(text) {
    return HALLUCINATED_PHYSICAL_RE.test(String(text || ''));
}

/**
 * Rejeita copy da IA que cita produtos físicos ou nomes fora do catálogo real.
 */
function rejectHallucinatedStoreCopy(text, options = {}) {
    const body = String(text || '').trim();
    if (!body) return true;

    const allowed = (options.allowedProductNames || [])
        .map((n) => String(n || '').trim().toLowerCase())
        .filter(Boolean);

    if (mentionsPhysicalGoods(body)) {
        const allowedHasPhysical = allowed.some((n) => mentionsPhysicalGoods(n));
        if (!allowedHasPhysical) return true;
    }

    return false;
}

module.exports = {
    sanitizeAiBodyText,
    sanitizeAssistantReply,
    isPersonaJunkResponse,
    recoverPromoBody,
    rejectHallucinatedStoreCopy,
    mentionsPhysicalGoods,
    CTA_LINE_PATTERNS,
    PERSONA_JUNK_PATTERNS,
};
