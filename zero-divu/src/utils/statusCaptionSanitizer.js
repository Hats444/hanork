'use strict';

const PRICE_LINE_RE =
  /^💰|^\*\*?\s*R\$\s*\d|^\s*R\$\s*\d|\bde\s+R\$\s*\d|\bpor\s+apenas\s+R\$/iu;

const BARE_PRICE_RE = /^\s*R\$\s*\d/u;
const CTA_LINE_RE =
  /^(🛒\s*)?(garanta agora|quero comprar|compre agora|comprar agora|abrir o bot)/iu;
const TG_LINK_RE = /https?:\/\/t\.me\/[^\s<>)]+/i;
const DELIVERY_LINE_RE =
  /entrega autom[aá]tica|pagamento confirmado|ap[oó]s confirma[cç][aã]o do pix|assim que o pagamento/iu;

function normalizeComparable(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function linesRoughlyEqual(a, b) {
  const x = normalizeComparable(a);
  const y = normalizeComparable(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 12 && y.length >= 12 && (x.includes(y) || y.includes(x))) return true;
  return false;
}

function dedupeLines(text) {
  const lines = String(text || '').split('\n');
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const key = line.trim().toLowerCase();
    if (!key) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function dedupeFuzzyParagraphs(text) {
  const paras = String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out = [];
  for (const para of paras) {
    if (out.some((prev) => linesRoughlyEqual(prev, para))) continue;
    out.push(para);
  }
  return out.join('\n\n');
}

function dedupeFuzzyLines(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let prev = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      prev = null;
      continue;
    }
    if (prev && linesRoughlyEqual(t, prev)) continue;
    out.push(line);
    prev = t;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Mantém apenas o último bloco de preço na legenda. */
function keepSinglePriceBlock(text) {
  const lines = String(text || '').split('\n');
  const priceIdx = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (PRICE_LINE_RE.test(t) || BARE_PRICE_RE.test(t)) priceIdx.push(i);
  });
  if (priceIdx.length <= 1) return lines.join('\n');

  const keep = priceIdx[priceIdx.length - 1];
  return lines
    .filter((line, i) => {
      const t = line.trim();
      return !(PRICE_LINE_RE.test(t) || BARE_PRICE_RE.test(t)) || i === keep;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Remove preço solto (R$ X) quando o CTA abaixo já traz valor ou link. */
function stripBarePriceBeforeCta(text) {
  const lines = String(text || '').split('\n');
  let ctaIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (CTA_LINE_RE.test(t) || (TG_LINK_RE.test(t) && /R\$/i.test(t))) {
      ctaIdx = i;
      break;
    }
  }
  if (ctaIdx <= 0) return lines.join('\n');

  const filtered = lines.filter((line, i) => {
    if (i >= ctaIdx) return true;
    const t = line.trim();
    if (BARE_PRICE_RE.test(t) && !PRICE_LINE_RE.test(t)) return false;
    if (PRICE_LINE_RE.test(t) && !/💰/u.test(t)) return false;
    return true;
  });
  return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Mantém um único bloco de CTA + link t.me (preserva "Garanta agora" + URL juntos). */
function keepSingleCtaBlock(text) {
  const lines = String(text || '').split('\n');
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!CTA_LINE_RE.test(t)) continue;
    let end = i;
    while (end + 1 < lines.length) {
      const n = lines[end + 1].trim();
      if (!n) break;
      if (TG_LINK_RE.test(n) || DELIVERY_LINE_RE.test(n) || /^✅/u.test(n)) {
        end++;
        continue;
      }
      break;
    }
    const slice = lines.slice(i, end + 1);
    blocks.push({
      start: i,
      end,
      hasLink: slice.some((l) => TG_LINK_RE.test(l.trim())),
    });
    i = end;
  }

  if (blocks.length <= 1) return lines.join('\n');

  const keep = [...blocks].reverse().find((b) => b.hasLink) || blocks[blocks.length - 1];

  return lines
    .filter((line, i) => {
      const t = line.trim();
      if (i >= keep.start && i <= keep.end) return true;
      if (CTA_LINE_RE.test(t)) return false;
      if (TG_LINK_RE.test(t)) return false;
      if (DELIVERY_LINE_RE.test(t)) return false;
      if (/^✅/u.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripUrgencyDuplicates(text) {
  let s = String(text || '');
  const phrases = [
    /🔥\s*preço de oferta relâmpago[^\n]*/giu,
    /🔥\s*oferta relâmpago ativa[^\n]*/giu,
    /⏳\s*estoque digital limitado[^\n]*/giu,
  ];
  for (const re of phrases) {
    const matches = s.match(re);
    if (matches && matches.length > 1) {
      let first = true;
      s = s.replace(re, (m) => {
        if (first) {
          first = false;
          return m;
        }
        return '';
      });
    }
  }
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function stripRepeatedDeliveryLines(text) {
  const lines = String(text || '').split('\n');
  let seen = false;
  return lines
    .filter((line) => {
      const t = line.trim();
      if (!DELIVERY_LINE_RE.test(t)) return true;
      if (seen) return false;
      seen = true;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripRepeatedProductTitle(text, productName) {
  const name = String(productName || '').trim();
  if (!name) return text;
  const nameNorm = normalizeComparable(name);
  const lines = String(text || '').split('\n');
  let seen = false;
  return lines
    .filter((line) => {
      const t = line.trim().replace(/^\*+|\*+$/g, '');
      const plain = normalizeComparable(t.replace(/^✨\s*/, ''));
      const isTitle =
        plain === nameNorm ||
        plain.startsWith(`${nameNorm} `) ||
        t === name ||
        t === `✨ ${name}` ||
        t.startsWith(`✨ ${name}`);
      if (!isTitle) return true;
      if (seen) return false;
      seen = true;
      return true;
    })
    .join('\n');
}

exports.sanitizeWaCaption = (text, options = {}) => {
  let s = String(text || '').trim();
  if (!s) return s;

  s = dedupeFuzzyParagraphs(s);
  s = dedupeFuzzyLines(s);
  s = dedupeLines(s);
  if (options.productName) s = stripRepeatedProductTitle(s, options.productName);
  s = keepSinglePriceBlock(s);
  s = stripBarePriceBeforeCta(s);
  s = stripUrgencyDuplicates(s);
  s = keepSingleCtaBlock(s);
  s = stripRepeatedDeliveryLines(s);
  if (options.productName) s = stripRepeatedProductTitle(s, options.productName);
  return dedupeFuzzyLines(dedupeLines(s));
};
