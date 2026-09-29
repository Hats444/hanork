'use strict';

const dns = require('dns').promises;

const { resolveZerotwoApiBase } = require('./zerotwoEndpoints');

function getZerotwoApiHost() {
    const base = resolveZerotwoApiBase(process.env);
    try {
        return new URL(base).hostname;
    } catch {
        return null;
    }
}

/**
 * Verifica se ZEROTWO_API resolve no DNS (ENOTFOUND = domínio morto/expirado).
 */
async function checkZerotwoApiDns(logger) {
    const host = getZerotwoApiHost();
    if (!host) {
        const msg = '[ZeroTwo AI] ZEROTWO_API inválida no .env';
        logger?.warn?.(msg);
        return { ok: false, reason: 'invalid_url', host: null };
    }
    try {
        const addrs = await dns.lookup(host, { all: true });
        return { ok: true, host, addrs: addrs.map((a) => a.address) };
    } catch (e) {
        const code = e.code || e.message;
        logger?.warn?.('[ZeroTwo AI] DNS falhou — GPT/IA externa indisponível; templates locais ativos', {
            host,
            code,
            hint: 'Defina ZEROTWO_API=https://zero-two-apis.store no .env (domínio oficial jul/2026)',
        });
        return { ok: false, reason: code, host };
    }
}

module.exports = { getZerotwoApiHost, checkZerotwoApiDns };
