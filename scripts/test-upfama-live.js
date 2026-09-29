'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const UpFamaProvider = require('../src/modules/smm/providers/upFamaProvider');
const ProviderManager = require('../src/modules/smm/providers/ProviderManager');
const SsmProviderAdapter = require('../src/modules/smm/providers/ssmProviderAdapter');

function maskKey(key) {
    if (!key || key.length < 8) return '(empty)';
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

async function main() {
    console.log('=== UP FAMA live API test ===');
    console.log('URL:', process.env.UP_FAMA_API_URL || '(default)');
    console.log('Key:', maskKey(process.env.UP_FAMA_API_KEY));

    const bal = await UpFamaProvider.getBalance();
    if (bal?.error) {
        console.error('❌ balance failed:', bal.message || bal.error);
        process.exit(1);
    }
    console.log('✅ balance:', bal.balance, bal.currency || 'BRL');

    const services = await UpFamaProvider.getServices();
    const count = Array.isArray(services) ? services.length : 0;
    if (!count) {
        console.error('❌ services empty or invalid');
        process.exit(1);
    }
    console.log('✅ services:', count, 'itens');
    const sample = services.slice(0, 3).map((s) => `[${s.service}] ${String(s.name).slice(0, 50)} — R$${s.rate}`);
    sample.forEach((line) => console.log('  ·', line));

    const cached = await ProviderManager.fetchProviderServices(ProviderManager.SECONDARY_ID, true);
    console.log('✅ cache refresh:', cached.length, 'normalizados');

    const chain = ProviderManager.getProviderChain();
    console.log('✅ provider chain:', chain.join(' → '));
    console.log('✅ dual enabled:', ProviderManager.isDualProviderEnabled());

    const ssmBal = await SsmProviderAdapter.getBalance();
    if (ssmBal?.error) {
        console.warn('⚠️ SSM balance:', ssmBal.message || ssmBal.error);
    } else {
        console.log('✅ SSM balance:', ssmBal.balance, ssmBal.currency || 'BRL');
    }

    const allBal = await ProviderManager.fetchAllBalances();
    for (const row of allBal) {
        const status = row.ok ? `${row.balance} ${row.currency}` : row.error;
        console.log(`✅ [${row.label}] ${status} (key ${row.fingerprint})`);
    }

    console.log('\n✅ Live tests OK');
}

main().catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
});
