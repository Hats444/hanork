'use strict';

const fs = require('fs-extra');
const path = require('path');
const { filterDivulgacaoProducts, isDivulgacaoEligibleProduct } = require('./divulgacaoCatalog');
const { getZeroDivuClient } = require('./ZeroDivuClient');
const { isZeroDivuEnabled, ZERO_DIVU_CONFIG } = require('./config');
const { stripHtml, readPhotoBuffer } = require('./promo');

const CATALOG_FILE = 'hanork_auto_catalog.json';

function randomWaPromoDelayMs(source = 'auto') {
  const src = String(source || 'auto');
  const manual =
    src === 'manual' ||
    src === 'button_activate' ||
    src === 'button_run_now' ||
    src.startsWith('hanork_auto_manual');
  if (manual) {
    const min = Number(process.env.HANORK_WA_PROMO_MANUAL_DELAY_MIN_MS) || 3 * 60 * 1000;
    const max = Number(process.env.HANORK_WA_PROMO_MANUAL_DELAY_MAX_MS) || 5 * 60 * 1000;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return min;
    return min + Math.floor(Math.random() * (max - min));
  }
  const min = Number(process.env.HANORK_WA_PROMO_DELAY_MIN_MS) || 8 * 60 * 1000;
  const max = Number(process.env.HANORK_WA_PROMO_DELAY_MAX_MS) || 14 * 60 * 1000;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return min;
  return min + Math.floor(Math.random() * (max - min));
}

function getFlashSale(prisma, productId) {
  if (!prisma?.flashSale?.findActive) return null;
  try {
    prisma.flashSale.expire?.();
    return prisma.flashSale.findActive(productId);
  } catch {
    return null;
  }
}

function catalogUsesAi() {
  const v = String(process.env.HANORK_WA_CATALOG_USE_AI || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function catalogUsesAsyncAi() {
  if (!catalogUsesAi()) return false;
  const asyncV = String(process.env.HANORK_WA_CATALOG_ASYNC_AI ?? '1').toLowerCase();
  return asyncV !== '0' && asyncV !== 'false' && asyncV !== 'no';
}

async function buildPlainProductText(p, { prisma, username, dbRaw, useAi }) {
  const sale = getFlashSale(prisma, p.id);
  const wantAi = useAi === true || (useAi !== false && catalogUsesAi());
  if (wantAi) {
    const { generateProductPromoPlain, isAiBroadcastEnabled } = require('../../utils/broadcastAiCopy');
    if (isAiBroadcastEnabled()) {
      return generateProductPromoPlain(p, {
        sale,
        username,
        dbRaw: dbRaw || null,
        stableCopy: true,
        channel: 'wa',
      });
    }
  }
  const { buildWaPlainPromo } = require('../../utils/persuasiveProductCopy');
  return buildWaPlainPromo(p, { sale, username });
}

async function syncHanorkCatalogToZero(deps = {}, options = {}) {
  if (!isZeroDivuEnabled()) {
    return { ok: false, skipped: true, reason: 'zero_divu_disabled' };
  }

  const skipAsyncEnqueue = options.skipAsyncEnqueue === true;
  const useAiCatalog =
    options.useAi !== undefined ? options.useAi === true : catalogUsesAi();
  const wantAsync =
    !skipAsyncEnqueue &&
    options.asyncAi !== false &&
    catalogUsesAsyncAi() &&
    useAiCatalog;

  if (wantAsync) {
    const { enqueueCatalogAiSync } = require('./catalogAiSync');
    const delayMs = Math.max(0, Number(options.delayMs) || 0);
    const enq = await enqueueCatalogAiSync(deps, {
      source: options.source || 'sync',
      delayMs,
      force: options.force === true,
    });
    if (enq.skipped && enq.reason === 'already_pending') {
      return { ok: true, asyncAi: true, pending: true, reason: 'already_pending' };
    }
    if (!enq.ok && !enq.skipped) {
      return { ok: false, error: enq.reason || 'enqueue_failed' };
    }
    return {
      ok: true,
      asyncAi: true,
      queued: true,
      jobId: enq.jobId,
      message: 'Catálogo IA enfileirado — template primeiro, textos IA em background',
    };
  }

  const loadProducts = deps.loadProducts;
  if (!loadProducts) {
    return { ok: false, error: 'missing_loadProducts' };
  }

  const client = getZeroDivuClient();
  client.ensureDir();

  const products = await loadProducts();
  const active = filterDivulgacaoProducts(products);
  if (!active.length) {
    return { ok: false, error: 'no_active_products' };
  }

  let username = '';
  if (typeof deps.getBotUsername === 'function') {
    username = (await deps.getBotUsername()) || '';
  }
  if (!username) username = process.env.BOT_USERNAME || '';

  const { resolveProductPhotoWithMenuFallback } = require('../../utils/productPhoto');
  const photosDir = deps.CONFIG?.CAMINHO_FOTOS || deps.photosDir || null;
  const mediaDir = path.join(ZERO_DIVU_CONFIG.zeroRoot, 'src', 'media', 'hanork');
  fs.ensureDirSync(mediaDir);

  const { prepareWaPromoPlain, prepareWaChatPlain } = require('../../utils/waCaptionPrepare');
  const { buildWaChatPromo } = require('../../utils/persuasiveProductCopy');
  const { HANORK_PRODUCT_ID, writeHanorkOnlyCatalogFile } = require('../../data/hanorkBroadcastVariants');

  const hanorkOnlyProduct = active.find((p) => Number(p.id) === HANORK_PRODUCT_ID);
  if (hanorkOnlyProduct && active.every((p) => Number(p.id) === HANORK_PRODUCT_ID)) {
    const outPath = path.join(client.ipcDir, CATALOG_FILE);
    const payload = writeHanorkOnlyCatalogFile(hanorkOnlyProduct, {
      username,
      photosDir,
      catalogPath: outPath,
    });
    return {
      ok: true,
      count: payload.productCount || payload.variacoes?.length || 0,
      skippedNoPhoto: 0,
      eligible: active.length,
      path: outPath,
      dynamicPromo: true,
      photoPool: payload.photoPool || [],
    };
  }

  const variacoes = [];
  let withProductPhoto = 0;
  let withMenuFallback = 0;
  let skippedNoMedia = 0;

  for (const p of active) {
    const { photo, usedMenuFallback } = resolveProductPhotoWithMenuFallback(
      p,
      photosDir,
      `wa-sync:${p.id}`
    );
    if (!photo) {
      skippedNoMedia++;
      continue;
    }

    let buf = null;
    try {
      buf = await readPhotoBuffer(photo, photosDir);
    } catch {
      /* ignore */
    }
    if (!buf?.length) {
      skippedNoMedia++;
      continue;
    }

    if (usedMenuFallback) withMenuFallback++;
    else withProductPhoto++;

    let imageFile = null;
    if (!usedMenuFallback) {
        imageFile = `auto-prod-${p.id}.jpg`;
        await fs.writeFile(path.join(mediaDir, imageFile), buf);
    }

    if (Number(p.id) === HANORK_PRODUCT_ID) {
      variacoes.push({
        tipo: 'hanork-dynamic',
        productId: HANORK_PRODUCT_ID,
        productName: p.name,
        dynamic: true,
      });
      continue;
    }

    let texto;
    try {
      texto = await buildPlainProductText(p, {
        prisma: deps.prisma,
        username,
        dbRaw: deps.dbRaw || null,
        useAi: useAiCatalog,
      });
    } catch (e) {
      (deps.logger || console).warn?.(
        `[ZeroDivu] IA catálogo falhou produto ${p.id} — template: ${e.message}`,
        { category: 'HANORK', module: 'WA', productId: p.id }
      );
      const { buildWaPlainPromo } = require('../../utils/persuasiveProductCopy');
      const sale = getFlashSale(deps.prisma, p.id);
      texto = prepareWaPromoPlain(buildWaPlainPromo(p, { sale, username }), {
        productName: p.name,
        productId: p.id,
        username,
      });
    }

    texto = prepareWaPromoPlain(texto, {
      productName: p.name,
      productId: p.id,
      username,
    });

    const sale = getFlashSale(deps.prisma, p.id);
    const textoChat = prepareWaChatPlain(buildWaChatPromo(p, { sale, username }), {
      productName: p.name,
      productId: p.id,
      username,
    });

    variacoes.push({
      tipo: `prod-${p.id}`,
      texto,
      textoChat,
      productId: p.id,
      productName: p.name,
      imageFile,
      useMenuPhoto: usedMenuFallback,
    });
  }

  if (skippedNoMedia > 0) {
    (deps.logger || console).warn?.(
      `[ZeroDivu] Catálogo WA: ${skippedNoMedia} produto(s) sem mídia`,
      {
        category: 'HANORK',
        module: 'WA',
        withProductPhoto,
        withMenuFallback,
        skippedNoMedia,
        eligible: active.length,
      }
    );
  }

  if (useAiCatalog && variacoes.length) {
    (deps.logger || console).info?.(
      `[ZeroDivu] Sync catálogo WA com IA — ${variacoes.length} produto(s) (fila GPT, sequencial)`,
      { category: 'HANORK', module: 'WA' }
    );
  }

  const skippedNoPhoto = skippedNoMedia;

  const payload = {
    updatedAt: new Date().toISOString(),
    source: variacoes.some((v) => v.dynamic) ? 'hanork_dynamic_photos' : 'hanork_auto_broadcast',
    dynamicPromo: variacoes.some((v) => v.dynamic),
    photoPool: variacoes.some((v) => v.dynamic)
      ? require('../../data/hanorkBroadcastVariants').listHanorkPromoPhotos(photosDir)
      : undefined,
    photosDir: photosDir || null,
    productCount: variacoes.length,
    variacoes,
  };

  const outPath = path.join(client.ipcDir, CATALOG_FILE);
  await fs.writeJson(outPath, payload, { spaces: 2 });

  return { ok: true, count: variacoes.length, skippedNoPhoto, eligible: active.length, path: outPath };
}

function wireAutoBroadcastSync(autoBroadcastService, deps) {
  if (!isZeroDivuEnabled() || !autoBroadcastService) return;
  if (autoBroadcastService._zeroDivuSyncWired) return;
  if (typeof autoBroadcastService.runCycle !== 'function') {
    return;
  }
  autoBroadcastService._zeroDivuSyncWired = true;
  autoBroadcastService._zeroDivuDeps = deps;

  const { waContentTypeAllowed } = require('./campaignWaSync');
  const orig = autoBroadcastService.runCycle.bind(autoBroadcastService);
  autoBroadcastService.runCycle = async (source) => {
    const result = await orig(source);
    if (result?.success) {
      const ZeroTwoAi = require('../../services/ZeroTwoAiService');
      const skipFullSync =
        catalogUsesAi() &&
        (ZeroTwoAi.isRateLimited?.() || ZeroTwoAi.isBootGuardActive?.());
      if (!skipFullSync) {
        syncHanorkCatalogToZero(deps).catch((e) => {
          (deps.logger || console).warn?.('[ZeroDivu] Sync pós-broadcast:', e.message);
        });
      } else {
        (deps.logger || console).info?.(
          '[ZeroDivu] Sync catálogo WA adiado — IA em cooldown ou boot guard',
          { category: 'HANORK', module: 'WA' }
        );
      }
      if (result.productId) {
        if (!waContentTypeAllowed({ productId: result.productId })) {
          return result;
        }
        const { isDivulgacaoEligibleProduct } = require('./divulgacaoCatalog');
        const prods = await deps.loadProducts?.().catch(() => []);
        const picked = (prods || []).find((p) => Number(p.id) === Number(result.productId));
        if (!picked || !isDivulgacaoEligibleProduct(picked)) {
          return result;
        }
        const cycleKey = autoBroadcastService.getCount?.() || Date.now();
        const { enqueueProductPromoById } = require('./promo');
        const delayMs = randomWaPromoDelayMs(source);
        enqueueProductPromoById(deps, result.productId, {
          source: `hanork_auto_${source || 'auto'}`,
          idempotencyKey: `auto-bcast-${result.productId}-${cycleKey}`,
          delayMs,
          processNow: false,
        })
          .then((r) => {
            if (r?.ok) {
              const mins = Math.max(1, Math.round(delayMs / 60000));
              (deps.logger || console).info?.(
                `[ZeroDivu] Auto-broadcast → WA Status agendado (~${mins} min): ${r.productName || result.productName}`,
                { category: 'HANORK', module: 'WA', productId: result.productId, delayMs }
              );
            }
          })
          .catch((e) => {
            (deps.logger || console).warn?.(
              `[ZeroDivu] Auto-broadcast WA promo falhou: ${e.message}`
            );
          });
      } else if (result.smmBroadcast) {
        if (!waContentTypeAllowed({ smmBroadcast: true })) {
          return result;
        }
        const cycleKey = autoBroadcastService.getCount?.() || Date.now();
        const { enqueueSmmPromo } = require('./promo');
        const delayMs = randomWaPromoDelayMs(source);
        enqueueSmmPromo(deps, {
          source: `hanork_auto_smm_${source || 'auto'}`,
          idempotencyKey: `auto-bcast-smm-${cycleKey}`,
          delayMs,
          processNow: false,
        })
          .then((r) => {
            if (r?.ok) {
              const mins = Math.max(1, Math.round(delayMs / 60000));
              (deps.logger || console).info?.(
                `[ZeroDivu] Auto-broadcast SMM → WA agendado (~${mins} min)`,
                { category: 'HANORK', module: 'WA', delayMs }
              );
            }
          })
          .catch((e) => {
            (deps.logger || console).warn?.(`[ZeroDivu] Auto-broadcast SMM WA falhou: ${e.message}`);
          });
      }
    }
    return result;
  };
}

module.exports = {
  syncHanorkCatalogToZero,
  wireAutoBroadcastSync,
  buildPlainProductText,
  randomWaPromoDelayMs,
  CATALOG_FILE,
  filterDivulgacaoProducts,
  isDivulgacaoEligibleProduct,
  catalogUsesAi,
  catalogUsesAsyncAi,
  getFlashSale,
};
