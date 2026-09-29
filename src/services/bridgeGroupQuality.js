'use strict';

/**
 * Ranking / upgrade do pool ponte Telegram — mesma ideia do Zero Divu (groupQuality + groupMemberPolicy).
 */

const MIN_MEMBERS = Math.max(0, parseInt(process.env.BRIDGE_PROMO_MIN_MEMBERS || '150', 10));
const ENABLE_UPGRADE = process.env.BRIDGE_ENABLE_GROUP_UPGRADE !== '0';
const UPGRADE_MIN_GAIN = Math.max(
  5,
  parseInt(process.env.BRIDGE_GROUP_UPGRADE_MIN_MEMBER_GAIN || '20', 10)
);
const UPGRADE_MIN_SCORE_DELTA = Math.max(
  8,
  parseInt(process.env.BRIDGE_GROUP_UPGRADE_MIN_SCORE_DELTA || '12', 10)
);

function minMembers() {
  return MIN_MEMBERS;
}

/** Grupo onde a ponte ainda pode divulgar */
function canPromoteInBridgeGroup(g) {
  if (!g?.chat_id && !g?.id) return false;
  if (g.active === 0 || g.active === false) return false;
  if (g.promo_via_bridge !== 1 && g.promo_via_bridge !== '1') return false;
  if (g.broadcast_enabled === 0 || g.broadcast_enabled === false) return false;
  if (g.type === 'channel') return false;
  return true;
}

function groupRankingScore(g, liveSize) {
  const size = Number(liveSize ?? g.member_count ?? g.size ?? 0);
  const posts = Number(g.bridge_promo_sent ?? g.promo_sent ?? 0);
  const divulge = canPromoteInBridgeGroup(g) ? 0 : -100000;
  return size * 3 + posts * 2 + divulge;
}

function inviteLikelyWorthJoining(invite = {}) {
  const size = Number(invite.size || invite.participantsCount || 0);
  const min = minMembers();
  if (min > 0 && size > 0 && size < min) return false;
  return true;
}

function inviteRankingScore(invite = {}) {
  if (!inviteLikelyWorthJoining(invite)) return -1;
  const size = Number(invite.size || invite.participantsCount || 0);
  return size * 3;
}

function inviteHasMoreMembersThan(invite, groupRecord) {
  const inviteSize = Number(invite?.size || invite?.participantsCount || 0);
  const groupSize = Number(groupRecord?.member_count ?? groupRecord?.size ?? 0);
  if (groupSize <= 0 || inviteSize <= 0) return false;
  return inviteSize > groupSize;
}

function shouldVacateForInvite(groupRecord, invite) {
  if (!ENABLE_UPGRADE) return false;
  if (!groupRecord || !invite) return false;
  if (!inviteLikelyWorthJoining(invite)) return false;
  if (!canPromoteInBridgeGroup(groupRecord)) return false;

  const inviteSize = Number(invite.size || invite.participantsCount || 0);
  const groupSize = Number(groupRecord.member_count ?? groupRecord.size ?? 0);

  if (!inviteHasMoreMembersThan(invite, groupRecord)) return false;

  const gain = UPGRADE_MIN_GAIN;
  if (inviteSize < groupSize + gain) return false;

  const groupScore = groupRankingScore(groupRecord, groupSize);
  const inviteScore = inviteRankingScore(invite);
  return inviteScore > groupScore + UPGRADE_MIN_SCORE_DELTA;
}

function compareWeakest(a, b) {
  const sa = Number(a.member_count ?? a.size ?? 0);
  const sb = Number(b.member_count ?? b.size ?? 0);
  if (sa !== sb) return sa - sb;
  return (a._ranking ?? 0) - (b._ranking ?? 0);
}

/** Menor grupo elegível (candidato a saída só com upgrade melhor). */
function pickSmallestBridgeGroup(groups = []) {
  const candidates = [];
  for (const g of groups) {
    if (!canPromoteInBridgeGroup(g)) continue;
    const mem = Number(g.member_count ?? 0);
    if (mem <= 0) continue;
    candidates.push({
      ...g,
      id: g.chat_id,
      size: mem,
      _ranking: groupRankingScore(g, mem),
    });
  }
  if (!candidates.length) return null;
  candidates.sort(compareWeakest);
  return candidates[0];
}

/** Ordena do pior ao melhor (para cap / eviction). */
function sortGroupsWeakestFirst(groups = []) {
  return [...groups]
    .filter((g) => canPromoteInBridgeGroup(g))
    .map((g) => {
      const mem = Number(g.member_count ?? 0);
      return { ...g, id: g.chat_id, size: mem, _ranking: groupRankingScore(g, mem) };
    })
    .sort(compareWeakest);
}

module.exports = {
  minMembers,
  ENABLE_UPGRADE,
  UPGRADE_MIN_GAIN,
  UPGRADE_MIN_SCORE_DELTA,
  canPromoteInBridgeGroup,
  groupRankingScore,
  inviteLikelyWorthJoining,
  inviteRankingScore,
  inviteHasMoreMembersThan,
  shouldVacateForInvite,
  pickSmallestBridgeGroup,
  sortGroupsWeakestFirst,
};
