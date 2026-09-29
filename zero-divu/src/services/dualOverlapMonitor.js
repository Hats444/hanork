'use strict';

const fs = require('fs-extra');
const path = require('path');
const { IPC_DIR } = require('../ipc/paths');
const dualGroupRegistry = require('./dualGroupRegistry');
const { infoLog, warningLog } = require('../utils/logger');

const COORD_DIR = path.resolve(IPC_DIR, '..', 'wa-blast-coord');

function membershipFile(sessionId) {
  return path.join(COORD_DIR, `membership-${sessionId}.json`);
}

const PEER_SNAP_MAX_AGE_MS = 45 * 60 * 1000;

async function publishLocalMembership(sock) {
  if (!dualGroupRegistry.dualEnabled() || !sock) return null;

  const groupCache = require('./groupCache');
  let participating = {};
  try {
    participating = await groupCache.getParticipating(sock, false);
  } catch {
    return null;
  }

  const ids = Object.keys(participating || {}).filter((k) => k.endsWith('@g.us'));
  const local = dualGroupRegistry.localSessionId();
  const subjects = {};
  for (const id of ids) {
    subjects[id] = participating[id]?.subject || null;
  }

  const snap = {
    session: local,
    updatedAt: new Date().toISOString(),
    groupIds: ids,
    subjects,
  };

  fs.ensureDirSync(COORD_DIR);
  const fp = membershipFile(local);
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeJson(tmp, snap, { spaces: 0 });
  await fs.move(tmp, fp, { overwrite: true });
  return snap;
}

function readPeerMembership() {
  const peer = dualGroupRegistry.peerSessionId();
  const fp = membershipFile(peer);
  try {
    if (!fs.existsSync(fp)) return null;
    const snap = fs.readJsonSync(fp);
    if (!snap) return null;
    const age = Date.now() - new Date(snap.updatedAt || 0).getTime();
    if (age > PEER_SNAP_MAX_AGE_MS) return { ...snap, stale: true };
    return snap;
  } catch {
    return null;
  }
}

function isGroupInPeerMembership(groupId) {
  const peer = readPeerMembership();
  if (!peer?.groupIds?.length || peer.stale) return false;
  return peer.groupIds.includes(String(groupId || '').trim());
}

async function leaveOverlapGroup(sock, gid, subject, reason = 'overlap-dual-wa') {
  const local = dualGroupRegistry.localSessionId();
  const groupBanGuard = require('./groupBanGuard');
  const groupValidator = require('./groupValidator');

  const out = await groupBanGuard.safeLeaveGroup(sock, gid, reason, {
    bypassBanGuard: true,
    policyCheck: async () => true,
  });

  if (!out?.left) return false;

  dualGroupRegistry.releaseGroup(gid, local);
  groupValidator.markInvalid(gid, reason);
  warningLog(
    `Saiu de grupo duplicado (${dualGroupRegistry.peerSessionId()} também está): ${subject || gid.split('@')[0]}`
  );
  return true;
}

async function refillAfterOverlap(sock, slots = 1) {
  const need = Math.max(0, Number(slots) || 0);
  if (need <= 0 || !sock) return { enqueued: 0 };

  const cfg = require('../config/divulgacao');
  if (!cfg.AUTO_JOIN_GROUPS) return { enqueued: 0, reason: 'auto_join_off' };

  const limits = require('./operationalLimits');
  const groupValidator = require('./groupValidator');
  const maxGroups = limits.getMaxGroups();
  const activeN = groupValidator.countActive();
  const headroom = Math.max(0, maxGroups - activeN);
  if (headroom <= 0) return { enqueued: 0, reason: 'at_cap' };

  const cap = Math.min(need, headroom);
  const joinManager = require('./joinManager');
  const pendingInvites = require('./pendingInvites');
  let enqueued = 0;
  const tried = new Set();

  const tryEnqueue = async (code, meta = {}) => {
    const c = String(code || '').trim();
    if (!c || tried.has(c)) return false;
    tried.add(c);
    try {
      await joinManager.enqueueInvite(sock, c, { ...meta, overlapRefill: true, quiet: true });
      return true;
    } catch {
      return false;
    }
  };

  for (const item of pendingInvites.listForProcessing()) {
    if (enqueued >= cap) break;
    const gid = item.meta?.id || item.meta?.gid;
    if (gid && dualGroupRegistry.shouldSkipJoin(gid)) continue;
    if (gid && isGroupInPeerMembership(gid)) continue;
    if (await tryEnqueue(item.code, item.meta || {})) enqueued += 1;
  }

  if (enqueued < cap) {
    try {
      const archive = require('./inviteLinkArchive');
      for (const row of archive.listJoinable(cap - enqueued)) {
        if (enqueued >= cap) break;
        if (await tryEnqueue(row.code, { subject: row.subject, size: row.member_count })) {
          enqueued += 1;
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (enqueued > 0) {
    infoLog(`Dual WA: ${enqueued} convite(s) enfileirado(s) para repor vaga após overlap`);
  }
  return { enqueued };
}

/**
 * Detecta grupos em comum com o peer (snapshot + registry) e faz o bot local sair quando deve.
 */
async function runOverlapPass(sock, opts = {}) {
  if (!dualGroupRegistry.dualEnabled() || !sock) return { skipped: true };

  const localSnap = await publishLocalMembership(sock);
  if (!localSnap?.groupIds?.length) {
    const dedupe = await dualGroupRegistry.dedupeOverlappingGroups(sock);
    return { skipped: true, reason: 'no_groups', dedupe };
  }

  const peerSnap = readPeerMembership();
  const local = dualGroupRegistry.localSessionId();
  const primary = dualGroupRegistry.primarySessionId();
  const localSet = new Set(localSnap.groupIds);

  let overlapIds = [];
  if (peerSnap?.groupIds?.length && !peerSnap.stale) {
    overlapIds = peerSnap.groupIds.filter((gid) => localSet.has(gid));
  }

  if (opts.onlyGid) {
    const gid = String(opts.onlyGid).trim();
    overlapIds = overlapIds.includes(gid) ? [gid] : [];
  }

  let left = 0;
  let claimed = 0;

  for (const gid of overlapIds) {
    const subject = localSnap.subjects?.[gid] || peerSnap?.subjects?.[gid];
    const owner = dualGroupRegistry.getOwner(gid);

    if (owner?.session === local) continue;

    if (owner?.session && owner.session !== local) {
      if (await leaveOverlapGroup(sock, gid, subject)) left += 1;
      continue;
    }

    if (local === primary) {
      const claim = dualGroupRegistry.claimGroup(gid, local, {
        subject,
        tookFrom: dualGroupRegistry.peerSessionId(),
      });
      if (claim.ok) claimed += 1;
      continue;
    }

    if (await leaveOverlapGroup(sock, gid, subject)) left += 1;
  }

  const dedupe = await dualGroupRegistry.dedupeOverlappingGroups(sock);
  left += dedupe.left || 0;

  let refill = { enqueued: 0, reason: null };
  if (left > 0) {
    try {
      require('../ipc/eventBus').emitLeave({
        group: `${left} overlap(s)`,
        reason: 'dual-wa — grupo duplicado, repor vaga',
      });
    } catch {
      /* ignore */
    }
    refill = await refillAfterOverlap(sock, left);
  }

  if (overlapIds.length > 0 || left > 0) {
    infoLog(
      `Dual overlap check (${local}): ${overlapIds.length} em comum · ${left} saída(s) · ${claimed} claim(s) primário`
    );
  }

  return {
    overlaps: overlapIds.length,
    left,
    claimed,
    dedupe,
    refill,
    peerStale: Boolean(peerSnap?.stale),
    message:
      left > 0
        ? `${left} saída(s) · ${refill.enqueued || 0} convite(s) para repor alcance`
        : overlapIds.length > 0
          ? `${overlapIds.length} em comum — primário mantém, secundário não precisa sair`
          : 'Nenhum grupo duplicado',
  };
}

module.exports = {
  publishLocalMembership,
  readPeerMembership,
  isGroupInPeerMembership,
  refillAfterOverlap,
  runOverlapPass,
};
