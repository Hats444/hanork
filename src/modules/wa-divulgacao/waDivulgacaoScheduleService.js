'use strict';

const QueueService = require('../queue/QueueService');
const { WA_DIV_CAMPAIGN_QUEUE, isRealQueueEnabled } = require('../queue/QueueHelpers');

async function listPendingCampaigns(telegramId) {
    const tid = String(telegramId);
    if (!isRealQueueEnabled()) return [];

    const queue = QueueService.initQueue(WA_DIV_CAMPAIGN_QUEUE);
    if (!queue?.getJobs) return [];

    const out = [];
    try {
        const jobs = await queue.getJobs(['delayed', 'waiting'], 0, 80);
        for (const job of jobs || []) {
            if (String(job?.data?.telegramId) !== tid) continue;
            let runAt = job.timestamp || Date.now();
            if (job.opts?.delay) runAt += job.opts.delay;
            out.push({
                bullId: job.id,
                jobId: job.data?.jobId || String(job.id),
                mode: job.data?.mode,
                groups: job.data?.groupIds?.length || 0,
                delayMs: job.data?.delayMs,
                cycles: job.data?.cycles,
                runAt: new Date(runAt).toISOString(),
            });
        }
    } catch {
        return [];
    }

    out.sort((a, b) => new Date(a.runAt) - new Date(b.runAt));
    return out;
}

async function cancelCampaignJob(jobId) {
    if (!jobId || !isRealQueueEnabled()) return false;
    const job = await QueueService.getJob(WA_DIV_CAMPAIGN_QUEUE, jobId);
    if (!job?.remove) return false;
    try {
        await job.remove();
        return true;
    } catch {
        return false;
    }
}

module.exports = { listPendingCampaigns, cancelCampaignJob };
