'use strict';

const logger = require('../../../config/logger');
const WaDivulgacaoConfig = require('../waDivulgacaoConfig');
const { ensureWaDivulgacaoProducts } = require('../waDivulgacaoProductService');

let bootstrapped = false;

function registerWaDivulgacaoBoot(_bot, deps = {}) {
    if (bootstrapped) return;
    bootstrapped = true;

    if (!WaDivulgacaoConfig.enabled) {
        logger.info('[WaDivulgacao] Módulo desligado (WA_DIVULGACAO_ENABLED=0)');
        return;
    }

    try {
        const r = ensureWaDivulgacaoProducts();
        logger.info('[WaDivulgacao] Módulo ativo — Hanork Div assinatura', { plans: r.upserted });
    } catch (e) {
        (deps.logger || logger).warn('[WaDivulgacao] sync planos falhou', { detail: e.message });
    }
}

module.exports = { registerWaDivulgacaoBoot };
