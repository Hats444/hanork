'use strict';

const cfg = require('../config/divulgacao');
const groupProfile = require('./groupProfile');
const groupClassifier = require('./groupClassifier');
const groupReclassify = require('./groupReclassify');
const groupValidator = require('./groupValidator');
const groupCache = require('./groupCache');
const postagem = require('./postagem');
const monitor = require('./monitor');
const labels = require('../utils/groupLabels');
const safe = require('../utils/safe');
const { sleep } = require('../utils/sleep');
const { infoLog, successLog, warningLog, debugLog } = require('../utils/logger');
const blacklist = require('./blacklist');

const processing = new Set();

function wasChatVisited(jid) {
  const inv = groupValidator.loadInvalidGroups();
  const r = inv[jid]?.reason || '';
  return r.includes('chat normal') || r.includes('visita única');
}

function registerClassification(gid, profile, result, extra = {}) {
  groupValidator.registerGroup(gid, {
    ...extra,
    subject: profile.subject,
    desc: profile.desc ? profile.desc.slice(0, 500) : undefined,
    announce: profile.announce,
    size: profile.size || extra.size,
    groupType: result.groupType || result.type,
    postPermission: result.postPermission,
    classifyAction: result.action,
    classifyConfidence: result.confidence,
    classifyDivScore: result.divScore,
    classifyChatScore: result.chatScore,
    classifyReason: result.reason,
    classifyReasons: (result.reasons || []).slice(0, 14),
    classifyLayersSummary: result.layers
      ? {
          contentDiv: result.layers.content?.divScore,
          contentChat: result.layers.content?.chatScore,
          rulesBan: result.layers.rules?.banScore,
          rulesAllow: result.layers.rules?.allowScore,
          structureBoost: `${result.layers.structure?.divBoost || 0}/${result.layers.structure?.chatBoost || 0}`,
        }
      : undefined,
    classifyFingerprint: groupReclassify.profileFingerprint(profile),
    classifiedAt: new Date().toISOString(),
    lastReclassifiedAt: new Date().toISOString(),
    classifyPendingVerify: false,
    classifyPendingReason: null,
    classifyTrustLevel: result.trustLevel || null,
    classifyMetadataQuality: result.metadataQuality || null,
  });
}

/** Pode enviar status de boas-vindas ao entrar (após classificação) */
function canWelcomePost(result, hints = {}) {
  if (hints.pendingApproval) return { ok: false, reason: 'aguardando aprovação do admin' };
  if (!cfg.AUTO_POST_ON_JOIN || !cfg.USE_GROUP_STATUS) {
    return { ok: false, reason: 'post ao entrar desativado na config' };
  }
  if (!result || result.action === 'visit_once') {
    return { ok: false, reason: 'visita única — boas-vindas já tratadas' };
  }
  if (result.postPermission === 'denied') {
    return { ok: false, reason: 'divulgação proibida neste grupo' };
  }
  const eligible = groupClassifier.isEligibleForCycle({
    id: 'check',
    groupType: result.groupType || result.type,
    postPermission: result.postPermission,
    classifyAction: result.action,
    visitOnly: false,
    pendingApproval: false,
  });
  if (!eligible && result.groupType === 'divulgacao' && result.postPermission !== 'denied') {
    if (cfg.GROUP_CLASSIFY_INFER_DIV_FROM_SIGNALS !== false) {
      return { ok: true };
    }
  }
  if (!eligible) {
    return { ok: false, reason: 'grupo não elegível para ciclo de divulgação' };
  }
  return { ok: true };
}

async function tryWelcomePost(sock, gid, result, hints, name) {
  const gate = canWelcomePost(result, hints);
  if (!gate.ok) {
    if (!hints.pendingApproval) {
      debugLog(`Sem boas-vindas em ${labels.shortId(gid)}: ${gate.reason}`);
    }
    return false;
  }

  const postGuard = require('./postGuard');
  const respectLimits = cfg.JOIN_WELCOME_RESPECT_LIMITS !== false;
  const check = postGuard.canPostToGroup(gid, {
    allowGraceBypass: !respectLimits,
  });
  if (!check.ok) {
    infoLog(`Boas-vindas adiadas em ${name}: ${check.reason}`);
    return false;
  }

  const minD = cfg.JOIN_WELCOME_DELAY_MS_MIN ?? 0;
  const maxD = cfg.JOIN_WELCOME_DELAY_MS_MAX ?? minD;
  if (maxD > 0) {
    const span = Math.max(0, maxD - minD);
    const wait = minD + (span > 0 ? Math.floor(Math.random() * span) : 0);
    infoLog(`Boas-vindas em ${name} em ~${Math.round(wait / 1000)}s…`);
    await sleep(wait);
  }

  await safe.run(`Boas-vindas ${name}`, () => postagem.postOnJoin(sock, gid));
  return true;
}

exports.postOnceAndLeave = async (sock, gid, subject) => {
  const name = labels.displayName({ subject, id: gid });

  infoLog(`Chat detectado — visita única: ${name}`);

  await safe.run(`Status em ${name}`, () => postagem.postVisitOnce(sock, gid));

  await sleep(cfg.CHAT_GROUP_LEAVE_DELAY_MS || 10000);

  const left = await safe.runSilent(
    `Sair do grupo ${labels.shortId(gid)}`,
    async () => {
      await sock.groupLeave(gid);
      return true;
    },
    false
  );

  if (left) {
    require('./groupRegistryCleanup').onBotLeft(gid, 'chat normal — visita única', { subject: name });
    monitor.inc('groupsLeft');
    successLog(`Saída concluída: ${name}`);
  } else {
    warningLog(`Não foi possível sair de ${name} — marcado para não divulgar`);
    groupValidator.registerGroup(gid, { groupType: 'chat', visitOnly: true, leftPending: true });
  }
};

exports.handleNewGroup = async (sock, gid, hints = {}) => {
  if (!gid) return null;
  if (processing.has(gid)) {
    debugLog(`Onboarding já em andamento: ${labels.shortId(gid)}`);
    return { skipped: true, reason: 'em processamento' };
  }
  processing.add(gid);

  try {
    if (wasChatVisited(gid)) {
      infoLog(`Grupo já visitado: ${labels.shortId(gid)}`);
      return { type: 'chat', skipped: true };
    }

    if (!cfg.ENABLE_GROUP_CLASSIFIER) {
      groupValidator.registerGroup(gid, { groupType: 'divulgacao', postPermission: 'allowed', classifyAction: 'stay', ...hints });
      await tryWelcomePost(sock, gid, { groupType: 'divulgacao', postPermission: 'allowed', action: 'stay' }, hints, labels.displayName(hints, labels.shortId(gid)));
      return { type: 'divulgacao', skipped: true };
    }

    const profile = await groupProfile.collect(sock, gid, hints);
    const name = labels.displayName(profile, labels.shortId(gid));
    const contentBlock = require('./groupContentFilter').validateGroupJoin({
      title: profile.subject,
      description: profile.desc || profile.description,
      username: profile.id ? String(profile.id).split('@')[0] : '',
      channel: 'wa',
    });
    if (!contentBlock.allowed) {
      infoLog(`Conteúdo bloqueado (${contentBlock.reason}) — saindo: ${name}`);
      const groupBanGuard = require('./groupBanGuard');
      await groupBanGuard.safeLeaveGroup(sock, gid, contentBlock.reason, {
        bypassBanGuard: true,
        policyCheck: async () => true,
      });
      blacklist.blockGroup(gid);
      return { ...contentBlock, action: 'leave', reason: contentBlock.reason };
    }
    const result = groupClassifier.classify(profile);

    const minMembers = cfg.MIN_MEMBERS_IN_GROUP ?? 0;
    const size = Number(profile.size || hints.size || 0);
    const { isProtectedGroup } = require('../utils/manualJoinPolicy');
    if (minMembers > 0 && !isProtectedGroup({ ...hints, size, manualJoin: hints.manualJoin })) {
      const groupBanGuard = require('./groupBanGuard');
      const tooSmall = await groupBanGuard.confirmMemberCountBelow(sock, gid, minMembers, size);
      if (tooSmall) {
        infoLog(`Grupo pequeno (confirmado < ${minMembers}) — saindo: ${name}`);
        const out = await groupBanGuard.safeLeaveGroup(sock, gid, `poucos membros (${size})`, {
          bypassBanGuard: true,
          policyCheck: async () => true,
        });
        if (!out.left) {
          groupValidator.registerGroup(gid, { visitOnly: true, leftPending: true });
        }
        return { ...result, action: 'leave', reason: `poucos membros (${size})` };
      }
    }

    registerClassification(gid, profile, result, {
      ...hints,
      manualJoin: Boolean(hints.manualJoin),
      size: size || profile.size,
    });

    infoLog(
      `${labels.typeLabel(result.groupType || result.type)} (${result.confidence}) — ${name}`
    );
    infoLog(groupClassifier.formatVerdictLog(result));

    if (hints.pendingApproval) return result;

    if (result.action === 'visit_once') {
      await exports.postOnceAndLeave(sock, gid, profile.subject);
      return result;
    }

    if (
      result.action === 'stay_cautious' &&
      result.postPermission !== 'allowed' &&
      result.groupType !== 'divulgacao'
    ) {
      infoLog(`Grupo aguardando confirmação das regras: ${name} — ${result.reason}`);
      return result;
    }

    if (result.action === 'stay_cautious' && result.postPermission !== 'allowed') {
      infoLog(`Grupo de divulgação (cautela) — tentando status de entrada: ${name}`);
    } else if (result.action === 'stay_cautious') {
      successLog(`Grupo ativo (cautela): ${name} — ${result.reason}`);
    } else {
      successLog(`Grupo ativo para divulgação: ${name}`);
    }

    const welcomed = await tryWelcomePost(sock, gid, result, hints, name);
    if (welcomed) successLog(`Status de entrada enviado: ${name}`);

    return result;
  } finally {
    processing.delete(gid);
  }
};

exports.handleApproved = async (sock, gid) => {
  const active = groupValidator.loadActiveGroups()[gid] || {};
  groupValidator.registerGroup(gid, { pendingApproval: false });

  infoLog(`Aprovação recebida: ${labels.displayName(active, labels.shortId(gid))}`);

  return exports.handleNewGroup(sock, gid, {
    pendingApproval: false,
    approved: true,
    rejoined: true,
    subject: active.subject,
    desc: active.desc,
    inviteCode: active.inviteCode,
    size: active.size,
    manualJoin: Boolean(active.manualJoin),
  });
};

exports.reclassifyExisting = async (sock, gid, waGroup) => {
  return groupReclassify.reclassifyOne(sock, gid, waGroup || {}, { force: true });
};
