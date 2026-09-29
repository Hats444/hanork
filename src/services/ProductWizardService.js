'use strict';

const path = require('path');
const fs = require('fs');
const { resolveLocalFile } = require('../utils/safeLocalPath');
const { formatForStorage } = require('../utils/productFormat');
const {
    validateListingDraft,
    buildBuyerProductText,
    getDescriptionHint,
    MIN_DESC_LEN,
    MIN_NAME_LEN,
} = require('../utils/productListing');
const {
    extractTelegramMedia,
    downloadTelegramFile,
    formatBytes,
    DEFAULT_MAX_BYTES,
    buildProductPhotoFileName,
} = require('../utils/telegramMedia');
const logger = require('../config/logger');
const Msg = require('../telegram/Msg');
const dbRaw = require('../config/database-sqlite').connect;

const PRODUCTS_DIR = process.env.PRODUCTS_PATH || path.join(__dirname, '../../produtos');
const WIZARD_TTL_MS = 15 * 60 * 1000;

const PRODUCT_WIZARD_STEPS = {
    TYPE: 'type',
    NAME: 'name',
    DESCRIPTION: 'description',
    PRICE: 'price',
    PHOTO: 'photo',
    FILE: 'file',
    CONFIRM: 'confirm',
};

const PRODUCT_TYPES = {
    FILE: 'file',
    PHOTO: 'photo',
    VIDEO: 'video',
    AUDIO: 'audio',
    TEXT: 'text',
    SERVICE: 'service',
    SUBSCRIPTION: 'subscription',
};

function getTypeEmoji(_type) {
    return '';
}

function getTypeName(type) {
    const map = {
        file: 'Arquivo',
        photo: 'Foto',
        video: 'Vídeo',
        audio: 'Áudio',
        text: 'Texto/Código',
        service: 'Serviço',
        subscription: 'Assinatura',
    };
    return map[type] || 'Produto';
}

function isExpired(wizard) {
    return !wizard?._ts || Date.now() - wizard._ts > WIZARD_TTL_MS;
}

function clearWizard(store, adminId) {
    store.delete(adminId);
}

function startWizard(store, adminId) {
    store.set(adminId, { step: PRODUCT_WIZARD_STEPS.TYPE, data: {}, _ts: Date.now() });
}

function typeKeyboard(Markup) {
    return Markup.inlineKeyboard([
        [
            { text: 'Arquivo', callback_data: 'prodtype_file' },
            { text: 'Foto', callback_data: 'prodtype_photo' },
        ],
        [
            { text: 'Vídeo', callback_data: 'prodtype_video' },
            { text: 'Áudio', callback_data: 'prodtype_audio' },
        ],
        [
            { text: 'Texto/Código', callback_data: 'prodtype_text' },
            { text: 'Serviço', callback_data: 'prodtype_service' },
        ],
        [{ text: 'Assinatura', callback_data: 'prodtype_subscription' }],
        [{ text: 'Cancelar', callback_data: 'prod_cancel' }],
    ]);
}

function syncWizardFormat(wizard) {
    wizard.data.category = formatForStorage({
        file_url: wizard.data.file_url || '',
        type: wizard.data.type,
        is_subscription: wizard.data.type === PRODUCT_TYPES.SUBSCRIPTION,
    });
}

function fileStepHint(type) {
    if (type === PRODUCT_TYPES.TEXT) {
        return (
            'Envie o <b>conteúdo</b> (texto na mensagem), arquivo <b>.txt</b> ou link <code>https://...</code>.\n\n' +
            '<i>Ou digite <code>pular</code> para usar só a descrição.</i>'
        );
    }
    if (type === PRODUCT_TYPES.SERVICE || type === PRODUCT_TYPES.SUBSCRIPTION) {
        return (
            'Envie um arquivo opcional (ZIP, PDF, foto, vídeo, áudio…) ou link <code>https://...</code>.\n\n' +
            '<i>Ou digite <code>pular</code> para continuar sem arquivo.</i>'
        );
    }
    if (type === PRODUCT_TYPES.PHOTO) {
        return 'Envie a <b>foto</b> do produto (imagem/GIF) ou digite <code>pular</code> se já enviou no passo da capa.';
    }
    return (
        '<b>Arquivo de entrega</b> — envie como <b>Documento</b> (recomendado para ZIP, PDF, TXT…) ou mídia:\n\n' +
        'ZIP/RAR/7Z · PDF/TXT/DOC · Foto · Vídeo · Áudio\n\n' +
        `<i>Até ${formatBytes(DEFAULT_MAX_BYTES)}. Link externo: cole <code>https://...</code></i>\n` +
        '<i>Ou digite <code>pular</code> se for serviço sem arquivo.</i>'
    );
}

async function saveProductCover(ctx, wizard, media, deps = {}) {
    const photosDir = deps.photosDir || PRODUCTS_DIR;
    const coverName = buildProductPhotoFileName(wizard.data.name, media, photosDir);
    await Msg.reply(ctx, `Salvando capa (${media.label || 'imagem'})…`);
    const saved = await downloadTelegramFile(ctx, media.fileId, coverName, photosDir, {
        mimeType: media.mimeType,
        maxBytes: 10 * 1024 * 1024,
    });
    wizard.data.photo = saved.fileName;
    wizard.data.photo_url = '';
    wizard.data._photo_mime = media.mimeType || '';
}

function syncProductPhotoFileName(wizard, deps = {}) {
    if (!wizard.data.photo || wizard.data.photo_url || !wizard.data.name) return;
    const photosDir = deps.photosDir || PRODUCTS_DIR;
    const oldFp = resolveLocalFile(photosDir, wizard.data.photo);
    if (!oldFp) return;

    const desired = buildProductPhotoFileName(
        wizard.data.name,
        { fileName: wizard.data.photo, mimeType: wizard.data._photo_mime },
        photosDir
    );
    if (wizard.data.photo === desired) return;

    const newFp = path.join(photosDir, desired);
    try {
        if (oldFp !== newFp) {
            fs.renameSync(oldFp, newFp);
        }
        wizard.data.photo = desired;
    } catch (e) {
        logger.warn('[ProductWizard] renomear capa:', e.message);
    }
}

async function maybeSetCoverFromDeliveryImage(ctx, wizard, media, deps = {}) {
    if (!media?.isImage || wizard.data.photo || wizard.data.photo_url) return;
    try {
        const photosDir = deps.photosDir || PRODUCTS_DIR;
        const coverName = buildProductPhotoFileName(wizard.data.name, media, photosDir);
        const saved = await downloadTelegramFile(ctx, media.fileId, coverName, photosDir, {
            mimeType: media.mimeType,
            maxBytes: 10 * 1024 * 1024,
        });
        wizard.data.photo = saved.fileName;
        wizard.data.photo_url = '';
        wizard.data._photo_mime = media.mimeType || '';
    } catch (e) {
        logger.warn('[ProductWizard] capa auto:', e.message);
    }
}

async function saveDeliveryFile(ctx, wizard, media, deps = {}) {
    await Msg.reply(
        ctx,
        `Baixando <b>${media.label || 'arquivo'}</b>${media.fileSize ? ` (${formatBytes(media.fileSize)})` : ''}…`,
        { parse_mode: 'HTML' }
    );
    const saved = await downloadTelegramFile(ctx, media.fileId, media.fileName, PRODUCTS_DIR, {
        mimeType: media.mimeType,
        maxBytes: DEFAULT_MAX_BYTES,
    });
    wizard.data.file_url = saved.fileName;
    wizard.data._delivery_bytes = saved.bytes;
    wizard.data._delivery_ext = saved.ext;
    wizard.data._telegram_file_id = media.fileId;
    syncWizardFormat(wizard);
    await maybeSetCoverFromDeliveryImage(ctx, wizard, media, deps);
    return saved;
}

/**
 * Texto do wizard (nome, descrição, preço, texto/código, pular)
 */
async function handleText(ctx, wizard, store, deps = {}) {
    if (!wizard || isExpired(wizard)) {
        clearWizard(store, ctx.from.id);
        await Msg.reply(ctx, 'Sessão expirada. Use /gerenciarprodutos ou /addproduto.');
        return true;
    }

    const txt = (ctx.message?.text || '').trim();
    if (!txt) return false;

    if (txt === '/cancelar' || txt.toLowerCase() === 'cancelar') {
        clearWizard(store, ctx.from.id);
        await Msg.reply(ctx, 'Cadastro de produto cancelado.');
        return true;
    }

    switch (wizard.step) {
        case PRODUCT_WIZARD_STEPS.NAME: {
            if (txt.length < MIN_NAME_LEN) {
                await Msg.reply(ctx, `Nome muito curto. Use pelo menos ${MIN_NAME_LEN} caracteres (ex: <i>Pack Premium ZIP</i>).`, {
                    parse_mode: 'HTML',
                });
                return true;
            }
            wizard.data.name = txt;
            syncProductPhotoFileName(wizard, deps);
            if (await returnToConfirmIfNeeded(ctx, wizard, store, deps)) return true;
            wizard.step = PRODUCT_WIZARD_STEPS.DESCRIPTION;
            const hint = getDescriptionHint(wizard.data.type);
            await Msg.reply(ctx, 
                `Nome: <b>${txt}</b>\n\n` +
                    `Agora a <b>descrição para o comprador</b> (mín. ${MIN_DESC_LEN} caracteres):\n\n` +
                    `<i>${hint}</i>\n\n` +
                    `<b>Exemplo:</b>\n` +
                    `Conteúdo completo em arquivo digital\n` +
                    `Entrega automática após o pagamento\n` +
                    `Suporte por mensagem`,
                { parse_mode: 'HTML' }
            );
            return true;
        }
        case PRODUCT_WIZARD_STEPS.DESCRIPTION: {
            if (txt.length < MIN_DESC_LEN) {
                await Msg.reply(ctx, 
                    `Descrição muito curta (${txt.length}/${MIN_DESC_LEN}). Explique o que o cliente recebe — isso aumenta as vendas.`,
                    { parse_mode: 'HTML' }
                );
                return true;
            }
            wizard.data.description = txt;
            if (await returnToConfirmIfNeeded(ctx, wizard, store, deps)) return true;
            if (wizard.data._returnToConfirm) {
                delete wizard.data._returnToConfirm;
                return showConfirmPreview(ctx, wizard, store, deps);
            }
            wizard.step = PRODUCT_WIZARD_STEPS.PRICE;
            await Msg.reply(ctx, 
                `Descrição salva.\n\nEnvie o <b>preço</b> em reais (ex: <code>29.90</code>):`,
                { parse_mode: 'HTML' }
            );
            return true;
        }
        case PRODUCT_WIZARD_STEPS.PRICE: {
            const price = parseFloat(txt.replace(',', '.'));
            if (Number.isNaN(price) || price <= 0) {
                await Msg.reply(ctx, 'Preço inválido. Exemplo: <code>19.90</code>', { parse_mode: 'HTML' });
                return true;
            }
            wizard.data.price = price;
            if (await returnToConfirmIfNeeded(ctx, wizard, store, deps)) return true;
            wizard.step = PRODUCT_WIZARD_STEPS.PHOTO;
            await Msg.reply(ctx, 
                `Preço: <b>R$ ${price.toFixed(2)}</b>\n\n` +
                    `<b>Capa do produto</b> (opcional)\n\n` +
                    `Envie uma <b>foto</b> (imagem ou arquivo .jpg/.png) ou a <b>URL</b> (<code>https://...</code>).\n` +
                    `Ou digite <code>pular</code> para continuar sem capa.`,
                { parse_mode: 'HTML' }
            );
            return true;
        }
        case PRODUCT_WIZARD_STEPS.PHOTO: {
            if (txt.toLowerCase() === 'pular' || txt.toLowerCase() === 'skip') {
                if (wizard.data._returnToConfirm) {
                    wizard.data.photo = '';
                    wizard.data.photo_url = '';
                    return await returnToConfirmIfNeeded(ctx, wizard, store, deps);
                }
                wizard.step = PRODUCT_WIZARD_STEPS.FILE;
                await Msg.reply(ctx, `Sem capa.\n\n${fileStepHint(wizard.data.type)}`, { parse_mode: 'HTML' });
                return true;
            }
            if (!/^https?:\/\//i.test(txt)) {
                await Msg.reply(ctx, 'URL inválida. Use <code>https://...</code> ou <code>pular</code>.', { parse_mode: 'HTML' });
                return true;
            }
            wizard.data.photo_url = txt;
            wizard.data.photo = '';
            if (await returnToConfirmIfNeeded(ctx, wizard, store, deps)) return true;
            wizard.step = PRODUCT_WIZARD_STEPS.FILE;
            await Msg.reply(ctx, `Capa salva.\n\n${fileStepHint(wizard.data.type)}`, { parse_mode: 'HTML' });
            return true;
        }
        case PRODUCT_WIZARD_STEPS.FILE: {
            if (txt.toLowerCase() === 'pular' || txt.toLowerCase() === 'skip') {
                if (wizard.data._returnToConfirm) {
                    return await returnToConfirmIfNeeded(ctx, wizard, store, deps);
                }
                return showConfirmPreview(ctx, wizard, store, deps);
            }
            if (/^https?:\/\//i.test(txt)) {
                wizard.data.file_url = txt.trim();
                syncWizardFormat(wizard);
                if (await returnToConfirmIfNeeded(ctx, wizard, store, deps)) return true;
                await Msg.reply(ctx, `Link de entrega salvo.\n\n<i>O cliente receberá o link após a compra.</i>`, { parse_mode: 'HTML' });
                return showConfirmPreview(ctx, wizard, store, deps);
            }
            if (wizard.data.type === PRODUCT_TYPES.TEXT) {
                wizard.data.file_url = `text:${txt}`;
                syncWizardFormat(wizard);
                if (await returnToConfirmIfNeeded(ctx, wizard, store, deps)) return true;
                return showConfirmPreview(ctx, wizard, store, deps);
            }
            await Msg.reply(
                ctx,
                'Envie o arquivo (documento/foto/vídeo/áudio) ou cole link <code>https://...</code>.\n\n' +
                    '<i>Dica: ZIP e PDF funcionam melhor como <b>Documento</b>, não como foto comprimida.</i>',
                { parse_mode: 'HTML' }
            );
            return true;
        }
        default:
            return false;
    }
}

/**
 * Arquivo/mídia no passo FILE
 */
async function handleMedia(ctx, wizard, store, deps = {}) {
    if (!wizard || isExpired(wizard)) {
        clearWizard(store, ctx.from?.id);
        await Msg.reply(ctx, 'Sessão expirada. Use /gerenciarprodutos ou /addproduto.');
        return true;
    }

    wizard._ts = Date.now();
    const msg = ctx.message;
    const media = extractTelegramMedia(msg);

    if (wizard.step === PRODUCT_WIZARD_STEPS.PHOTO) {
        if (!media?.isImage) {
            await Msg.reply(
                ctx,
                'Envie uma <b>foto/imagem</b> (ou GIF), URL <code>https://...</code> ou <code>pular</code>.\n\n' +
                    '<i>ZIP, PDF e TXT vão no próximo passo (arquivo de entrega).</i>',
                { parse_mode: 'HTML' }
            );
            return true;
        }
        try {
            await saveProductCover(ctx, wizard, media, deps);
            if (await returnToConfirmIfNeeded(ctx, wizard, store, deps)) return true;
            wizard.step = PRODUCT_WIZARD_STEPS.FILE;
            await Msg.reply(ctx, `Capa salva.\n\n${fileStepHint(wizard.data.type)}`, { parse_mode: 'HTML' });
        } catch (e) {
            logger.error('[ProductWizard] capa:', e.message);
            await Msg.reply(
                ctx,
                `Não foi possível salvar a capa: ${e.message}\n\nTente outra imagem, URL ou <code>pular</code>.`,
                { parse_mode: 'HTML' }
            );
        }
        return true;
    }

    if (wizard.step !== PRODUCT_WIZARD_STEPS.FILE) {
        return false;
    }

    if (!media?.fileId) {
        await Msg.reply(
            ctx,
            'Tipo não reconhecido. Envie como <b>Documento</b> ou mídia suportada.\n\n' +
                'Suportado: ZIP, RAR, PDF, TXT, fotos, vídeos, áudios, APK…',
            { parse_mode: 'HTML' }
        );
        return true;
    }

    try {
        const saved = await saveDeliveryFile(ctx, wizard, media, deps);

        const localPath = resolveLocalFile(PRODUCTS_DIR, wizard.data.file_url);
        if (!localPath) {
            throw new Error('Arquivo salvo mas caminho inválido');
        }

        await Msg.reply(
            ctx,
            `<b>Arquivo recebido!</b>\n\n` +
                `<code>${wizard.data.file_url}</code>\n` +
                `${formatBytes(saved.bytes)}${saved.ext ? ` · ${saved.ext.toUpperCase()}` : ''}`,
            { parse_mode: 'HTML' }
        );
    } catch (e) {
        logger.error('[ProductWizard] download:', e.message);
        await Msg.reply(
            ctx,
            `<b>Falha ao baixar o arquivo</b>\n\n${e.message}\n\n` +
                '<b>O que fazer:</b>\n' +
                'Envie como <b>Documento</b>, não só foto\n' +
                'Arquivos grandes: comprima ou use link <code>https://...</code>\n' +
                'Tente de novo sem fechar o /addproduto',
            { parse_mode: 'HTML' }
        );
        return true;
    }

    syncWizardFormat(wizard);
    if (await returnToConfirmIfNeeded(ctx, wizard, store, deps)) return true;
    return showConfirmPreview(ctx, wizard, store, deps);
}

function confirmKeyboard(Markup) {
    return Markup.inlineKeyboard([
        [{ text: 'Publicar no catálogo', callback_data: 'prod_publish' }],
        [
            { text: 'Nome', callback_data: 'prod_draft_name' },
            { text: 'Descrição', callback_data: 'prod_draft_desc' },
        ],
        [
            { text: 'Preço', callback_data: 'prod_draft_price' },
            { text: 'Capa', callback_data: 'prod_draft_photo' },
        ],
        [
            { text: 'Arquivo', callback_data: 'prod_draft_file' },
            { text: 'Tipo', callback_data: 'prod_draft_type' },
        ],
        [{ text: 'Atualizar prévia', callback_data: 'prod_draft_refresh' }],
        [{ text: 'Cancelar', callback_data: 'prod_cancel' }],
    ]);
}

function resolveDraftPhotoOptions(wizard, deps = {}) {
    const { isUsablePhotoUrl } = require('../telegram/Msg');
    const photosDir = deps.photosDir;

    if (wizard.data.photo_url && isUsablePhotoUrl(String(wizard.data.photo_url))) {
        return { photoUrl: wizard.data.photo_url, useMenuPhoto: false };
    }
    if (wizard.data.photo && photosDir) {
        const fp = resolveLocalFile(photosDir, wizard.data.photo);
        if (fp) return { photoUrl: { source: fp }, useMenuPhoto: false };
    }
    const fu = wizard.data.file_url || '';
    if (fu && !fu.startsWith('text:') && !/^https?:\/\//i.test(fu)) {
        if (/\.(jpe?g|png|gif|webp|bmp)$/i.test(fu)) {
            const fp = resolveLocalFile(PRODUCTS_DIR, fu);
            if (fp) return { photoUrl: { source: fp }, useMenuPhoto: false };
        }
    }
    return { useMenuPhoto: true };
}

function startDraftEdit(wizard, field) {
    wizard._ts = Date.now();
    wizard.data._returnToConfirm = true;
    const map = {
        name: PRODUCT_WIZARD_STEPS.NAME,
        desc: PRODUCT_WIZARD_STEPS.DESCRIPTION,
        price: PRODUCT_WIZARD_STEPS.PRICE,
        photo: PRODUCT_WIZARD_STEPS.PHOTO,
        file: PRODUCT_WIZARD_STEPS.FILE,
        type: PRODUCT_WIZARD_STEPS.TYPE,
    };
    wizard.step = map[field] || PRODUCT_WIZARD_STEPS.CONFIRM;
}

function getDraftEditPrompt(wizard, field) {
    const type = wizard.data.type;
    const prompts = {
        name: 'Envie o <b>novo nome</b> do produto:',
        desc:
            `Envie a <b>nova descrição</b> (mín. ${MIN_DESC_LEN} caracteres):\n\n` +
            `<i>${getDescriptionHint(type)}</i>`,
        price: 'Envie o <b>novo preço</b> em reais (ex: <code>29.90</code>):',
        photo:
            'Envie a <b>nova capa</b> (foto ou arquivo de imagem), URL <code>https://...</code>\n' +
            'ou <code>pular</code> para remover a capa.',
        file:
            'Envie o <b>novo arquivo de entrega</b>, cole link <code>https://...</code>\n' +
            'ou texto (tipo Texto/Código).\n\n' +
            `<i>${fileStepHint(type)}</i>`,
        type: 'Escolha o <b>tipo</b> do produto:',
    };
    return prompts[field] || 'Envie o novo valor:';
}

async function returnToConfirmIfNeeded(ctx, wizard, store, deps) {
    if (!wizard.data._returnToConfirm) return false;
    delete wizard.data._returnToConfirm;
    wizard.step = PRODUCT_WIZARD_STEPS.CONFIRM;
    await showConfirmPreview(ctx, wizard, store, deps);
    return true;
}

/**
 * Pré-visualização como o comprador verá antes de publicar.
 */
async function showConfirmPreview(ctx, wizard, store, deps = {}) {
    const check = validateListingDraft(wizard.data);
    if (!check.ok) {
        await Msg.reply(ctx, 
            `<b>Antes de publicar, corrija:</b>\n\n` +
                check.issues.map((i) => `${i}`).join('\n'),
            { parse_mode: 'HTML' }
        );
        return true;
    }

    syncWizardFormat(wizard);
    wizard.step = PRODUCT_WIZARD_STEPS.CONFIRM;

    const draft = {
        name: wizard.data.name,
        description: wizard.data.description,
        price: wizard.data.price,
        file_url: wizard.data.file_url || '',
        photo: wizard.data.photo || '',
        photo_url: wizard.data.photo_url || '',
        category: wizard.data.category,
        is_subscription: wizard.data.type === PRODUCT_TYPES.SUBSCRIPTION,
        stock: 999,
    };

    const preview = buildBuyerProductText(draft, { showStock: false });
    const entregaLine = wizard.data.file_url?.startsWith('text:')
        ? '\nEntrega: texto/código na mensagem'
        : wizard.data.file_url?.startsWith('http')
          ? `\nEntrega: link externo`
          : wizard.data.file_url
            ? `\nArquivo: <code>${wizard.data.file_url}</code>` +
              (wizard.data._delivery_bytes ? ` (${formatBytes(wizard.data._delivery_bytes)})` : '') +
              (wizard.data.category ? ` · ${String(wizard.data.category).toUpperCase()}` : '')
            : '\n<i>Sem arquivo de entrega</i>';

    const { Markup } = require('telegraf');
    const adminNote =
        `\n\n<i>Prévia admin</i>${entregaLine}` +
        `\n\n<b>Publicar este produto na loja?</b>`;
    const text = preview + adminNote;

    const photoOpts = resolveDraftPhotoOptions(wizard, deps);
    await Msg.replaceMenu(ctx, text, confirmKeyboard(Markup), {
        ...photoOpts,
        forceNew: !ctx.callbackQuery?.message,
    });
    return true;
}

async function finishWizard(ctx, wizard, store, deps = {}) {
    const { prisma, invalidateProductCache, AuditService, UserService } = deps;

    try {
        const isSubscription = wizard.data.type === PRODUCT_TYPES.SUBSCRIPTION;
        const isService = wizard.data.type === PRODUCT_TYPES.SERVICE;

        if (!wizard.data.name || !wizard.data.price) {
            await Msg.reply(ctx, 'Dados incompletos. Comece de novo com /addproduto');
            clearWizard(store, ctx.from.id);
            return true;
        }

        if (!wizard.data.file_url && !isService && !isSubscription && wizard.data.type !== PRODUCT_TYPES.TEXT) {
            await Msg.reply(ctx, 'Este tipo de produto precisa de arquivo ou conteúdo. Tente novamente.');
            return true;
        }

        try {
            const tenantContext = require('../infrastructure/TenantContext');
            const tid = tenantContext.getCurrentNumericId();
            if (tid) {
                const TenantLimits = require('../modules/tenant/TenantLimits');
                TenantLimits.assertProductLimit(tid);
            }
        } catch (limErr) {
            if (limErr.userMessage) {
                await Msg.reply(ctx, limErr.userMessage, { parse_mode: 'HTML' });
            } else {
                await Msg.reply(ctx, `${limErr.message}`);
            }
            return true;
        }

        syncWizardFormat(wizard);
        syncProductPhotoFileName(wizard, deps);
        const category =
            wizard.data.category ||
            formatForStorage({
                file_url: wizard.data.file_url || '',
                type: wizard.data.type,
                is_subscription: isSubscription,
            });

        const publishCheck = validateListingDraft(wizard.data);
        if (!publishCheck.ok) {
            await Msg.reply(ctx, 
                `Não foi possível publicar:\n` + publishCheck.issues.map((i) => `${i}`).join('\n'),
                { parse_mode: 'HTML' }
            );
            return true;
        }

        const p = await prisma.product.create({
            data: {
                name: wizard.data.name,
                price: wizard.data.price,
                description: wizard.data.description || '',
                file_url: wizard.data.file_url || '',
                photo_url: wizard.data.photo_url || '',
                photo: wizard.data.photo || '',
                category: category || 'geral',
                stock: 999,
                active: true,
                is_subscription: isSubscription,
            },
        });

        // Validar arquivo local existe (evita produto “fantasma”)
        const fu = wizard.data.file_url || '';
        if (fu && !fu.startsWith('text:') && !/^https?:\/\//i.test(fu)) {
            const local = resolveLocalFile(PRODUCTS_DIR, fu);
            if (!local) {
                try {
                    dbRaw().prepare('DELETE FROM products WHERE id = ?').run(p.id);
                } catch (delErr) {
                    logger.warn('[ProductWizard] rollback delete:', delErr.message);
                }
                await Msg.reply(ctx, 'Arquivo de entrega não encontrado no disco. Envie o arquivo de novo com /addproduto.');
                return true;
            }
        }

        if (typeof invalidateProductCache === 'function') invalidateProductCache();

        try {
            const adminUser = await UserService.findByTelegramId(ctx.from.id);
            AuditService.log(adminUser?.id, ctx.from.id, 'CREATE_PRODUCT', 'product', String(p.id), null, {
                name: p.name,
                price: p.price,
            });
        } catch (_) { /* opcional */ }

        clearWizard(store, ctx.from.id);

        const entrega =
            wizard.data.file_url?.startsWith('text:')
                ? 'Texto/código na entrega'
                : wizard.data.file_url
                  ? `Arquivo: <code>${wizard.data.file_url}</code>`
                  : 'Sem arquivo (serviço/assinatura)';
        const fmtLine = category ? `\nFormato: <b>${category.toUpperCase()}</b>` : '';

        const { Markup } = require('telegraf');
        await Msg.reply(ctx, 
            `<b>Produto publicado!</b>\n\n` +
                `ID: <code>${p.id}</code>\n` +
                `${p.name}\n` +
                `R$ ${Number(p.price).toFixed(2)}` +
                `${fmtLine}\n` +
                `${entrega}\n\n` +
                `Já está à venda — teste como cliente: <code>/cat</code>`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [{ text: 'Flash sale (-20% / 24h)', callback_data: `prod_flash_${p.id}` }],
                    [{ text: 'Ver catálogo', callback_data: 'cat_hub' }],
                ]),
            }
        );
        return true;
    } catch (e) {
        logger.error('[ProductWizard] create:', e.message);
        await Msg.reply(ctx, `Erro ao criar produto: ${e.message}`);
        return true;
    }
}

function setType(wizard, type) {
    wizard.data.type = type;
    wizard.step = PRODUCT_WIZARD_STEPS.NAME;
    wizard._ts = Date.now();
}

module.exports = {
    PRODUCT_WIZARD_STEPS,
    PRODUCT_TYPES,
    getTypeEmoji,
    getTypeName,
    startWizard,
    clearWizard,
    typeKeyboard,
    handleText,
    handleMedia,
    finishWizard,
    showConfirmPreview,
    confirmKeyboard,
    startDraftEdit,
    getDraftEditPrompt,
    resolveDraftPhotoOptions,
    setType,
    isExpired,
    downloadTelegramFile,
    extractMediaFromMessage: extractTelegramMedia,
    extractTelegramMedia,
};
