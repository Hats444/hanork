'use strict';

const FornecedorBrasilProvider = require('./fornecedorBrasilProvider');
const SsmProviderAdapter = require('./ssmProviderAdapter');
const UpFamaProvider = require('./upFamaProvider');

const registry = new Map([
    [SsmProviderAdapter.name, SsmProviderAdapter],
    [UpFamaProvider.name, UpFamaProvider],
]);

function getProvider(name) {
    const key = name || SsmProviderAdapter.name;
    return registry.get(key) || null;
}

function listProviders() {
    return [...registry.keys()];
}

module.exports = {
    getProvider,
    listProviders,
    FornecedorBrasilProvider,
    SsmProviderAdapter,
    UpFamaProvider,
};
