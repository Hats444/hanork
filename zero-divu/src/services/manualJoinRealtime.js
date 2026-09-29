'use strict';

const cfg = require('../config/divulgacao');
const groupValidator = require('./groupValidator');
const groupCache = require('./groupCache');
const blacklist = require('./blacklist');
const groupRole = require('../utils/groupRole');
const labels = require('../utils/groupLabels');
const safe = require('../utils/safe');
const { successLog, infoLog } = require('../utils/logger');

const DEDUP_MS = Math.max(15000, Number(cfg.MANUAL_JOIN_DEDUP_MS) || 90000);
const recent = new Map();

function sameJid(a, b) {
  return groupRole.sameJid?.(a, b) || false;
}

function botInParticipants(participants, botJid) {
  if (!botJid || !participants?.length) return false;
  return participants.some((p) => sameJid(p, botJid));
}

function wasRecentlyHandled(gid) {
  const t = recent.get(gid);
  if (!t) return false;
  if (Date.now() - t < DEDUP_MS) return true;
  recent.delete(gid);
  return false;
}

function markHandled(gid) {
  recent.set(gid, Date.now());
  if (recent.size > 200) {
    const cutoff = Date.now() - DEDUP_MS * 2;
    for (const [k, v] of recent) {
      if (v < cutoff) recent.delete(k);
    }
  }
}

function statusHintFromRole(role) {
  if (groupRole.isAnnounceOnlyMember(role)) {
    return 'só-admins — promova o bot a admin para postar status';
  }
  if (role?.isAdmin === true) return 'admin — status liberado';
  if (role?.announce === false) return 'membros podem postar — status OK';
  return 'verificando permissões…';
}

async function fetchJoinSnapshot(sock, gid, hints = {}) {
  let subject = hints.subject || null;
  let size = Number(hints.size || 0) || null;
  let announce = hints.announce ?? null;
  let role = null;

  try {
    role = await groupRole.getBotRole(sock, gid);
    if (role.size) size = role.size;
    if (role.announce != null) announce = role.announce;
  } catch {
    /* ignore */
  }

  if (!subject || !size) {
    try {
      const meta = await sock.groupMetadata(gid);
      subject = subject || meta.subject || null;
      size = size || meta.size || meta.participants?.length || null;
      if (announce == null) announce = meta.announce ?? null;
    } catch {
      /* ignore */
    }
  }

  const active = groupValidator.loadActiveGroups()[gid] || {};
  subject = subject || active.subject || labels.shortId(gid);

  return {
    subject,
    size: size || active.size || null,
    announce,
    role,
    statusHint: statusHintFromRole(role || {}),
  };
}

async function emitManualJoinEvent(payload) {
  try {
    await require('../ipc/eventBus').emitManualJoin(payload);
  } catch {
    /* IPC opcional */
  }
}

/**
 * Entrada manual detectada (celular / link externo) — tempo real.
 */
async function handleManualJoin(sock, gid, hints = {}) {
  if (!gid || !sock) return { ok: false, reason: 'invalid' };
  if (wasRecentlyHandled(gid)) return { ok: false, reason: 'dedup' };

  const prev = groupValidator.loadActiveGroups()[gid];
  const isReentry = Boolean(prev && !prev.leftPending);
  if (isReentry && prev.manualJoin && !hints.force) {
    return { ok: false, reason: 'already_manual' };
  }

  markHandled(gid);

  groupCache.invalidate();
  blacklist.unblockGroup(gid);
  groupValidator.clearInvalid(gid);

  const snap = await fetchJoinSnapshot(sock, gid, hints);
  const name = labels.displayName({ subject: snap.subject, id: gid }, labels.shortId(gid));

  groupValidator.registerGroup(gid, {
    manualJoin: true,
    joinedAt: new Date().toISOString(),
    subject: snap.subject,
    size: snap.size,
    announce: snap.announce,
    pendingApproval: false,
    manualJoinSource: hints.source || 'realtime',
  });

  const activeCount = Object.keys(groupValidator.loadActiveGroups()).length;
  const maxGroups = cfg.MAX_GROUPS ?? cfg.MAX_ACTIVE_GROUPS ?? null;

  await emitManualJoinEvent({
    group: name,
    gid: labels.shortId(gid),
    size: snap.size,
    announce: snap.announce,
    statusHint: snap.statusHint,
    source: hints.source || 'realtime',
    active: activeCount,
    max: maxGroups,
    reentry: isReentry,
  });

  successLog(
    `📲 Entrada manual · ${name}${snap.size ? ` · ${snap.size} membros` : ''} · ${snap.statusHint}`
  );

  safe.runSilent('Onboarding manual (realtime)', () =>
    require('./groupOnboarding').handleNewGroup(sock, gid, {
      manualJoin: true,
      source: hints.source || 'realtime',
      subject: snap.subject,
      size: snap.size,
      announce: snap.announce,
    })
  );

  safe.runSilent('Sync grupo (realtime)', async () => {
    await groupCache.getParticipating(sock, true).catch(() => {});
    await require('./grupos').syncGroupsFromWhatsApp(sock, false).catch(() => {});
  });

  return { ok: true, group: name, ...snap };
}

async function onParticipantUpdate(sock, event) {
  const botJid = sock?.user?.id;
  if (!botJid || !event?.id) return;

  if (event.action === 'remove' && botInParticipants(event.participants, botJid)) {
    monitorSafeLeave(event.id);
    return;
  }

  if (event.action !== 'add') return;
  if (!botInParticipants(event.participants, botJid)) return;

  await handleManualJoin(sock, event.id, { source: 'participant_add' });
}

function monitorSafeLeave(gid) {
  try {
    require('./monitor').inc('groupsLeft');
    require('./groupRegistryCleanup').onBotLeft(gid, 'bot removido', { blockList: true });
  } catch {
    /* ignore */
  }
}

async function onGroupsUpdate(sock, updates) {
  if (!Array.isArray(updates) || !updates.length) return;

  for (const u of updates) {
    const gid = u?.id;
    if (!gid || !String(gid).endsWith('@g.us')) continue;

    const prev = groupValidator.loadActiveGroups()[gid];
    if (prev && !prev.leftPending && prev.manualJoin) continue;
    if (prev && !prev.leftPending && !u.subject) continue;

    let inGroup = Boolean(groupCache.getMap?.()[gid]);
    if (!inGroup) {
      const live = await groupCache.confirmMembershipLive(sock, gid);
      inGroup = live === true;
    }
    if (!inGroup) continue;

    const isNew = !prev || prev.leftPending;
    if (!isNew && prev?.subject) continue;

    await handleManualJoin(sock, gid, {
      source: 'groups_update',
      subject: u.subject,
      announce: u.announce,
    });
  }
}

module.exports = {
  handleManualJoin,
  onParticipantUpdate,
  onGroupsUpdate,
  sameJid,
  botInParticipants,
};
