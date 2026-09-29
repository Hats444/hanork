'use strict';

const { prisma } = require('../../config/database-sqlite');

function insert(row) {
  try {
    prisma.waAdminAudit.insert(row);
  } catch {
    /* não bloquear IPC */
  }
}

function recent(limit = 30) {
  try {
    return prisma.waAdminAudit.recent(limit);
  } catch {
    return [];
  }
}

function formatAuditLines(rows) {
  if (!rows?.length) return 'Nenhum registro de auditoria WA.';
  return rows
    .slice(0, 25)
    .map((r) => {
      const ok = r.ok ? '' : '';
      const at = r.created_at || '';
      const err = r.error ? ` · ${r.error}` : '';
      return `${ok} <code>${r.command}</code> · ${at}${err}`;
    })
    .join('\n');
}

module.exports = { insert, recent, formatAuditLines };
