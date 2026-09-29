'use strict';

const cfg = require('../config/divulgacao');

function minMembersThreshold() {
  return Math.max(0, Number(cfg.MIN_MEMBERS_IN_GROUP) || 50);
}

/** Grupo entrado manualmente ou grande o suficiente para não ser descartado automaticamente. */
function isProtectedGroup(group) {
  if (!group) return false;
  if (group.manualJoin) return true;
  const size = Number(group.size || 0);
  return size >= minMembersThreshold();
}

function shouldNotifyStatusBlocked(group) {
  if (!group) return false;
  if (group.manualJoin) return true;
  if (Number(group.size || 0) >= minMembersThreshold()) return true;
  return Boolean(group.statusBlockedReason);
}

module.exports = {
  minMembersThreshold,
  isProtectedGroup,
  shouldNotifyStatusBlocked,
};
