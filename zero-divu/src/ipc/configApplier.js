'use strict';

const fs = require('fs-extra');
const cfg = require('../config/divulgacao');
const profiles = require('../config/profiles');
const { FILES } = require('./paths');

let runtimePatch = {};
let lastFileMtime = 0;

const PROFILE_KEYS = [
  'MAX_GROUPS',
  'MAX_GROUPS_PER_CYCLE',
  'POST_INTERVAL',
  'POST_DELAY_MIN',
  'POST_DELAY_MAX',
  'JOIN_DELAY_MIN',
  'JOIN_DELAY_MAX',
  'STATUS_DELAY_MIN',
  'STATUS_DELAY_MAX',
  'INTER_GROUP_DELAY_MS_MIN',
  'INTER_GROUP_DELAY_MS_MAX',
  'MAX_POSTS_PER_HOUR',
  'MAX_JOIN_PER_HOUR',
];

function normalizeProfile(name) {
  const key = String(name || 'safe').toLowerCase();
  if (key === 'balanced' || key === 'equilibrado') return 'balanced';
  if (key === 'aggressive' || key === 'agressivo') return 'aggressive';
  return 'safe';
}

function applyProfileToCfg(profileId) {
  const id = normalizeProfile(profileId);
  const prof = profiles.byName(id);
  for (const k of PROFILE_KEYS) {
    if (k === 'MAX_GROUPS' && runtimePatch.maxGroupsPinned) continue;
    if (prof[k] != null) cfg[k] = prof[k];
  }
  cfg.OPERATION_PROFILE = id;
  cfg.profileLabel = prof.label || id;
  cfg.profileDescription = prof.description || '';
  return id;
}

function applyScalarPatch(patch) {
  if (patch.MAX_GROUPS != null) {
    cfg.MAX_GROUPS = Math.max(1, Number(patch.MAX_GROUPS) || cfg.MAX_GROUPS);
  }
  if (patch.MAX_POSTS_PER_HOUR != null) {
    cfg.MAX_POSTS_PER_HOUR = Math.max(0, Number(patch.MAX_POSTS_PER_HOUR) || 0);
  }
  if (patch.MIN_MEMBERS_IN_GROUP != null) {
    cfg.MIN_MEMBERS_IN_GROUP = Math.max(0, Number(patch.MIN_MEMBERS_IN_GROUP) || 0);
  }
  if (patch.AUTO_JOIN_GROUPS != null) {
    cfg.AUTO_JOIN_GROUPS = patch.AUTO_JOIN_GROUPS === true;
  }
  if (patch.AUTO_POST_ON_JOIN != null) {
    cfg.AUTO_POST_ON_JOIN = patch.AUTO_POST_ON_JOIN === true;
  }
  if (patch.MAX_JOIN_PER_HOUR != null) {
    cfg.MAX_JOIN_PER_HOUR = Math.max(0, Number(patch.MAX_JOIN_PER_HOUR) || 0);
  }
  if (patch.ACTIVE_HOURS_ENABLED != null) {
    cfg.ACTIVE_HOURS_ENABLED = patch.ACTIVE_HOURS_ENABLED === true;
  }
  if (patch.QUIET_HOURS_ENABLED != null) {
    cfg.QUIET_HOURS_ENABLED = patch.QUIET_HOURS_ENABLED === true;
  }
  if (patch.POST_DELAY_MS != null) {
    const ms = Math.max(1000, Number(patch.POST_DELAY_MS) || 10000);
    cfg.POST_DELAY_MIN = ms;
    cfg.POST_DELAY_MAX = ms;
  }
  if (patch.JOIN_DELAY_MS != null) {
    const ms = Math.max(1000, Number(patch.JOIN_DELAY_MS) || 25000);
    cfg.JOIN_DELAY_MIN = ms;
    cfg.JOIN_DELAY_MAX = ms;
  }
  if (patch.STATUS_DELAY_MS != null) {
    const ms = Math.max(1000, Number(patch.STATUS_DELAY_MS) || 60000);
    cfg.STATUS_DELAY_MIN = ms;
    cfg.STATUS_DELAY_MAX = ms;
    cfg.INTER_GROUP_DELAY_MS_MIN = ms;
    cfg.INTER_GROUP_DELAY_MS_MAX = ms;
  }
  const numericKeys = [
    'MAX_GROUPS_PER_CYCLE',
    'POST_INTERVAL',
    'STARTUP_IMMEDIATE_MAX_GROUPS',
    'STARTUP_CATCHUP_BATCH_SIZE',
    'STARTUP_CATCHUP_MAX_POSTS',
    'HANORK_PROMO_MAX_GROUPS',
    'JOIN_WELCOME_DELAY_MS_MIN',
    'JOIN_WELCOME_DELAY_MS_MAX',
    'INTER_GROUP_DELAY_MS_MIN',
    'INTER_GROUP_DELAY_MS_MAX',
    'POST_DELAY_MIN',
    'POST_DELAY_MAX',
    'JOIN_DELAY_MIN',
    'JOIN_DELAY_MAX',
    'STATUS_DELAY_MIN',
    'STATUS_DELAY_MAX',
  ];
  for (const k of numericKeys) {
    if (patch[k] != null) cfg[k] = Math.max(0, Number(patch[k]) || 0);
  }
  if (patch.STARTUP_CATCHUP_BYPASS_ALL_GRACE != null) {
    cfg.STARTUP_CATCHUP_BYPASS_ALL_GRACE = patch.STARTUP_CATCHUP_BYPASS_ALL_GRACE === true;
  }
  if (patch.postsPaused != null) {
    try {
      require('./runtimeControls').setPostsPaused(patch.postsPaused === true);
    } catch {
      /* worker boot */
    }
  }
}

function syncRuntimeFromPatch() {
  if (runtimePatch.postsPaused != null) {
    try {
      require('./runtimeControls').setPostsPaused(runtimePatch.postsPaused === true);
    } catch {
      /* ignore */
    }
  }
}

exports.getPatch = () => ({ ...runtimePatch });

exports.applyPatch = (patch = {}) => {
  runtimePatch = { ...runtimePatch, ...patch };

  if (patch.OPERATION_PROFILE) {
    applyProfileToCfg(patch.OPERATION_PROFILE);
    runtimePatch.OPERATION_PROFILE = cfg.OPERATION_PROFILE;
  }

  applyScalarPatch(runtimePatch);
  syncRuntimeFromPatch();
  return { ...runtimePatch };
};

exports.setMaxGroups = (n) =>
  exports.applyPatch({ MAX_GROUPS: n, maxGroupsPinned: true });

exports.setProfile = (name, opts = {}) => {
  const patch = { OPERATION_PROFILE: normalizeProfile(name) };
  if (opts.manual) patch.autoProfileEnabled = false;
  return exports.applyPatch(patch);
};

exports.enableAutoProfile = () => exports.applyPatch({ autoProfileEnabled: true });

exports.disableAutoProfile = () => exports.applyPatch({ autoProfileEnabled: false });

exports.isAutoProfileEnabled = () => runtimePatch.autoProfileEnabled !== false;

exports.setDelay = (kind, ms) => {
  const key =
    kind === 'join' ? 'JOIN_DELAY_MS' : kind === 'status' ? 'STATUS_DELAY_MS' : 'POST_DELAY_MS';
  return exports.applyPatch({ [key]: ms });
};

exports.persistPatch = async () => {
  await fs.writeJson(FILES.configPatch, runtimePatch, { spaces: 2 });
  try {
    const st = await fs.stat(FILES.configPatch);
    lastFileMtime = st.mtimeMs;
  } catch {
    /* ignore */
  }
  return runtimePatch;
};

exports.loadAndApplyFromFile = async () => {
  try {
    if (!fs.existsSync(FILES.configPatch)) return null;
    const st = await fs.stat(FILES.configPatch);
    if (st.mtimeMs <= lastFileMtime && Object.keys(runtimePatch).length) return runtimePatch;
    lastFileMtime = st.mtimeMs;
    const patch = await fs.readJson(FILES.configPatch);
    if (!patch || typeof patch !== 'object') return null;
    const applied = exports.applyPatch(patch);
    syncRuntimeFromPatch();
    return applied;
  } catch {
    return null;
  }
};

function enforceDefaultMaxGroups() {
  const envDefault = Math.max(1, Number(process.env.ZERO_MAX_GROUPS) || 25);
  if (runtimePatch.maxGroupsPinned && runtimePatch.MAX_GROUPS != null) {
    applyScalarPatch({ MAX_GROUPS: runtimePatch.MAX_GROUPS });
    return;
  }
  if (runtimePatch.MAX_GROUPS == null) {
    exports.applyPatch({ MAX_GROUPS: envDefault });
  }
}

exports.initFromFile = async () => {
  try {
    if (fs.existsSync(FILES.configPatch)) {
      const st = await fs.stat(FILES.configPatch);
      lastFileMtime = st.mtimeMs;
      const patch = await fs.readJson(FILES.configPatch);
      if (patch && typeof patch === 'object') exports.applyPatch(patch);
    }
    enforceDefaultMaxGroups();
    syncRuntimeFromPatch();
  } catch {
    /* ignore */
  }
};

exports.setPostsPaused = (paused) =>
  exports.applyPatch({ postsPaused: Boolean(paused) });

exports.syncRuntimeFromPatch = syncRuntimeFromPatch;
