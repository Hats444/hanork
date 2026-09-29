'use strict';

const watchdog = require('./watchdog');
const runtimeSnapshot = require('./runtimeSnapshot');
const processHeartbeat = require('./processHeartbeat');
const metrics = require('./metrics');
const groupHealth = require('./groupHealth');

exports.start = () => {
  processHeartbeat.start(30000);
  runtimeSnapshot.savePeriodic(120000);
  watchdog.start(90000);
};

exports.stop = () => {
  watchdog.stop();
  processHeartbeat.stop();
  try {
    processHeartbeat.markCleanExit();
  } catch {
    /* ignore */
  }
};

exports.healthCheck = () => {
  const dead = groupHealth.markDeadGroups();
  return {
    metrics: metrics.snapshot(),
    deadMarked: dead,
    heartbeat: processHeartbeat.load(),
  };
};

module.exports = exports;
