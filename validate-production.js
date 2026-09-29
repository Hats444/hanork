'use strict';

/**
 * Checklist rápido de produção — roda no WSL com node 20.
 * Uso: node scripts/validate-production.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const checks = [];
let failed = 0;

function ok(name, detail = '') {
    checks.push({ ok: true, name, detail });
}

function fail(name, detail = '') {
    checks.push({ ok: false, name, detail });
    failed += 1;
}

async function pingRedis() {
    try {
        const Redis = require('ioredis');
        const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
        const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
        await r.connect();
        const pong = await r.ping();
        await r.quit();
        if (pong === 'PONG') ok('Redis', url);
        else fail('Redis', `resposta inesperada: ${pong}`);
    } catch (e) {
        fail('Redis', e.message);
    }
}

function checkProduct() {
    try {
        const Database = require('better-sqlite3');
        const dbPathRaw =
            process.env.HANORK_DB_PATH ||
            path.join(process.env.HOME || '/home/vendetta', '.hanork', 'hanork.db');
        const dbPath = dbPathRaw.startsWith('~')
            ? path.join(process.env.HOME || '/home/vendetta', dbPathRaw.slice(1))
            : dbPathRaw;
        if (!fs.existsSync(dbPath)) {
            fail('SQLite produto #1', `DB não encontrado: ${dbPath}`);
            return;
        }
        const db = new Database(dbPath, { readonly: true });
        const row = db.prepare('SELECT id, name, price, active FROM products WHERE id = 1').get();
        db.close();
        if (!row) {
            fail('SQLite produto #1', 'produto id=1 ausente');
            return;
        }
        const priceOk = Math.abs(Number(row.price) - 297.9) < 0.01;
        if (row.active && priceOk) {
            ok('SQLite produto #1', `${row.name} — R$ ${Number(row.price).toFixed(2)}`);
        } else {
            fail('SQLite produto #1', JSON.stringify(row));
        }
    } catch (e) {
        fail('SQLite produto #1', e.message);
    }
}

function checkEnv() {
    const key = (process.env.API_KEY_ZEROTWO || '').trim();
    if (key === 'hanorkbots') ok('API_KEY_ZEROTWO', 'hanorkbots');
    else if (key) fail('API_KEY_ZEROTWO', `valor inesperado: ${key}`);
    else fail('API_KEY_ZEROTWO', 'ausente');

    const flags = [
        ['REDIS_FAIL_CLOSED_ENABLED', '1'],
        ['ADMIN_NOTIFY_USE_QUEUE', '1'],
        ['ZERO_IPC_AUTH_REQUIRED', '1'],
        ['ZEROTWO_AI_REDIS_CACHE', '1'],
        ['DASHBOARD_TENANT_ENFORCE', '1'],
        ['BROADCAST_PV_USE_QUEUE', '1'],
    ];
    for (const [name, expected] of flags) {
        const v = String(process.env[name] || '').trim();
        if (v === expected || v === 'true') ok(name, v || expected);
        else fail(name, v ? `=${v}` : 'ausente/desligado');
    }

    if (process.env.ZERO_IPC_TOKEN) ok('ZERO_IPC_TOKEN', 'definido');
    else fail('ZERO_IPC_TOKEN', 'ausente');
}

function checkFotos() {
    const fotosDir = path.join(ROOT, 'fotos');
    if (!fs.existsSync(fotosDir)) {
        fail('Pasta fotos/', 'não encontrada');
        return;
    }
    const imgs = fs.readdirSync(fotosDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
    if (imgs.length) ok('Pasta fotos/', `${imgs.length} imagem(ns)`);
    else fail('Pasta fotos/', 'sem imagens');
}

function checkBroadcastVariants() {
    try {
        const mod = require('../src/data/hanorkBroadcastVariants');
        const photos = mod.listHanorkPromoPhotos(path.join(ROOT, 'fotos'));
        const n = Array.isArray(mod.VARIANTS) ? mod.VARIANTS.length : 0;
        if (photos.length && (n >= 20 || n > 0)) {
            ok('Divulgação TG/WA', `${n || '20+'} textos · ${photos.length} foto(s)`);
        } else {
            fail('Divulgação TG/WA', `textos=${n} fotos=${photos.length}`);
        }
    } catch (e) {
        fail('Divulgação TG/WA', e.message);
    }
}

function httpGet(urlPath, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const port = Number(process.env.PORT) || 3000;
        const req = http.get(
            { hostname: '127.0.0.1', port, path: urlPath, timeout: timeoutMs },
            (res) => {
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () => resolve({ status: res.statusCode, body }));
            }
        );
        req.on('error', (e) => resolve({ error: e.message }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ error: 'timeout' });
        });
    });
}

async function checkHealth() {
    const live = await httpGet('/health/live');
    if (live.status === 200) ok('HTTP /health/live', '200');
    else fail('HTTP /health/live', live.error || String(live.status));

    const metrics = await httpGet('/metrics');
    if (metrics.status === 200 && metrics.body?.includes('hanork_')) {
        ok('HTTP /metrics', 'Prometheus OK');
    } else if (metrics.error) {
        fail('HTTP /metrics', metrics.error);
    } else {
        fail('HTTP /metrics', String(metrics.status));
    }
}

function checkSmm() {
    const enabled =
        String(process.env.SMM_ENABLED || '0').trim() === '1' ||
        String(process.env.SMM_ENABLED || '').toLowerCase() === 'true';
    if (!enabled) {
        ok('SMM', 'desligado (SMM_ENABLED≠1)');
        return;
    }

    const apiKey = (process.env.FORNECEDOR_BRASIL_API_KEY || '').trim();
    if (apiKey.length >= 8) ok('SMM FORNECEDOR_BRASIL_API_KEY', 'definido');
    else fail('SMM FORNECEDOR_BRASIL_API_KEY', 'ausente ou curto');

    const fulfillJob = path.join(ROOT, 'src/modules/smm/queue/smmFulfillJob.js');
    if (fs.existsSync(fulfillJob)) ok('SMM smmFulfillJob', 'módulo presente');
    else fail('SMM smmFulfillJob', 'arquivo ausente');

    try {
        require('../src/modules/queue/jobs/index.js');
        ok('SMM queue jobs', 'index carrega sem erro');
    } catch (e) {
        fail('SMM queue jobs', e.message);
    }

    try {
        const Database = require('better-sqlite3');
        const dbPathRaw =
            process.env.HANORK_DB_PATH ||
            path.join(process.env.HOME || '/home/vendetta', '.hanork', 'hanork.db');
        const dbPath = dbPathRaw.startsWith('~')
            ? path.join(process.env.HOME || '/home/vendetta', dbPathRaw.slice(1))
            : dbPathRaw;
        if (!fs.existsSync(dbPath)) {
            fail('SMM catálogo', `DB não encontrado: ${dbPath}`);
            return;
        }
        const db = new Database(dbPath, { readonly: true });
        const active = db.prepare('SELECT COUNT(*) as c FROM smm_services WHERE active = 1').get().c;
        const total = db.prepare('SELECT COUNT(*) as c FROM smm_services').get().c;
        const platforms = db
            .prepare(
                'SELECT COUNT(DISTINCT platform) as c FROM smm_services WHERE active = 1'
            )
            .get().c;
        db.close();
        if (total < 100) {
            fail('SMM catálogo', `import incompleto: ${total} serviços`);
        } else if (active < 50) {
            fail('SMM catálogo', `poucos ativos: ${active}/${total} — rode smm-curate-catalog ou import`);
        } else if (platforms < 3) {
            fail('SMM catálogo', `poucas plataformas ativas: ${platforms}`);
        } else {
            ok('SMM catálogo', `${active} ativos / ${total} total · ${platforms} plataformas`);
        }
    } catch (e) {
        fail('SMM catálogo', e.message);
    }
}

async function main() {
    console.log('Hanork — checklist produção\n');
    checkEnv();
    checkProduct();
    checkFotos();
    checkBroadcastVariants();
    checkSmm();
    await pingRedis();
    await checkHealth();

    for (const c of checks) {
        const icon = c.ok ? 'OK' : 'FAIL';
        console.log(`[${icon}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    }
    console.log(`\n${checks.length - failed}/${checks.length} OK`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
