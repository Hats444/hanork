'use strict';

const logger = require('../../../config/logger');
const { isSmmEnabled } = require('../smmEnabled');
const SmmConfig = require('../smmConfig');
const SmmServiceRepository = require('../repositories/smmServiceRepository');
const { runSyncServicesJob } = require('../jobs/syncServicesJob');

let bootstrapped = false;

async function maybeAutoImport() {
    if (!SmmConfig.autoImportOnBoot) return;
    const total = SmmServiceRepository.countAll();
    if (total > 0) {
        logger.info('[SMM] Catálogo já importado', { total });
        return;
    }
    logger.info('[SMM] Importação automática inicial (JSON/API)...');
    const result = await runSyncServicesJob({ source: 'auto', syncType: 'boot' });
    if (!result.ok) {
        logger.warn('[SMM] Auto-import falhou', { error: result.error });
    }
}

function registerSmmBoot(_bot, deps = {}) {
    if (bootstrapped) return;
    bootstrapped = true;

    if (!isSmmEnabled()) {
        logger.info('[SMM] Módulo desligado (SMM_ENABLED=0) — zero impacto em produção');
        return;
    }

    logger.info('[SMM] Módulo ativo', {
        margin: SmmConfig.marginPercent,
        minProfit: SmmConfig.minProfit,
        publicAccess: SmmConfig.publicAccess,
        providerKey: require('../providers/fornecedorBrasilProvider').keyFingerprint(),
    });

    maybeAutoImport().catch((e) => {
        (deps.logger || logger).warn('[SMM] auto-import async erro', { detail: e.message });
    });
}

module.exports = { registerSmmBoot, maybeAutoImport };
