'use strict';

const cfg = require('../config/divulgacao');
const groupValidator = require('../services/groupValidator');
const postGuard = require('../services/postGuard');

function bucketReason(reason) {
  const r = String(reason || 'bloqueado').toLowerCase();
  if (r.includes('poucos membros')) return 'poucos membros';
  if (r.includes('limite') || r.includes('24h') || r.includes('diário')) return 'limite de posts';
  if (r.includes('anti-ban') || r.includes('cota horária') || r.includes('reputação')) return 'anti-ban / cota';
  if (r.includes('aprovação')) return 'aguardando aprovação';
  if (r.includes('chat') || r.includes('visita')) return 'grupo de chat';
  if (r.includes('status bloqueado') || r.includes('só-admins')) return 'status bloqueado';
  if (r.includes('classific')) return 'classificação';
  return reason || 'bloqueado';
}

function summarizeGroups(groups = []) {
  const list = Array.isArray(groups) ? groups.filter(Boolean) : [];
  const reasons = {};
  let eligible = 0;

  for (const g of list) {
    const check = postGuard.canPostToGroup(g);
    if (check.ok) {
      eligible += 1;
      continue;
    }
    const key = bucketReason(check.reason);
    reasons[key] = (reasons[key] || 0) + 1;
  }

  return {
    total: list.length,
    eligible,
    blocked: list.length - eligible,
    reasons,
    minMembers: cfg.MIN_MEMBERS_IN_GROUP ?? 0,
  };
}

function summarizeActive() {
  const active = groupValidator.listSortedByScore();
  return summarizeGroups(active);
}

function summarizeIds(groupIds = []) {
  const active = groupValidator.loadActiveGroups();
  const groups = groupIds.map((id) => active[id]).filter(Boolean);
  return summarizeGroups(groups);
}

function topReasonLines(reasons, limit = 4) {
  return Object.entries(reasons || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, n]) => `• ${n} ${reason}`);
}

function buildBlockedMessage(summary, { context = 'postar' } = {}) {
  const s = summary || summarizeActive();
  const lines = [
    `<b>Nenhum grupo disponível para ${context}</b>`,
    '',
    `${s.total} grupo(s) ativo(s) · <b>0</b> liberado(s) agora`,
  ];

  const reasonLines = topReasonLines(s.reasons);
  if (reasonLines.length) {
    lines.push('', '<b>Motivos:</b>', ...reasonLines);
  }

  if (s.minMembers > 0 && s.reasons['poucos membros']) {
    lines.push(
      '',
      `Mínimo configurado: <b>${s.minMembers}</b> membros.`,
      `Ajuste: <code>/wa_min ${Math.max(10, Math.min(30, s.minMembers))}</code> ou entre em grupos maiores.`
    );
  }

  try {
    if (require('../ipc/runtimeControls').isPostsPaused?.()) {
      lines.push('', '<i>Posts estão pausados no painel — use Ligar posts ou</i> <code>/wa_ligar</code>');
    }
  } catch {
    /* fora do worker */
  }

  lines.push('', '<code>/wa_grupos</code> · <code>/wa_limites</code> · <code>/wa_status</code>');
  return lines.join('\n');
}

function buildZeroSendMessage(summary, total = 0) {
  const s = summary || {};
  const lines = [
    `<b>Nenhum envio confirmado</b> (${total || s.total || 0} grupo(s) no ciclo)`,
  ];
  const reasonLines = topReasonLines(s.reasons);
  if (reasonLines.length) {
    lines.push('', '<b>Filtros aplicados:</b>', ...reasonLines);
  } else {
    lines.push('', 'Todos os grupos do ciclo foram pulados (anti-ban, limite diário ou membros).');
  }
  if (s.minMembers > 0 && s.reasons?.['poucos membros']) {
    lines.push('', `Mínimo de membros: <b>${s.minMembers}</b> · <code>/wa_min</code> para ajustar`);
  }
  return lines.join('\n');
}

module.exports = {
  bucketReason,
  summarizeGroups,
  summarizeActive,
  summarizeIds,
  buildBlockedMessage,
  buildZeroSendMessage,
};
