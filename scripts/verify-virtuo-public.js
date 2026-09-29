#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { canUseVirtuoCatalog, isVirtuoPublicAccess } = require('../src/modules/virtuo/virtuoAccess');
const VirtuoConfig = require('../src/modules/virtuo/virtuoConfig');
const VirtuoApiClient = require('../src/modules/virtuo/providers/virtuoApiClient');

async function main() {
    const nonAdminUid = 123456789;
    const checks = {
        VIRTUO_ENABLED: process.env.VIRTUO_ENABLED,
        VIRTUO_PUBLIC: process.env.VIRTUO_PUBLIC,
        publicAccess: VirtuoConfig.publicAccess,
        isVirtuoPublicAccess: isVirtuoPublicAccess(),
        nonAdminCanUseCatalog: canUseVirtuoCatalog(nonAdminUid, () => false),
    };

    let balance = null;
    try {
        const r = await VirtuoApiClient.getBalance();
        balance = r.data;
    } catch (e) {
        balance = { error: e.message };
    }

    const nf = await VirtuoApiClient.fetchPricesList('nf');
    const nfCountries = nf?.ok && Array.isArray(nf?.data?.prices) ? nf.data.prices.length : 0;

    const ok =
        checks.nonAdminCanUseCatalog &&
        String(checks.VIRTUO_PUBLIC) === '1' &&
        !balance?.error;

    console.log('=== Virtuo público ===');
    console.log(JSON.stringify({ checks, balance, nfCountries }, null, 2));
    console.log(ok ? '\nALL OK — catálogo aberto ao público' : '\nFAIL — revisar gate ou API');
    process.exit(ok ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
