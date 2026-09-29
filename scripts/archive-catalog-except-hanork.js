'use strict';
/**
 * Arquiva todos os produtos (exceto Hanork #1) em Downloads e remove do bot.
 * Uso: node scripts/archive-catalog-except-hanork.js [--dry-run]
 */
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const os = require('os');
const { connect } = require('../src/config/database-sqlite');

const KEEP_ID = Number(process.env.HANORK_PRODUCT_ID || 1);
const dryRun = process.argv.includes('--dry-run');
const root = path.join(__dirname, '..');
function resolveArchiveRoot() {
  const date = new Date().toISOString().slice(0, 10);
  const winDownloads = '/mnt/c/Users/boots/Downloads/hanork-produtos-arquivo/' + date;
  if (fs.existsSync('/mnt/c/Users/boots/Downloads')) return winDownloads;
  return path.join(os.homedir(), 'Downloads', 'hanork-produtos-arquivo', date);
}

const archiveRoot = resolveArchiveRoot();

const productsDir = process.env.PRODUCTS_PATH || path.join(root, 'produtos');
const photosDir = process.env.CAMINHO_FOTOS || path.join(root, 'fotos');

function ensureDir(p) {
  if (!dryRun) fs.mkdirSync(p, { recursive: true });
}

function moveFile(src, dest) {
  if (!src || !fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  if (dryRun) {
    console.log(`[dry] move ${src} → ${dest}`);
        return true;
  }
  try {
    fs.renameSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
  console.log(`movido: ${path.basename(src)} → ${path.relative(archiveRoot, dest)}`);
  return true;
}

function copyThenDelete(src, dest) {
  if (!src || !fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  if (dryRun) {
    console.log(`[dry] archive ${src} → ${dest}`);
    return true;
  }
  fs.copyFileSync(src, dest);
  fs.unlinkSync(src);
  console.log(`arquivado: ${path.relative(archiveRoot, dest)}`);
  return true;
}

function findAutoProdImage(id) {
  const hits = [];
  const bases = [
    path.join(root, 'zero-divu', 'src', 'media', 'hanork'),
    path.join(root, 'shared', 'zero-ipc', 'media', 'hanork'),
  ];
  for (const base of bases) {
    const fp = path.join(base, `auto-prod-${id}.jpg`);
    if (fs.existsSync(fp)) hits.push(fp);
  }
  return hits;
}

function resolveDeliveryPath(fileUrl) {
  if (!fileUrl || /^https?:\/\//i.test(fileUrl) || String(fileUrl).startsWith('text:')) {
    return null;
  }
  const rel = String(fileUrl).replace(/\\/g, '/');
  const direct = path.join(productsDir, rel);
  if (fs.existsSync(direct)) return direct;
  return null;
}

function paidOrders(db, productId) {
  return (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id = ? AND o.status IN ('PAID','DELIVERED')`
      )
      .get(productId)?.c || 0
  );
}

function writeHanorkOnlyCatalog(db) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(KEEP_ID);
  if (!p) throw new Error(`Produto Hanork #${KEEP_ID} não encontrado`);
  const { writeHanorkOnlyCatalogFile } = require('../src/data/hanorkBroadcastVariants');
  writeHanorkOnlyCatalogFile(p, { username: process.env.BOT_USERNAME || 'hanork_bot' });
  console.log('Catálogo WA: 20 variantes Hanork góticas');
}

function copyTree(src, dest) {
  ensureDir(dest);
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyTree(s, d);
    else {
      fs.copyFileSync(s, d);
      fs.unlinkSync(s);
    }
  }
}

function removeTree(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) removeTree(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}

function sweepLeftovers() {
  const keepDelivery = new Set(['hanork-bot-v3.zip']);
  const keepPhotos = new Set(['hanork_1.jpg']);

  if (fs.existsSync(productsDir)) {
    for (const name of fs.readdirSync(productsDir)) {
      if (keepDelivery.has(name)) continue;
      const src = path.join(productsDir, name);
      const dest = path.join(archiveRoot, 'produtos', name);
      const st = fs.statSync(src);
      if (st.isDirectory()) {
        if (!dryRun) {
          copyTree(src, dest);
          removeTree(src);
          console.log(`movido: ${name}/ → produtos/${name}/`);
        }
      } else if (st.isFile()) {
        moveFile(src, dest);
      }
    }
  }

  if (fs.existsSync(photosDir)) {
    for (const name of fs.readdirSync(photosDir)) {
      if (keepPhotos.has(name)) continue;
      const src = path.join(photosDir, name);
      if (!fs.statSync(src).isFile()) continue;
      moveFile(src, path.join(archiveRoot, 'fotos', name));
    }
  }

  const divulgacao = path.join(archiveRoot, 'DIVULGACAO-HANORK-ONLY.txt');
  if (!dryRun) {
    const { formatAllVariantsBonusFile } = require('../src/data/hanorkBroadcastVariants');
    fs.writeFileSync(divulgacao, formatAllVariantsBonusFile(), 'utf8');
    console.log(`Textos divulgação: ${divulgacao}`);
  }
}

function main() {
  if (process.argv.includes('--sweep-only')) {
    ensureDir(archiveRoot);
    ensureDir(path.join(archiveRoot, 'produtos'));
    ensureDir(path.join(archiveRoot, 'fotos'));
    sweepLeftovers();
    console.log(`Sweep em ${archiveRoot}`);
    return;
  }

  const db = connect();
  const all = db.prepare('SELECT * FROM products ORDER BY id').all();
  const toRemove = all.filter((p) => Number(p.id) !== KEEP_ID);

  if (!toRemove.length) {
    console.log('Nenhum produto extra para arquivar.');
    writeHanorkOnlyCatalog(db);
    return;
  }

  ensureDir(archiveRoot);
  ensureDir(path.join(archiveRoot, 'produtos'));
  ensureDir(path.join(archiveRoot, 'fotos'));
  ensureDir(path.join(archiveRoot, 'textos'));
  ensureDir(path.join(archiveRoot, 'wa-media'));
  ensureDir(path.join(archiveRoot, 'db-export'));

  const manifest = {
    archivedAt: new Date().toISOString(),
    keepProductId: KEEP_ID,
    products: [],
  };

  console.log(dryRun ? '=== DRY RUN ===' : `=== Arquivando em ${archiveRoot} ===\n`);

  for (const p of toRemove) {
    const entry = {
      id: p.id,
      name: p.name,
      price: p.price,
      file_url: p.file_url,
      photo: p.photo,
      category: p.category,
      description: p.description,
      paidOrders: paidOrders(db, p.id),
      files: [],
    };

    const textPath = path.join(archiveRoot, 'textos', `produto-${p.id}-${slug(p.name)}.txt`);
    const textContent = [
      `ID: ${p.id}`,
      `Nome: ${p.name}`,
      `Preço: R$ ${Number(p.price).toFixed(2)}`,
      `Arquivo entrega: ${p.file_url || '-'}`,
      `Foto: ${p.photo || '-'}`,
      `Categoria: ${p.category || '-'}`,
      `Ativo: ${p.active}`,
      '',
      '--- DESCRIÇÃO ---',
      stripHtml(p.description || ''),
      '',
    ].join('\n');
    if (!dryRun) fs.writeFileSync(textPath, textContent, 'utf8');
    entry.files.push(path.relative(archiveRoot, textPath));

    if (p.photo) {
      const src = path.join(photosDir, p.photo);
      const dest = path.join(archiveRoot, 'fotos', p.photo);
      if (moveFile(src, dest)) entry.files.push(`fotos/${p.photo}`);
    }

    const delivery = resolveDeliveryPath(p.file_url);
    if (delivery) {
      const dest = path.join(archiveRoot, 'produtos', path.basename(delivery));
      if (delivery.includes('preview') || delivery.includes(path.sep)) {
        const relDest = path.join(archiveRoot, 'produtos', String(p.file_url).replace(/\\/g, '/'));
        ensureDir(path.dirname(relDest));
        if (!dryRun && fs.existsSync(delivery)) {
          fs.copyFileSync(delivery, relDest);
          try {
            fs.unlinkSync(delivery);
          } catch {
            /* dir tree */
          }
        }
        entry.files.push(path.relative(archiveRoot, relDest));
      } else if (copyThenDelete(delivery, dest)) {
        entry.files.push(`produtos/${path.basename(dest)}`);
      }
    }

    for (const autoImg of findAutoProdImage(p.id)) {
      const dest = path.join(archiveRoot, 'wa-media', `auto-prod-${p.id}.jpg`);
      if (moveFile(autoImg, dest)) entry.files.push(`wa-media/auto-prod-${p.id}.jpg`);
    }

    if (!dryRun) {
      if (entry.paidOrders > 0) {
        db.prepare('UPDATE products SET active = 0, stock = 0 WHERE id = ?').run(p.id);
        db.prepare('UPDATE flash_sales SET active = 0 WHERE product_id = ?').run(p.id);
        console.log(`#${p.id} ${p.name} — pausado (${entry.paidOrders} pedido(s) pagos)`);
      } else {
        db.prepare('DELETE FROM flash_sales WHERE product_id = ?').run(p.id);
        db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
        console.log(`#${p.id} ${p.name} — removido do banco`);
      }
    } else {
      console.log(`#${p.id} ${p.name} — seria ${entry.paidOrders ? 'pausado' : 'removido'}`);
    }

    manifest.products.push(entry);
  }

  if (!dryRun) {
    fs.writeFileSync(
      path.join(archiveRoot, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(archiveRoot, 'db-export', 'products-removidos.json'),
      JSON.stringify(toRemove, null, 2) + '\n',
      'utf8'
    );
  }

  writeHanorkOnlyCatalog(db);
  sweepLeftovers();

  const remaining = db.prepare('SELECT id, name, active FROM products ORDER BY id').all();
  console.log('\nProdutos no banco:', remaining.map((r) => `#${r.id} ${r.name}`).join(', ') || '(vazio)');
  console.log(dryRun ? '\nDry-run — nada alterado.' : `\nArquivo salvo em:\n${archiveRoot}`);
}

function slug(name) {
  return String(name || 'produto')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 48);
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

main();
