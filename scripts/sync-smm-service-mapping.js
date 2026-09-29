'use strict';

/**
 * Sync completo SMM: API FornecedorBrasil + UP FAMA → SQLite + cache + serviceMapping.json
 *
 * Uso:
 *   node scripts/sync-smm-service-mapping.js
 *   node scripts/sync-smm-service-mapping.js --min-score=0.55 --dry-run
 *   node scripts/sync-smm-service-mapping.js --skip-db   # só mapping, sem gravar SQLite
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const SmmConfig = require('../src/modules/smm/smmConfig');
const { classifyService } = require('../src/modules/smm/services/classificationService');
const { syncProviderCatalog } = require('../src/modules/smm/services/syncService');
const CacheService = require('../src/modules/smm/services/cacheService');
const ProviderManager = require('../src/modules/smm/providers/ProviderManager');
const SsmProviderAdapter = require('../src/modules/smm/providers/ssmProviderAdapter');
const UpFamaProvider = require('../src/modules/smm/providers/upFamaProvider');

const DEFAULT_OUTPUT = path.join(__dirname, '../src/modules/smm/config/serviceMapping.json');
const PRIMARY_ID = SsmProviderAdapter.name;
const SECONDARY_ID = UpFamaProvider.name;

function parseArgs(argv) {
    const opts = {
        minScore: 0.52,
        dryRun: false,
        skipDb: false,
        output: DEFAULT_OUTPUT,
        verbose: false,
    };
    for (const arg of argv) {
        if (arg === '--dry-run') opts.dryRun = true;
        if (arg === '--skip-db') opts.skipDb = true;
        if (arg === '--verbose' || arg === '-v') opts.verbose = true;
        if (arg.startsWith('--min-score=')) {
            opts.minScore = Number(arg.split('=')[1]) || opts.minScore;
        }
        if (arg.startsWith('--output=')) {
            opts.output = path.resolve(arg.split('=').slice(1).join('='));
        }
    }
    return opts;
}

function stripEmoji(text) {
    return String(text || '')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const STOP_WORDS = new Set([
    'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'com', 'para', 'por',
    'the', 'and', 'or', 'hq', 'fast', 'slow', 'best', 'top', 'new', 'old',
    'servico', 'service', 'services', 'default',
]);

function normalizeName(name) {
    return stripEmoji(name)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s|+]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(name) {
    const n = normalizeName(name);
    const tokens = n.split(/[\s|+/]+/).filter((t) => t.length > 1 && !STOP_WORDS.has(t));
    return new Set(tokens);
}

function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter += 1;
    return inter / (a.size + b.size - inter);
}

function flagSet(name) {
    const n = normalizeName(name);
    const flags = [];
    if (/brasil|brazil|br\b|🇧🇷/.test(n)) flags.push('geo:br');
    if (/mundial|world|global|🇺🇸|international/.test(n)) flags.push('geo:world');
    if (/refill|reposicao|recharge|♻/.test(n)) flags.push('refill');
    if (/cancel/.test(n)) flags.push('cancel');
    if (/drip|dripfeed/.test(n)) flags.push('drip');
    if (/curtida|like|likes|curtidas/.test(n)) flags.push('likes');
    if (/seguidor|follower|followers|seguidores/.test(n)) flags.push('followers');
    if (/visualiz|view|views|reproduc|play|plays/.test(n)) flags.push('views');
    if (/coment|comment/.test(n)) flags.push('comments');
    if (/membros|member|members|subscribers|inscritos/.test(n)) flags.push('members');
    if (/compartilh|share|shares/.test(n)) flags.push('shares');
    if (/live|ao vivo/.test(n)) flags.push('live');
    if (/story|stories|reels|reel/.test(n)) flags.push('reels');
    if (/free fire|freefire|ff\b/.test(n)) flags.push('freefire');
    return new Set(flags);
}

function flagOverlap(a, b) {
    if (!a.size && !b.size) return 1;
    let inter = 0;
    for (const f of a) if (b.has(f)) inter += 1;
    const union = new Set([...a, ...b]).size;
    return union ? inter / union : 0;
}

function qtyScore(a, b) {
    const minA = Number(a.min) || 1;
    const minB = Number(b.min) || 1;
    const maxA = Number(a.max) || minA;
    const maxB = Number(b.max) || minB;
    const minRatio = Math.min(minA, minB) / Math.max(minA, minB);
    const maxRatio = Math.min(maxA, maxB) / Math.max(maxA, maxB);
    return (minRatio + maxRatio) / 2;
}

function enrich(raw, provider) {
    const name = String(raw.name || raw.service_name || '').trim();
    const classified = classifyService(raw);
    return {
        id: Number(raw.service ?? raw.provider_service_id),
        name,
        rate: Number(raw.rate) || 0,
        min: Number(raw.min) || 1,
        max: Number(raw.max) || 1,
        provider,
        platform: classified.platform,
        subcategory: classified.subcategory,
        categoryRaw: classified.category_raw || '',
        tokens: tokenize(name),
        flags: flagSet(name),
        norm: normalizeName(name),
    };
}

function bucketKey(item) {
    return `${item.platform}::${item.subcategory}`;
}

function scorePair(ssm, up) {
    if (ssm.platform !== up.platform) return 0;
    let score = 0;
    score += 0.22; // platform match
    score += ssm.subcategory === up.subcategory ? 0.18 : 0.06;
    score += jaccard(ssm.tokens, up.tokens) * 0.35;
    score += flagOverlap(ssm.flags, up.flags) * 0.15;
    score += qtyScore(ssm, up) * 0.10;
    // penaliza nomes muito curtos sem overlap
    if (ssm.tokens.size < 2 && up.tokens.size < 2 && jaccard(ssm.tokens, up.tokens) < 0.3) {
        score *= 0.5;
    }
    return Math.min(1, score);
}

function buildLabel(ssm, up) {
    const plat = ssm.platform !== 'Outros' ? ssm.platform : up.platform;
    const sub = ssm.subcategory !== 'Outros' ? ssm.subcategory : up.subcategory;
    const geo = ssm.flags.has('geo:br') || up.flags.has('geo:br') ? 'BR' : '';
    return [plat, sub, geo].filter(Boolean).join(' · ').slice(0, 120)
        || stripEmoji(ssm.name).slice(0, 80);
}

async function fetchCatalog(provider, adapter) {
    const raw = await provider.getServices();
    if (!Array.isArray(raw) || !raw.length) {
        throw new Error(`${adapter.name}: catálogo vazio ou inválido`);
    }
    return raw
        .map((r) => enrich(r, adapter.name))
        .filter((s) => Number.isFinite(s.id) && s.id > 0 && s.name);
}

async function syncProviderCatalogsToDb(opts = {}) {
    const out = {
        fornecedorbrasil: null,
        upfama: null,
        cache: null,
        dbError: null,
    };

    try {
        console.log('🔄 FornecedorBrasil — API → SQLite…');
        out.fornecedorbrasil = await syncProviderCatalog(PRIMARY_ID, {
            deactivateMissing: opts.deactivateMissing !== false,
        });
        console.log(
            `   ✓ FB: ${out.fornecedorbrasil.processed} proc · ` +
            `${out.fornecedorbrasil.created} novos · ${out.fornecedorbrasil.updated} atualizados · ` +
            `${out.fornecedorbrasil.removed} removidos`
        );

        if (ProviderManager.isProviderConfigured(SECONDARY_ID)) {
            console.log('🔄 UP FAMA — API → SQLite…');
            out.upfama = await syncProviderCatalog(SECONDARY_ID, {
                deactivateMissing: opts.deactivateMissing !== false,
            });
            console.log(
                `   ✓ UP: ${out.upfama.processed} proc · ` +
                `${out.upfama.created} novos · ${out.upfama.updated} atualizados · ` +
                `${out.upfama.removed} removidos`
            );
        } else {
            console.log('   ⚪ UP FAMA: key ausente — pulando sync SQLite');
        }
    } catch (e) {
        out.dbError = e.message;
        console.warn(`   ⚠️ Sync SQLite falhou (${e.message}) — segue mapping via API ao vivo`);
    }

    console.log('🔄 Cache in-memory dos provedores…');
    out.cache = await ProviderManager.refreshServicesCache();

    try {
        await CacheService.invalidateAll();
    } catch (_) { /* Redis/mem opcional */ }

    return out;
}

async function fetchLiveCatalogs() {
    console.log('🔄 Lendo catálogos ao vivo (API FornecedorBrasil + UP FAMA)…');
    const [ssmRaw, upRaw] = await Promise.all([
        fetchCatalog(SsmProviderAdapter, SsmProviderAdapter),
        fetchCatalog(UpFamaProvider, UpFamaProvider),
    ]);
    console.log(`   SSM: ${ssmRaw.length} · UP: ${upRaw.length} serviços`);
    return { ssmRaw, upRaw };
}

function writeMappingPayload(payload, outputPath, opts = {}) {
    if (opts.dryRun) {
        console.log('\n(dry-run — arquivo não gravado)');
        return outputPath;
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`\n✅ Gravado: ${outputPath}`);

    const prodPath = '/home/vendetta/hanork/src/modules/smm/config/serviceMapping.json';
    if (fs.existsSync('/home/vendetta/hanork') && path.resolve(outputPath) !== path.resolve(prodPath)) {
        try {
            fs.mkdirSync(path.dirname(prodPath), { recursive: true });
            fs.writeFileSync(prodPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
            console.log(`✅ Gravado também: ${prodPath}`);
        } catch (_) { /* ignore */ }
    }
    return outputPath;
}

/**
 * Fluxo completo: sync DB (FB+UP) → cache → mapping.json
 */
async function runFullSync(opts = {}) {
    if (!SmmConfig.providerKey) {
        throw new Error('FORNECEDOR_BRASIL_API_KEY ausente no .env');
    }
    if (!SmmConfig.upFamaApiKey) {
        throw new Error('UP_FAMA_API_KEY ausente no .env');
    }

    let catalogSync = null;
    if (!opts.skipDb) {
        catalogSync = await syncProviderCatalogsToDb(opts);
    } else {
        await ProviderManager.refreshServicesCache();
    }

    const { ssmRaw, upRaw } = await fetchLiveCatalogs();
    const { mappings, unmatchedSsm, unusedUp } = generateMappings(ssmRaw, upRaw, opts);

    const payload = {
        generatedAt: new Date().toISOString(),
        minScore: opts.minScore ?? 0.52,
        catalogSync: catalogSync
            ? {
                fornecedorbrasil: catalogSync.fornecedorbrasil,
                upfama: catalogSync.upfama,
                cache: catalogSync.cache,
            }
            : { skipped: true },
        stats: {
            ssmTotal: ssmRaw.length,
            upTotal: upRaw.length,
            mapped: mappings.length,
            unmatchedSsm: unmatchedSsm.length,
            unusedUp,
        },
        mappings,
    };

    writeMappingPayload(payload, opts.output || DEFAULT_OUTPUT, opts);

    return { payload, ssmRaw, upRaw, catalogSync };
}

function generateMappings(ssmList, upList, opts) {
    const pairs = [];

    for (const ssm of ssmList) {
        for (const up of upList) {
            const score = scorePair(ssm, up);
            if (score >= opts.minScore) {
                pairs.push({ ssm, up, score });
            }
        }
    }

    pairs.sort((a, b) => b.score - a.score || a.ssm.rate - b.ssm.rate);

    const usedSsm = new Set();
    const usedUp = new Set();
    const mappings = [];

    for (const { ssm, up, score } of pairs) {
        if (usedSsm.has(ssm.id) || usedUp.has(up.id)) continue;
        usedSsm.add(ssm.id);
        usedUp.add(up.id);
        mappings.push({
            label: buildLabel(ssm, up),
            ssmServiceId: ssm.id,
            upServiceId: up.id,
            score: Number(score.toFixed(3)),
            ssmRate: ssm.rate,
            upRate: up.rate,
            ssmName: ssm.name.slice(0, 160),
            upName: up.name.slice(0, 160),
            platform: ssm.platform,
            subcategory: ssm.subcategory,
        });
    }

    mappings.sort((a, b) => b.score - a.score || a.platform.localeCompare(b.platform));

    const unmatchedSsm = ssmList
        .filter((s) => !usedSsm.has(s.id))
        .slice(0, 50)
        .map((s) => ({ id: s.id, name: s.name, platform: s.platform, subcategory: s.subcategory }));

    return {
        mappings,
        unmatchedSsm,
        unusedUp: upList.filter((u) => !usedUp.has(u.id)).length,
    };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const { payload } = await runFullSync(opts);

    console.log(`\n📊 Mapping (min-score=${opts.minScore}):`);
    console.log(`   Mapeados: ${payload.stats.mapped}`);
    console.log(`   SSM sem par (amostra): ${payload.stats.unmatchedSsm}`);
    console.log(`   UP não usados: ${payload.stats.unusedUp}`);

    if (opts.verbose && payload.mappings.length) {
        console.log('\nTop 10 matches:');
        payload.mappings.slice(0, 10).forEach((m) => {
            console.log(
                `   [${m.score}] SSM#${m.ssmServiceId} ↔ UP#${m.upServiceId} · ${m.label}\n` +
                `      SSM R$${m.ssmRate} · UP R$${m.upRate}`
            );
        });
    }
}

module.exports = {
    generateMappings,
    fetchCatalog,
    fetchLiveCatalogs,
    syncProviderCatalogsToDb,
    runFullSync,
    scorePair,
    normalizeName,
};

if (require.main === module) {
    main().catch((err) => {
        console.error('❌', err.message);
        process.exit(1);
    });
}
