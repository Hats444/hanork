'use strict';

const { stripHtml } = require('./persuasiveProductCopy');

const TG_INLINE_TAGS = new Set([
    'b',
    'strong',
    'i',
    'em',
    'u',
    'ins',
    's',
    'strike',
    'del',
    'code',
    'a',
    'tg-spoiler',
]);

function normalizeComparable(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function linesRoughlyEqual(a, b) {
    const x = normalizeComparable(a);
    const y = normalizeComparable(b);
    if (!x || !y) return false;
    if (x === y) return true;
    if (x.length >= 8 && y.length >= 8 && (x.includes(y) || y.includes(x))) return true;
    return false;
}

/** Remove linhas ou parágrafos consecutivos idênticos (texto plano). */
function dedupePlainText(text) {
    let s = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!s) return '';

    const paras = s.split(/\n{2,}/);
    const outParas = [];
    let prevPara = null;
    for (const para of paras) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        if (prevPara && linesRoughlyEqual(trimmed, prevPara)) continue;
        const lines = trimmed.split('\n');
        const outLines = [];
        let prevLine = null;
        for (const line of lines) {
            const lt = line.trim();
            if (!lt) continue;
            if (prevLine && linesRoughlyEqual(lt, prevLine)) continue;
            outLines.push(lt);
            prevLine = lt;
        }
        const merged = outLines.join('\n');
        if (!merged) continue;
        if (prevPara && linesRoughlyEqual(merged, prevPara)) continue;
        outParas.push(merged);
        prevPara = merged;
    }
    return outParas.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Remove título/nome do produto repetido no início do corpo. */
function stripRepeatedProductTitle(body, productName) {
    const name = String(productName || '').trim();
    if (!name) return String(body || '').trim();

    let s = String(body || '').trim();
    const nameNorm = normalizeComparable(name);

    for (let pass = 0; pass < 3; pass++) {
        const firstLine = s.split('\n')[0]?.trim() || '';
        const firstPlain = stripHtml(firstLine);
        const firstNorm = normalizeComparable(firstPlain);
        if (
            firstNorm === nameNorm ||
            firstNorm === normalizeComparable(`✨ ${name}`) ||
            firstNorm.startsWith(`${nameNorm} `) ||
            (firstNorm.length >= 6 && nameNorm.length >= 6 && firstNorm.includes(nameNorm) && firstNorm.length < nameNorm.length + 40)
        ) {
            s = s.slice(firstLine.length).replace(/^\n+/, '').trim();
            continue;
        }
        break;
    }
    return s;
}

const PRICE_LINE_RE =
    /^💰|^\*\*?\s*R\$\s*\d|^\s*R\$\s*\d|\bde\s+R\$\s*\d|\bpor\s+apenas\s+R\$/iu;

/** Mantém só o último bloco de preço — IA + rodapé não podem repetir valor. */
function stripDuplicatePriceLines(body) {
    const lines = String(body || '').split('\n');
    const priceIdx = [];
    lines.forEach((line, i) => {
        if (PRICE_LINE_RE.test(line.trim())) priceIdx.push(i);
    });
    if (priceIdx.length <= 1) {
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    const keep = priceIdx[priceIdx.length - 1];
    return lines
        .filter((line, i) => !PRICE_LINE_RE.test(line.trim()) || i === keep)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Remove tags de fechamento órfãs e fecha tags abertas no fim (evita "Unexpected end tag").
 */
function repairTelegramHtml(html) {
    let s = String(html || '');
    if (!s.trim()) return '';

    const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)>/g;
    const stack = [];
    let out = '';
    let last = 0;
    let m;

    while ((m = tagRe.exec(s)) !== null) {
        out += s.slice(last, m.index);
        const closing = Boolean(m[1]);
        const tag = String(m[2] || '').toLowerCase();
        const attrs = m[3] || '';

        if (!TG_INLINE_TAGS.has(tag) && tag !== 'span' && tag !== 'blockquote' && tag !== 'pre') {
            last = m.index + m[0].length;
            continue;
        }

        if (tag === 'span' && !/tg-spoiler/i.test(attrs)) {
            last = m.index + m[0].length;
            continue;
        }

        if (closing) {
            let idx = -1;
            for (let i = stack.length - 1; i >= 0; i--) {
                const top = stack[i];
                if (top === tag || (tag === 'strong' && top === 'b') || (tag === 'b' && top === 'strong')) {
                    idx = i;
                    break;
                }
            }
            if (idx >= 0) {
                while (stack.length > idx + 1) {
                    const orphan = stack.pop();
                    out += `</${orphan}>`;
                }
                stack.pop();
                out += m[0];
            }
        } else if (tag === 'a') {
            const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs);
            if (href) {
                stack.push('a');
                const safe = href[1].replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                out += `<a href="${safe}">`;
            }
        } else {
            const canon = tag === 'strong' ? 'b' : tag === 'em' ? 'i' : tag === 'ins' ? 'u' : tag === 'strike' || tag === 'del' ? 's' : tag;
            stack.push(canon);
            out += m[0];
        }
        last = m.index + m[0].length;
    }

    out += s.slice(last);
    while (stack.length) {
        out += `</${stack.pop()}>`;
    }
    return out;
}

/** Corrige erros comuns de IA em copy de divulgação (PT-BR). */
function fixPromoPortuguese(text) {
    let s = String(text || '');
    if (!s.trim()) return '';

    const rules = [
        [/\bdivulga[cç][aã]o\s+liberado\b/gi, 'divulgação liberada'],
        [/\boferta\s+liberado\b/gi, 'oferta liberada'],
        [/\bpromo[cç][aã]o\s+liberado\b/gi, 'promoção liberada'],
        [/\bentrega\s+automatico\b/gi, 'entrega automática'],
        [/\bentregas\s+automatico\b/gi, 'entregas automáticas'],
        [/\bconfirma[cç][aã]o\s+automatico\b/gi, 'confirmação automática'],
        [/\bpagamentos\s+automatico\b/gi, 'pagamentos automáticos'],
        [/\bloja\s+automatico\b/gi, 'loja automática'],
        [/\bcompra\s+automatico\b/gi, 'compra automática'],
        [/\bcompras\s+automatico\b/gi, 'compras automáticas'],
        [/\bdisponivel\b/gi, 'disponível'],
        [/\bunico\b/gi, 'único'],
        [/\bunica\b/gi, 'única'],
        [/\bvoce\b/gi, 'você'],
        [/\bnao\b/gi, 'não'],
        [/\btambem\b/gi, 'também'],
        [/\bja\b/gi, 'já'],
        [/\bapos\b/gi, 'após'],
        [/\bso\b/gi, 'só'],
        [/\bpratico\b/gi, 'prático'],
        [/\brapido\b/gi, 'rápido'],
        [/\bfacil\b/gi, 'fácil'],
        [/\bexclusivo\s+da\s+hanork\b/gi, 'exclusivo da Hanork'],
        [/\s+([,.!?])/g, '$1'],
        [/\s{2,}/g, ' '],
    ];
    for (const [re, rep] of rules) {
        s = s.replace(re, rep);
    }
    return s.replace(/\n{3,}/g, '\n\n').trim();
}

function polishAiBody(rawBody, productName) {
    let body = String(rawBody || '').trim();
    if (!body) return '';
    body = fixPromoPortuguese(stripRepeatedProductTitle(stripHtml(body), productName));
    body = stripDuplicatePriceLines(body);
    body = dedupePlainText(body);
    return fixPromoPortuguese(body.trim());
}

/** Separa título, corpo e rodapé (preço + CTA) para não destruir HTML do rodapé. */
function splitPromoSections(html) {
    const s = String(html || '').trim();
    const titleRe = /^(\s*<b>[\s\S]*?<\/b>\s*\n*)/i;
    const tm = s.match(titleRe);
    const title = tm ? tm[1].trimEnd() : '';
    let rest = tm ? s.slice(tm[0].length).trimStart() : s;
    const footerRe = /(\n\n)(?=<s>|<b>\s*R\$|💰|<a\s+href)/i;
    const fm = rest.search(footerRe);
    if (fm >= 0) {
        return {
            title,
            body: rest.slice(0, fm).trim(),
            footer: rest.slice(fm).trim(),
        };
    }
    return { title, body: rest.trim(), footer: '' };
}

function polishPromoHtml(html, { productName } = {}) {
    const { sanitizeTelegramHtml } = require('./persuasiveProductCopy');
    let s = sanitizeTelegramHtml(String(html || ''));
    if (!s) return '';

    const { title, body, footer } = splitPromoSections(s);
    let polishedBody = body;
    if (polishedBody) {
        polishedBody = polishAiBody(stripHtml(polishedBody), productName);
        polishedBody = sanitizeTelegramHtml(polishedBody);
    }

    const parts = [];
    if (title) parts.push(title);
    if (polishedBody) parts.push(polishedBody);
    if (footer) parts.push(footer);
    s = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

    return repairTelegramHtml(sanitizeTelegramHtml(s));
}

function polishPromoPlain(text, { productName } = {}) {
    let s = dedupePlainText(String(text || '').trim());
    if (productName) s = stripRepeatedProductTitle(s, productName);
    s = stripDuplicatePriceLines(s);
    return dedupePlainText(s);
}

function htmlToPlainPromo(html, options = {}) {
    let s = String(html || '');
    s = s.replace(
        /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_m, href, inner) => {
            const label = stripHtml(inner).trim();
            if (!label) return href;
            if (label.includes(href)) return label;
            return `${label}\n${href}`;
        }
    );
    let plain = polishPromoPlain(stripHtml(s), { productName: options.productName });
    if (options.productId != null) {
        const { ensureProductBuyLink } = require('./waPromoLink');
        plain = ensureProductBuyLink(plain, options.productId, options.username, {
            maxLen: options.maxLen,
        });
    }
    return plain;
}

function isTelegramHtmlBalanced(html) {
    try {
        const fixed = repairTelegramHtml(String(html || ''));
        const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)/g;
        const stack = [];
        let m;
        while ((m = tagRe.exec(fixed)) !== null) {
            const closing = Boolean(m[1]);
            const tag = String(m[2] || '').toLowerCase();
            if (!TG_INLINE_TAGS.has(tag) && tag !== 'a') continue;
            if (closing) {
                if (!stack.length) return false;
                stack.pop();
            } else if (tag === 'a') {
                stack.push('a');
            } else {
                stack.push(tag);
            }
        }
        return stack.length === 0;
    } catch {
        return false;
    }
}

module.exports = {
    normalizeComparable,
    dedupePlainText,
    stripRepeatedProductTitle,
    stripDuplicatePriceLines,
    splitPromoSections,
    fixPromoPortuguese,
    polishAiBody,
    polishPromoHtml,
    polishPromoPlain,
    htmlToPlainPromo,
    repairTelegramHtml,
    isTelegramHtmlBalanced,
};
