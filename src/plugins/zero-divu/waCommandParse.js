'use strict';

/**
 * Extrai argumentos de comandos /wa_* — com ou sem @bot, via ctx.match ou texto bruto.
 */
function extractFromTelegrafMatch(ctx) {
  const payload = ctx?.payload;
  if (payload != null && String(payload).trim()) return String(payload).trim();

  const m = ctx?.match;
  if (m == null) return null;
  if (typeof m === 'string') {
    const s = m.trim();
    return s || null;
  }
  if (Array.isArray(m)) {
    for (let i = m.length - 1; i >= 0; i--) {
      const part = m[i];
      if (part != null && String(part).trim()) return String(part).trim();
    }
    return null;
  }
  if (typeof m === 'object' && m.groups?.payload != null) {
    const s = String(m.groups.payload).trim();
    return s || null;
  }
  return null;
}

function parseWaArgs(ctx, cmdName) {
  const fromMatch = extractFromTelegrafMatch(ctx);
  if (fromMatch !== null) return fromMatch;

  const text = String(ctx?.message?.text || '').trim();
  if (!text) return '';

  const escaped = String(cmdName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^/${escaped}(?:\\s*@[\\w_]+)?\\s*(.*)$`, 'is');
  const m = text.match(re);
  return (m?.[1] || '').trim();
}

function parseWaArgsParts(ctx, cmdName) {
  return parseWaArgs(ctx, cmdName).split(/\s+/).filter(Boolean);
}

/** /cancelar com ou sem @bot — fluxos wa_texto_set / wa_midia_add */
function isWaCancelCommand(ctx) {
  const text = String(ctx?.message?.text || '').trim();
  return /^\/cancelar(?:@[\w_]+)?$/i.test(text);
}

module.exports = { parseWaArgs, parseWaArgsParts, extractFromTelegrafMatch, isWaCancelCommand };
