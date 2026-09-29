#!/usr/bin/env node
'use strict';
const root = require('path').join(__dirname, '..');
process.chdir(root);
require('dotenv').config({ path: require('path').join(root, '.env') });
const VirtuoApiClient = require(require('path').join(root, 'src/modules/virtuo/providers/virtuoApiClient'));
const VirtuoConfig = require(require('path').join(root, 'src/modules/virtuo/virtuoConfig'));

(async () => {
    console.log('key len', VirtuoConfig.apiKey.length, VirtuoConfig.apiKey.slice(0, 8));
    const bal = await VirtuoApiClient.getBalance();
    console.log('balance', JSON.stringify(bal));
    const act = await VirtuoApiClient.requestActivation({
        service: process.argv[2] || 'wa',
        country: Number(process.argv[3] || 39),
        server: 1,
        maxPrice: Number(process.argv[4] || 6.09),
    });
    console.log('activation', JSON.stringify(act));
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
