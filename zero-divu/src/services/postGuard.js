'use strict';

const cfg = require('../config/divulgacao');
const limits = require('./operationalLimits');
const groupValidator = require('./groupValidator');
const groupClassifier = require('./groupClassifier');
const logThrottle = require('../utils/logThrottle');
const { infoLog, skipLog } = require('../utils/logger');

function schedulerEnabled() {
  return cfg.DISTRIBUTED_SCHEDULER_ENABLED !== false;
}

function sliding24hEnabled() {
  return cfg.ENABLE_SLIDING_24H !== false;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function msSince(iso) {
  if (!iso) return Infinity;
  return Date.now() - new Date(iso).getTime();
}

/** Bloqueio por classificação (separado de anti-spam operacional) */
function getContentFilterBlockReason(group) {
  if (!group) return null;
  const block = require('./groupContentFilter').validateGroupJoin({
    title: group.subject,
    description: group.desc,
    username: group.id ? String(group.id).split('@')[0] : '',
    channel: 'wa',
  });
  if (!block.allowed) return `conteúdo bloqueado — ${block.reason}`;
  return null;
}

function getStatusBlockedReason(group) {
  const content = getContentFilterBlockReason(group);
  if (content) return content;
  if (!group) return null;
  if (group.statusBlockedReason) {
    return `status bloqueado — ${group.statusBlockedReason}`;
  }
  if (
    cfg.STATUS_BLOCK_ANNOUNCE_MEMBER !== false &&
    group.announce === true &&
    group.botIsAdmin === false
  ) {
    return 'só-admins — bot membro (status indisponível)';
  }
  return null;
}

function getClassifierBlockReason(group) {
  if (!cfg.ENABLE_GROUP_CLASSIFIER) return null;

  if (group.classifyPendingVerify) {
    return `regras não verificadas — ${group.classifyPendingReason || 'metadados indisponíveis'}`;
  }

  if (group.postPermission === 'denied') {
    const detail = group.classifyReason || 'regras ou perfil proíbem divulgação';
    return `divulgação proibida — ${detail}`;
  }

  if (group.classifyAction === 'visit_once') {
    return `visita única — ${group.classifyReason || 'não permanece para ciclo'}`;
  }

  if (group.postPermission === 'unknown' && cfg.GROUP_CLASSIFY_BLOCK_UNKNOWN !== false) {
    return `permissão indefinida — ${group.classifyReason || 'sem liberação explícita nas regras'}`;
  }

  if (group.groupType === 'chat') {
    if (cfg.GROUP_CLASSIFY_STRICT_CHAT !== false) {
      return `grupo de conversa — ${group.classifyReason || 'modo rigoroso'}`;
    }
    if (group.classifyAction !== 'stay_cautious') {
      return `grupo de conversa — ${group.classifyReason || 'propósito social'}`;
    }
  }

  if (group.groupType === 'mixed' && group.postPermission !== 'allowed') {
    return `grupo misto — ${group.classifyReason || 'sem liberação clara para divulgar'}`;
  }

  if (group.classifyAction === 'stay_cautious' && group.postPermission !== 'allowed') {
    return `cautela — ${group.classifyReason || 'aguardando confirmação das regras'}`;
  }

  if (
    group.groupType === 'unknown' &&
    group.postPermission !== 'allowed' &&
    cfg.GROUP_CLASSIFY_DEFAULT_OPEN === false
  ) {
    return `grupo não classificado — ${group.classifyReason || 'sem sinal claro de divulgação'}`;
  }

  return null;
}

async function liveVerifyGroup(sock, group) {
  if (!cfg.GROUP_CLASSIFY_LIVE_VERIFY || !sock || !group?.id) return group;

  const groupProfile = require('./groupProfile');
  if (!groupProfile.isSocketOnline(sock)) return group;

  const maxAge = cfg.GROUP_CLASSIFY_LIVE_VERIFY_MAX_AGE_MS ?? 6 * 60 * 60 * 1000;
  const last = group.classifyLastLiveVerifyAt
    ? new Date(group.classifyLastLiveVerifyAt).getTime()
    : 0;
  const needsVerify =
    group.classifyPendingVerify ||
    group.postPermission === 'unknown' ||
    group.classifyAction === 'stay_cautious' ||
    !last ||
    Date.now() - last > maxAge;

  if (!needsVerify) return group;

  try {
    const groupClassifier = require('./groupClassifier');
    const profile = await groupProfile.collect(sock, group.id, group, {
      forceFetch:
        (group.classifyPendingVerify || group.postPermission === 'unknown') &&
        !groupProfile.hasUsableDescription({}, group),
    });

    const hasCache = groupProfile.hasUsableDescription(profile, group);

    if (!profile.metadataFetched && profile.metadataError) {
      if (hasCache) {
        const result = groupClassifier.classify(profile);
        groupValidator.registerGroup(group.id, {
          subject: profile.subject || group.subject,
          desc: profile.desc ? String(profile.desc).slice(0, 500) : group.desc,
          announce: profile.announce ?? group.announce,
          size: profile.size || group.size,
          groupType: result.groupType || result.type,
          postPermission: result.postPermission,
          classifyAction: result.action,
          classifyConfidence: result.confidence,
          classifyDivScore: result.divScore,
          classifyChatScore: result.chatScore,
          classifyReason: result.reason,
          classifyReasons: (result.reasons || []).slice(0, 14),
          classifyTrustLevel: result.trustLevel,
          classifyMetadataQuality: result.metadataQuality,
          classifyPendingVerify: false,
          classifyPendingReason: null,
          classifyLastLiveVerifyAt: new Date().toISOString(),
          classifiedAt: new Date().toISOString(),
        });
        return groupValidator.loadActiveGroups()[group.id] || group;
      }

      groupValidator.registerGroup(group.id, {
        classifyPendingVerify: true,
        classifyPendingReason: profile.metadataError,
      });
      return groupValidator.loadActiveGroups()[group.id] || group;
    }

    const result = groupClassifier.classify(profile);
    groupValidator.registerGroup(group.id, {
      subject: profile.subject,
      desc: profile.desc ? String(profile.desc).slice(0, 500) : group.desc,
      announce: profile.announce,
      size: profile.size,
      groupType: result.groupType || result.type,
      postPermission: result.postPermission,
      classifyAction: result.action,
      classifyConfidence: result.confidence,
      classifyDivScore: result.divScore,
      classifyChatScore: result.chatScore,
      classifyReason: result.reason,
      classifyReasons: (result.reasons || []).slice(0, 14),
      classifyTrustLevel: result.trustLevel,
      classifyMetadataQuality: result.metadataQuality,
      classifyPendingVerify: false,
      classifyPendingReason: null,
      classifyLastLiveVerifyAt: new Date().toISOString(),
      classifiedAt: new Date().toISOString(),
    });

    return groupValidator.loadActiveGroups()[group.id] || group;
  } catch {
    return group;
  }
}

function getGraceSkipReason(group) {
  const grace = cfg.JOIN_GRACE_PERIOD_MS ?? 0;
  if (grace <= 0) return null;
  if (!group.joinedAt) return null;
  const sinceJoin = msSince(group.joinedAt);
  if (sinceJoin >= grace) return null;
  const minLeft = Math.ceil((grace - sinceJoin) / 60000);
  return `grupo novo (aguardar ~${minLeft} min após entrada)`;
}

function prunePostHistory(history, windowMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - windowMs;
  return (history || []).filter((iso) => new Date(iso).getTime() >= cutoff);
}

function postsInSlidingWindow(group) {
  const max24 =
    cfg.GROUP_MAX_STATUS_PER_24H ??
    cfg.MAX_POSTS_PER_GROUP_PER_24H ??
    cfg.MAX_POSTS_PER_GROUP_PER_DAY ??
    2;
  const hist = prunePostHistory(group.postHistory || []);
  return { count: hist.length, max: max24 };
}

/** Só olha último post real — não o slot nextPostAt do scheduler */
function getRecencySkipReasonByLastPost(group) {
  const minInterval = cfg.MIN_GROUP_POST_INTERVAL_MS ?? 12 * 60 * 60 * 1000;
  if (!group.lastPostAt) return null;
  const sincePost = msSince(group.lastPostAt);
  if (sincePost < minInterval) {
    const minLeft = Math.ceil((minInterval - sincePost) / 60000);
    return `post recente (aguardar ~${minLeft} min)`;
  }
  return null;
}

function getRecencySkipReason(group, { forStartup = false } = {}) {
  const strictStartup = forStartup && cfg.STARTUP_CATCHUP_STRICT_LIMITS !== false;
  if (
    forStartup &&
    !strictStartup &&
    cfg.STARTUP_CATCHUP_IGNORE_SCHEDULER_SLOT !== false
  ) {
    return getRecencySkipReasonByLastPost(group);
  }

  if (schedulerEnabled()) {
    const groupScheduler = require('./groupScheduler');
    const reason = groupScheduler.getSkipReason(group.id, group);
    if (reason) return reason;
  }

  return getRecencySkipReasonByLastPost(group);
}

exports.isRecentPost = (group) => Boolean(getRecencySkipReason(group));

exports.getRecencyInfo = (group) => {
  const minInterval = cfg.MIN_GROUP_POST_INTERVAL_MS ?? 12 * 60 * 60 * 1000;
  const sincePost = msSince(group.lastPostAt);
  if (!group?.lastPostAt) {
    return { recent: false, neverPosted: true, minutesLeft: 0, hoursSincePost: null };
  }
  const recent = sincePost < minInterval;
  return {
    recent,
    neverPosted: false,
    minutesLeft: recent ? Math.ceil((minInterval - sincePost) / 60000) : 0,
    hoursSincePost: Math.round(sincePost / 3600000),
  };
};

function getOperationalSkipReason(group, { ignoreGrace = false, ignoreRecency = false } = {}) {
  const minScore = cfg.MIN_GROUP_SCORE ?? 40;
  if ((group.score ?? 100) < minScore) {
    return `score operacional baixo (${group.score ?? 0})`;
  }

  const errThreshold = cfg.GROUP_ERROR_PAUSE_THRESHOLD ?? 3;
  if ((group.errors || 0) >= errThreshold) {
    const cooldown = cfg.GROUP_ERROR_COOLDOWN_MS ?? 24 * 60 * 60 * 1000;
    const sinceFail = msSince(group.lastFailAt);
    if (sinceFail < cooldown) {
      return `muitas falhas (${group.errors})`;
    }
  }

  if (!ignoreRecency) {
    try {
      const statusDailyControl = require('./statusDailyControl');
      statusDailyControl.syncFromGroup(group);
      const daily = statusDailyControl.checkGroupLimits(group.id);
      if (!daily.ok) return daily.reason;
    } catch {
      const recency = getRecencySkipReason(group);
      if (recency) return recency;

      const hardMax24 =
        cfg.GROUP_MAX_STATUS_PER_24H ??
        cfg.MAX_POSTS_PER_GROUP_PER_24H ??
        cfg.MAX_POSTS_PER_GROUP_PER_DAY ??
        2;
      const { count: n24 } = postsInSlidingWindow(group);
      if (n24 >= hardMax24) {
        return `limite ${hardMax24} status/24h por grupo`;
      }

      if (!schedulerEnabled() && sliding24hEnabled()) {
        const { count, max } = postsInSlidingWindow(group);
        if (count >= max) {
          return `limite ${max}/24h (janela deslizante)`;
        }
      } else {
        const maxPerDay = cfg.MAX_POSTS_PER_GROUP_PER_DAY ?? 2;
        const day = todayKey();
        if (group.postDay === day && (group.postsToday || 0) >= maxPerDay) {
          return `limite diário (${maxPerDay}/dia)`;
        }
      }
    }
  }

  if (schedulerEnabled()) {
    const groupReputation = require('./groupReputation');
    if (groupReputation.shouldDeprioritize(group.id)) {
      return 'reputação baixa — pausa temporária';
    }
  }

  if (!ignoreGrace) {
    const graceReason = getGraceSkipReason(group);
    if (graceReason) return graceReason;
  }

  const minMembers = cfg.MIN_MEMBERS_IN_GROUP ?? 0;
  if (minMembers > 0 && (group.size || 0) < minMembers) {
    return `poucos membros (${group.size || 0})`;
  }

  return null;
}

function getSkipReason(group, opts = {}) {
  if (!group?.id) return 'grupo inválido';

  if (cfg.SKIP_PENDING_APPROVAL !== false && group.pendingApproval) {
    return 'aguardando aprovação do admin';
  }

  if (group.visitOnly || group.leftPending) {
    return 'grupo de chat (visita única concluída ou pendente)';
  }

  const statusBlocked = getStatusBlockedReason(group);
  if (statusBlocked) return statusBlocked;

  const classReason = getClassifierBlockReason(group);
  if (classReason) return classReason;

  const opsReason = getOperationalSkipReason(group, opts);
  if (opsReason) return opsReason;

  return null;
}

exports.canPostToGroup = (groupOrJid, { allowGraceBypass = false } = {}) => {
  const group =
    typeof groupOrJid === 'string'
      ? groupValidator.loadActiveGroups()[groupOrJid]
      : groupOrJid;

  if (!group?.id) return { ok: false, reason: 'grupo não registrado' };

  const reason = getSkipReason(group, { ignoreGrace: allowGraceBypass });
  return reason ? { ok: false, reason } : { ok: true };
};

/** Marca grupos só-admins (bot membro) antes do scheduler — evita falhas repetidas no boot */
exports.markAnnounceOnlyBlocked = async (sock) => {
  if (cfg.STATUS_BLOCK_ANNOUNCE_MEMBER === false || !sock) return 0;
  const groupRole = require('../utils/groupRole');
  let marked = 0;

  for (const [jid, g] of Object.entries(groupValidator.loadActiveGroups())) {
    if (g.statusBlockedReason || g.postPermission === 'denied') continue;
    if (g.pendingApproval || g.visitOnly) continue;

    const role = await groupRole.getBotRole(sock, jid);
    if (groupRole.isAnnounceOnlyMember(role)) {
      groupValidator.registerGroup(jid, {
        announce: true,
        botIsAdmin: false,
        postPermission: 'denied',
        statusBlockedReason: 'só-admins (membro)',
      });
      marked++;
    } else if (role.isAdmin === true) {
      groupValidator.registerGroup(jid, {
        botIsAdmin: true,
        announce: role.announce ?? g.announce,
      });
    }
  }

  if (marked > 0 && logThrottle.shouldLog('announce-blocked-boot', 60000)) {
    infoLog(`${marked} grupo(s) só-admins marcado(s) — status desativado até promover o bot`);
  }
  return marked;
};

/** Limpa bloqueio falso por forbidden quando há descrição em cache */
exports.healForbiddenPending = () => {
  if (!cfg.ENABLE_GROUP_CLASSIFIER) return 0;
  const groupProfile = require('./groupProfile');
  const groupBanGuard = require('./groupBanGuard');
  let healed = 0;
  let deferred = 0;

  for (const [jid, g] of Object.entries(groupValidator.loadActiveGroups())) {
    if (!g.classifyPendingVerify) continue;
    const reason = String(g.classifyPendingReason || '');
    if (!/forbidden|403|not-authorized/i.test(reason)) continue;
    if (groupBanGuard.isRateOrTransient(reason)) {
      groupValidator.registerGroup(jid, {
        classifyPendingVerify: true,
        classifyPendingReason: 'metadados indisponíveis (rate limit)',
      });
      deferred++;
      continue;
    }

    if (!groupProfile.hasUsableDescription({}, g)) {
      groupValidator.registerGroup(jid, {
        classifyPendingVerify: true,
        classifyPendingReason: 'aguardando metadados (sem ban)',
      });
      deferred++;
      continue;
    }

    groupValidator.registerGroup(jid, {
      classifyPendingVerify: false,
      classifyPendingReason: null,
    });
    healed++;
  }

  if (deferred && logThrottle.shouldLog('heal-forbidden-defer', 10 * 60 * 1000)) {
    infoLog(`${deferred} grupo(s) aguardando metadados — sem marcar ban`);
  }
  if (healed && logThrottle.shouldLog('heal-forbidden-cache')) {
    infoLog(`${healed} grupo(s) liberado(s) — regras em cache (WhatsApp negou leitura ao vivo)`);
  }
  return healed + deferred;
};

/** Verifica regras ao vivo (descrição WhatsApp) antes de enviar status */
exports.canPostToGroupLive = async (sock, groupOrJid, opts = {}) => {
  let group =
    typeof groupOrJid === 'string'
      ? groupValidator.loadActiveGroups()[groupOrJid]
      : groupOrJid;

  if (!group?.id) return { ok: false, reason: 'grupo não registrado' };

  if (sock && cfg.BLOCK_POST_IF_NOT_IN_WA !== false) {
    const groupMembership = require('./groupMembership');
    const groupCache = require('./groupCache');
    if (
      groupMembership.participatingGroupCount() > 0 &&
      !groupMembership.isInParticipatingMap(group.id)
    ) {
      const live = await groupCache.confirmMembershipLive(sock, group.id);
      if (live === false) {
        require('./groupRegistryCleanup').onConfirmedAbsent(
          group.id,
          'tentativa de post em grupo fantasma'
        );
        return { ok: false, reason: 'bot não está neste grupo' };
      }
      if (live === null) {
        return { ok: false, reason: 'grupo fora da lista WA — aguardando confirmação' };
      }
    }
  }

  if (cfg.ENABLE_GROUP_CLASSIFIER && cfg.GROUP_CLASSIFY_LIVE_VERIFY !== false && sock) {
    group = await liveVerifyGroup(sock, group);
  }

  return exports.canPostToGroup(group, opts);
};

function listDivulgacaoCandidates() {
  const groupClassifier = require('./groupClassifier');
  const groupMembership = require('./groupMembership');
  return groupMembership
    .filterInWhatsApp(
      groupValidator
        .listSortedByScore()
        .filter((g) => !cfg.ENABLE_GROUP_CLASSIFIER || groupClassifier.isEligibleForCycle(g))
    );
}

function shouldBypassGraceForStartup(group, forStartup) {
  if (!forStartup) return false;
  if (cfg.STARTUP_CATCHUP_BYPASS_GRACE === false) return false;
  if (cfg.STARTUP_CATCHUP_BYPASS_ALL_GRACE === true) return true;
  return !group.lastPostAt;
}

/** Separa grupos: pode postar agora / post recente / carência / bloqueado */
exports.analyzeDivulgacaoGroups = (opts = {}) => {
  const forStartup = opts.forStartup === true;
  const due = [];
  const recent = [];
  const grace = [];
  const blocked = [];

  for (const g of listDivulgacaoCandidates()) {
    if (cfg.SKIP_PENDING_APPROVAL !== false && g.pendingApproval) {
      blocked.push({ id: g.id, group: g, reason: 'aguardando aprovação' });
      continue;
    }
    if (g.visitOnly || g.leftPending) {
      blocked.push({ id: g.id, group: g, reason: 'visita única' });
      continue;
    }

    const statusBlocked = getStatusBlockedReason(g);
    if (statusBlocked) {
      blocked.push({ id: g.id, group: g, reason: statusBlocked });
      continue;
    }

    const classReason = getClassifierBlockReason(g);
    if (classReason) {
      blocked.push({ id: g.id, group: g, reason: classReason });
      continue;
    }

    const recency = getRecencySkipReason(g, { forStartup });
    if (recency) {
      const info = exports.getRecencyInfo(g);
      recent.push({
        id: g.id,
        group: g,
        reason: recency,
        minutesLeft: info.minutesLeft,
        hoursSincePost: info.hoursSincePost,
      });
      continue;
    }

    const bypassGrace = shouldBypassGraceForStartup(g, forStartup);
    const graceReason = bypassGrace ? null : getGraceSkipReason(g);
    if (graceReason) {
      const minLeft = Math.ceil(
        ((cfg.JOIN_GRACE_PERIOD_MS || 0) - msSince(g.joinedAt)) / 60000
      );
      grace.push({ id: g.id, group: g, reason: graceReason, minutesLeft: minLeft });
      continue;
    }

    const opsReason = getOperationalSkipReason(g, {
      ignoreRecency: true,
      ignoreGrace: bypassGrace,
    });
    if (opsReason) {
      blocked.push({ id: g.id, group: g, reason: opsReason });
      continue;
    }

    const info = exports.getRecencyInfo(g);
    due.push({
      ...g,
      neverPosted: info.neverPosted,
      hoursSincePost: info.hoursSincePost,
    });
  }

  due.sort((a, b) => {
    if (!a.lastPostAt && b.lastPostAt) return -1;
    if (a.lastPostAt && !b.lastPostAt) return 1;
    if (a.lastPostAt && b.lastPostAt) {
      return msSince(b.lastPostAt) - msSince(a.lastPostAt);
    }
    return (b.score || 0) - (a.score || 0);
  });

  return { due, recent, grace, blocked };
};

exports.filterEligibleGroups = (groups, { applyCycleCap = true } = {}) => {
  const eligible = [];
  const skipped = [];

  for (const g of groups) {
    const check = exports.canPostToGroup(g);
    if (check.ok) eligible.push(g);
    else {
      skipped.push({ id: g.id, reason: check.reason, group: g });
      if (logThrottle.shouldLog(`skip-${g.id}`, 30 * 60 * 1000)) {
        let rep;
        try {
          rep = require('./groupReputation').get(g.id).trustScore;
        } catch {
          rep = undefined;
        }
        skipLog(g.id, check.reason, { group: g, trustScore: rep, queue: 'delivery' });
      }
    }
  }

  if (skipped.length && logThrottle.shouldLog('anti-spam-skip', 10 * 60 * 1000)) {
    const sample = skipped.slice(0, 5).map((s) => `${s.id.split('@')[0]}: ${s.reason}`);
    infoLog(
      `Filtro de ciclo: ${skipped.length} pulado(s)${skipped.length > 5 ? ' (amostra)' : ''}: ${sample.join('; ')}`
    );
  }

  let ids = eligible.map((g) => g.id);
  const maxCycle = applyCycleCap ? limits.getMaxGroupsPerCycle() : 0;
  if (maxCycle > 0 && ids.length > maxCycle) {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    ids = ids.slice(0, maxCycle);
    infoLog(`Anti-spam: ciclo limitado a ${maxCycle}/${eligible.length} grupo(s)`);
  }

  return ids;
};

exports.filterEligibleIds = (groupIds) => {
  const active = groupValidator.loadActiveGroups();
  const groups = groupIds.map((id) => active[id] || { id }).filter((g) => g.id);
  return exports.filterEligibleGroups(groups);
};

module.exports = exports;
