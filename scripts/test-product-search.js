'use strict';

/**
 * node scripts/test-product-search.js
 */

require('dotenv').config();
const ProductSearchService = require('../src/services/ProductSearchService');

const sample = [
    { id: 1, name: 'Cursor Dragon Pro', description: 'Conta premium cursor', category: 'assinatura', price: 49, active: true, stock: 10, file_url: 'x.zip' },
    { id: 2, name: 'Hanork AI Bot', description: 'Automação vendas telegram', category: 'servico', price: 199, active: true, stock: 5, file_url: '' },
    { id: 3, name: 'Pack Canva Pro', description: 'Templates e recursos', category: 'geral', price: 29, active: true, stock: 99, file_url: 'pack.zip' },
    { id: 4, name: 'Netflix 4K', description: 'Tela compartilhada', category: 'streaming', price: 15, active: true, stock: 20, file_url: '' },
];

const cases = [
    ['hanork', 2],
    ['cursor', 1],
    ['cursor dragon', 1],
    ['dragon', 1],
    ['canva', 3],
    ['streaming netflix', 4],
    ['zip', [1, 3]],
    ['#2', 2],
    ['produto inexistente xyz', null],
];

let failed = 0;
for (const [query, expectId] of cases) {
    const { results, scores } = ProductSearchService.searchProducts(sample, query);
    const topId = results[0]?.id ?? null;
    const ok = expectId === null
        ? results.length === 0
        : Array.isArray(expectId)
          ? expectId.includes(topId)
          : topId === expectId;
    if (!ok) failed += 1;
    console.log(
        ok ? 'OK  ' : 'FAIL',
        JSON.stringify({ query, top: topId, expect: expectId, scores: scores.slice(0, 3) })
    );
}

if (failed) {
    console.error(`\n${failed} falha(s)`);
    process.exit(1);
}
console.log(`\n${cases.length} casos OK — busca universal`);
