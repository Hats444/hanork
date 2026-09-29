'use strict';

const fs = require('fs-extra');
const path = require('path');
const { IPC_DIR } = require('../ipc/paths');
const { infoLog, warningLog } = require('../utils/logger');

const COORD_DIR = path.resolve(IPC_DIR, '..', 'wa-blast-coord');
const OWNERS_FILE = path.join(COORD_DIR, 'group-owners.json');

function dualEnabled() {
  return (
    process.env.WA_DUAL_JOIN_BIDIRECTIONAL === '1' &&
    Boolean(process.env.WA_DUAL_IPC_DIR_PEER)
  );
}

function localSessionId() {
  return process.env.WA_SESSION_ID || 'wa_a';
}

function peerSessionId() {
  return process.env.WA_DUAL_PEER_SESSION || 'wa_b';
}

function primarySessionId() {
  return process.env.WA_DUAL_PRIMARY_SESSION || 'wa_a';
}

function readOwners() {
  try {
    return fs.readJsonSync(OWNERS_FILE) || {};
  } catch {
    return {};
  }
}

function writeOwners(data) {
  fs.ensureDirSync(COORD_DIR);
  const tmp = `${OWNERS_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeJsonSync(tmp, data, { spaces: 2 });
  fs.moveSync(tmp, OWNERS_FILE, { overwrite: true });
}

function getOwner(groupId) {
  const jid = String(groupId || '').trim();
  if (!jid) return null;
  const row = readOwners()[jid];
  if (!row?.session) return null;
  return row;
}

function isOwnedByPeer(groupId) {
  if (!dualEnabled()) return false;
  const owner = getOwner(groupId);
  if (!owner) return false;
  return owner.session !== localSessionId();
}

function shouldSkipJoin(groupId) {
  if (!dualEnabled()) return false;
  return isOwnedByPeer(groupId);
}

const PEER_SNAP_MAX_AGE_MS = 45 * 60 * 1000;

function membershipFile(sessionId) {
  return path.join(COORD_DIR, `membership-${sessionId}.json`);
}

function readPeerMembershipSnap() {
  const peer = peerSessionId();
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

/** Este worker deve postar neste grupo? (dual WA — 1 bot por GP). */
function shouldLocalBlastGroup(groupId) {
  if (!dualEnabled()) return true;

  const gid = String(groupId || '').trim();
  if (!gid) return false;

  const local = localSessionId();
  const owner = getOwner(gid);
  if (owner?.session) return owner.session === local;

  try {
    const groupValidator = require('./groupValidator');
    const row = groupValidator.loadActiveGroups()[gid];
    if (row?.wa_session_id && row.wa_session_id !== local) return false;
  } catch {
    /* ignore */
  }

  const peerSnap = readPeerMembershipSnap();
  if (peerSnap?.groupIds?.includes(gid) && !peerSnap.stale) {
    return local === primarySessionId();
  }

  return true;
}

function filterGroupsForLocalBlast(groupIds) {
  if (!dualEnabled()) return { eligible: groupIds, skippedOverlap: 0 };

  const ids = [...new Set((groupIds || []).map(String).filter(Boolean))];
  const eligible = [];
  let skippedOverlap = 0;

  for (const gid of ids) {
    if (shouldLocalBlastGroup(gid)) eligible.push(gid);
    else skippedOverlap += 1;
  }

  if (skippedOverlap > 0) {
    infoLog(
      `Blast dual-WA (${localSessionId()}): ${skippedOverlap} grupo(s) no outro bot — pulados`
    );
  }

  return { eligible, skippedOverlap };
}

async function prepareForBlast(sock) {
  if (!dualEnabled() || !sock) return;
  try {
    await require('./dualOverlapMonitor').publishLocalMembership(sock);
  } catch {
    /* ignore */
  }
}

function registerOverlapOwnersForPrimary(localGroupIds) {
  if (!dualEnabled() || localSessionId() !== primarySessionId()) return 0;

  const peerSnap = readPeerMembershipSnap();
  if (!peerSnap?.groupIds?.length || peerSnap.stale) return 0;

  const peerSet = new Set(peerSnap.groupIds);
  let claimed = 0;
  for (const gid of localGroupIds || []) {
    if (!peerSet.has(gid) || getOwner(gid)?.session) continue;
    const out = claimGroup(gid, localSessionId(), {});
    if (out.ok) claimed += 1;
  }
  if (claimed > 0) {
    infoLog(`Blast dual-WA: ${claimed} grupo(s) em comum atribuídos ao ${primarySessionId()}`);
  }
  return claimed;
}

/**
 * Registra dono exclusivo do grupo. wa_a ganha em conflito com wa_b.
 * @returns {{ ok: boolean, owner?: string, conflict?: boolean }}
 */
function claimGroup(groupId, sessionId = localSessionId(), meta = {}) {
  const jid = String(groupId || '').trim();
  if (!jid) return { ok: false };

  const map = readOwners();
  const prev = map[jid];
  const local = sessionId || localSessionId();

  if (prev?.session && prev.session !== local) {
    if (local === primarySessionId() && prev.session !== primarySessionId()) {
      map[jid] = {
        session: local,
        at: Date.now(),
        subject: meta.subject || prev.subject || null,
        tookFrom: prev.session,
      };
      writeOwners(map);
      return { ok: true, owner: local, conflict: true, tookFrom: prev.session };
    }
    return { ok: false, owner: prev.session, conflict: true };
  }

  map[jid] = {
    session: local,
    at: Date.now(),
    subject: meta.subject || prev?.subject || null,
  };
  writeOwners(map);
  return { ok: true, owner: local };
}

function releaseGroup(groupId, sessionId = localSessionId()) {
  const jid = String(groupId || '').trim();
  if (!jid) return;
  const map = readOwners();
  if (map[jid]?.session === sessionId) {
    delete map[jid];
    writeOwners(map);
  }
}

/** Sai de grupos que o peer já possui — mantém 1 bot por grupo. */
async function dedupeOverlappingGroups(sock) {
  if (!dualEnabled() || !sock) return { left: 0, claimed: 0 };

  const groupCache = require('./groupCache');
  const groupBanGuard = require('./groupBanGuard');
  const groupValidator = require('./groupValidator');
  const local = localSessionId();

  let participating = {};
  try {
    participating = await groupCache.getParticipating(sock, false);
  } catch {
    return { left: 0, claimed: 0 };
  }

  let left = 0;
  let claimed = 0;

  for (const [gid, g] of Object.entries(participating || {})) {
    const owner = getOwner(gid);

    if (owner && owner.session !== local) {
      try {
        const out = await groupBanGuard.safeLeaveGroup(sock, gid, 'dedupe-dual-wa-peer-owns', {
          bypassBanGuard: true,
          policyCheck: async () => true,
        });
        if (out?.left) {
          left += 1;
          releaseGroup(gid, local);
          groupValidator.markInvalid(gid, 'dedupe-dual-wa');
          warningLog(
            `Saiu de grupo duplicado (${owner.session} já cobre): ${g?.subject || gid.split('@')[0]}`
          );
        }
      } catch (e) {
        warningLog(`Dedupe dual WA falhou ${gid}: ${e?.message || e}`);
      }
      continue;
    }

    const claim = claimGroup(gid, local, { subject: g?.subject });
    if (claim.ok) claimed += 1;
  }

  if (left > 0) {
    infoLog(`Dual WA dedupe: ${left} grupo(s) liberado(s) — só 1 bot por grupo`);
  }

  return { left, claimed };
}

module.exports = {
  dualEnabled,
  localSessionId,
  peerSessionId,
  primarySessionId,
  getOwner,
  isOwnedByPeer,
  shouldSkipJoin,
  shouldLocalBlastGroup,
  filterGroupsForLocalBlast,
  prepareForBlast,
  registerOverlapOwnersForPrimary,
  claimGroup,
  releaseGroup,
  dedupeOverlappingGroups,
};
