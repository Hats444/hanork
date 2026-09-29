'use strict';

const fs = require('fs-extra');
const crypto = require('crypto');
const path = require('path');
const { infoLog, warningLog } = require('../utils/logger');

function dualEnabled() {
  return (
    process.env.WA_DUAL_JOIN_BIDIRECTIONAL === '1' &&
    Boolean(process.env.WA_DUAL_IPC_DIR_PEER)
  );
}

/** @deprecated use dualEnabled */
function routeEnabled() {
  return dualEnabled();
}

function peerSessionId() {
  return process.env.WA_DUAL_PEER_SESSION || 'wa_b';
}

function peerDisplayName() {
  return process.env.WA_DUAL_PEER_DISPLAY || peerSessionId();
}

function localSessionId() {
  return process.env.WA_SESSION_ID || 'wa_a';
}

function peerCommandsFile() {
  return path.join(process.env.WA_DUAL_IPC_DIR_PEER, 'commands.jsonl');
}

function readPeerState() {
  const dir = process.env.WA_DUAL_IPC_DIR_PEER;
  if (!dir) return null;
  try {
    const fp = path.join(dir, 'state.json');
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function getLocalJoinStats() {
  const limits = require('./operationalLimits');
  const groupValidator = require('./groupValidator');
  let active = groupValidator.countActive();
  try {
    const groupCache = require('./groupCache');
    if (groupCache.isSyncTrustworthy()) {
      const wa = groupCache.countParticipatingGroups();
      if (wa > 0 && active > wa) active = wa;
    }
  } catch {
    /* ignore */
  }
  const max = limits.getMaxGroups();
  let canJoinHour = true;
  try {
    canJoinHour = require('./antiBan').canJoinNow();
  } catch {
    /* ignore */
  }
  const headroom = Math.max(0, max - active);
  return { active, max, headroom, canJoinHour, connected: true };
}

function getPeerJoinStats() {
  const snap = readPeerState();
  if (!snap) {
    return { active: 0, max: 0, headroom: 0, canJoinHour: false, connected: false, joinQueue: 0 };
  }
  const active = Number(snap.activeGroups) || 0;
  const max = Number(snap.maxGroupsEffective ?? snap.maxGroups) || 25;
  const joinsThisHour = Number(snap.joinsThisHour) || 0;
  const maxJoinsHour = Number(snap.maxJoinsEffective ?? snap.maxJoinPerHour) || 2;
  const joinQueue = Number(snap.joinQueue) || 0;
  const headroom = Math.max(0, max - active);
  const canJoinHour = joinsThisHour < maxJoinsHour;
  return {
    active,
    max,
    headroom,
    canJoinHour,
    connected: Boolean(snap.connected),
    joinQueue,
  };
}

/**
 * Escolhe quem deve processar o join: local ou peer.
 * Respeita MAX_GROUPS e fila — encaminha para quem tem mais vaga.
 */
function pickJoinTarget() {
  if (!dualEnabled()) return 'local';

  const local = getLocalJoinStats();
  const peer = getPeerJoinStats();
  const peerId = peerSessionId();

  if (!peer.connected) {
    return local.headroom > 0 && local.canJoinHour ? 'local' : null;
  }

  const localCan = local.headroom > 0 && local.canJoinHour;
  const peerCan = peer.headroom > 0 && peer.canJoinHour;

  if (!localCan && !peerCan) return null;
  if (!localCan && peerCan) return peerId;
  if (localCan && !peerCan) return 'local';

  // Ambos com vaga — quem tem mais headroom recebe (balanceamento)
  if (peer.headroom > local.headroom) return peerId;
  if (local.headroom > peer.headroom) return 'local';

  // Empate — alterna entre local e peer para variar cobertura
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  return hourBucket % 2 === 0 ? 'local' : peerId;
}

async function appendIpcCommand(cmd, args, adminId = null) {
  const id = crypto.randomUUID();
  const payload = {
    id,
    cmd,
    args,
    adminId,
    at: new Date().toISOString(),
  };
  const token = process.env.ZERO_IPC_TOKEN;
  if (token) payload.token = token;
  await fs.ensureDir(process.env.WA_DUAL_IPC_DIR_PEER);
  await fs.appendFile(peerCommandsFile(), `${JSON.stringify(payload)}\n`, 'utf8');
  return id;
}

async function forwardInvite(code, meta = {}) {
  if (!dualEnabled() || !code) return false;
  const target = pickJoinTarget();
  if (target !== peerSessionId()) return false;

  const peer = getPeerJoinStats();
  if (!peer.connected || peer.headroom <= 0) return false;

  try {
    require('./inviteLinkArchive').markRouted(code, target, meta);
    await appendIpcCommand('wa.enqueue_invite', {
      code,
      meta: { ...meta, routedFrom: localSessionId() },
    });
    infoLog(`Convite encaminhado → ${peerDisplayName()}: ${String(code).slice(0, 10)}…`);
    try {
      require('./pendingInvites').remove(code);
    } catch {
      /* ignore */
    }
    return true;
  } catch (e) {
    warningLog(`Falha ao encaminhar convite ${peerDisplayName()}: ${e?.message || e}`);
    return false;
  }
}

async function routeIfNeeded(code, meta = {}) {
  if (!dualEnabled() || !code) return false;
  const target = pickJoinTarget();
  if (target === 'local' || target === null) return false;
  return forwardInvite(code, meta);
}

async function forwardPendingBatch(limit = 25) {
  if (!dualEnabled()) return { forwarded: 0, total: 0, kept: 0 };
  const pendingInvites = require('./pendingInvites');
  const queue = pendingInvites.listForProcessing();
  const total = queue.length;
  if (!total) return { forwarded: 0, total: 0, kept: 0 };

  const target = pickJoinTarget();
  const peerId = peerSessionId();
  const peer = getPeerJoinStats();
  const local = getLocalJoinStats();

  if (target !== peerId) {
    return {
      forwarded: 0,
      total,
      kept: total,
      target: 'local',
      localHeadroom: local.headroom,
      peerHeadroom: peer.headroom,
    };
  }

  const cap = Math.min(
    Math.max(1, Number(limit) || 25),
    peer.headroom || 0,
    total
  );
  if (cap <= 0) {
    return { forwarded: 0, total, kept: total, target: peerId, peerFull: true };
  }

  let forwarded = 0;
  for (const item of queue.slice(0, cap)) {
    if (await forwardInvite(item.code, { ...item.meta, resumed: true, seed: true })) {
      forwarded += 1;
    }
  }
  return {
    forwarded,
    total,
    kept: total - forwarded,
    target: peerId,
    peerDisplay: peerDisplayName(),
    localHeadroom: local.headroom,
    peerHeadroom: peer.headroom,
  };
}

module.exports = {
  dualEnabled,
  routeEnabled,
  pickJoinTarget,
  getLocalJoinStats,
  getPeerJoinStats,
  forwardInvite,
  routeIfNeeded,
  forwardPendingBatch,
  peerSessionId,
  peerDisplayName,
};
