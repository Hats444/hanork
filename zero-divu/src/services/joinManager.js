'use strict';

const cfg = require('../config/divulgacao');
const limits = require('./operationalLimits');
const antiBan = require('./antiBan');
const blacklist = require('./blacklist');
const groupValidator = require('./groupValidator');
const groupCache = require('./groupCache');
const grupos = require('./grupos');
const groupOnboarding = require('./groupOnboarding');
const monitor = require('./monitor');
const activeHours = require('../utils/activeHours');
const { sleep } = require('../utils/sleep');
const logThrottle = require('../utils/logThrottle');
const pendingInvites = require('./pendingInvites');
const inviteLinkArchive = require('./inviteLinkArchive');
const safe = require('../utils/safe');
const { QueueWorker } = require('./queueWorker');
const operationContext = require('../utils/operationContext');
const { successLog, warningLog, errorLog, infoLog, opLog } = require('../utils/logger');
const bootQuiet = require('../utils/bootQuiet');
const risk = require('./riskController');

const joinWorker = new QueueWorker('join', { concurrency: cfg.QUEUE_CONCURRENCY || 1, payloadKey: 'code' });
let joinWorkerStarted = false;
let sockRef = null;

/** Contagem usada no cap — alinha registro com grupos reais no WhatsApp quando possível */
function countForCap() {
  const disk = groupValidator.countActive();
  if (groupCache.isSyncTrustworthy()) {
    const wa = groupCache.countParticipatingGroups();
    if (wa > 0 && disk > wa) return wa;
  }
  return disk;
}

async function getInviteInfo(sock, code) {
  return sock.groupGetInviteInfo(code);
}

async function tryJoinGroup(sock, code, info) {
  const approval = Boolean(info?.joinApprovalMode);
  infoLog(
    approval
      ? `Enviando SOLICITAÇÃO de entrada (admin precisa aprovar)…`
      : `Entrando no grupo diretamente…`
  );

  const gid = await sock.groupAcceptInvite(code);

  if (gid) {
    return { ok: true, gid, approval, joined: true };
  }

  if (approval && info?.id) {
    const inGroup = await groupCache.hasGroup(sock, info.id);
    if (inGroup) {
      return { ok: true, gid: info.id, approval, joined: true };
    }
    return { ok: true, gid: info.id, approval, joined: false, pending: true };
  }

  await sleep(3000);
  groupCache.invalidate();
  const groups = await groupCache.getParticipating(sock, true);
  if (info?.id && groups[info.id]) {
    return { ok: true, gid: info.id, approval, joined: true };
  }

  return { ok: false, reason: 'entrada não confirmada' };
}

async function processInvite(sock, code, meta = {}) {
  return operationContext.withOp('join', { queue: 'join', code: code?.slice(0, 8) }, async (opId) => {
    if (!require('./socketRegistry').isOnline(sock)) {
      const err = new Error('conexão estabilizando');
      err.softRetry = true;
      throw err;
    }
    try {
      if (require('./safeMode').isPaused()) {
        const err = new Error('safe-mode');
        err.softRetry = true;
        throw err;
      }
    } catch {
      /* ignore */
    }
    if (!cfg.AUTO_JOIN_GROUPS && !meta.manual) return false;
    if (blacklist.isInviteBlocked(code)) {
      if (logThrottle.shouldLog(`join-blocked-${code.slice(0, 8)}`, 10 * 60 * 1000)) {
        warningLog(`Convite bloqueado: ${code.slice(0, 10)}…`);
      }
      pendingInvites.remove(code);
      return false;
    }

    if (!activeHours.isActiveNow()) {
      opLog('INFO', 'Fora do horário — convite guardado', { opId, queue: 'join' });
      pendingInvites.add(code, meta, 'fora-horario');
      const err = new Error('fora-horario');
      err.softRetry = true;
      throw err;
    }

    const maxGroupsEarly = limits.getMaxGroups();
    const activeEarly = countForCap();
    if (activeEarly >= maxGroupsEarly) {
      if (logThrottle.shouldLog('join-cap-early', 5 * 60 * 1000)) {
        warningLog(`Cap ${activeEarly}/${maxGroupsEarly} — join adiado (sem analisar convite agora)`);
        try {
          require('../ipc/eventBus').emitJoinLimit({
            reason: 'grupos',
            pauseMin: 25,
            active: activeEarly,
            max: maxGroupsEarly,
          });
        } catch {
          /* IPC opcional */
        }
      }
      pendingInvites.add(code, meta, 'limite-grupos');
      const err = new Error('limite-grupos');
      err.softRetry = true;
      throw err;
    }

    if (!antiBan.canJoinNow()) {
      pendingInvites.add(code, meta, 'limite-hora');
      const err = new Error('limite-hora');
      err.softRetry = true;
      throw err;
    }

    monitor.inc('invitesProcessed');
    infoLog(`Analisando convite ${code.slice(0, 10)}…`);
    try {
      const jq = require('./persistentQueue').list('join') || [];
      const pending = jq.filter((j) => j.status === 'pending' || j.status === 'processing').length;
      require('../ipc/eventBus').emitJoinStart({
        link: code,
        queuePos: pending + 1,
        queueTotal: pending + 1,
      });
    } catch {
      /* IPC opcional */
    }

    let info;
    try {
      info = await getInviteInfo(sock, code);
      info = await require('./groupMemberPolicy').resolveInviteInfo(sock, code, info);
      inviteLinkArchive.updatePreview(code, { subject: info.subject, size: info.size });
    } catch (e) {
      const errMsg = e?.message || String(e);
      try {
        risk.recordSignal('join_fail', errMsg);
      } catch {
        /* ignore */
      }
      const banGuard = require('./groupBanGuard');
      if (banGuard.isTransientInviteError(errMsg)) {
        pendingInvites.add(code, meta, 'preview-indisponivel');
        const err = new Error('preview-indisponivel');
        err.softRetry = true;
        throw err;
      }
      if (banGuard.isPermanentInviteError(errMsg)) {
        errorLog(`Convite inválido/expirado: ${errMsg}`);
        blacklist.blockInvite(code);
        inviteLinkArchive.markFailed(code, errMsg);
        pendingInvites.remove(code);
        monitor.inc('joinsFail');
        return false;
      }
      warningLog(`Convite adiado (${errMsg.slice(0, 60)})`);
      pendingInvites.add(code, meta, 'falha-retry');
      const err = new Error(errMsg);
      err.softRetry = true;
      throw err;
    }

    if (!info?.id) {
      warningLog('Convite sem ID de grupo');
      blacklist.blockInvite(code);
      inviteLinkArchive.markFailed(code, 'sem-id-grupo');
      pendingInvites.remove(code);
      monitor.inc('joinsFail');
      return false;
    }

    const invalid = groupValidator.loadInvalidGroups();
    if (invalid[info.id]?.reason?.includes('chat normal')) {
      infoLog(`Chat já visitado — ignorando: ${info.subject || info.id}`);
      pendingInvites.remove(code);
      return false;
    }

    if (blacklist.isGroupBlocked(info.id)) {
      infoLog(`Grupo na blacklist — ignorando: ${info.subject || info.id}`);
      pendingInvites.remove(code);
      return false;
    }

    try {
      const dualGroupRegistry = require('./dualGroupRegistry');
      if (dualGroupRegistry.shouldSkipJoin(info.id)) {
        const owner = dualGroupRegistry.getOwner(info.id);
        infoLog(
          `Grupo já no ${owner?.session || 'outro WA'} — não duplica entrada: ${info.subject || info.id}`
        );
        pendingInvites.remove(code);
        return false;
      }
      const overlapMonitor = require('./dualOverlapMonitor');
      if (overlapMonitor.isGroupInPeerMembership(info.id)) {
        infoLog(
          `Grupo já no ${dualGroupRegistry.peerSessionId()} (live) — não duplica: ${info.subject || info.id}`
        );
        pendingInvites.remove(code);
        return false;
      }
    } catch {
      /* ignore */
    }

    const contentFilter = require('./groupContentFilter');
    const contentBlock = contentFilter.validateGroupJoin({
      title: info.subject,
      description: info.desc || info.description,
      inviteText: meta?.caption || meta?.text || meta?.body || '',
      channel: 'wa',
    });
    if (!contentBlock.allowed) {
      warningLog(
        `Convite bloqueado (${contentBlock.reason}): ${info.subject || info.id}`
      );
      blacklist.blockInvite(code);
      blacklist.blockGroup(info.id);
      inviteLinkArchive.markBlocked(code, contentBlock.reason);
      pendingInvites.remove(code);
      monitor.inc('joinsFail');
      return false;
    }

    if (info.size >= info.maxParticipants) {
      warningLog(`Grupo cheio: ${info.subject || info.id}`);
      blacklist.blockInvite(code);
      inviteLinkArchive.markFailed(code, 'grupo-cheio');
      pendingInvites.remove(code);
      return false;
    }

    const minMem = cfg.MIN_MEMBERS_IN_GROUP ?? 50;
    if (minMem > 0 && info.size > 0 && info.size < minMem) {
      warningLog(
        `Convite ignorado (${info.size} membros < ${minMem}): ${info.subject || info.id}`
      );
      pendingInvites.remove(code);
      return false;
    }

    const prev = groupValidator.loadActiveGroups()[info.id];
    if (prev?.pendingApproval) {
      infoLog(`Solicitação já enviada — aguardando aprovação: ${info.subject || info.id}`);
      pendingInvites.remove(code);
      return false;
    }

    try {
      const churn = require('./groupChurnGuard');
      const joinGate = churn.canJoin(code, info.id);
      if (!joinGate.ok) {
        churn.logBlocked(
          `entrada bloqueada (~${joinGate.remainingMin} min)`,
          `${info.subject || code.slice(0, 10)}…`,
          `churn-join-${code.slice(0, 8)}`
        );
        pendingInvites.add(code, meta, joinGate.reason || 'churn-cooldown');
        return false;
      }
    } catch {
      /* ignore */
    }

    const alreadyIn = await groupCache.hasGroup(sock, info.id);
    if (alreadyIn) {
      infoLog(`Já está no grupo: ${info.subject || info.id}`);
      pendingInvites.remove(code);
      if (!prev?.groupType) {
        await safe.runSilent('Reclassificar existente', () =>
          groupOnboarding.reclassifyExisting(sock, info.id, info)
        );
      }
      return false;
    }

    const maxGroups = limits.getMaxGroups();
    const diskCount = groupValidator.countActive();
    let effectiveCount = diskCount;
    if (groupCache.isSyncTrustworthy()) {
      const waN = groupCache.countParticipatingGroups();
      if (waN > 0 && diskCount > waN) effectiveCount = waN;
    } else if (diskCount >= maxGroups) {
      warningLog('Sync de grupos incompleto — não libera vaga automática (evita sair de grupos bons)');
      pendingInvites.add(code, meta, 'sync-parcial');
      throw new Error('sync-parcial');
    }

    if (effectiveCount >= maxGroups) {
      warningLog(`Limite ${maxGroups} grupos — liberando vaga`);
      try {
        require('../ipc/eventBus').emitCap({
          active: countForCap(),
          max: maxGroups,
        });
      } catch {
        /* IPC opcional */
      }
      if (cfg.ENABLE_AUTO_EXIT && groupCache.isSyncTrustworthy()) {
        const memberPolicy = require('./groupMemberPolicy');
        let vacated = false;

        if (cfg.ENABLE_GROUP_UPGRADE_BY_MEMBERS !== false) {
          const up = await memberPolicy.tryUpgradeForInvite(sock, info, meta);
          if (up === 'skip') {
            pendingInvites.remove(code);
            return false;
          }
          if (up === 'vacated') {
            groupCache.invalidate();
            vacated = true;
            effectiveCount = groupValidator.countActive();
            const waN2 = groupCache.countParticipatingGroups();
            if (waN2 > 0 && effectiveCount > waN2) effectiveCount = waN2;
          }
        }

        if (!vacated && effectiveCount >= maxGroups) {
          const groupQuality = require('./groupQuality');
          const groupVacancy = require('./groupVacancy');
          const memberPolicy = require('./groupMemberPolicy');
          let weak = null;
          const upgradeCandidate = await memberPolicy.pickSmallestActiveGroup(sock);
          if (
            upgradeCandidate &&
            groupQuality.shouldVacateForInvite(
              upgradeCandidate._record ||
                groupValidator.loadActiveGroups()[upgradeCandidate.id] ||
                upgradeCandidate,
              info
            )
          ) {
            weak = upgradeCandidate;
          } else {
            weak = groupVacancy.pickGroupToVacate();
            if (weak && groupQuality.canDivulgeInGroup(weak)) {
              weak = null;
            }
          }
          if (weak?.id) {
            const gid = weak.id;
            const groupBanGuard = require('./groupBanGuard');
            const out = await groupBanGuard.safeLeaveGroup(sock, gid, 'substituído por convite melhor', {
              bypassBanGuard: true,
              policyCheck: async () => groupCache.confirmMembershipLive(sock, gid) === true,
            });
            if (out.left) {
              groupCache.invalidate();
              effectiveCount = groupValidator.countActive();
              vacated = true;
            }
          }
        }
      }
      if (effectiveCount >= maxGroups) {
        pendingInvites.add(code, meta, 'limite-grupos');
        throw new Error('limite-grupos');
      }
    }

    const waitMs = antiBan.joinDelay();
    infoLog(`Aguardando ${Math.round(waitMs / 1000)}s (anti-ban)…`);
    await sleep(waitMs);

    try {
      const result = await antiBan.withRetry(() => tryJoinGroup(sock, code, info), 'join');

      if (!result.ok) {
        throw new Error(result.reason || 'falha ao entrar');
      }

      antiBan.recordJoin();
      monitor.inc('joinsOk');
      groupCache.invalidate();

      const gid = result.gid || info.id;

      if (result.pending) {
        groupValidator.registerGroup(gid, {
          inviteCode: code,
          subject: info.subject,
          desc: info.desc,
          announce: info.announce,
          joinApprovalMode: result.approval,
          pendingApproval: true,
          ...meta,
        });
        successLog(`Solicitação enviada: ${info.subject || gid} — aguardando aprovação do admin`);
        inviteLinkArchive.markJoined(code, {
          gid,
          subject: info.subject,
          size: info.size,
          pending: true,
        });
        pendingInvites.remove(code);
      } else {
        successLog(`Entrou no grupo: ${info.subject || gid}`);
        try {
          require('./groupChurnGuard').recordJoin(gid, { inviteCode: code });
        } catch {
          /* ignore */
        }
        try {
          require('../ipc/eventBus').emitJoinOk({
            group: info.subject || gid,
            active: countForCap(),
            max: limits.getMaxGroups(),
          });
        } catch {
          /* IPC opcional */
        }
        inviteLinkArchive.markJoined(code, {
          gid,
          subject: info.subject,
          size: info.size,
        });
        pendingInvites.remove(code);
        try {
          require('./checkpoints').record('after_join', { gid, subject: info.subject });
        } catch {
          /* ignore */
        }
        await groupOnboarding.handleNewGroup(sock, gid, {
          inviteCode: code,
          subject: info.subject,
          desc: info.desc,
          announce: info.announce,
          size: info.size,
          joinApprovalMode: result.approval,
          pendingApproval: false,
          ...meta,
        });
        try {
          const dualGroupRegistry = require('./dualGroupRegistry');
          if (dualGroupRegistry.dualEnabled()) {
            dualGroupRegistry.claimGroup(gid, dualGroupRegistry.localSessionId(), {
              subject: info.subject,
            });
            await require('./dualOverlapMonitor').runOverlapPass(sock, { onlyGid: gid });
          }
        } catch {
          /* ignore */
        }
      }

      return true;
    } catch (e) {
      const errMsg = String(e.message || e);
      errorLog(`Falha ao entrar (${code.slice(0, 10)}…): ${errMsg}`);

      if (/already-exists|already exists/i.test(errMsg) && info?.id) {
        groupCache.invalidate();
        const inGroup = await groupCache.hasGroup(sock, info.id);
        if (inGroup) {
          infoLog(`Pedido pendente — já no grupo: ${info.subject || info.id}`);
          pendingInvites.remove(code);
          groupValidator.registerGroup(info.id, {
            inviteCode: code,
            subject: info.subject,
            pendingApproval: false,
          });
          await groupOnboarding.handleNewGroup(sock, info.id, {
            inviteCode: code,
            subject: info.subject,
            desc: info.desc,
            announce: info.announce,
            size: info.size,
            pendingApproval: false,
            ...meta,
          });
          inviteLinkArchive.markJoined(code, { gid: info.id, subject: info.subject, size: info.size });
          return true;
        }
        pendingInvites.remove(code);
        return false;
      }

      const banGuard = require('./groupBanGuard');
      if (banGuard.isPermanentInviteError(errMsg) || banGuard.isRealForbiddenError(errMsg)) {
        blacklist.blockInvite(code);
        inviteLinkArchive.markFailed(code, errMsg);
        pendingInvites.remove(code);
        return false;
      }
      if (banGuard.isTransientInviteError(errMsg)) {
        pendingInvites.add(code, meta, 'falha-retry');
        const err = new Error(errMsg);
        err.softRetry = true;
        throw err;
      }
      pendingInvites.add(code, meta, 'falha-retry');
      throw e;
    }
  });
}

function ensureJoinWorker(sock) {
  if (joinWorkerStarted) return;
  sockRef = sock;
  joinWorker.setProcessor(async (payload) => {
    if (!sockRef) throw new Error('socket indisponível');
    await processInvite(sockRef, payload.code, payload.meta || {});
  });
  joinWorker.start();
  joinWorkerStarted = true;
}

exports.startWorkers = (sock) => {
  if (cfg.PERSISTENT_QUEUES_ENABLED === false) return;
  ensureJoinWorker(sock);
};

exports.stopWorkers = () => {
  joinWorker.stop();
  joinWorkerStarted = false;
  sockRef = null;
};

exports.enqueueInvite = (sock, code, meta = {}) => {
  const quiet = Boolean(meta.quiet || meta.resumed || bootQuiet.isQuiet());

  if (blacklist.isInviteBlocked(code)) {
    if (quiet) bootQuiet.bumpInvite('skipped');
    else if (logThrottle.shouldLog(`enqueue-blocked-${code.slice(0, 8)}`, 15 * 60 * 1000)) {
      infoLog(`Convite ignorado (bloqueado): ${code.slice(0, 10)}…`);
    }
    inviteLinkArchive.markBlocked(code, 'blacklist');
    pendingInvites.remove(code);
    return Promise.resolve(false);
  }

  ensureJoinWorker(sock);

  if (meta.groupSize > 0 && !meta.size) meta = { ...meta, size: meta.groupSize };
  if (meta.size > 0) pendingInvites.setInviteSize(code, meta.size);

  const alreadyQueued = (() => {
    try {
      return require('./persistentQueue')
        .list('join')
        .some(
          (j) =>
            j.payload?.code === code &&
            j.status !== 'failed' &&
            j.status !== 'completed'
        );
    } catch {
      return pendingInvites.has(code);
    }
  })();

  const alreadyPending = pendingInvites.has(code);
  const isDup = alreadyPending || alreadyQueued;

  if (isDup) {
    if (quiet) bootQuiet.bumpInvite('dup');
    else if (logThrottle.shouldLog(`join-dup-${code.slice(0, 8)}`, 5 * 60 * 1000)) {
      infoLog(`Convite já na fila: ${code.slice(0, 10)}…`);
    }
  } else {
    pendingInvites.add(code, meta, 'fila');
    inviteLinkArchive.markQueued(code, meta);
  }

  if (!quiet && sock?.groupGetInviteInfo && !meta.size) {
    require('../utils/safe').runDebug('Tamanho do convite', async () => {
      const info = await sock.groupGetInviteInfo(code);
      if (info?.size > 0) pendingInvites.setInviteSize(code, info.size);
    });
  }

  if (cfg.PERSISTENT_QUEUES_ENABLED !== false) {
    if (isDup) {
      return Promise.resolve(true);
    }
    const job = joinWorker.enqueue({ code, meta }, 'join');
    if (job) {
      if (quiet) bootQuiet.bumpInvite('new');
      else if (logThrottle.shouldLog(`join-enq-${code.slice(0, 8)}`, 60 * 1000)) {
        infoLog(`Convite enfileirado [${job.id.slice(0, 6)}]: ${code.slice(0, 10)}…`);
      }
    }
    return Promise.resolve(Boolean(job));
  }

  if (!quiet) infoLog(`Convite na fila: ${code.slice(0, 10)}…`);
  return processInvite(sock, code, meta).catch((e) => {
    errorLog(`Erro na fila de convite: ${e.message}`);
  });
};

exports.processInviteV4 = async (sock, msg) => {
  const inv = msg.message?.groupInviteMessage;
  if (!inv?.inviteCode) return false;

  const code = inv.inviteCode;
  infoLog(`Convite nativo detectado: ${inv.groupName || code.slice(0, 10)}`);

  try {
    if (typeof sock.groupAcceptInviteV4 === 'function') {
      const gid = await sock.groupAcceptInviteV4(msg.key, inv);
      if (gid) {
        antiBan.recordJoin();
        monitor.inc('joinsOk');
        groupCache.invalidate();
        successLog(`Entrou via convite nativo: ${inv.groupName || gid}`);
        inviteLinkArchive.markJoined(code, {
          gid,
          subject: inv.groupName,
          size: inv.groupSize,
        });
        await groupOnboarding.handleNewGroup(sock, gid, {
          subject: inv.groupName,
          inviteCode: code,
          size: inv.groupSize,
        });
        return true;
      }
    }
  } catch (e) {
    warningLog(`InviteV4 falhou: ${e.message} — tentando por link`);
  }

  return exports.enqueueInvite(sock, code, { from: msg.key.remoteJid, native: true });
};

module.exports = exports;
