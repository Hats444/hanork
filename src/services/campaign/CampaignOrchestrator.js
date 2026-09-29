'use strict';

const logger = require('../../config/logger');
const { stateManager } = require('../../infrastructure');
const { isCampaignOrchestratorEnabled, maxPvCampaignsPerDay } = require('../../config/campaignConfig');
const {
    dayKey,
    getDueGroupSlots,
    getDuePvSlots,
    groupSlotKey,
    pvSlotKey,
} = require('./campaignTimeWindows');
const { getCampaignStore } = require('./CampaignStore');

function computeCampaignImpact(result) {
    const u = result?.users || {};
    const g = result?.groups || {};
    const c = result?.channels || {};
    const bp = result?.bridgePromo || {};
    return (
        (u.sent || 0) +
        (u.edited || 0) +
        (g.sent || 0) +
        (g.edited || 0) +
        (c.sent || 0) +
        (c.edited || 0) +
        (bp.sent || 0) +
        (bp.edited || 0)
    );
}

function scheduleSlotRetry(store, slotKey, { campaignType, channel, retryMs, payload }) {
    const runAt = Date.now() + retryMs;
    store.enqueueSlotRetry({
        idempotencyKey: `retry:${slotKey}`,
        campaignType,
        channel,
        runAtMs: runAt,
        payload,
    });
    logger.info('[CampaignOrchestrator] retry agendado', {
        slotKey,
        retryMin: Math.round(retryMs / 60000),
    });
}

async function finalizeSlotRun(store, {
    slotKey,
    slot,
    channel,
    source,
    built,
    result,
    service,
    startedAt,
    isGroup,
}) {
    const impact = computeCampaignImpact(result);
    const onlyRateLimited =
        impact === 0 &&
        ((result.users?.rateLimited || 0) +
            (result.groups?.rateLimited || 0) +
            (result.channels?.rateLimited || 0) +
            (result.bridgePromo?.rateLimited || 0) >
            0);

    store.recordHistory({
        slotKey,
        campaignType: slot.type,
        channel,
        source,
        stats: { ...result, impact, onlyRateLimited },
        startedAt,
        finishedAt: Date.now(),
    });

    if (impact > 0) {
        store.markSlotCompleted(slotKey, {
            campaignType: slot.type,
            channel,
            stats: isGroup
                ? { groups: result.groups, channels: result.channels, bridge: result.bridgePromo }
                : { users: result.users },
        });

        try {
            const { enqueueWaAfterCampaign } = require('../../plugins/zero-divu/campaignWaSync');
            await enqueueWaAfterCampaign(service, built, result, source, {
                slot,
                channel,
                hour: slot.hour,
            });
        } catch (e) {
            logger.warn('[CampaignOrchestrator] WA pós-slot:', e.message);
        }
    } else if (onlyRateLimited) {
        const BroadcastAdaptiveThrottle = require('../BroadcastAdaptiveThrottle');
        BroadcastAdaptiveThrottle.bindDb(service.dbRaw);
        scheduleSlotRetry(store, slotKey, {
            campaignType: slot.type,
            channel,
            retryMs: BroadcastAdaptiveThrottle.getPartialRetryMs(),
            payload: { hour: slot.hour, type: slot.type, isGroup },
        });
    } else {
        logger.info('[CampaignOrchestrator] slot sem entregas — não marca completo', { slotKey });
    }

    return impact;
}

async function runGroupSlot(service, slot, slotKey) {
    const store = getCampaignStore(service.dbRaw);
    if (store.isSlotCompleted(slotKey)) return { skipped: true, reason: 'already_done' };

    const startedAt = Date.now();
    const built = await service.buildForCampaignType(slot.type);
    const source = `campaign_group_${slot.type}_${slot.hour}`;

    service._cycleRunning = true;
    try {
        const result = await service._executeBuiltBroadcast(built, source, {
            targets: { users: false, groups: true, channels: true },
            campaignType: slot.type,
            campaignSlotKey: slotKey,
            enforceAutoRateLimit: true,
            skipBridgePromo: true,
        });
        if (!result.success) {
            logger.warn('[CampaignOrchestrator] grupo falhou', { slotKey, error: result.error });
            return result;
        }

        const impact = await finalizeSlotRun(store, {
            slotKey,
            slot,
            channel: 'telegram_group',
            source,
            built,
            result,
            service,
            startedAt,
            isGroup: true,
        });

        logger.info('[CampaignOrchestrator] slot grupo OK', {
            slotKey,
            type: slot.type,
            hour: slot.hour,
            impact,
            groups: result.groups?.total,
            channels: result.channels?.total,
        });
        return { success: true, impact, ...result };
    } finally {
        service._cycleRunning = false;
    }
}

async function runPvSlot(service, slot, slotKey) {
    const store = getCampaignStore(service.dbRaw);
    if (store.isSlotCompleted(slotKey)) return { skipped: true, reason: 'already_done' };

    const startedAt = Date.now();
    const built = await service.buildForCampaignType(slot.type);
    const source = `campaign_pv_${slot.type}_${slot.hour}`;

    service._cycleRunning = true;
    try {
        const result = await service._executeBuiltBroadcast(built, source, {
            targets: { users: true, groups: false, channels: false },
            campaignType: slot.type,
            campaignSlotKey: slotKey,
            campaignMaxPerDay: maxPvCampaignsPerDay(),
            enforceAutoRateLimit: true,
            skipBridgePromo: true,
        });
        if (!result.success) {
            logger.warn('[CampaignOrchestrator] PV falhou', { slotKey, error: result.error });
            return result;
        }

        const impact = await finalizeSlotRun(store, {
            slotKey,
            slot,
            channel: 'telegram_pv',
            source,
            built,
            result,
            service,
            startedAt,
            isGroup: false,
        });

        logger.info('[CampaignOrchestrator] slot PV OK', {
            slotKey,
            type: slot.type,
            hour: slot.hour,
            impact,
            users: result.users?.queued ?? result.users?.total,
        });
        return { success: true, impact, ...result };
    } finally {
        service._cycleRunning = false;
    }
}

async function processQueueRetries(service) {
    const store = getCampaignStore(service.dbRaw);
    const due = store.listDueQueueRetries();
    const dk = dayKey();

    for (const row of due) {
        let payload = {};
        try {
            payload = row.payload_json ? JSON.parse(row.payload_json) : {};
        } catch {
            payload = {};
        }
        const slot = { hour: payload.hour, type: payload.type || row.campaign_type };
        if (!Number.isFinite(slot.hour)) {
            store.markQueueDone(row.idempotency_key, 'invalid');
            continue;
        }
        const slotKey = payload.isGroup
            ? groupSlotKey(dk, slot.hour)
            : pvSlotKey(dk, slot.type, slot.hour);
        if (store.isSlotCompleted(slotKey)) {
            store.markQueueDone(row.idempotency_key, 'skipped');
            continue;
        }
        const lockKey = `campaign:retry:${row.idempotency_key}`;
        if (!stateManager.acquireLock(lockKey, 20 * 60 * 1000)) continue;
        try {
            if (payload.isGroup) await runGroupSlot(service, slot, slotKey);
            else await runPvSlot(service, slot, slotKey);
            store.markQueueDone(row.idempotency_key, 'done');
        } catch (e) {
            logger.error('[CampaignOrchestrator] retry:', e.message);
        } finally {
            stateManager.releaseLock(lockKey);
        }
    }
}

/**
 * Tick do orquestrador (substitui ciclo monolítico quando CAMPAIGN_ORCHESTRATOR=1).
 * @returns {boolean} true se o legado deve ser ignorado neste tick
 */
async function maybeRunCampaignOrchestrator(service) {
    if (!isCampaignOrchestratorEnabled()) return false;
    if (!service.isEnabled()) return true;
    if (service.getMaintenanceMode()) return true;
    if (service._cycleRunning || service.broadcastService?.isRunning) return true;

    const bootGrace = service._bootGraceMs();
    const uptimeMs = Math.round(process.uptime() * 1000);
    if (bootGrace > 0 && uptimeMs < bootGrace) return true;

    getCampaignStore(service.dbRaw);
    await processQueueRetries(service);

    const dueGroups = getDueGroupSlots();
    const duePv = getDuePvSlots();
    if (dueGroups.length || duePv.length) {
        logger.info('[CampaignOrchestrator] slots devidos', {
            groups: dueGroups.map((s) => `${s.hour}h:${s.type}`),
            pv: duePv.map((s) => `${s.hour}h:${s.type}`),
        });
    }
    if (!dueGroups.length && !duePv.length) return true;

    const dk = dayKey();

    for (const slot of dueGroups) {
        const slotKey = groupSlotKey(dk, slot.hour);
        const lockKey = `campaign:slot:${slotKey}`;
        if (!stateManager.acquireLock(lockKey, 30 * 60 * 1000)) continue;
        try {
            await runGroupSlot(service, slot, slotKey);
        } catch (e) {
            logger.error('[CampaignOrchestrator] grupo:', e.message);
        } finally {
            stateManager.releaseLock(lockKey);
        }
    }

    for (const slot of duePv) {
        const slotKey = pvSlotKey(dk, slot.type, slot.hour);
        const lockKey = `campaign:slot:${slotKey}`;
        if (!stateManager.acquireLock(lockKey, 2 * 60 * 60 * 1000)) continue;
        try {
            await runPvSlot(service, slot, slotKey);
        } catch (e) {
            logger.error('[CampaignOrchestrator] PV:', e.message);
        } finally {
            stateManager.releaseLock(lockKey);
        }
    }

    return true;
}

module.exports = {
    maybeRunCampaignOrchestrator,
    runGroupSlot,
    runPvSlot,
    computeCampaignImpact,
};
