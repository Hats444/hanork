'use strict';

const INVITE_RE = /(?:https?:\/\/)?(?:chat\.)?whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]+)/gi;

exports.extractInviteCodes = (text) => {
  if (!text || typeof text !== 'string') return [];
  const codes = new Set();
  let m;
  INVITE_RE.lastIndex = 0;
  while ((m = INVITE_RE.exec(text)) !== null) {
    if (m[1]) codes.add(m[1]);
  }
  return [...codes];
};

exports.formatUptime = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m ${s % 60}s`;
};
