#!/usr/bin/env node
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const { connect } = require('../src/config/database-sqlite');
connect();

const { runSyncServicesJob } = require('../src/modules/smm/jobs/syncServicesJob');
const SmmConfig = require('../src/modules/smm/smmConfig');

(async () => {
    console.log('Margem:', SmmConfig.marginPercent + '%', '| Min lucro/1000:', 'R$', SmmConfig.minProfit);
    const result = await runSyncServicesJob({ source: 'api', syncType: 'manual_script' });
    console.log('Sync OK:', result.total_processed, 'processados,', result.updated_count, 'atualizados');
    const svc = connect().prepare('SELECT cost_price, sale_price FROM smm_services WHERE id = 406').get();
    if (svc) {
        console.log('Exemplo 406: custo', svc.cost_price, '→ venda', svc.sale_price);
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
