'use strict';
/**
 * Remove produto #14 (Método ban) do catálogo e arquivos relacionados.
 * Uso: node scripts/remove-metodo-ban.js [--hard]
 *
 * Padrão: pausa no banco (active=0) — pedidos antigos preservados.
 * --hard: DELETE FROM products (só se não houver pedidos pagos).
 */
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { connect } = require('../src/config/database-sqlite');

const PRODUCT_ID = 14;
const hard = process.argv.includes('--hard');
const root = path.join(__dirname, '..');

const filesToDelete = [
    path.join(root, 'fotos', 'Metodo_Ban_1.jpg'),
];

function removeFromAutoCatalog() {
    const catalogPath = path.join(root, 'shared', 'zero-ipc', 'hanork_auto_catalog.json');
    if (!fs.existsSync(catalogPath)) return { removed: false };
    const payload = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const before = (payload.variacoes || []).length;
    payload.variacoes = (payload.variacoes || []).filter(
        (v) => Number(v.productId) !== PRODUCT_ID
    );
    payload.productCount = payload.variacoes.length;
    payload.updatedAt = new Date().toISOString();
    fs.writeFileSync(catalogPath, JSON.stringify(payload, null, 2) + '\n');
    return { removed: before !== payload.variacoes.length, count: payload.variacoes.length };
}

function findAutoProdImage() {
    const candidates = [
        path.join(root, 'zero-divu', 'media', 'hanork', 'auto-prod-14.jpg'),
        path.join(root, 'shared', 'zero-ipc', 'media', 'hanork', 'auto-prod-14.jpg'),
    ];
    try {
        const pathResolver = require('../zero-divu/src/utils/pathResolver');
        candidates.push(path.join(pathResolver.getMediaDir(), 'hanork', 'auto-prod-14.jpg'));
    } catch {
        /* ignore */
    }
    return candidates.filter((p) => fs.existsSync(p));
}

function main() {
    const db = connect();
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(PRODUCT_ID);
    if (!product) {
        console.log('Produto #14 não encontrado no banco — nada a fazer.');
        process.exit(0);
    }

    const orders = db
        .prepare(
            `SELECT COUNT(*) as c FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = ? AND o.status IN ('PAID','DELIVERED')`
        )
        .get(PRODUCT_ID);

    if (hard && orders.c > 0) {
        console.error(`Abortado: ${orders.c} pedido(s) pago(s) referenciam o produto #14.`);
        console.error('Use sem --hard para apenas pausar (active=0).');
        process.exit(1);
    }

    if (hard) {
        db.prepare('DELETE FROM flash_sales WHERE product_id = ?').run(PRODUCT_ID);
        db.prepare('DELETE FROM products WHERE id = ?').run(PRODUCT_ID);
        console.log('Banco: produto #14 removido (DELETE).');
    } else {
        db.prepare('UPDATE products SET active = 0, stock = 0 WHERE id = ?').run(PRODUCT_ID);
        db.prepare('UPDATE flash_sales SET active = 0 WHERE product_id = ?').run(PRODUCT_ID);
        console.log('Banco: produto #14 pausado (active=0, stock=0).');
    }
    console.log(`Pedidos históricos preservados: ${orders.c}`);

    const catalog = removeFromAutoCatalog();
    if (catalog.removed) {
        console.log(`Catálogo WA: entrada prod-14 removida (${catalog.count} produtos restantes).`);
    }

    let deleted = 0;
    for (const fp of [...filesToDelete, ...findAutoProdImage()]) {
        try {
            fs.unlinkSync(fp);
            console.log(`Arquivo removido: ${fp}`);
            deleted++;
        } catch {
            /* ignore */
        }
    }
    if (!deleted) console.log('Nenhum arquivo físico encontrado para remover.');

    console.log('\nConcluído — Método ban fora do catálogo e da divulgação.');
    console.log('Reinicie o bot ou rode sync WA para aplicar o catálogo limpo.');
}

main();
