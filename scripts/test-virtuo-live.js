#!/usr/bin/env node
'use strict';

process.chdir(require('path').join(__dirname, '..'));
require('./src/config/env');

const VirtuoApiClient = require('./src/modules/virtuo/providers/virtuoApiClient');
const VirtuoConfig = require('./src/modules/virtuo/virtuoConfig');

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    console.log('=== Virtuo API live test ===');
    console.log('API URL:', VirtuoConfig.apiUrl);
    console.log('Key:', VirtuoConfig.apiKey ? `${VirtuoConfig.apiKey.slice(0, 8)}…` : '(empty)');

    if (!VirtuoConfig.apiKey) {
        console.error('❌ VIRTUO_API_KEY não configurada');
        process.exit(1);
    }

    const bal = await VirtuoApiClient.getBalance();
    if (!bal.ok) {
        console.error('❌ balance:', bal.error?.message || bal.error);
        process.exit(1);
    }
    console.log('✅ balance:', bal.data?.balanceFormatted || bal.data);

    const prices = await VirtuoApiClient.getPrices('wa', 16, VirtuoConfig.defaultServer);
    if (!prices.ok) {
        console.error('❌ prices wa/br:', prices.error?.message || prices.error);
        process.exit(1);
    }
    console.log('✅ prices WA sample:', JSON.stringify(prices.data?.prices?.slice?.(0, 2) || prices.data, null, 2));

    if (dryRun) {
        console.log('\n✅ Dry-run OK (sem comprar número)');
        process.exit(0);
    }

    console.log('\n⚠️  Para testar compra real, remova --dry-run (debita saldo Virtuo)');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
