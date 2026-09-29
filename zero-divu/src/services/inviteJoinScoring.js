'use strict';

const cfg = require('../config/divulgacao');

const DIV_KEYWORDS = [
  'divulga',
  'promo',
  'promoc',
  'link',
  'network',
  'parceir',
  'negoci',
  'vendas',
  'marketing',
  'anunc',
  'publicid',
  'afiliad',
  'compra',
  'venda',
];

const CHAT_KEYWORDS = ['amizade', 'bate-papo', 'convers', 'meme', 'zoeira', 'roleplay', 'only fans'];

function metaOf(jobOrInvite) {
  if (jobOrInvite?.payload) {
    return { ...(jobOrInvite.payload.meta || {}), ...(jobOrInvite.payload || {}) };
  }
  return jobOrInvite?.meta || jobOrInvite || {};
}

function scoreInviteCandidate(item) {
  const meta = metaOf(item);
  const subject = String(meta.subject || meta.groupName || meta.title || '').toLowerCase();
  const size = Number(meta.size || meta.inviteSize || meta.member_count || 0);
  const minMembers = cfg.MIN_MEMBERS_IN_GROUP ?? 50;

  let score = 0;

  if (size >= minMembers) score += Math.min(120, Math.floor(size / 10));
  else if (size > 0) score -= 40;
  else score -= 10;

  for (const kw of DIV_KEYWORDS) {
    if (subject.includes(kw)) score += 18;
  }
  for (const kw of CHAT_KEYWORDS) {
    if (subject.includes(kw)) score -= 25;
  }

  if (meta.native) score += 8;
  if (meta.from) score += 4;

  const attempts = Number(item.attempts || meta.failCount || 0);
  score -= attempts * 12;

  const at = item.createdAt || item.at || item.received_at;
  if (at) {
    const ageH = (Date.now() - new Date(at).getTime()) / 3600000;
    if (ageH >= 1 && ageH <= 72) score += 6;
    if (ageH < 0.25) score -= 8;
  }

  return score;
}

exports.scoreInviteCandidate = scoreInviteCandidate;

exports.sortJobsByQuality = (jobs) =>
  [...jobs].sort((a, b) => scoreInviteCandidate(b) - scoreInviteCandidate(a));

exports.pickBestPendingJob = (jobs) => {
  const now = Date.now();
  const eligible = jobs.filter(
    (j) =>
      j.status === 'pending' ||
      (j.status === 'retry' && j.nextRetryAt && new Date(j.nextRetryAt).getTime() <= now)
  );
  if (!eligible.length) return null;
  return exports.sortJobsByQuality(eligible)[0];
};
