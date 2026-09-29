'use strict';

/** Smoke tests — roda com: node scripts/verify-spec.js */
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const checkpoints = require('../src/services/checkpoints');
assert(checkpoints.TYPES.length === 6, 'checkpoints: 6 types');

const postagem = require('../src/services/postagem');
assert(typeof postagem.startWorkers === 'function', 'postagem.startWorkers');
assert(typeof postagem.stopWorkers === 'function', 'postagem.stopWorkers');

const qm = require('../src/services/queueManager');
assert(typeof qm.startAll === 'function', 'queueManager.startAll');
assert(typeof qm.freeze === 'function', 'queueManager.freeze');
assert(typeof qm.waitForDrain === 'function', 'queueManager.waitForDrain');

const hb = require('../src/services/processHeartbeat');
hb.markCleanExit();
assert(hb.wasCrash() === false, 'wasCrash false after clean exit');

const activeHours = require('../src/utils/activeHours');
assert(typeof activeHours.isActiveNow === 'function', 'activeHours');

const terminal = require('../src/utils/terminalAdapter');
assert(typeof terminal.formatRow === 'function', 'terminalAdapter');

const persistentLocks = require('../src/services/persistentLocks');
const persistentQueue = require('../src/services/persistentQueue');
const lock = persistentLocks.acquire('test', { key: 'verify' }, 5000);
persistentLocks.release(lock.lockId);
const job = persistentQueue.enqueue('delivery', 'test', { cycleKey: `verify-${Date.now()}` });
const claimed = persistentQueue.claimById('delivery', job.id);
assert(claimed?.processingState === 'inline', 'claimById inline');
persistentQueue.complete('delivery', job.id);

const ges = require('../src/services/groupEventScheduler');
assert(typeof ges.start === 'function', 'groupEventScheduler');
assert(ges.isEnabled() === true, 'event scheduler enabled');

const jsonWriteLock = require('../src/utils/jsonWriteLock');
const got = jsonWriteLock.acquire('verify-lock', 5000);
assert(got.ok, 'jsonWriteLock');
jsonWriteLock.release('verify-lock');

const metrics = require('../src/services/metrics');
assert(typeof metrics.getPostsPerHour === 'function', 'metrics postsPerHour');
assert(typeof metrics.getThroughputPerHour === 'function', 'metrics throughput');

const recovery = require('../src/services/runtimeRecovery');
assert(typeof recovery.restoreFromSnapshot === 'function', 'restoreFromSnapshot');

const socketRegistry = require('../src/services/socketRegistry');
assert(typeof socketRegistry.close === 'function', 'socketRegistry');

const gc = require('../src/services/groupClassifier');

const denyProfile = gc.classify({
  subject: 'Família war',
  desc: 'Grupo de resenha entre amigos. Proibido divulgar links.',
});
assert(denyProfile.postPermission === 'denied', 'classifier: proibido divulgar → denied');

const allowProfile = gc.classify({
  subject: 'Lista de Divulgação BR',
  desc: 'Regras: divulga livre, links permitidos, parcerias bem-vindas.',
});
assert(allowProfile.postPermission === 'allowed', 'classifier: divulga livre → allowed');

const emptyProfile = gc.classify({ subject: 'Grupo Teste', desc: '' });
assert(
  emptyProfile.postPermission === 'allowed',
  'classifier: sem descrição → allowed (modo divulgação)'
);

const divNameProfile = gc.classify({ subject: 'Lista Divulgação BR', desc: '' });
assert(
  divNameProfile.postPermission === 'allowed' && divNameProfile.action === 'stay',
  'classifier: grupo sem regras → entra no ciclo (stay)'
);

const chatProfile = gc.classify({
  subject: 'Compras e Vendas Campina',
  desc: 'Somente conversa sobre compras locais. Sem spam.',
});
assert(
  chatProfile.action === 'visit_once' || chatProfile.postPermission !== 'allowed',
  'classifier: chat/compras não vira allowed automático'
);

const resilience = require('../src/services/connectionResilience');
resilience.recordDisconnect(440);
assert(resilience.computeDelayMs(440) >= 15000, '440 backoff min 15s');
resilience.markGhostWaitDone();
assert(resilience.computeDelayMs(440) <= 15000, '440 backoff after ghost settle only');
assert(typeof require('../src/services/socketRegistry').setWarmup === 'function', 'socketRegistry.setWarmup');
assert(typeof require('../src/services/socketRegistry').isWarmingUp === 'function', 'socketRegistry.isWarmingUp');
assert(typeof require('../src/bot').pause === 'function', 'bot.pause');
assert(typeof require('../src/bot').resume === 'function', 'bot.resume');

const gp = require('../src/services/groupProfile');
assert(typeof gp.hasUsableDescription === 'function', 'groupProfile.hasUsableDescription');
assert(typeof require('../src/services/groupMetadataCache').get === 'function', 'metadataCache');

assert(typeof require('../src/services/groupReclassify').pause === 'function', 'reclassify.pause');
assert(typeof require('../src/services/groupReclassify').scheduleWhenStable === 'function', 'scheduleWhenStable');

const singleInstance = require('../src/services/singleInstance');
const env = require('../src/utils/environmentDetector');
assert(typeof singleInstance.acquire === 'function', 'singleInstance.acquire');
const fs = require('fs');
assert(typeof env.getRuntimeLabel === 'function', 'getRuntimeLabel');
assert(typeof env.getBootHint === 'function', 'getBootHint');
assert(typeof require('../src/services/sessionBackup').backup === 'function', 'sessionBackup');
const refreshed = env.refresh();
assert(refreshed.isWSL === false || refreshed.runtimeLabel.includes('WSL') || process.platform === 'win32', 'WSL label');
assert(fs.existsSync(require('path').join(__dirname, 'stop-bot.js')), 'stop-bot.js');
assert(typeof require('../src/services/conflict440Resolver').autoResolve === 'function', 'conflict440Resolver');
assert(typeof singleInstance.killAllOthers === 'function', 'singleInstance.killAllOthers');
assert(typeof singleInstance.release === 'function', 'singleInstance.release');

assert(typeof require('../src/services/postGuard').healForbiddenPending === 'function', 'healForbiddenPending');
assert(typeof require('../src/services/databaseMaintenance').run === 'function', 'databaseMaintenance');
assert(typeof require('../src/services/forbiddenCleanup').purgeForbiddenFromFiles === 'function', 'forbiddenCleanup');
assert(fs.existsSync(require('path').join(__dirname, 'ensure-single.js')), 'ensure-single.js');
assert(typeof singleInstance.claimExclusive === 'function', 'claimExclusive');

const ipcAuth = require('../src/ipc/auth');
const ipcEnvKeys = ['ZERO_IPC_TOKEN', 'ZERO_IPC_AUTH_REQUIRED'];
const ipcEnvSnap = Object.fromEntries(ipcEnvKeys.map((k) => [k, process.env[k]]));
try {
  process.env.ZERO_IPC_TOKEN = 'test-ipc-secret';
  process.env.ZERO_IPC_AUTH_REQUIRED = '1';
  assert(ipcAuth.validateCommand({ cmd: 'wa.ping', token: 'test-ipc-secret' }).ok, 'ipc auth ok');
  assert(!ipcAuth.validateCommand({ cmd: 'wa.ping' }).ok, 'ipc auth missing token');
  assert(
    ipcAuth.validateCommand({ cmd: 'wa.ping' }).error === 'ipc_auth_missing',
    'ipc auth missing error code'
  );
  assert(!ipcAuth.validateCommand({ cmd: 'wa.ping', token: 'wrong' }).ok, 'ipc auth invalid token');
  process.env.ZERO_IPC_AUTH_REQUIRED = '0';
  assert(ipcAuth.validateCommand({ cmd: 'wa.ping' }).ok, 'ipc compat without token');
  assert(ipcAuth.validateCommand({ cmd: 'wa.ping', token: 'wrong' }).ok, 'ipc compat ignores bad token');
} finally {
  for (const k of ipcEnvKeys) {
    if (ipcEnvSnap[k] === undefined) delete process.env[k];
    else process.env[k] = ipcEnvSnap[k];
  }
}

console.log('verify-spec: OK (v1.7.2)');
