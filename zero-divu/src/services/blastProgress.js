'use strict';

const PROGRESS_EVERY_N = Number(process.env.WA_BLAST_PROGRESS_EVERY) || 1;

let lastEmitAt = new Map();

async function emitBlastProgress({
    jobId,
    sent = 0,
    failed = 0,
    skipped = 0,
    total = 0,
    index = 0,
    partial = true,
    done = false,
    campaign = 'blast',
    message = null,
} = {}) {
    if (!jobId) return;
    const key = `${jobId}:${index}:${done ? 'done' : 'partial'}`;
    const now = Date.now();
    if (!done && partial) {
        const prev = lastEmitAt.get(jobId) || 0;
        if (index % PROGRESS_EVERY_N !== 0 && now - prev < 2500) return;
        lastEmitAt.set(jobId, now);
    }
    if (done) lastEmitAt.delete(jobId);

    try {
        await require('../ipc/eventBus').emitPostCycle({
            sent,
            failed,
            skipped,
            total,
            index,
            partial: partial && !done,
            done,
            manual: true,
            campaign,
            jobId,
            message,
            ok: done ? sent > 0 || failed > 0 || skipped > 0 : true,
        });
    } catch {
        /* ignore */
    }
}

module.exports = { emitBlastProgress, PROGRESS_EVERY_N };
