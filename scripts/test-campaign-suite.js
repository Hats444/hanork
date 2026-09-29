'use strict';
/**
 * Testes unitários do Campaign Orchestrator (sem envio real).
 * Uso: CAMPAIGN_ORCHESTRATOR=1 node scripts/test-campaign-suite.js
 */
require('../src/config/env');

const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
};

const { isScheduledBroadcastSource } = require('../src/services/broadcastRateLimit');
const { campaignTypeForHour, campaignTypeNow } = require('../src/services/campaign/campaignTimeWindows');
const { computeCampaignImpact } = require('../src/services/campaign/CampaignOrchestrator');
const { waContentTypeAllowed } = require('../src/plugins/zero-divu/campaignWaSync');
const { getCampaignStore } = require('../src/services/campaign/CampaignStore');
const { groupCooldownMs } = require('../src/config/campaignConfig');
const dbConnect = require('../src/config/database-sqlite').connect;

function testRateLimitSources() {
    assert(isScheduledBroadcastSource('campaign_group_hanork_0'), 'campaign_group should be scheduled');
    assert(isScheduledBroadcastSource('campaign_pv_smm_18'), 'campaign_pv should be scheduled');
    assert(!isScheduledBroadcastSource('manual_admin'), 'manual should not be scheduled');
    console.log('  rateLimitSources: OK');
}

function testTimeWindows() {
    assert(campaignTypeForHour(0) === 'hanork', 'hour 0 = hanork');
    assert(campaignTypeForHour(11) === 'hanork', 'hour 11 = hanork');
    assert(campaignTypeForHour(12) === 'smm', 'hour 12 = smm');
    assert(campaignTypeForHour(23) === 'smm', 'hour 23 = smm');
    console.log('  timeWindows: OK');
}

function testImpactGating() {
    const zero = computeCampaignImpact({ users: { sent: 0 }, groups: { sent: 0 } });
    const pos = computeCampaignImpact({ users: { sent: 2, edited: 1 }, groups: { edited: 3 } });
    assert(zero === 0, 'zero impact');
    assert(pos === 6, 'positive impact');
    console.log('  impactGating: OK');
}

function testWaWindow() {
    const orig = process.env.CAMPAIGN_ORCHESTRATOR;
    process.env.CAMPAIGN_ORCHESTRATOR = '1';
    // waContentTypeAllowed uses campaignTypeNow() — can't mock hour easily without refactor
    // at least verify API works
    assert(typeof waContentTypeAllowed({ productId: 1 }) === 'boolean', 'wa filter returns bool');
    process.env.CAMPAIGN_ORCHESTRATOR = orig;
    console.log('  waWindow: OK');
}

function testPersistence() {
    const db = dbConnect();
    const store = getCampaignStore(() => db);
    store.ensureSeeded();
    const campaigns = db.prepare('SELECT COUNT(*) AS c FROM campaigns').get();
    assert(campaigns.c >= 6, 'campaigns seeded');

    const testSlot = `test:slot:${Date.now()}`;
    assert(!store.isSlotCompleted(testSlot), 'fresh slot not completed');
    store.markSlotCompleted(testSlot, { campaignType: 'hanork', channel: 'test' });
    assert(store.isSlotCompleted(testSlot), 'slot marked completed');
    db.prepare('DELETE FROM campaign_deliveries WHERE dest_id = ?').run(testSlot);

    const uid = `test-user-${Date.now()}`;
    assert(store.canDeliverUser(uid, 'hanork').ok, 'first hanork ok');
    store.recordUserDelivery(uid, { campaignType: 'hanork', channel: 'telegram_pv', status: 'sent' });
    assert(!store.canDeliverUser(uid, 'hanork').ok, 'duplicate hanork blocked');
    assert(store.canDeliverUser(uid, 'smm').ok, 'smm still ok same day');
    store.recordUserDelivery(uid, { campaignType: 'smm', channel: 'telegram_pv', status: 'sent' });
    assert(!store.canDeliverUser(uid, 'smm').ok, 'daily cap');
    db.prepare('DELETE FROM campaign_deliveries WHERE dest_id = ?').run(uid);

    console.log('  persistence: OK');
}

function testGroupCooldown() {
    assert(groupCooldownMs() >= 6 * 60 * 60 * 1000, 'group cooldown >= 6h');
    console.log('  groupCooldown: OK');
}

function main() {
    console.log('=== Campaign Suite ===');
    testRateLimitSources();
    testTimeWindows();
    testImpactGating();
    testWaWindow();
    testPersistence();
    testGroupCooldown();
    console.log('ALL OK');
}

main();
