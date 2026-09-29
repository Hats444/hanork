'use strict';

/**
 * Smoke test do Campaign Orchestrator (read-only + tick sem envio se nenhum slot).
 * Uso: node scripts/test-campaign-orchestrator.js
 */
require('../src/config/env');

const { isCampaignOrchestratorEnabled, groupSlots, pvSlots } = require('../src/config/campaignConfig');
const {
    getLocalParts,
    dayKey,
    campaignTypeNow,
    getDueGroupSlots,
    getDuePvSlots,
} = require('../src/services/campaign/campaignTimeWindows');
const { getCampaignStore } = require('../src/services/campaign/CampaignStore');
const dbConnect = require('../src/config/database-sqlite').connect;

async function main() {
    const db = dbConnect();
    const store = getCampaignStore(() => db);
    store.ensureSeeded();

    const now = new Date();
    const parts = getLocalParts(now);
    const campaigns = db.prepare('SELECT code, campaign_type, channel, slot_hour FROM campaigns ORDER BY slot_hour').all();
    const deliveries = db.prepare('SELECT COUNT(*) AS c FROM campaign_deliveries').get();
    const history = db.prepare('SELECT COUNT(*) AS c FROM campaign_history').get();

    const dueG = getDueGroupSlots(now);
    const dueP = getDuePvSlots(now);

    console.log('=== Campaign Orchestrator Smoke Test ===');
    console.log('enabled:', isCampaignOrchestratorEnabled());
    console.log('timezone: America/Sao_Paulo');
    console.log('local:', `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${String(parts.minute).padStart(2, '0')}`);
    console.log('dayKey:', dayKey(now));
    console.log('windowType:', campaignTypeNow(now));
    console.log('groupSlots config:', groupSlots().map((s) => `${s.hour}h→${s.type}`).join(', '));
    console.log('pvSlots config:', pvSlots().map((s) => `${s.hour}h→${s.type}`).join(', '));
    console.log('dueGroupSlots:', dueG.length ? dueG : '(nenhum agora)');
    console.log('duePvSlots:', dueP.length ? dueP : '(nenhum agora)');
    console.log('campaigns seeded:', campaigns.length);
    console.log('campaign_deliveries rows:', deliveries.c);
    console.log('campaign_history rows:', history.c);

    if (campaigns.length) {
        console.log('sample campaigns:', campaigns.slice(0, 3).map((c) => c.code).join(', '), '...');
    }

    const ok =
        isCampaignOrchestratorEnabled() &&
        campaigns.length >= 6 &&
        (campaignTypeNow(now) === 'hanork' || campaignTypeNow(now) === 'smm');

    console.log(ok ? '\nRESULT: OK' : '\nRESULT: FAIL');
    process.exit(ok ? 0 : 1);
}

main().catch((e) => {
    console.error('FAIL:', e.message);
    process.exit(1);
});
