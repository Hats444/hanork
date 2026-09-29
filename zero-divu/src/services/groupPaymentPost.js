'use strict';

const { jidNormalizedUser } = require('@kurtucoben/baileys/lib/WABinary');
const { sameJid } = require('../utils/groupRole');
const { warningLog } = require('../utils/logger');

function participantJid(participant) {
  if (!participant) return null;
  const raw =
    typeof participant === 'string'
      ? participant
      : participant.id || participant.jid || participant.phoneNumber || null;
  if (!raw || typeof raw !== 'string') return null;
  try {
    return jidNormalizedUser(raw);
  } catch {
    return raw.includes('@') ? raw : null;
  }
}

function isGroupAdmin(participant) {
  const role = participant?.admin;
  return role === 'admin' || role === 'superadmin' || role === true;
}

async function resolveGroupMentionJids(sock, groupId, cache = null) {
  const key = String(groupId);
  if (cache && cache.has(key)) return cache.get(key);

  let jids = [];
  try {
    if (typeof sock?.groupMetadata === 'function') {
      const meta = await sock.groupMetadata(groupId);
      const me = sock?.user?.id;
      jids = (meta?.participants || [])
        .filter((p) => !isGroupAdmin(p))
        .map(participantJid)
        .filter(Boolean);
      if (me) {
        jids = jids.filter((jid) => !sameJid(jid, me));
      }
      jids = [...new Set(jids)];
    }
  } catch (e) {
    warningLog(`Menções invisíveis falharam (${key}): ${e?.message || e}`);
  }

  if (cache) cache.set(key, jids);
  return jids;
}

function buildPaymentPayload(text, mentionedJid = []) {
  const note = String(text || '').trim();
  const extendedTextMessage = { text: note };
  const mentions = Array.isArray(mentionedJid) ? mentionedJid.filter(Boolean) : [];
  if (mentions.length) {
    extendedTextMessage.contextInfo = {
      mentionedJid: mentions,
      forwardingScore: 999,
      isForwarded: true,
    };
  }
  return {
    requestPaymentMessage: {
      currencyCodeIso4217: 'BRL',
      amount1000: '0',
      noteMessage: {
        extendedTextMessage,
      },
      expiryTimestamp: '0',
      amount: {
        value: '0',
        offset: 0,
        currencyCode: 'BRL',
      },
    },
  };
}

async function sendPayment(sock, groupId, text, mentionCache = null) {
  if (typeof sock.relayMessage !== 'function') {
    throw new Error('relayMessage indisponível — atualize o worker WhatsApp');
  }
  const mentionedJid = await resolveGroupMentionJids(sock, groupId, mentionCache);
  await sock.relayMessage(groupId, buildPaymentPayload(text, mentionedJid), {});
}

function buildMentionTextPayload(text, mentionedJid = []) {
  const note = String(text || '').trim();
  const extendedTextMessage = { text: note };
  const mentions = Array.isArray(mentionedJid) ? mentionedJid.filter(Boolean) : [];
  if (mentions.length) {
    extendedTextMessage.contextInfo = { mentionedJid: mentions };
  }
  return { extendedTextMessage };
}

async function sendMentionText(sock, groupId, text, mentionCache = null) {
  if (typeof sock.relayMessage !== 'function') {
    throw new Error('relayMessage indisponível — atualize o worker WhatsApp');
  }
  const mentionedJid = await resolveGroupMentionJids(sock, groupId, mentionCache);
  await sock.relayMessage(groupId, buildMentionTextPayload(text, mentionedJid), {});
}

function autoPromoWithPaymentEnabled() {
  const env = String(process.env.HANORK_PROMO_WITH_PAYMENT ?? '1').trim().toLowerCase();
  return env !== '0' && env !== 'false' && env !== 'off';
}

module.exports = {
  resolveGroupMentionJids,
  buildPaymentPayload,
  sendPayment,
  sendMentionText,
  autoPromoWithPaymentEnabled,
};
