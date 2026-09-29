'use strict';

exports.shortId = (jid) => (jid ? String(jid).split('@')[0] : '—');

exports.displayName = (groupOrJid, fallback) => {
  if (!groupOrJid) return fallback || 'Grupo';
  if (typeof groupOrJid === 'string') return fallback || exports.shortId(groupOrJid);
  return groupOrJid.subject || fallback || exports.shortId(groupOrJid.id);
};

exports.typeLabel = (type) => {
  if (type === 'divulgacao') return 'Divulgação';
  if (type === 'chat') return 'Chat';
  if (type === 'mixed') return 'Misto';
  return 'Indefinido';
};

exports.permissionLabel = (perm) => {
  if (perm === 'allowed') return 'liberado';
  if (perm === 'denied') return 'proibido';
  return 'indefinido';
};
