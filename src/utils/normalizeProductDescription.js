'use strict';

/**
 * Corrige descrições salvas com "\\n" literal (JSON/escape) em vez de quebra de linha real.
 */
function normalizeProductDescription(text) {
  let s = String(text || '');
  if (!s) return '';
  if (s.includes('\\n')) {
    s = s.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
  }
  return s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { normalizeProductDescription };
