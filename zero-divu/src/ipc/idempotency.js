'use strict';

const fs = require('fs-extra');
const path = require('path');
const { IPC_DIR, ensureDir } = require('./paths');

const FILE = path.join(IPC_DIR, 'idempotency.json');
const DEFAULT_TTL_MS = Number(process.env.ZERO_IPC_IDEMPOTENCY_TTL_MS) || 3600000;

function loadMap() {
  try {
    return fs.readJsonSync(FILE) || {};
  } catch {
    return {};
  }
}

function saveMap(map) {
  ensureDir();
  const keys = Object.keys(map);
  if (keys.length > 500) {
    const sorted = keys.sort((a, b) => (map[b].at || 0) - (map[a].at || 0));
    for (const k of sorted.slice(400)) delete map[k];
  }
  fs.writeJsonSync(FILE, map, { spaces: 2 });
}

exports.getCached = (key, ttlMs = DEFAULT_TTL_MS) => {
  if (!key) return null;
  const map = loadMap();
  const entry = map[String(key)];
  if (!entry) return null;
  if (Date.now() - (entry.at || 0) > ttlMs) return null;
  return entry.result || null;
};

exports.store = (key, result, ttlMs = DEFAULT_TTL_MS) => {
  if (!key) return;
  const map = loadMap();
  map[String(key)] = { at: Date.now(), ttlMs, result };
  saveMap(map);
};

exports.sideEffectCommands = new Set([
  'wa.pause',
  'wa.resume',
  'wa.post_now',
  'wa.sync_groups',
  'wa.overlap_cleanup',
  'wa.leave_group',
  'wa.set_max',
  'wa.set_profile',
  'wa.auto_profile',
  'wa.set_delay',
  'wa.set_min_members',
  'wa.set_auto_join',
  'wa.set_auto_post_on_join',
  'wa.set_max_join_per_hour',
  'wa.preset_prod',
  'wa.clear_antiban_pause',
  'wa.reload_config',
  'wa.set_text',
  'wa.save_media',
  'wa.remove_media',
  'wa.enqueue_invite',
  'wa.enqueue_promo',
  'wa.process_promo',
  'wa.custom_blast',
  'wa.set_hanork_campaign',
  'wa.set_hanork_auto_sync',
  'wa.logout',
]);

exports.resolveKey = (cmd) => {
  const name = cmd.cmd;
  const args = cmd.args || {};
  if (args.idempotencyKey) return String(args.idempotencyKey);
  if (args.dedupeKey) return `${name}:${args.dedupeKey}`;
  if (exports.sideEffectCommands.has(name) && cmd.id) {
    return `${name}:cmd:${cmd.id}`;
  }
  return null;
};
