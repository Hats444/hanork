'use strict';

const { checksum } = require('./atomicWrite');

const isoOk = (v) => {
  if (!v) return true;
  const t = new Date(v).getTime();
  return Number.isFinite(t) && t > 0 && t <= Date.now() + 86400000;
};

const schemas = {
  'gruposAtivos.json': (d) => typeof d === 'object' && d !== null && !Array.isArray(d),
  'antiBanState.json': (d) => typeof d === 'object' && d !== null,
  'schedulerState.json': (d) =>
    typeof d === 'object' && d !== null && typeof d.groups === 'object',
  'warmupState.json': (d) => typeof d === 'object' && d !== null,
  'metricsState.json': (d) => typeof d === 'object' && d !== null,
  'rotationState.json': (d) => typeof d === 'object' && d !== null,
  'groupReputation.json': (d) => typeof d === 'object' && d !== null,
  'patternGuardState.json': (d) => typeof d === 'object' && d !== null,
  'recoveryMode.json': (d) => typeof d === 'object' && d !== null,
  'processHeartbeat.json': (d) => typeof d === 'object' && d !== null && isoOk(d.at),
  'timerRegistry.json': (d) => typeof d === 'object' && d !== null,
  'persistentLocks.json': (d) => Array.isArray(d?.locks) || d?.locks === undefined,
  'queue_join.json': (d) => Array.isArray(d?.jobs) || d?.jobs === undefined,
  'queue_delivery.json': (d) => Array.isArray(d?.jobs) || d?.jobs === undefined,
  'queue_retry.json': (d) => Array.isArray(d?.jobs) || d?.jobs === undefined,
  'queue_maintenance.json': (d) => Array.isArray(d?.jobs) || d?.jobs === undefined,
  'queue_cooldown.json': (d) => Array.isArray(d?.jobs) || d?.jobs === undefined,
  'deliveryDedup.json': (d) => Array.isArray(d?.deliveries) || d?.deliveries === undefined,
};

exports.validate = (name, data) => {
  if (data === null || data === undefined) return { ok: false, reason: 'null' };
  const fn = schemas[name];
  if (fn && !fn(data)) return { ok: false, reason: 'schema' };

  if (name === 'schedulerState.json' && data.groups) {
    for (const g of Object.values(data.groups)) {
      if (g.nextPostAt && !isoOk(g.nextPostAt)) return { ok: false, reason: 'timestamp' };
      if (g.lastPostAt && !isoOk(g.lastPostAt)) return { ok: false, reason: 'timestamp' };
    }
  }

  return { ok: true };
};

exports.verifyChecksum = (filePath, rawContent) => {
  try {
    const fs = require('fs');
    const metaPath = `${filePath}.meta.json`;
    if (!fs.existsSync(metaPath)) return { ok: true, skipped: true };
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (!meta.checksum) return { ok: true, skipped: true };
    if (meta.at && !isoOk(meta.at)) return { ok: false, reason: 'meta-timestamp' };
    const actual = checksum(rawContent);
    if (actual !== meta.checksum) return { ok: false, reason: 'checksum' };
    return { ok: true };
  } catch {
    return { ok: true, skipped: true };
  }
};

module.exports = exports;
