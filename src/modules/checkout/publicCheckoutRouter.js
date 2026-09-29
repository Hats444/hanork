/**
 * publicCheckoutRouter — checkout público por link
 * Rotas:
 *   GET  /loja/:slug                  — vitrine pública da loja
 *   GET  /loja/:slug/produto/:id      — página do produto com OpenGraph
 *   GET  /loja/:slug/p/:id            — alias curto
 *   POST /loja/:slug/produto/:id/pay  — criar pedido e redirecionar para MP
 */
'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../config/logger');
const { resolveProductFormat } = require('../../utils/productFormat');
const catalogBrowse = require('../../utils/catalogBrowse');

function db() {
    return require('../../config/database-sqlite').connect();
}
function getProduct(id, tenantId = null) {
    if (tenantId != null) {
        return (
            db()
                .prepare('SELECT * FROM products WHERE id=? AND active=1 AND tenant_id=?')
                .get(Number(id), tenantId) || null
        );
    }
    return db().prepare('SELECT * FROM products WHERE id=? AND active=1 AND tenant_id IS NULL').get(Number(id)) || null;
}
function getProducts(limit = 20, tenantId = null) {
    if (tenantId != null) {
        return db()
            .prepare('SELECT * FROM products WHERE active=1 AND tenant_id=? ORDER BY id DESC LIMIT ?')
            .all(tenantId, limit);
    }
    return db().prepare('SELECT * FROM products WHERE active=1 AND tenant_id IS NULL ORDER BY id DESC LIMIT ?').all(limit);
}
function getTenant(slug) {
    try {
        return db().prepare('SELECT * FROM tenants WHERE slug=? AND active=1').get(slug) || null;
    } catch {
        return null; // tabela pode não existir ainda
    }
}

function fmtPrice(n) {
    return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function productCard(p, slug) {
    const imgHtml = p.photo_url
        ? `<img src="${escHtml(p.photo_url)}" alt="${escHtml(p.name)}" class="prod-img" loading="lazy">`
        : `<div class="prod-img-placeholder">🛍️</div>`;
    const outOfStock = p.stock !== undefined && p.stock < 1 && p.stock !== 999;
    const fmt = resolveProductFormat(p);
    const fmtHtml = fmt ? `<div class="prod-cat">${escHtml(fmt)}</div>` : '';
    return `
      <div class="prod-card" id="prod-${p.id}">
        ${imgHtml}
        <div class="prod-body">
          <div class="prod-name">${escHtml(p.name)}</div>
          ${fmtHtml}
          <div class="prod-price">${fmtPrice(p.price)}</div>
          ${outOfStock
            ? `<button class="btn-buy" disabled>Esgotado</button>`
            : `<a class="btn-buy" href="/loja/${slug}/produto/${p.id}">Ver produto →</a>`}
        </div>
      </div>`;
}

function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function baseStyles() {
    return `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fc;color:#1a1a2e;min-height:100vh}
    header{background:linear-gradient(135deg,#7c6af7,#5a4fcf);color:#fff;padding:20px 24px;display:flex;align-items:center;gap:16px}
    header h1{font-size:1.4rem;font-weight:700}
    header p{opacity:.85;font-size:.9rem}
    .container{max-width:1100px;margin:0 auto;padding:28px 20px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px}
    .prod-card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06);transition:.2s;display:flex;flex-direction:column}
    .prod-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.1)}
    .prod-img{width:100%;height:180px;object-fit:cover}
    .prod-img-placeholder{width:100%;height:180px;display:flex;align-items:center;justify-content:center;font-size:3rem;background:#f0eeff}
    .prod-body{padding:16px;flex:1;display:flex;flex-direction:column;gap:6px}
    .prod-name{font-weight:600;font-size:1rem;color:#1a1a2e}
    .prod-cat{font-size:.75rem;color:#888;text-transform:uppercase;letter-spacing:.4px}
    .prod-price{font-size:1.3rem;font-weight:700;color:#7c6af7;margin-top:auto;padding-top:8px}
    .btn-buy{display:block;margin-top:10px;background:linear-gradient(135deg,#7c6af7,#5a4fcf);color:#fff;border:none;border-radius:8px;padding:10px;font-size:.9rem;font-weight:600;text-align:center;cursor:pointer;text-decoration:none;transition:.15s}
    .btn-buy:hover{opacity:.88}
    .btn-buy:disabled{background:#ccc;cursor:not-allowed}
    .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:600;background:#f0eeff;color:#7c6af7}
    .back{display:inline-flex;align-items:center;gap:6px;color:#7c6af7;text-decoration:none;font-size:.9rem;margin-bottom:20px}
    .back:hover{text-decoration:underline}
    .product-detail{background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 16px rgba(0,0,0,.07);display:grid;grid-template-columns:1fr 1fr;gap:32px}
    .product-detail img{width:100%;border-radius:12px;object-fit:cover;max-height:360px}
    .product-detail .no-img{width:100%;height:280px;border-radius:12px;background:#f0eeff;display:flex;align-items:center;justify-content:center;font-size:4rem}
    .product-detail h2{font-size:1.6rem;margin-bottom:12px}
    .product-detail .desc{color:#555;line-height:1.6;margin-bottom:20px;white-space:pre-wrap}
    .product-detail .price-big{font-size:2rem;font-weight:700;color:#7c6af7;margin-bottom:24px}
    .tg-btn{display:block;background:linear-gradient(135deg,#7c6af7,#5a4fcf);color:#fff;border:none;border-radius:10px;padding:14px 24px;font-size:1rem;font-weight:600;text-align:center;text-decoration:none;cursor:pointer;transition:.15s;width:100%;max-width:360px}
    .tg-btn:hover{opacity:.88}
    footer{text-align:center;padding:32px 20px;color:#aaa;font-size:.82rem}
    @media(max-width:640px){.product-detail{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}}
    @media(max-width:420px){.grid{grid-template-columns:1fr}}
    .fmt-nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}
    .fmt-chip{display:inline-block;padding:8px 14px;border-radius:20px;font-size:.82rem;font-weight:600;text-decoration:none;background:#fff;color:#5a4fcf;border:1px solid #e0dcf7;transition:.15s}
    .fmt-chip:hover{background:#f0eeff}
    .fmt-chip.active{background:linear-gradient(135deg,#7c6af7,#5a4fcf);color:#fff;border-color:transparent}`;
}

function buildWebFilterBar(slug, groups, activeKey) {
    let html = '<nav class="fmt-nav">';
    html += `<a class="fmt-chip${!activeKey ? ' active' : ''}" href="/loja/${escHtml(slug)}">📋 Todos</a>`;
    for (const key of catalogBrowse.getOrderedFormatKeys(groups)) {
        const n = (groups[key] || []).length;
        if (!n) continue;
        const active = activeKey === key ? ' active' : '';
        html += `<a class="fmt-chip${active}" href="/loja/${escHtml(slug)}?f=${escHtml(key)}">${escHtml(catalogBrowse.bucketLabel(key))} (${n})</a>`;
    }
    html += '</nav>';
    return html;
}

// ── Vitrine da loja ───────────────────────────────────────────────────────────
router.get('/loja/:slug', (req, res) => {
    const { slug } = req.params;
    const tenant = getTenant(slug);
    const storeName = tenant?.name || 'Loja';
    const allProducts = getProducts(50, tenant?.id ?? null);
    const groups = catalogBrowse.groupProductsByFormat(allProducts);
    const filterKey = String(req.query.f || '').toLowerCase();
    const products =
        filterKey && groups[filterKey]
            ? groups[filterKey]
            : filterKey
              ? []
              : allProducts;
    const baseUrl = process.env.SITE_HANORK || `${req.protocol}://${req.get('host')}`;
    const botUsername = process.env.BOT_USERNAME || '';
    const filterBar = buildWebFilterBar(slug, groups, filterKey || null);

    res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(storeName)}</title>
<meta name="description" content="Confira os produtos da ${escHtml(storeName)}">
<meta property="og:title" content="${escHtml(storeName)}">
<meta property="og:description" content="${products.length} produtos disponíveis">
<meta property="og:url" content="${baseUrl}/loja/${slug}">
<meta property="og:type" content="website">
<style>${baseStyles()}</style>
</head>
<body>
<header>
  <div>
    <h1>🛍️ ${escHtml(storeName)}</h1>
    <p>${products.length} produto(s) disponível(is)</p>
  </div>
</header>
<div class="container">
  ${filterBar}
  ${products.length
    ? `<div class="grid">${products.map(p => productCard(p, slug)).join('')}</div>`
    : `<p style="text-align:center;color:#aaa;padding:60px 0">${filterKey ? 'Nenhum produto neste formato.' : 'Nenhum produto disponível no momento.'}</p>`
  }
</div>
<footer>Powered by <b>Hanork</b>${botUsername ? ` · <a href="https://t.me/${botUsername}" style="color:#7c6af7">Comprar via Telegram</a>` : ''}</footer>
</body>
</html>`);
});

// ── Página do produto ─────────────────────────────────────────────────────────
router.get(['/loja/:slug/produto/:id', '/loja/:slug/p/:id'], (req, res) => {
    const { slug, id } = req.params;
    const tenant = getTenant(slug);
    const p = getProduct(id, tenant?.id ?? null);
    if (!p) return res.status(404).send('<h1>Produto não encontrado</h1>');

    const storeName = tenant?.name || 'Loja';
    const baseUrl = process.env.SITE_HANORK || `${req.protocol}://${req.get('host')}`;
    const botUsername = process.env.BOT_USERNAME || '';
    const outOfStock = p.stock !== undefined && p.stock < 1 && p.stock !== 999;
    const tgLink = botUsername
        ? `https://t.me/${botUsername}?start=buy_${p.id}`
        : null;
    const fmt = resolveProductFormat(p);
    const fmtBadge = fmt ? `<span class="badge">${escHtml(fmt)}</span>` : '';

    res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(p.name)} — ${escHtml(storeName)}</title>
<meta name="description" content="${escHtml((p.description || '').slice(0, 155))}">
<meta property="og:title" content="${escHtml(p.name)}">
<meta property="og:description" content="${escHtml((p.description || '').slice(0, 155))}">
<meta property="og:url" content="${baseUrl}/loja/${slug}/produto/${p.id}">
<meta property="og:type" content="product">
${p.photo_url ? `<meta property="og:image" content="${escHtml(p.photo_url)}">` : ''}
<meta property="product:price:amount" content="${p.price}">
<meta property="product:price:currency" content="BRL">
<style>${baseStyles()}</style>
</head>
<body>
<header>
  <div>
    <h1>🛍️ ${escHtml(storeName)}</h1>
  </div>
</header>
<div class="container">
  <a class="back" href="/loja/${slug}">← Voltar à loja</a>
  <div class="product-detail">
    <div>
      ${p.photo_url
        ? `<img src="${escHtml(p.photo_url)}" alt="${escHtml(p.name)}">`
        : `<div class="no-img">🛍️</div>`}
    </div>
    <div>
      ${fmtBadge}
      <h2 style="margin-top:${fmt ? '12' : '0'}px">${escHtml(p.name)}</h2>
      ${p.description ? `<div class="desc">${escHtml(p.description)}</div>` : ''}
      <div class="price-big">${fmtPrice(p.price)}</div>
      ${outOfStock
        ? `<button class="tg-btn" disabled style="background:#ccc">Produto esgotado</button>`
        : tgLink
          ? `<a class="tg-btn" href="${escHtml(tgLink)}" target="_blank">🤖 Comprar via Telegram</a>`
          : `<p style="color:#888;font-size:.9rem">Entre em contato para comprar.</p>`
      }
      ${p.stock && p.stock < 999 && p.stock > 0
        ? `<p style="color:#f59e0b;font-size:.82rem;margin-top:10px">⚠️ Apenas ${p.stock} unidade(s) em estoque</p>`
        : ''}
    </div>
  </div>
</div>
<footer>Powered by <b>Hanork</b>${botUsername ? ` · <a href="https://t.me/${botUsername}" style="color:#7c6af7">Abrir bot</a>` : ''}</footer>
</body>
</html>`);

    logger.info(`[PUBLIC] Produto ${p.id} visualizado — slug=${slug}`);
});

module.exports = router;
