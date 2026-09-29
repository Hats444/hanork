#!/usr/bin/env node
'use strict';
/**
 * Diagnóstico Zero Two API — DNS + HTTP rápido.
 * Uso: node scripts/test-zerotwo-api.js
 */
require('dotenv').config();
const dns = require('dns').promises;
const axios = require('axios');
const { getZerotwoApiHost } = require('../src/config/zerotwoReachability');

async function main() {
    const base = String(process.env.ZEROTWO_API || 'https://zero-two-apis.com.br').replace(/\/$/, '');
    const key = process.env.API_KEY_ZEROTWO || '';
    const host = getZerotwoApiHost();

    console.log('ZEROTWO_API:', base);
    console.log('API_KEY_ZEROTWO:', key ? `${key.slice(0, 4)}…` : '(ausente)');
    console.log('');

    if (!host) {
        console.error('FAIL — URL inválida');
        process.exit(1);
    }

    try {
        const addrs = await dns.lookup(host, { all: true });
        console.log('DNS OK:', host, '→', addrs.map((a) => a.address).join(', '));
    } catch (e) {
        console.error('DNS FAIL:', host, '—', e.code || e.message);
        console.error('');
        console.error('O domínio não resolve (NXDOMAIN / ENOTFOUND).');
        console.error('Ações: renovar DNS do domínio OU atualizar ZEROTWO_API no .env com a URL correta.');
        console.error('Enquanto isso: catálogo/broadcast usam template (sem GPT).');
        process.exit(1);
    }

    if (!key) {
        console.warn('WARN — API_KEY_ZEROTWO ausente; pulando teste HTTP');
        process.exit(0);
    }

    const url = `${base}/api/ia/gpt?query=${encodeURIComponent('ping')}&apikey=${encodeURIComponent(key)}`;
    try {
        const res = await axios.get(url, { timeout: 15000, validateStatus: () => true });
        console.log('HTTP', res.status, res.statusText || '');
        if (res.status >= 200 && res.status < 300) {
            console.log('OK — API respondeu');
            process.exit(0);
        }
        console.warn('WARN — API respondeu mas status não-2xx');
        process.exit(1);
    } catch (e) {
        console.error('HTTP FAIL:', e.code || e.message);
        process.exit(1);
    }
}

main();
