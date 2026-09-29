'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const VirtuoConfig = require('../src/modules/virtuo/virtuoConfig');

async function tryGet(path) {
    const url = `${VirtuoConfig.apiUrl.replace(/\/+$/, '')}/v1${path}`;
    const { status, data } = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${VirtuoConfig.apiKey}`,
            'X-Api-Key': VirtuoConfig.apiKey,
        },
        validateStatus: () => true,
        timeout: 15000,
    });
    console.log(path, status, typeof data === 'object' ? JSON.stringify(data).slice(0, 500) : data);
}

async function main() {
    for (const p of ['', '/docs', '/health', '/activations', '/activation/history', '/prices?service=wa&server=1']) {
        await tryGet(p);
    }
}

main().catch(console.error);
