'use strict';
/**
 * Regrava hanork_auto_catalog.json com preços/textos do SQLite (template, sem IA).
 * Uso: node scripts/force-catalog-sync.js [--with-ai]
 */
require('dotenv').config({ quiet: true });

const path = require('path');

const REPO = path.join(__dirname, '..');

async function main() {
    const withAi = process.argv.includes('--with-ai');
    process.env.ZERO_DIVU_ENABLED = process.env.ZERO_DIVU_ENABLED || '1';

    const { prisma } = require('../src/config/database');
    const logger = require('../src/config/logger');
    const dbRaw = require('../src/config/database-sqlite').connect;
    const { createCatalogHelpers } = require('../src/bot/helpers/catalogHelpers');
    const { syncHanorkCatalogToZero } = require('../src/plugins/zero-divu/hanorkAutoSync');
    const { orchestrateCatalogAiSync, enqueueCatalogAiSync } = require('../src/plugins/zero-divu/catalogAiSync');

    const { loadProducts } = createCatalogHelpers({ prisma, logger });
    const deps = {
        prisma,
        dbRaw,
        loadProducts,
        logger,
        CONFIG: {
            CAMINHO_FOTOS: path.join(REPO, 'fotos'),
            CAMINHO_PRODUTOS: path.join(REPO, 'produtos'),
        },
        getBotUsername: async () => process.env.BOT_USERNAME || process.env.HANORK_BOT_USERNAME || 'hanork_bot',
    };

    console.log('=== Sync catálogo WA (template + DB) ===\n');

    const result = await syncHanorkCatalogToZero(deps, {
        useAi: false,
        skipAsyncEnqueue: true,
        source: 'force-catalog-sync',
    });

    if (!result.ok) {
        console.error('Falhou:', result.error || result.reason || result);
        process.exit(1);
    }

    console.log(`OK: ${result.count} produto(s) → ${result.path}`);

    const sample = await prisma.product.findUnique({ where: { id: 15 } });
    if (sample) {
        console.log(`   #15 ${sample.name}: R$ ${Number(sample.price).toFixed(2)}`);
    }

    if (withAi) {
        console.log('\n=== Enfileirando IA (Bull ai:catalog) ===\n');
        try {
            const QueueService = require('../src/modules/queue/QueueService');
            await QueueService.initQueue('ai:catalog');
            const enq = await enqueueCatalogAiSync(deps, {
                source: 'force-catalog-sync',
                force: true,
                delayMs: 0,
            });
            if (enq.ok && !enq.skipped) {
                console.log('Job catalog-ai-full enfileirado — textos IA em ~15–30 min.');
            } else if (enq.skipped) {
                console.log('IA async desativada ou job já pendente:', enq.reason);
                const orch = await orchestrateCatalogAiSync(deps, { source: 'force-catalog-sync' });
                console.log('Orquestração direta:', orch.ok ? `${orch.enqueued || 0} job(s)` : orch.error);
            }
        } catch (e) {
            console.warn('Redis/fila indisponível — template já atualizado:', e.message);
            console.warn('Reinicie o bot ou rode com Redis ativo para IA.');
        }
    } else {
        console.log('\nDica: node scripts/force-catalog-sync.js --with-ai  (textos persuasivos IA)');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
