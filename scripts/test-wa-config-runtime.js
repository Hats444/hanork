#!/usr/bin/env node
'use strict';

/**
 * Valida hot-reload de config WhatsApp (config.patch.json + configApplier).
 * Não exige worker Baileys online — testa persistência e aplicação imediata em memória.
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const HANORK_ROOT = path.resolve(__dirname, '..');
const TMP_IPC = path.join(os.tmpdir(), `hanork-wa-test-${Date.now()}`);
const PATCH_FILE = path.join(TMP_IPC, 'config.patch.json');

process.env.ZERO_DIVU_IPC_DIR = TMP_IPC;
process.env.ZERO_MAX_GROUPS = '25';

let passed = 0;
let failed = 0;

function ok(label) {
  passed += 1;
  console.log(`  ✅ ${label}`);
}

function fail(label, detail) {
  failed += 1;
  console.error(`  ❌ ${label}${detail ? `: ${detail}` : ''}`);
}

function assert(cond, label, detail) {
  if (cond) ok(label);
  else fail(label, detail);
}

async function setup() {
  await fs.ensureDir(TMP_IPC);
  await fs.writeJson(PATCH_FILE, {}, { spaces: 2 });
}

async function cleanup() {
  try {
    await fs.remove(TMP_IPC);
  } catch {
    /* ignore */
  }
}

function freshConfigApplier() {
  const applierPath = path.join(HANORK_ROOT, 'zero-divu', 'src', 'ipc', 'configApplier.js');
  const pathsPath = path.join(HANORK_ROOT, 'zero-divu', 'src', 'ipc', 'paths.js');
  delete require.cache[require.resolve(applierPath)];
  delete require.cache[require.resolve(pathsPath)];
  return require(applierPath);
}

function freshRuntimeControls() {
  const p = path.join(HANORK_ROOT, 'zero-divu', 'src', 'ipc', 'runtimeControls.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}

async function testDelayPersistAndReload() {
  console.log('\n▶ Delay post — persist + reload');
  const applier = freshConfigApplier();
  await applier.initFromFile();

  applier.setDelay('post', 18000);
  await applier.persistPatch();

  const cfg = require(path.join(HANORK_ROOT, 'zero-divu', 'src', 'config', 'divulgacao'));
  assert(cfg.POST_DELAY_MIN === 18000, 'cfg.POST_DELAY_MIN aplicado', String(cfg.POST_DELAY_MIN));
  assert(cfg.POST_DELAY_MAX === 18000, 'cfg.POST_DELAY_MAX aplicado', String(cfg.POST_DELAY_MAX));

  const onDisk = await fs.readJson(PATCH_FILE);
  assert(onDisk.POST_DELAY_MS === 18000, 'POST_DELAY_MS no config.patch.json');

  const applier2 = freshConfigApplier();
  await applier2.initFromFile();
  const cfg2 = require(path.join(HANORK_ROOT, 'zero-divu', 'src', 'config', 'divulgacao'));
  assert(cfg2.POST_DELAY_MIN === 18000, 'reload boot mantém delay post');
}

async function testMaxGroupsNotOverwritten() {
  console.log('\n▶ Max grupos — admin pin não sobrescrito no boot');
  await fs.writeJson(
    PATCH_FILE,
    { MAX_GROUPS: 40, maxGroupsPinned: true, OPERATION_PROFILE: 'safe' },
    { spaces: 2 }
  );

  const applier = freshConfigApplier();
  await applier.initFromFile();
  const cfg = require(path.join(HANORK_ROOT, 'zero-divu', 'src', 'config', 'divulgacao'));
  assert(cfg.MAX_GROUPS === 40, 'MAX_GROUPS=40 respeitado após boot', String(cfg.MAX_GROUPS));

  const patch = applier.getPatch();
  assert(patch.maxGroupsPinned === true, 'maxGroupsPinned preservado');
}

async function testPostsPausedPersist() {
  console.log('\n▶ Pause/resume — persist + sync runtime');
  const applier = freshConfigApplier();
  const controls = freshRuntimeControls();
  await applier.initFromFile();

  applier.setPostsPaused(true);
  await applier.persistPatch();
  assert(controls.isPostsPaused() === true, 'postsPaused in-memory após set');

  const applier2 = freshConfigApplier();
  freshRuntimeControls();
  await applier2.initFromFile();
  const controls2 = require(path.join(HANORK_ROOT, 'zero-divu', 'src', 'ipc', 'runtimeControls'));
  assert(controls2.isPostsPaused() === true, 'postsPaused restaurado do patch no boot');

  applier2.setPostsPaused(false);
  await applier2.persistPatch();
  assert(controls2.isPostsPaused() === false, 'postsPaused resume imediato');
}

async function testPresetScalarPatch() {
  console.log('\n▶ Preset prod — scalars aplicados ao cfg');
  const applier = freshConfigApplier();
  await applier.initFromFile();
  applier.applyPatch({
    OPERATION_PROFILE: 'safe',
    MAX_GROUPS_PER_CYCLE: 3,
    HANORK_PROMO_MAX_GROUPS: 4,
    STARTUP_IMMEDIATE_MAX_GROUPS: 3,
  });
  const cfg = require(path.join(HANORK_ROOT, 'zero-divu', 'src', 'config', 'divulgacao'));
  assert(cfg.MAX_GROUPS_PER_CYCLE === 3, 'MAX_GROUPS_PER_CYCLE aplicado', String(cfg.MAX_GROUPS_PER_CYCLE));
  assert(cfg.HANORK_PROMO_MAX_GROUPS === 4, 'HANORK_PROMO_MAX_GROUPS aplicado');
  assert(cfg.STARTUP_IMMEDIATE_MAX_GROUPS === 3, 'STARTUP_IMMEDIATE_MAX_GROUPS aplicado');
}

async function testIdempotencyCommandId() {
  console.log('\n▶ idempotency — chave por cmd.id');
  const idem = require(path.join(HANORK_ROOT, 'zero-divu', 'src', 'ipc', 'idempotency'));
  const key = idem.resolveKey({ id: 'abc-123', cmd: 'wa.set_max', args: { n: 40 } });
  assert(key === 'wa.set_max:cmd:abc-123', 'resolveKey usa cmd.id em mutações', key);
}

async function testWaIpcHelper() {
  console.log('\n▶ waIpcHelper — offline + limites');
  const helper = require(path.join(HANORK_ROOT, 'src', 'plugins', 'zero-divu', 'waIpcHelper'));
  const offline = helper.formatLimitsText(null, { offline: true });
  assert(offline.includes('indisponível'), 'formatLimitsText offline');

  const text = helper.formatLimitsText({
    profile: 'safe',
    autoProfile: true,
    minMembers: 50,
    autoJoinGroups: true,
    maxJoinPerHour: 2,
    maxGroups: 25,
    postDelayMin: 15000,
    postDelayMax: 15000,
    joinDelayMin: 60000,
    joinDelayMax: 60000,
    postsPaused: false,
    hanorkCampaignEnabled: true,
  });
  assert(text.includes('Delay post'), 'formatLimitsText inclui delays');
  assert(text.includes('15000'), 'formatLimitsText mostra delay post');
}

async function testOperationsSetDelay() {
  console.log('\n▶ operations.setDelay — IPC handler layer');
  const opsPath = path.join(HANORK_ROOT, 'zero-divu', 'src', 'ipc', 'operations.js');
  delete require.cache[require.resolve(opsPath)];
  const operations = require(opsPath);

  const out = await operations.setDelay('join', 45000);
  assert(out.kind === 'join' && out.ms === 45000, 'setDelay retorna kind/ms');

  const cfg = require(path.join(HANORK_ROOT, 'zero-divu', 'src', 'config', 'divulgacao'));
  assert(cfg.JOIN_DELAY_MIN === 45000, 'JOIN_DELAY_MIN runtime após setDelay');
}

async function testIdempotencyMutations() {
  console.log('\n▶ idempotency — comandos mutantes registrados');
  const idem = require(path.join(HANORK_ROOT, 'zero-divu', 'src', 'ipc', 'idempotency'));
  const required = [
    'wa.set_min_members',
    'wa.set_auto_join',
    'wa.preset_prod',
    'wa.clear_antiban_pause',
    'wa.reload_config',
  ];
  for (const cmd of required) {
    assert(idem.sideEffectCommands.has(cmd), `sideEffectCommands inclui ${cmd}`);
  }
}

async function testGetLimitsAutoSync() {
  console.log('\n▶ getLimitsSummary — hanorkAutoSyncEnabled');
  const ops = require(path.join(HANORK_ROOT, 'zero-divu', 'src', 'ipc', 'operations'));
  const summary = ops.getLimitsSummary();
  assert(summary.hanorkAutoSyncEnabled != null, 'getLimitsSummary expõe hanorkAutoSyncEnabled');
}

async function testIpcHandlerSetDelay() {
  console.log('\n▶ IPC server.handleCommand — wa.set_delay ponta a ponta');
  process.env.ZERO_DIVU_IPC_DIR = TMP_IPC;
  const server = require(path.join(HANORK_ROOT, 'zero-divu', 'src', 'ipc', 'server'));
  const ack = await server.handleCommand({
    id: 'test-delay-1',
    cmd: 'wa.set_delay',
    args: { kind: 'post', ms: 22000 },
  });
  assert(ack?.ok === true, 'handleCommand wa.set_delay ok');
  assert(ack.result?.ms === 22000, 'handleCommand retorna ms');

  const patch = await fs.readJson(PATCH_FILE);
  assert(patch.POST_DELAY_MS === 22000, 'patch persistido pelo handler');

  const cfg = require(path.join(HANORK_ROOT, 'zero-divu', 'src', 'config', 'divulgacao'));
  assert(cfg.POST_DELAY_MIN === 22000, 'cfg atualizado imediatamente');
}

async function main() {
  console.log('=== test-wa-config-runtime ===');
  console.log(`IPC temp: ${TMP_IPC}`);

  await setup();
  try {
    await testDelayPersistAndReload();
    await testMaxGroupsNotOverwritten();
    await testPresetScalarPatch();
    await testPostsPausedPersist();
    await testWaIpcHelper();
    await testOperationsSetDelay();
    await testIdempotencyMutations();
    await testIdempotencyCommandId();
    await testGetLimitsAutoSync();
    await testIpcHandlerSetDelay();
  } finally {
    await cleanup();
  }

  console.log(`\n--- ${passed} ok, ${failed} fail ---`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
