#!/usr/bin/env node
'use strict';
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');
const { getProvider } = require('../src/modules/smm/providers/providerRegistry');
(async () => {
    const bal = await getProvider().getBalance();
    console.log(JSON.stringify(bal, null, 2));
    if (bal?.error) process.exit(1);
})().catch((e) => { console.error(e.message); process.exit(1); });
