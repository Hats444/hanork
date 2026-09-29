'use strict';

/**
 * Testes locais do dual-provider SMM (sem bater nas APIs reais).
 * Uso: node scripts/test-smm-dual-provider.js
 */

process.env.FORNECEDOR_BRASIL_API_KEY = process.env.FORNECEDOR_BRASIL_API_KEY || 'test-ssm-key-12345678';
process.env.UP_FAMA_API_KEY = process.env.UP_FAMA_API_KEY || 'test-up-key-87654321';
process.env.SMM_DUAL_PROVIDER = '1';
process.env.SMM_PROVIDER_MODE = 'auto';

const ProviderManager = require('../src/modules/smm/providers/ProviderManager');
const SsmProviderAdapter = require('../src/modules/smm/providers/ssmProviderAdapter');

let primaryCalls = 0;
let secondaryCalls = 0;

const mockPrimary = {
    name: ProviderManager.PRIMARY_ID,
    origin: 'SSM',
    async getBalance() {
        return { balance: 500, currency: 'BRL' };
    },
    async createOrder() {
        primaryCalls += 1;
        return { error: true, message: 'simulated_ssm_down' };
    },
    async addOrder() {
        return mockPrimary.createOrder(...arguments);
    },
};

const mockSecondary = {
    name: ProviderManager.SECONDARY_ID,
    origin: 'UP',
    async getBalance() {
        return { balance: 500, currency: 'BRL' };
    },
    async createOrder({ serviceId }) {
        secondaryCalls += 1;
        return { order: `UP-${serviceId}-${Date.now()}` };
    },
    async addOrder(serviceId) {
        return mockSecondary.createOrder({ serviceId });
    },
};

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function run() {
    console.log('=== test 1: SSM-only chain when UP key cleared ===');
    const savedUp = process.env.UP_FAMA_API_KEY;
    process.env.UP_FAMA_API_KEY = '';
    ProviderManager._clearTestProviderResolver();
    assert(
        ProviderManager.getProviderChain().join(',') === ProviderManager.PRIMARY_ID,
        'chain should be primary only without UP key'
    );
    process.env.UP_FAMA_API_KEY = savedUp;

    console.log('=== test 2: admin mode override ===');
    ProviderManager.setAdminMode('up');
    assert(ProviderManager.getEffectiveMode() === 'up', 'admin up mode');
    assert(
        ProviderManager.getProviderChain().join(',') === ProviderManager.SECONDARY_ID,
        'chain should be secondary only in up mode'
    );
    ProviderManager.setAdminMode('auto');

    console.log('=== test 3: fallback SSM fail → UP success ===');
    primaryCalls = 0;
    secondaryCalls = 0;
    ProviderManager._setTestMapping({
        mappings: [{ label: 'test', ssmServiceId: 111, upServiceId: 222 }],
    });
    ProviderManager._setTestProviderResolver((id) => {
        if (id === ProviderManager.PRIMARY_ID) return mockPrimary;
        if (id === ProviderManager.SECONDARY_ID) return mockSecondary;
        return null;
    });

    const orderedService = {
        id: 1,
        provider: ProviderManager.PRIMARY_ID,
        provider_service_id: 111,
        cost_price: 10,
        name: 'Test service',
    };
    const candidates = [orderedService];

    const submit = await ProviderManager.submitOrderWithFallback({
        orderedService,
        candidates,
        link: 'https://example.com/post',
        quantity: 1000,
    });

    assert(submit.ok, 'fallback submit should succeed');
    assert(submit.fallback === true, 'should mark fallback');
    assert(primaryCalls >= 1, 'primary should be tried');
    assert(secondaryCalls >= 1, 'secondary should be tried after primary fail');
    assert(submit.providerId === ProviderManager.SECONDARY_ID, 'provider_used should be UP');

    console.log('=== test 4: both providers down ===');
    ProviderManager._setTestProviderResolver((id) => ({
        name: id,
        async createOrder() {
            return { error: true, message: `${id}_down` };
        },
        async addOrder() {
            return this.createOrder(...arguments);
        },
    }));

    const fail = await ProviderManager.submitOrderWithFallback({
        orderedService,
        candidates,
        link: 'https://example.com/post',
        quantity: 1000,
    });
    assert(!fail.ok, 'should fail when all providers down');
    assert(fail.reason === 'all_providers_failed', 'reason should be all_providers_failed');

    console.log('=== test 5: native UP catalog service (Package / Free Fire) ===');
    primaryCalls = 0;
    secondaryCalls = 0;
    ProviderManager._clearTestMapping();
    ProviderManager._setTestProviderResolver((id) => {
        if (id === ProviderManager.PRIMARY_ID) return mockPrimary;
        if (id === ProviderManager.SECONDARY_ID) return mockSecondary;
        return null;
    });

    const upPackageService = {
        id: 3746,
        provider: 'upfama',
        provider_service_id: 1109,
        service_type: 'Package',
        cost_price: 6.5,
        name: '[UP] PASSE DE ELITE FREE FIRE',
    };

    const nativeUp = await ProviderManager.submitOrderWithFallback({
        orderedService: upPackageService,
        candidates: [upPackageService],
        link: '2703421351',
        quantity: 1,
    });

    assert(nativeUp.ok, 'native UP package should submit via UpFama');
    assert(nativeUp.providerId === ProviderManager.SECONDARY_ID, 'native UP should use secondary provider');
    assert(primaryCalls === 0, 'SSM should not be called for native UP catalog service');
    assert(secondaryCalls >= 1, 'UpFama should receive the order');

    console.log('=== test 8: fulfill chain skips SSM for native UP ===');
    ProviderManager._clearTestMapping();
    const upPkg = {
        id: 3746,
        provider: 'upfama',
        provider_service_id: 1109,
        service_type: 'Package',
        cost_price: 6.5,
        active: true,
        name: '[UP] PASSE DE ELITE FREE FIRE',
    };
    const chain = ProviderManager.getFulfillProviderChain(upPkg, [upPkg]);
    assert(
        chain.join(',') === ProviderManager.SECONDARY_ID,
        `native UP chain should be UP only, got: ${chain.join(',')}`
    );

    console.log('=== test 9: assertFulfillAllowed uses flat Package cost on UP ===');
    let ssmBalanceChecked = false;
    ProviderManager._setTestProviderResolver((id) => {
        if (id === ProviderManager.PRIMARY_ID) {
            return {
                name: id,
                async getBalance() {
                    ssmBalanceChecked = true;
                    return { balance: 500, currency: 'BRL' };
                },
            };
        }
        if (id === ProviderManager.SECONDARY_ID) {
            return {
                name: id,
                async getBalance() {
                    return { balance: 5, currency: 'BRL' };
                },
            };
        }
        return null;
    });

    const guard = await ProviderManager.assertFulfillAllowed({
        orderedService: upPkg,
        candidates: [upPkg],
        quantity: 1,
    });
    assert(!ssmBalanceChecked, 'SSM balance should not be checked for native UP package');
    assert(!guard.ok, 'should fail when UP balance too low');
    assert(guard.reason === 'insufficient_provider_balance', 'reason should be insufficient balance');
    assert(guard.providerId === ProviderManager.SECONDARY_ID, 'should check UP provider');
    assert(guard.required === 6.5, `Package cost should be flat 6.5, got ${guard.required}`);

    console.log('=== test 10: resolve order provider from provider_used ===');
    ProviderManager._setTestProviderResolver((id) => ({ name: id }));
    const resolved = ProviderManager.getProviderForOrder({
        provider: ProviderManager.PRIMARY_ID,
        provider_used: ProviderManager.SECONDARY_ID,
    });
    assert(resolved.name === ProviderManager.SECONDARY_ID, 'status should use provider_used');

    console.log('=== test 11: SsmProviderAdapter wraps original client ===');
    assert(typeof SsmProviderAdapter.getServices === 'function', 'adapter exposes getServices');
    assert(typeof SsmProviderAdapter.addOrder === 'function', 'adapter exposes addOrder alias');
    assert(SsmProviderAdapter.name === 'fornecedorbrasil', 'adapter keeps original provider id');

    ProviderManager._clearTestProviderResolver();
    ProviderManager._clearTestMapping();
    console.log('\n✅ All dual-provider tests passed.');
}

run().catch((err) => {
    ProviderManager._clearTestProviderResolver();
    ProviderManager._clearTestMapping();
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
});
