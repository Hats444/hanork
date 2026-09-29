#!/usr/bin/env node
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/config/env');

const { connect } = require('../src/config/database-sqlite');
const db = connect();

const svc = db.prepare('SELECT id, name, cost_price, sale_price FROM smm_services WHERE id = ?').get(406);

if (svc) {
    const cost = Number(svc.cost_price);
    const sale = Number(svc.sale_price);
    const markupPct = cost > 0 ? ((sale - cost) / cost) * 100 : 0;
    console.log('=== Servico 406 (teste recente) ===');
    console.log('Nome:', String(svc.name || '').slice(0, 70));
    console.log('Custo fornecedor / 1000:', cost.toFixed(4));
    console.log('Seu preco venda / 1000:', sale.toFixed(4));
    console.log('Markup:', markupPct.toFixed(1) + '%');
    console.log('');
    for (const q of [10, 180, 500, 1000, 5000]) {
        const rev = (sale / 1000) * q;
        const cst = (cost / 1000) * q;
        console.log(
            `${q} un: venda R$${rev.toFixed(2)} | custo R$${cst.toFixed(2)} | lucro R$${(rev - cst).toFixed(2)}`
        );
    }
}

const orders = db.prepare('SELECT status, sale_price, cost, profit, quantity FROM smm_orders').all();
const completed = orders.filter((o) => o.status === 'COMPLETED');
const sum = (arr, key) => arr.reduce((s, o) => s + (Number(o[key]) || 0), 0);

console.log('\n=== Pedidos SMM no DB ===');
console.log('Total pedidos:', orders.length);
console.log('Concluidos:', completed.length, '| lucro R$', sum(completed, 'profit').toFixed(2));
console.log(
    'Todos | venda R$',
    sum(orders, 'sale_price').toFixed(2),
    '| lucro R$',
    sum(orders, 'profit').toFixed(2)
);

const cheap = db
    .prepare('SELECT id, cost_price, sale_price FROM smm_services WHERE active = 1 ORDER BY cost_price ASC LIMIT 3')
    .all();
const pricey = db
    .prepare('SELECT id, cost_price, sale_price FROM smm_services WHERE active = 1 ORDER BY cost_price DESC LIMIT 3')
    .all();

console.log('\n=== Servicos baratos (regra min R$2 / 1000 un.) ===');
for (const s of cheap) {
    const c = Number(s.cost_price);
    const sa = Number(s.sale_price);
    console.log(`id ${s.id} | custo ${c.toFixed(2)} | venda ${sa.toFixed(2)} | lucro/1k R$${(sa - c).toFixed(2)}`);
}
console.log('=== Servicos caros (regra 35%) ===');
for (const s of pricey) {
    const c = Number(s.cost_price);
    const sa = Number(s.sale_price);
    const pct = c > 0 ? (((sa - c) / c) * 100).toFixed(0) : '?';
    console.log(`id ${s.id} | custo ${c.toFixed(2)} | venda ${sa.toFixed(2)} | lucro/1k R$${(sa - c).toFixed(2)} (${pct}%)`);
}

const margin = Number(process.env.SMM_MARGIN_PERCENT) || 35;
const minProfit = Number(process.env.SMM_MIN_PROFIT) || 2;
console.log('\n=== Config atual (.env) ===');
console.log(`SMM_MARGIN_PERCENT=${margin}%`);
console.log(`SMM_MIN_PROFIT=R$${minProfit} por 1000 unidades`);
console.log(`Regra: venda/1000 = max(custo×${1 + margin / 100}, custo+${minProfit})`);
console.log(`Acima de ~R$${(minProfit / (margin / 100)).toFixed(2)}/1000 custo → ganha ${margin}%`);
console.log(`Abaixo disso → ganha fixo R$${minProfit}/1000 unidades`);
