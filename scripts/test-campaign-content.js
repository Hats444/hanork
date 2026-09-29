'use strict';
/** Testa geração de conteúdo por tipo (sem envio). */
require('../src/config/env');
const dbConnect = require('../src/config/database-sqlite').connect;
const { AutoBroadcastService } = require('../src/services/AutoBroadcastService');
const { BroadcastService } = require('../src/services/BroadcastService');
const { campaignTypeNow } = require('../src/services/campaign/campaignTimeWindows');

async function main() {
    const dbRaw = () => dbConnect();
    const broadcastService = new BroadcastService({ dbRaw, bot: null });
    const svc = new AutoBroadcastService({
        dbRaw,
        broadcastService,
        loadProducts: async () => dbRaw().prepare('SELECT * FROM products WHERE active=1').all(),
        prisma: null,
        getBotUsername: async () => process.env.BOT_USERNAME || 'hanork_bot',
        getMaintenanceMode: () => false,
    });

    const window = campaignTypeNow();
    const hanork = await svc.buildForCampaignType('hanork');
    const smm = await svc.buildForCampaignType('smm');

    console.log('window:', window);
    console.log('hanork:', { productId: hanork.productId, smm: !!hanork.smmBroadcast, textLen: (hanork.texto || '').length });
    console.log('smm:', { productId: smm.productId, smm: !!smm.smmBroadcast, variant: smm.smmVariantId, textLen: (smm.texto || '').length });

    const ok = (hanork.texto || '').length > 20 && (smm.texto || '').length > 20;
    console.log(ok ? 'CONTENT: OK' : 'CONTENT: FAIL');
    process.exit(ok ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
