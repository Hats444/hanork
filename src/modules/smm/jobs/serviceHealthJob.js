'use strict';

const { runServiceHealthJob } = require('../services/serviceHealthService');

async function runServiceHealthMonitorJob() {
    return runServiceHealthJob();
}

module.exports = { runServiceHealthMonitorJob };
