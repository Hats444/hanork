'use strict';

const path = require('path');
const fs = require('fs');
const { Markup } = require('telegraf');
const { prisma } = require('../config/database-sqlite');
const logger = require('../config/logger');
const { formatForStorage, resolveProductFormat } = require('../utils/productFormat');
const { MIN_NAME_LEN, MIN_DESC_LEN } = require('../utils/productListing');
const { normalizeProductDescription } = require('../utils/normalizeProductDescription');
const { resolveLocalFile } = require('../utils/safeLocalPath');
const { buildProductPhotoFileName } = require('../utils/telegramMedia');
const AuditService = require('../modules/audit/AuditService');
const UserService = require('../modules/user/UserService');

const FIELD_ALIASES = {
    nome: 'name',
    name: 'name',
    preco: 'price',
    preço: 'price',
    price: 'price',
    valor: 'price',
    descricao: 'description',
    descrição: 'description',
    desc: 'description',
    description: 'description',
    estoque: 'stock',
    stock: 'stock',
    foto: 'photo',
    photo: 'photo',
    capa: 'photo',
    arquivo: 'file_url',
    file: 'file_url',
    entrega: 'file_url',
    formato: 'category',
    format: 'category',
    categoria: 'category',
    category: 'category',
    cat: 'category',
    ativo: 'active',
    active: 'active',
    status: 'active',
};

const FIELD_LABELS = {
    name: 'Nome',
    price: 'Preço',
    description: 'Descrição',
    stock: 'Estoque',
    photo: 'Capa',
    file_url: 'Arquivo de entrega',
    category: 'Formato',
    active: 'Status',
};

function normalizeField(raw) {
    const key = String(raw || '').trim().toLowerCase();
    return FIELD_ALIASES[key] || null;
}

function parseQuickEdit(text) {
    const parts = String(text || '').trim().split(/\s+/);
    if (parts.length < 3) return null;
    const pid = parseInt(parts[1], 10);
    const field = normalizeField(parts[2]);
    if (!pid || !field) return null;
    const value = parts.slice(3).join(' ').trim();
    if (!value) return null;
    return { pid, field, value };
}

function stockLabel(stock) {
    if (stock >= 999) return '∞';
    if (stock <= 0) return 'Esgotado';
    return String(stock);
}

function deliverySummary(p) {
    const fu = String(p.file_url || '').trim();
    if (!fu) return 'Sem arquivo (serviço/assinatura)';
    if (fu.startsWith('text:')) return 'Texto/código na entrega';
    if (/^https?:\/\//i.test(fu)) return `Link externo`;
    return `<code>${fu}</code>`;
}

function photoSummary(p) {
    if (p.photo_url) return 'URL externa';
    if (p.photo) return `<code>${p.photo}</code>`;
    return 'Sem capa';
}

async function getSalesCount(productId, dbRaw) {
    try {
        const db = dbRaw?.() || dbRaw;
        if (!db?.prepare) return 0;
        const row = db
            .prepare(
                `SELECT COUNT(DISTINCT oi.order_id) as c
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 WHERE oi.product_id = ? AND o.status IN ('PAID','DELIVERED')`
            )
            .get(productId);
        return row?.c || 0;
    } catch {
        return 0;
    }
}

async function findProduct(pid, includeInactive = true) {
    const id = parseInt(pid, 10);
    if (!id) return null;
    const p = await prisma.product.findUnique({ where: { id } });
    if (!p) return null;
    if (!includeInactive && !p.active) return null;
    return p;
}

function buildProductDetailText(p, extras = {}) {
    const fmt = resolveProductFormat(p);
    const status = p.active ? 'Ativo no catálogo' : 'Pausado (fora do catálogo)';
    const sub = p.is_subscription ? '\nAssinatura' : '';

    let txt =
        `<b>Produto #${p.id}</b>\n\n` +
        `<b>${p.name}</b>\n\n` +
        `${normalizeProductDescription(p.description) || '<i>Sem descrição</i>'}\n\n` +
        `<b>R$ ${Number(p.price).toFixed(2)}</b>\n` +
        `Estoque: ${stockLabel(p.stock ?? 999)}\n` +
        `Formato: ${fmt ? `<b>${fmt.toUpperCase()}</b>` : '—'}\n` +
        `Capa: ${photoSummary(p)}\n` +
        `Entrega: ${deliverySummary(p)}\n` +
        `${status}${sub}`;

    if (extras.sales != null) {
        txt += `\nVendas confirmadas: <b>${extras.sales}</b>`;
    }
    return txt;
}

function buildEditKeyboard(pid, p) {
    const rows = [
        [
            { text: 'Nome', callback_data: `ep_name_${pid}` },
            { text: 'Preço', callback_data: `ep_price_${pid}` },
        ],
        [
            { text: 'Descrição', callback_data: `ep_desc_${pid}` },
            { text: 'Capa', callback_data: `ep_photo_${pid}` },
        ],
        [
            { text: 'Arquivo', callback_data: `ep_file_${pid}` },
            { text: 'Estoque', callback_data: `ep_stock_${pid}` },
        ],
        [{ text: 'Formato', callback_data: `ep_cat_${pid}` }],
    ];

    if (p?.active) {
        rows.push([{ text: 'Pausar no catálogo', callback_data: `prod_del_${pid}` }]);
    } else {
        rows.push([{ text: 'Reativar no catálogo', callback_data: `prod_reactivate_${pid}` }]);
    }

    rows.push(
        [{ text: 'Flash sale', callback_data: `prod_flash_${pid}` }],
        [
            { text: 'Voltar produtos', callback_data: 'prod_menu_back' },
            { text: 'Voltar admin', callback_data: 'a_menu' },
        ]
    );

    return Markup.inlineKeyboard(rows);
}

function buildDeleteConfirmKeyboard(pid) {
    return Markup.inlineKeyboard([
        [
            { text: 'Sim, pausar', callback_data: `prod_del_confirm_${pid}` },
            { text: 'Cancelar', callback_data: `prod_edit_${pid}` },
        ],
        [{ text: 'Voltar produtos', callback_data: 'prod_menu_back' }],
    ]);
}

function buildListText(products, { page = 0, pageSize = 15 } = {}) {
    if (!products.length) {
        return '<b>Nenhum produto cadastrado.</b>\n\nUse <code>/addproduto</code> para criar o primeiro.';
    }
    const slice = products.slice(page * pageSize, (page + 1) * pageSize);
    let txt = `<b>Produtos (${products.length})</b>\n\n`;
    slice.forEach((p) => {
        const flag = p.active ? 'ativo' : 'pausado';
        txt += `${flag} <b>#${p.id}</b> ${p.name}\n`;
        txt += `   R$ ${Number(p.price).toFixed(2)} · ${stockLabel(p.stock ?? 999)}\n`;
    });
    if (products.length > (page + 1) * pageSize) {
        txt += `\n<i>Página ${page + 1} — use os botões para navegar</i>`;
    }
    txt +=
        `\n\n<b>Comandos rápidos:</b>\n` +
        `<code>/produto ID</code> — detalhes\n` +
        `<code>/editproduto ID</code> — editar\n` +
        `<code>/editproduto ID preco 29.90</code> — atalho\n` +
        `<code>/removeproduto ID</code> — pausar`;
    return txt;
}

function buildListKeyboard(products, page = 0, pageSize = 15) {
    const rows = [];
    const nav = [];
    if (page > 0) nav.push({ text: 'Anterior', callback_data: `prod_list_pg_${page - 1}` });
    if ((page + 1) * pageSize < products.length) {
        nav.push({ text: 'Próxima', callback_data: `prod_list_pg_${page + 1}` });
    }
    if (nav.length) rows.push(nav);
    rows.push([{ text: 'Voltar produtos', callback_data: 'prod_menu_back' }]);
    return Markup.inlineKeyboard(rows);
}

function buildEditHelpText() {
    return (
        `<b>Editar produto — atalhos</b>\n\n` +
        `<code>/editproduto ID</code> — painel com botões\n\n` +
        `<b>Edição direta:</b>\n` +
        `<code>/editproduto ID nome Pack VIP</code>\n` +
        `<code>/editproduto ID preco 29.90</code>\n` +
        `<code>/editproduto ID desc Nova descrição aqui</code>\n` +
        `<code>/editproduto ID estoque 50</code>\n` +
        `<code>/editproduto ID foto https://...</code>\n` +
        `<code>/editproduto ID ativo sim</code>\n\n` +
        `<i>Campos: nome, preco, desc, estoque, foto, arquivo, formato, ativo</i>`
    );
}

function parseActiveValue(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (['1', 'true', 'sim', 's', 'on', 'ativar', 'ativo', 'yes'].includes(v)) return 1;
    if (['0', 'false', 'nao', 'não', 'n', 'off', 'pausar', 'inativo', 'no'].includes(v)) return 0;
    return null;
}

async function applyFieldUpdate(pid, field, rawValue, deps = {}) {
    const p = await findProduct(pid, true);
    if (!p) return { ok: false, error: 'Produto não encontrado.' };

    const dbField = field;
    let value = rawValue;
    const data = {};

    switch (dbField) {
        case 'name': {
            value = String(rawValue).trim();
            if (value.length < MIN_NAME_LEN) {
                return { ok: false, error: `Nome muito curto (mín. ${MIN_NAME_LEN} caracteres).` };
            }
            data.name = value;
            break;
        }
        case 'description': {
            value = String(rawValue).trim();
            if (value.length < MIN_DESC_LEN) {
                return { ok: false, error: `Descrição muito curta (mín. ${MIN_DESC_LEN} caracteres).` };
            }
            data.description = value;
            break;
        }
        case 'price': {
            value = parseFloat(String(rawValue).replace(',', '.'));
            if (Number.isNaN(value) || value <= 0) {
                return { ok: false, error: 'Preço inválido. Exemplo: 29.90' };
            }
            data.price = value;
            break;
        }
        case 'stock': {
            value = parseInt(String(rawValue).replace(/\D/g, ''), 10);
            if (Number.isNaN(value) || value < 0) {
                return { ok: false, error: 'Estoque inválido. Use um número ≥ 0.' };
            }
            data.stock = value;
            break;
        }
        case 'photo': {
            const url = String(rawValue).trim();
            if (!/^https?:\/\//i.test(url)) {
                return { ok: false, error: 'URL inválida. Use https://... ou envie a imagem no painel.' };
            }
            data.photo_url = url;
            data.photo = '';
            break;
        }
        case 'file_url': {
            value = String(rawValue).trim();
            if (!value) return { ok: false, error: 'Informe o arquivo, link ou conteúdo.' };
            if (!value.startsWith('text:') && !/^https?:\/\//i.test(value)) {
                const productsDir = deps.productsDir;
                if (productsDir) {
                    const local = resolveLocalFile(productsDir, value);
                    if (!local) {
                        return { ok: false, error: 'Arquivo local não encontrado. Envie o arquivo pelo painel.' };
                    }
                }
            }
            data.file_url = value;
            data.category = formatForStorage({ ...p, file_url: value });
            break;
        }
        case 'category': {
            const raw = String(rawValue).trim().toLowerCase();
            data.category =
                !raw || raw === 'auto' || raw === 'automatico'
                    ? formatForStorage(p)
                    : formatForStorage({ ...p, category: raw });
            value = data.category;
            break;
        }
        case 'active': {
            const active = parseActiveValue(rawValue);
            if (active === null) {
                return { ok: false, error: 'Use sim/nao, ativar/pausar ou 1/0.' };
            }
            data.active = active;
            value = active ? 'ativo' : 'pausado';
            break;
        }
        default:
            return { ok: false, error: 'Campo não reconhecido.' };
    }

    const updated = await prisma.product.update({ where: { id: pid }, data });

    if (typeof deps.invalidateProductCache === 'function') {
        deps.invalidateProductCache();
    }

    if (dbField === 'name' && updated.photo && !updated.photo_url && deps.photosDir) {
        try {
            await syncPhotoFileName(updated, deps.photosDir);
        } catch (e) {
            logger.warn('[ProductAdmin] renomear capa:', e.message);
        }
    }

    if (dbField === 'stock' && value > 0 && (p.stock ?? 999) <= 0 && typeof deps.notifyRestock === 'function') {
        deps.notifyRestock(pid, updated.name).catch(() => {});
    }

    try {
        const adminUser = deps.adminTelegramId
            ? await UserService.findByTelegramId(deps.adminTelegramId)
            : null;
        AuditService.log(adminUser?.id, deps.adminTelegramId, 'UPDATE_PRODUCT', 'product', String(pid), {
            [dbField]: p[dbField],
        }, { [dbField]: data[dbField] ?? value });
    } catch { /* opcional */ }

    return {
        ok: true,
        product: updated,
        field: dbField,
        label: FIELD_LABELS[dbField] || dbField,
        displayValue: String(value),
    };
}

async function syncPhotoFileName(product, photosDir) {
    if (!product?.photo || product.photo_url || !product.name) return product;
    const oldFp = resolveLocalFile(photosDir, product.photo);
    if (!oldFp) return product;

    const desired = buildProductPhotoFileName(product.name, { fileName: product.photo }, photosDir);
    if (product.photo === desired) return product;

    const newFp = path.join(photosDir, desired);
    if (oldFp !== newFp) {
        fs.renameSync(oldFp, newFp);
    }
    const updated = await prisma.product.update({
        where: { id: product.id },
        data: { photo: desired },
    });
    return updated;
}

async function updateProductPhotoFromFile(pid, savedFileName, productName, deps = {}) {
    const p = await findProduct(pid, true);
    if (!p) return { ok: false, error: 'Produto não encontrado.' };

    let fileName = savedFileName;
    if (productName || p.name) {
        const desired = buildProductPhotoFileName(
            productName || p.name,
            { fileName: savedFileName },
            deps.photosDir
        );
        if (desired !== savedFileName && deps.photosDir) {
            const oldFp = resolveLocalFile(deps.photosDir, savedFileName);
            const newFp = path.join(deps.photosDir, desired);
            if (oldFp && oldFp !== newFp) {
                fs.renameSync(oldFp, newFp);
                fileName = desired;
            }
        }
    }

    const updated = await prisma.product.update({
        where: { id: pid },
        data: { photo: fileName, photo_url: '' },
    });

    if (typeof deps.invalidateProductCache === 'function') deps.invalidateProductCache();

    return { ok: true, product: updated, fileName };
}

async function setProductActive(pid, active, deps = {}) {
    const p = await findProduct(pid, true);
    if (!p) return { ok: false, error: 'Produto não encontrado.' };

    const updated = await prisma.product.update({
        where: { id: pid },
        data: { active: active ? 1 : 0 },
    });

    if (typeof deps.invalidateProductCache === 'function') deps.invalidateProductCache();

    try {
        const adminUser = deps.adminTelegramId
            ? await UserService.findByTelegramId(deps.adminTelegramId)
            : null;
        AuditService.log(
            adminUser?.id,
            deps.adminTelegramId,
            active ? 'ACTIVATE_PRODUCT' : 'DEACTIVATE_PRODUCT',
            'product',
            String(pid),
            { active: p.active },
            { active: updated.active }
        );
    } catch { /* opcional */ }

    return { ok: true, product: updated };
}

function getEditFieldPrompt(field) {
    const labels = {
        name: 'nome',
        price: 'preço (ex: 29.90)',
        desc: 'descrição',
        photo: 'capa (foto, imagem ou URL https://)',
        file: 'arquivo de entrega (documento, mídia ou link https://)',
        stock: 'estoque (número)',
        cat: 'formato (zip, mp4, jpg… ou auto)',
    };
    return labels[field] || field;
}

module.exports = {
    FIELD_ALIASES,
    FIELD_LABELS,
    normalizeField,
    parseQuickEdit,
    findProduct,
    buildProductDetailText,
    buildEditKeyboard,
    buildDeleteConfirmKeyboard,
    buildListText,
    buildListKeyboard,
    buildEditHelpText,
    applyFieldUpdate,
    updateProductPhotoFromFile,
    setProductActive,
    getEditFieldPrompt,
    getSalesCount,
};
