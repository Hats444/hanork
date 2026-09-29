'use strict';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Formata resposta de wa.post_now / wa.process_promo para Telegram (HTML). */
function formatPostNowReply(ack) {
  const r = ack?.result?.result || ack?.result || {};

  if (!ack?.ok) {
    if (r.message && String(r.message).includes('<b>')) {
      return String(r.message).trim();
    }
    const raw = r.message || ack.message || ack.error || 'Falha ao postar';
    if (raw === 'no_groups' || raw === 'Nenhum grupo elegível') {
      return (
        '<b>Nenhum grupo disponível</b>\n\n' +
        'Todos os grupos ativos estão bloqueados pelos filtros (membros, limite diário, anti-ban).\n\n' +
        '<code>/wa_grupos</code> · <code>/wa_limites</code> · <code>/wa_status</code>'
      );
    }
    return String(raw).trim();
  }

  if (r.promo && r.productName && (r.sent ?? 0) > 0) {
    return `Promo <b>${escapeHtml(r.productName)}</b>: <b>${r.sent}</b> envio(s)`;
  }

  if ((r.sent ?? 0) > 0) {
    const camp = r.campaign ? ` · campanha <code>${escapeHtml(r.campaign)}</code>` : '';
    return `Post enviado: <b>${r.sent}/${r.total ?? r.sent}</b>${camp}`;
  }

  if (r.message && String(r.message).includes('<b>')) {
    return String(r.message).trim();
  }

  if (r.promoTried?.productName) {
    return (
      `<i>Promo na fila (${escapeHtml(r.promoTried.productName)}) sem envio.</i>\n\n` +
      (r.message || 'Nenhum grupo liberado para status agora.')
    );
  }

  if (r.total > 0) {
    return (
      r.message ||
      `<b>Nenhum envio</b> em ${r.total} grupo(s).\n` +
        'Verifique filtros: membros mínimos, limite diário ou anti-ban.\n' +
        '<code>/wa_limites</code> · <code>/wa_grupos</code>'
    );
  }

  return 'Nenhum grupo disponível para postar agora.';
}

function formatProcessPromoReply(ack) {
  const r = ack?.result?.result || ack?.result || {};
  if (!ack?.ok) {
    const msg = r.message || ack.message || ack.error;
    if (msg === 'empty_queue' || msg === 'Fila promo vazia') {
      return 'Fila promo vazia. Nada para processar.';
    }
    return String(msg || 'Falha ao processar promo').trim();
  }
  if ((r.sent ?? 0) > 0) {
    return `Promo <b>${escapeHtml(r.productName || r.jobId || 'ok')}</b>: <b>${r.sent}</b> grupo(s)`;
  }
  if (r.noGroups || r.allSkipped) {
    return (
      `<b>Promo sem envio</b>${r.productName ? ` (${escapeHtml(r.productName)})` : ''}\n\n` +
      'Nenhum grupo liberado pelos filtros atuais.\n' +
      '<code>/wa_grupos</code> · <code>/wa_min</code> · <code>/wa_limites</code>'
    );
  }
  if (r.failed) {
    return `Promo falhou após várias tentativas${r.productName ? `: ${escapeHtml(r.productName)}` : ''}.`;
  }
  if (r.retry) {
    return `Promo reagendada${r.productName ? ` (${escapeHtml(r.productName)})` : ''} — tente mais tarde.`;
  }
  return 'Promo processada sem envio confirmado.';
}

module.exports = {
  formatPostNowReply,
  formatProcessPromoReply,
  escapeHtml,
};
