'use strict';

const ProductAdminService = require('../../services/ProductAdminService');

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const DB_FIELD_MAP = {
    name: 'name',
    price: 'price',
    desc: 'description',
    stock: 'stock',
    cat: 'category',
    photo: 'photo',
    file: 'file_url',
};

/**
 * Processa texto do admin em modo edição de produto (ep_*).
 * Deve rodar antes de bridge, broadcast, Hanork e demais catch-alls.
 * @returns {boolean} true se consumiu o update
 */
async function tryHandleProductEditText(ctx, deps) {
    const { isAdmin, editProductMode, Msg, productAdminDeps, escapeMd } = deps;
    const uid = ctx.from?.id;
    if (!uid || !isAdmin(uid)) return false;
    if (!(await editProductMode.has(uid))) return false;

    const txt = String(ctx.message?.text || '').trim();
    const edit = await editProductMode.get(uid);
    const pid = edit?.pid;
    const field = edit?.field;

    if (!pid || !field) {
        await editProductMode.delete(uid);
        await Msg.reply(ctx, '❌ Sessão de edição expirou. Use /editproduto ID');
        return true;
    }

    if (txt === '/cancelar' || txt.toLowerCase() === 'cancelar') {
        await editProductMode.delete(uid);
        const p = await ProductAdminService.findProduct(pid, true);
        if (!p) {
            await Msg.reply(ctx, '❌ Edição cancelada.');
            return true;
        }
        await Msg.reply(
            ctx,
            `❌ Edição cancelada.\n\n<b>Produto #${pid}</b> — ${escapeHtml(p.name)}`,
            {
                parse_mode: 'HTML',
                reply_markup: ProductAdminService.buildEditKeyboard(pid, p).reply_markup,
            }
        );
        return true;
    }

    const dbField = DB_FIELD_MAP[field];
    if (!dbField) {
        await editProductMode.delete(uid);
        await Msg.reply(ctx, '❌ Campo inválido. Use /editproduto ID');
        return true;
    }

    if (field === 'photo' && !/^https?:\/\//i.test(txt)) {
        await Msg.reply(
            ctx,
            '🖼️ Envie a <b>imagem</b> como foto/arquivo, ou digite URL <code>https://...</code>.',
            { parse_mode: 'HTML' }
        );
        return true;
    }

    if (field === 'file') {
        const isLink = /^https?:\/\//i.test(txt);
        const isTextDelivery = txt.startsWith('text:');
        if (!isLink && !isTextDelivery) {
            await Msg.reply(
                ctx,
                '📎 Envie o <b>arquivo</b> como documento/mídia, cole link <code>https://...</code> ou conteúdo <code>text:...</code>.',
                { parse_mode: 'HTML' }
            );
            return true;
        }
    }

    if (!txt) {
        await Msg.reply(ctx, '❌ Digite um valor válido ou envie cancelar.');
        return true;
    }

    const result = await ProductAdminService.applyFieldUpdate(pid, dbField, txt, productAdminDeps(ctx));
    if (!result.ok) {
        await editProductMode.set(uid, { pid, field, _ts: Date.now() });
        await Msg.reply(ctx, `❌ ${result.error}`);
        return true;
    }

    await editProductMode.delete(uid);
    const display = escapeMd
        ? escapeMd(result.displayValue.slice(0, 200)) +
          (result.displayValue.length > 200 ? '…' : '')
        : result.displayValue.slice(0, 200);

    await Msg.reply(
        ctx,
        `✅ <b>${result.label}</b> do produto #${pid} atualizado.\n\n` +
            `Novo valor: <code>${display}</code>`,
        {
            parse_mode: 'HTML',
            reply_markup: ProductAdminService.buildEditKeyboard(pid, result.product).reply_markup,
        }
    );
    return true;
}

module.exports = { tryHandleProductEditText, DB_FIELD_MAP };
