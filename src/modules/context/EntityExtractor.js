'use strict';

const AMOUNT_RE = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais?|real|rs)?/gi;
const PIX_RE = /\b(pix|pic)\b/i;
const CARD_RE = /\b(cart[aã]o|cr[eé]dito|d[eé]bito)\b/i;
const CASH_RE = /\b(dinheiro|esp[eé]cie|cash)\b/i;
const TRANSFER_RE = /\b(transfer[eê]ncia|ted|doc)\b/i;

const WEEKDAYS = {
    segunda: 1,
    terça: 2,
    terca: 2,
    quarta: 3,
    quinta: 4,
    sexta: 5,
    sabado: 6,
    sábado: 6,
    domingo: 0,
};

const TIME_RE = /\b(\d{1,2})[:h](\d{2})?\b/i;
const TOMORROW_RE = /\b(amanh[aã])\b/i;
const TODAY_RE = /\b(hoje)\b/i;

function normalizeText(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function parseAmount(raw) {
    if (!raw) return null;
    let s = String(raw).replace(/\s/g, '').replace(/r\$/gi, '');
    if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function extractAmounts(text) {
    const amounts = [];
    let m;
    const re = new RegExp(AMOUNT_RE.source, 'gi');
    while ((m = re.exec(text)) !== null) {
        const v = parseAmount(m[1]);
        if (v != null) amounts.push(v);
    }
    return amounts;
}

function extractPaymentMethod(text) {
    const n = normalizeText(text);
    if (PIX_RE.test(n)) return 'pix';
    if (CARD_RE.test(n)) return 'card';
    if (CASH_RE.test(n)) return 'cash';
    if (TRANSFER_RE.test(n)) return 'transfer';
    return null;
}

function extractClientName(text, verbs = []) {
    const original = String(text || '').trim();
    const lower = normalizeText(original);

    for (const v of verbs) {
        const re = new RegExp(
            `([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]?[a-záéíóúâêôãõç]+){0,2})\\s+${v}`,
            'i'
        );
        const m = original.match(re);
        if (m) return m[1].trim();
    }

    const casaRe = /(?:casa\s+do|cliente|pro|para|pra)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)/i;
    const cm = original.match(casaRe);
    if (cm) return cm[1].trim();

    const proRe = /\b(?:pro|para|pra)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)/i;
    const pm = original.match(proRe);
    if (pm) return pm[1].trim();

    return null;
}

function extractDateHint(text) {
    const n = normalizeText(text);
    if (TOMORROW_RE.test(n)) return { relative: 'tomorrow' };
    if (TODAY_RE.test(n)) return { relative: 'today' };
    for (const [word, dow] of Object.entries(WEEKDAYS)) {
        if (new RegExp(`\\b${word}\\b`).test(n)) return { weekday: dow, word };
    }
    return null;
}

function extractTime(text) {
    const m = String(text || '').match(TIME_RE);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return { hour: h, minute: min };
}

function extractServiceDescription(text) {
    const n = normalizeText(text);
    const ficouIdx = n.indexOf('ficou');
    if (ficouIdx > 3) {
        return String(text).slice(0, ficouIdx).trim().replace(/^(fiz|fizemos|servico de|serviço de)\s+/i, '');
    }
    if (/troca|instal|consert|repar|manutenc/.test(n)) {
        return String(text).trim();
    }
    return null;
}

function extractLocation(text) {
    const m = String(text || '').match(/(?:na|em)\s+(?:casa\s+do\s+)?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\w\s]{2,30})/i);
    return m ? m[1].trim() : null;
}

function extractPronounReference(text) {
    return /\b(ele|ela|eles|elas)\b/i.test(String(text || ''));
}

function extractAll(text) {
    const amounts = extractAmounts(text);
    return {
        client: extractClientName(text, ['pagou', 'pago', 'transferiu', 'depositou', 'vai pagar', 'ficou devendo']),
        amount: amounts.length ? amounts[amounts.length - 1] : null,
        amounts,
        method: extractPaymentMethod(text),
        date: extractDateHint(text),
        time: extractTime(text),
        service: extractServiceDescription(text),
        location: extractLocation(text),
        pronounRef: extractPronounReference(text),
        notes: String(text || '').trim(),
    };
}

module.exports = {
    extractAll,
    extractAmounts,
    extractClientName,
    extractPaymentMethod,
    parseAmount,
    normalizeText,
};
