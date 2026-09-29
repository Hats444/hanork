'use strict';

const { groupSlots, pvSlots } = require('../../config/campaignConfig');
const { DEFAULT_PRIMARY, DEFAULT_SECONDARY, isDualWaEnabled } = require('./waSessionsManifest');

function slotTypeToSession(campaignType) {
  return campaignType === 'smm' ? DEFAULT_SECONDARY : DEFAULT_PRIMARY;
}

function normalizeChannel(channel) {
  const ch = String(channel || 'telegram_group').toLowerCase();
  if (ch.includes('pv') || ch === 'private') return 'pv';
  return 'group';
}

function findSlot(hour, channel) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return null;
  const slots = normalizeChannel(channel) === 'pv' ? pvSlots() : groupSlots();
  return slots.find((s) => Number(s.hour) === h) || null;
}

function resolveSessionForSlot(hour, channel) {
  const slot = findSlot(hour, channel);
  if (slot) return slotTypeToSession(slot.type);
  const { campaignTypeNow } = require('../../services/campaign/campaignTimeWindows');
  return slotTypeToSession(campaignTypeNow());
}

function resolveSessionForCampaign({ hour, channel, smmBroadcast, productId } = {}) {
  if (!isDualWaEnabled()) return DEFAULT_PRIMARY;
  if (hour != null && channel) return resolveSessionForSlot(hour, channel);
  if (smmBroadcast) return DEFAULT_SECONDARY;
  if (productId) return DEFAULT_PRIMARY;
  return DEFAULT_PRIMARY;
}

module.exports = {
  resolveSessionForSlot,
  resolveSessionForCampaign,
  slotTypeToSession,
  findSlot,
};
