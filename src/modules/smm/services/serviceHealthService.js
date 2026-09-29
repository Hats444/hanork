'use strict';

const logger = require('../../../config/logger');
const SmmConfig = require('../smmConfig');
const SmmServiceRepository = require('../repositories/smmServiceRepository');
const { SERVICE_HEALTH, normalizeHealth } = require('../constants/serviceHealthStatuses');

function healthConfig() {
    return {
        windowDays: SmmConfig.healthWindowDays,
        minSamples: SmmConfig.healthMinSamples,
        warningRate: SmmConfig.healthWarningRate,
        degradedRate: SmmConfig.healthDegradedRate,
        disableRate: SmmConfig.healthDisableRate,
        autoDisable: SmmConfig.healthAutoDisable,
    };
}

/**
 * Taxa de falha = (failed + canceled) / (completed + failed + canceled).
 * Amostras em andamento (submitted/processing/partial) não entram no denominador.
 */
function deriveHealthFromCounts(counts, cfg = healthConfig()) {
    const completed = Number(counts.completed) || 0;
    const failed = Number(counts.failed) || 0;
    const canceled = Number(counts.canceled) || 0;
    const terminal = completed + failed + canceled;

    if (terminal < cfg.minSamples) {
        return { health: SERVICE_HEALTH.HEALTHY, failRate: 0, terminal };
    }

    const failRate = (failed + canceled) / terminal;
    let health = SERVICE_HEALTH.HEALTHY;
    if (failRate >= cfg.disableRate) health = SERVICE_HEALTH.DISABLED;
    else if (failRate >= cfg.degradedRate) health = SERVICE_HEALTH.DEGRADED;
    else if (failRate >= cfg.warningRate) health = SERVICE_HEALTH.WARNING;

    return { health, failRate, terminal };
}

function computeServiceHealth(serviceId, cfg = healthConfig()) {
    const counts = SmmServiceRepository.getOrderHealthCounts(serviceId, cfg.windowDays);
    return deriveHealthFromCounts(counts, cfg);
}

function recalcServiceHealth(serviceId, cfg = healthConfig()) {
    const { health, failRate, terminal } = computeServiceHealth(serviceId, cfg);
    const prev = SmmServiceRepository.findById(serviceId);
    if (!prev) return null;

    const prevHealth = normalizeHealth(prev.service_health);
    const shouldDeactivate =
        cfg.autoDisable && health === SERVICE_HEALTH.DISABLED && prev.active;

    SmmServiceRepository.updateHealth(serviceId, health, shouldDeactivate);

    return {
        serviceId,
        prevHealth,
        health,
        failRate,
        terminal,
        deactivated: shouldDeactivate,
    };
}

async function runServiceHealthJob() {
    const cfg = healthConfig();
    const serviceIds = SmmServiceRepository.listIdsForHealthRecalc(cfg.windowDays);
    let updated = 0;
    let deactivated = 0;
    const summary = { HEALTHY: 0, WARNING: 0, DEGRADED: 0, DISABLED: 0 };

    for (const id of serviceIds) {
        const r = recalcServiceHealth(id, cfg);
        if (!r) continue;
        updated++;
        summary[r.health] = (summary[r.health] || 0) + 1;
        if (r.deactivated) {
            deactivated++;
            logger.warn('[SMM:health] auto-disable', {
                serviceId: id,
                failRate: r.failRate,
                terminal: r.terminal,
            });
        } else if (r.health !== r.prevHealth) {
            logger.info('[SMM:health] status change', {
                serviceId: id,
                from: r.prevHealth,
                to: r.health,
                failRate: r.failRate,
            });
        }
    }

    if (updated > 0) {
        logger.info('[SMM:health] recalc OK', { checked: updated, deactivated, summary });
    }

    return { checked: updated, deactivated, summary };
}

function countByHealth(activeOnly = true) {
    return SmmServiceRepository.countByHealth(activeOnly);
}

module.exports = {
    healthConfig,
    deriveHealthFromCounts,
    computeServiceHealth,
    recalcServiceHealth,
    runServiceHealthJob,
    countByHealth,
};
