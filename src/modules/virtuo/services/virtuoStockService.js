'use strict';

const logger = require('../../../config/logger');
const dbRaw = require('../../../config/database-sqlite').connect;
const VirtuoServiceRepository = require('../repositories/virtuoServiceRepository');
const VirtuoApiClient = require('../providers/virtuoApiClient');
const VirtuoConfig = require('../virtuoConfig');
const { resolveForCatalogRow, extractApiCountryId } = require('../utils/virtuoCountryResolver');

const KV_BLOCK_PREFIX = 'virtuo_block:';
const KV_RECONCILE_CURSOR = 'virtuo_reconcile_cursor';

function blockKey(serviceCode, countryId, server) {
    return `${KV_BLOCK_PREFIX}${serviceCode}:${countryId}:${server}`;
}

function readKvTs(key) {
    try {
        const row = dbRaw().prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
        return row?.value ? Number(row.value) : 0;
    } catch {
        return 0;
    }
}

function writeKvTs(key, value = Date.now()) {
    try {
        dbRaw()
            .prepare('INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))')
            .run(key, String(value));
    } catch {
        /* ignore */
    }
}

function deleteKv(key) {
    try {
        dbRaw().prepare('DELETE FROM kv_store WHERE key = ?').run(key);
    } catch {
        /* ignore */
    }
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isBlocked(serviceCode, countryId, server) {
    const ts = readKvTs(blockKey(serviceCode, countryId, server));
    if (!ts) return false;
    return Date.now() - ts < VirtuoConfig.stockBlockTtlMs;
}

/** País vendável quando /prices indica estoque. Limpa bloqueio obsoleto se API mostra available>0. */
function activateFromPrices(serviceCode, countryId, server, svcId, available) {
    const avail = Number(available) || 0;
    if (avail <= 0) {
        markBlocked(serviceCode, countryId, server, svcId);
        return 0;
    }
    clearBlock(serviceCode, countryId, server, svcId, avail);
    return 1;
}

/** @deprecated use activateFromPrices na reconciliação */
function resolveActiveFromStock(serviceCode, countryId, server, available = 0) {
    return activateFromPrices(serviceCode, countryId, server, null, available);
}

function markBlocked(serviceCode, countryId, server, svcId = null) {
    writeKvTs(blockKey(serviceCode, countryId, server));
    if (svcId) {
        VirtuoServiceRepository.setAvailability(svcId, undefined, 0);
    }
}

function clearBlock(serviceCode, countryId, server, svcId = null, available = null) {
    deleteKv(blockKey(serviceCode, countryId, server));
    if (svcId != null) {
        const avail = available != null ? Number(available) : undefined;
        const active = resolveActiveFromStock(serviceCode, countryId, server, avail ?? 1);
        VirtuoServiceRepository.setAvailability(
            svcId,
            avail != null && Number.isFinite(avail) ? avail : undefined,
            active
        );
    }
}

async function fetchLivePriceRow(serviceCode, countryId, server) {
    const resp = await VirtuoApiClient.getPrices(serviceCode, undefined, server);
    if (!resp.ok) return { ok: false, error: resp.error };
    const prices = resp.data?.prices || [];
    const row = prices.find((p) => Number(extractApiCountryId(p, { fromPrices: true })) === Number(countryId));
    return { ok: true, row: row || null, total: prices.length };
}

async function reconcileServiceRow(svc) {
    const resolved = await resolveForCatalogRow(svc);
    if (!resolved.ok) {
        markBlocked(svc.service_code, svc.country_id, svc.server || VirtuoConfig.defaultServer, svc.id);
        return {
            id: svc.id,
            deactivated: true,
            reason: resolved.error?.code || 'resolve_failed',
            country: svc.country_name,
            service: svc.service_code,
        };
    }

    const { apiCountryId, apiCountryName, available } = resolved;

    if (Number(svc.country_id) !== apiCountryId) {
        logger.error('[Virtuo:stock] country_id incorreto no catálogo — corrigindo pedidos futuros via resolver', {
            catalogRowId: svc.id,
            storedCountryId: svc.country_id,
            apiCountryId,
            storedName: svc.country_name,
            apiName: apiCountryName,
            service: svc.service_code,
        });
        VirtuoServiceRepository.patchCountryId(svc.id, apiCountryId, apiCountryName);
    }

    if (available <= 0) {
        markBlocked(svc.service_code, apiCountryId, svc.server || VirtuoConfig.defaultServer, svc.id);
        return {
            id: svc.id,
            deactivated: true,
            reason: 'catalog_zero',
            country: apiCountryName,
            service: svc.service_code,
        };
    }

    const active = activateFromPrices(
        svc.service_code,
        apiCountryId,
        svc.server || VirtuoConfig.defaultServer,
        svc.id,
        available
    );
    VirtuoServiceRepository.setAvailability(svc.id, available, active);

    return {
        id: svc.id,
        activated: active === 1,
        deactivated: active === 0,
        country: apiCountryName,
        service: svc.service_code,
        apiCountryId,
    };
}

async function assertServiceAvailable(svcOrId, orderLike = null) {
    const svc =
        typeof svcOrId === 'object' && svcOrId?.id
            ? svcOrId
            : VirtuoServiceRepository.findById(Number(svcOrId));
    if (!svc) {
        return { ok: false, reason: 'out_of_stock', detail: 'Serviço indisponível' };
    }

    const resolved = await resolveForCatalogRow(svc);

    if (!resolved.ok) {
        return {
            ok: false,
            reason: 'out_of_stock',
            detail: 'País não encontrado na API Virtuo',
        };
    }

    const { apiCountryId, available, apiCountryName } = resolved;
    const server = Number(orderLike?.server ?? svc.server) || VirtuoConfig.defaultServer;

    if (available <= 0) {
        markBlocked(svc.service_code, apiCountryId, server, svc.id);
        return { ok: false, reason: 'out_of_stock', detail: 'Sem números disponíveis agora' };
    }

    const active = activateFromPrices(svc.service_code, apiCountryId, server, svc.id, available);
    VirtuoServiceRepository.setAvailability(svc.id, available, active);

    if (!active) {
        return { ok: false, reason: 'out_of_stock', detail: 'Estoque esgotado ou em verificação' };
    }

    const refreshed = VirtuoServiceRepository.findById(svc.id) || svc;
    return {
        ok: true,
        svc: {
            ...refreshed,
            country_id: apiCountryId,
            country_name: apiCountryName,
        },
    };
}

async function markNoNumbers(svc) {
    if (!svc?.id) return;
    const resolved = await resolveForCatalogRow(svc).catch(() => null);
    const countryId = resolved?.ok ? resolved.apiCountryId : svc.country_id;
    markBlocked(svc.service_code, countryId, svc.server || VirtuoConfig.defaultServer, svc.id);
    logger.info('[Virtuo:stock] bloqueado por NO_NUMBERS', {
        id: svc.id,
        service: svc.service_code,
        country: svc.country_name,
        countryId,
    });
}

async function reconcileStockFromPrices(serviceCode, server = VirtuoConfig.defaultServer) {
    const resp = await VirtuoApiClient.getPrices(serviceCode, undefined, server);
    if (!resp.ok) return { ok: false, serviceCode, error: resp.error?.code };

    let updated = 0;
    let deactivated = 0;

    for (const row of resp.data?.prices || []) {
        const countryId = extractApiCountryId(row, { fromPrices: true });
        const available = Number(row.available ?? 0);
        if (!countryId) continue;

        const existing = VirtuoServiceRepository.findByComposite(serviceCode, countryId, server);
        if (!existing) continue;

        if (available <= 0) {
            if (existing.active) deactivated++;
            markBlocked(serviceCode, countryId, server, existing.id);
            updated++;
            continue;
        }

        const active = activateFromPrices(serviceCode, countryId, server, existing.id, available);
        VirtuoServiceRepository.setAvailability(existing.id, available, active);
        updated++;
    }

    return { ok: true, serviceCode, updated, deactivated };
}

/** Varre países cadastrados usando só /prices (sem criar ativações na Virtuo). */
async function reconcileCatalogBatch(limit = VirtuoConfig.stockRecheckBatch) {
    let cursor = readKvTs(KV_RECONCILE_CURSOR) || 0;
    let rows = VirtuoServiceRepository.listAfterId(cursor, limit);

    if (!rows.length) {
        cursor = 0;
        rows = VirtuoServiceRepository.listAfterId(0, limit);
    }

    let activated = 0;
    let deactivated = 0;
    let skipped = 0;
    let lastId = cursor;

    for (const svc of rows) {
        lastId = svc.id;
        const r = await reconcileServiceRow(svc);
        if (r.activated) activated++;
        else if (r.deactivated) deactivated++;
        else skipped++;
        await sleep(VirtuoConfig.stockReconcileDelayMs);
    }

    if (lastId > 0) writeKvTs(KV_RECONCILE_CURSOR, lastId);

    return {
        checked: rows.length,
        activated,
        deactivated,
        skipped,
        cursor: lastId,
        total: VirtuoServiceRepository.countAll(),
        sellable: VirtuoServiceRepository.countSellable(),
        cycleComplete: rows.length < limit,
    };
}

async function clearAllBlocks() {
    try {
        const r = dbRaw().prepare("DELETE FROM kv_store WHERE key LIKE 'virtuo_block:%'").run();
        logger.info('[Virtuo:stock] bloqueios KV removidos', { count: r.changes });
        return r.changes || 0;
    } catch {
        return 0;
    }
}

/** Reativa catálogo inteiro a partir de /prices (limpa bloqueios obsoletos). */
async function reactivateAllFromPrices(featuredCodes) {
    const cleared = await clearAllBlocks();
    let sellable = 0;
    for (const code of featuredCodes) {
        await reconcileStockFromPrices(code);
    }
    sellable = VirtuoServiceRepository.countSellable();
    return { cleared, sellable };
}

async function seedBlocksFromFailedOrders() {
    let rows = [];
    try {
        rows = dbRaw()
            .prepare(`
                SELECT DISTINCT vs.id, vs.service_code, vs.country_id, vs.server, vs.country_name
                FROM virtuo_orders vo
                JOIN virtuo_services vs ON vs.id = vo.virtuo_service_id
                WHERE vo.updated_at >= datetime('now', '-2 hours')
                  AND (
                    UPPER(COALESCE(vo.provider_status, '')) LIKE '%NO_NUMBERS%'
                    OR UPPER(COALESCE(vo.provider_status, '')) LIKE '%OUT_OF_STOCK%'
                  )
            `)
            .all();
    } catch {
        return 0;
    }
    for (const row of rows) {
        markBlocked(row.service_code, row.country_id, row.server || VirtuoConfig.defaultServer, row.id);
    }
    if (rows.length) {
        logger.info('[Virtuo:stock] bloqueios seed de pedidos falhos', { count: rows.length });
    }
    return rows.length;
}

async function reconcileAllFeaturedStock(featuredCodes) {
    let totalUpdated = 0;
    let totalDeactivated = 0;
    for (const code of featuredCodes) {
        const r = await reconcileStockFromPrices(code);
        if (r.ok) {
            totalUpdated += r.updated || 0;
            totalDeactivated += r.deactivated || 0;
        }
    }
    const batch = await reconcileCatalogBatch(VirtuoConfig.stockRecheckBatch);
    return {
        updated: totalUpdated,
        deactivated: totalDeactivated,
        reconcile: batch,
        sellable: VirtuoServiceRepository.countSellable(),
    };
}

async function reconcileCatalogFull({ batchSize, maxBatches } = {}) {
    const size = batchSize || VirtuoConfig.stockRecheckBatch;
    const max = maxBatches || Math.ceil(VirtuoServiceRepository.countAll() / size) + 2;
    writeKvTs(KV_RECONCILE_CURSOR, 0);

    let totals = { checked: 0, activated: 0, deactivated: 0, skipped: 0, batches: 0 };
    for (let i = 0; i < max; i++) {
        const r = await reconcileCatalogBatch(size);
        totals.checked += r.checked;
        totals.activated += r.activated;
        totals.deactivated += r.deactivated;
        totals.skipped += r.skipped;
        totals.batches++;
        if (r.cycleComplete || r.checked === 0) break;
    }
    totals.sellable = VirtuoServiceRepository.countSellable();
    totals.total = VirtuoServiceRepository.countAll();
    logger.info('[Virtuo:stock] reconciliação completa', totals);
    return totals;
}

/** @deprecated probes de ativação removidos — alias para reconcileCatalogBatch */
async function probeAllStockBatch(limit, _opts) {
    return reconcileCatalogBatch(limit);
}

/** @deprecated */
async function probeAllStockFull(opts) {
    return reconcileCatalogFull(opts);
}

/** @deprecated */
async function recheckBlockedStock(limit) {
    return reconcileCatalogBatch(limit);
}

/** @deprecated */
async function probeServiceRow(svc) {
    return reconcileServiceRow(svc);
}

/** @deprecated — não criar ativações reais para checar estoque */
async function probeActivation() {
    logger.warn('[Virtuo:stock] probeActivation desativado — use /prices');
    return { activatable: null, reason: 'disabled' };
}

module.exports = {
    assertServiceAvailable,
    markNoNumbers,
    markBlocked,
    clearBlock,
    clearAllBlocks,
    isBlocked,
    resolveActiveFromProbe: activateFromPrices,
    resolveActiveFromStock: activateFromPrices,
    activateFromPrices,
    probeActivation,
    probeServiceRow,
    fetchLivePriceRow,
    reconcileStockFromPrices,
    reconcileServiceRow,
    reconcileCatalogBatch,
    reconcileCatalogFull,
    reactivateAllFromPrices,
    recheckBlockedStock,
    probeAllStockBatch,
    probeAllStockFull,
    reconcileAllFeaturedStock,
    seedBlocksFromFailedOrders,
};
