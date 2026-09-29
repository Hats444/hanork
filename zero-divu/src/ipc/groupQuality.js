'use strict';

const cfg = require('../config/divulgacao');
const postGuard = require('./postGuard');

function minMembers() {
  return Math.max(0, Number(cfg.MIN_MEMBERS_IN_GROUP) || 50);
}

/** Grupo onde o bot pode divulgar (status) com as regras atuais */
exports.canDivulgeInGroup = (g) => {
  if (!g?.id) return false;
  if (g.pendingApproval || g.visitOnly) return false;
  if (g.groupType === 'chat') return false;
  const check = postGuard.canPostToGroup(g);
  return check.ok === true;
};

/** Heurística antes de entrar — convite precisa parecer grupo de divulgação */
exports.inviteLikelyAllowsDivulgacao = (invite = {}) => {
  if (invite.groupType === 'chat') return false;
  const size = Number(invite.size || 0);
  const min = minMembers();
  if (min > 0 && size > 0 && size < min) return false;
  return true;
};

exports.groupRankingScore = (g, liveSize) => {
  const size = Number(liveSize ?? g.size ?? 0);
  const base = Number(g.score ?? 50);
  const posts = Number(g.successPosts ?? g.postCount ?? 0);
  const divulge = exports.canDivulgeInGroup(g) ? 0 : -100000;
  // Membros pesam forte: grupo grande = bom, pequeno = ruim na fila de saída
  return size * 3 + base + posts * 2 + divulge;
};

exports.inviteRankingScore = (invite = {}) => {
  if (!exports.inviteLikelyAllowsDivulgacao(invite)) return -1;
  const size = Number(invite.size || 0);
  let s = size * 3;
  if (invite.announce === true) s += 15;
  if (invite.announce === false) s -= 8;
  return s;
};

/** Convite tem mais membros que o grupo atual (nunca troca por grupo menor ou igual) */
exports.inviteHasMoreMembersThan = (invite, groupRecord) => {
  const inviteSize = Number(invite?.size || 0);
  const groupSize = Number(groupRecord?.size || 0);
  if (groupSize <= 0 || inviteSize <= 0) return false;
  return inviteSize > groupSize;
};

/** Só substitui grupo onde já pode divulgar por convite com MAIS membros e score melhor */
exports.shouldVacateForInvite = (groupRecord, invite) => {
  if (!groupRecord?.id || !invite) return false;
  if (!exports.inviteLikelyAllowsDivulgacao(invite)) return false;
  if (!exports.canDivulgeInGroup(groupRecord)) return false;

  const inviteSize = Number(invite.size || 0);
  const groupSize = Number(groupRecord.size || 0);

  if (!exports.inviteHasMoreMembersThan(invite, groupRecord)) return false;

  const gain = Math.max(1, Number(cfg.GROUP_UPGRADE_MIN_MEMBER_GAIN) || 20);
  if (inviteSize < groupSize + gain) return false;

  const groupScore = exports.groupRankingScore(groupRecord, groupSize);
  const inviteScore = exports.inviteRankingScore(invite);
  const minDelta = Math.max(8, Number(cfg.GROUP_UPGRADE_MIN_SCORE_DELTA) || 12);
  return inviteScore > groupScore + minDelta;
};

module.exports = exports;
