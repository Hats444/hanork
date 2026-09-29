'use strict';

const logger = require('../../../config/logger');
const { deferBackground } = require('../../../utils/defer');
const { getWaDivulgacaoCampaignService } = require('../waDivulgacaoCampaignService');

async function processWaDivCampaign(job) {
    const bot = global.botInstance;
    const data = job?.data || {};
    const telegramId = data.telegramId;
    if (!telegramId || !bot?.telegram) {
        throw new Error('wadv:campaign job sem telegramId ou bot');
    }

    const camp = getWaDivulgacaoCampaignService();
    const jobId = data.jobId || `wadv-sched-${telegramId}-${Date.now()}`;

    logger.info('[WADV_QUEUE] Executando campanha agendada', {
        jobId: job.id,
        telegramId,
        mode: data.mode,
        groups: data.groupIds?.length,
    });

    const r = await camp.executeCampaign(telegramId, { ...data, jobId }, { scheduled: true });

    const uid = Number(telegramId);
    if (r.ok) {
        const { getWaDivulgacaoClient } = require('../waDivulgacaoClient');
        const { client } = getWaDivulgacaoClient(telegramId);
        const ctx = { telegram: bot.telegram, from: { id: uid } };
        deferBackground(`wadv-sched-blast-${jobId}`, () =>
            camp.notifyBlastDone(ctx, client, uid, jobId, data.groupIds?.length || 0, {
                mode: data.mode,
                cycles: data.cycles,
                scheduled: true,
            })
        );
        await bot.telegram.sendMessage(
            uid,
            `🚀 <b>Campanha agendada disparada</b>\n\n${r.message || 'Em andamento…'}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    } else {
        await bot.telegram.sendMessage(
            uid,
            `❌ <b>Campanha agendada falhou</b>\n\n${r.message || 'Erro desconhecido'}`,
            { parse_mode: 'HTML' }
        ).catch(() => {});
    }

    return r;
}

module.exports = { processWaDivCampaign };
