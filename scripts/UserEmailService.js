'use strict';

/**
 * Cadastro e verificação de e-mail do cliente (Gmail etc.)
 * — entrega de produtos, ofertas e avisos por e-mail
 */
const path = require('path');
const logger = require('../config/logger');
const { resolveLocalFile } = require('../utils/safeLocalPath');
const emailService = require('../config/email-service');
const { normalizeReplyMarkup } = require('../telegram/menus/twoColKeyboard');
const dbRaw = require('../config/database-sqlite').connect;

const PENDING_PREFIX = 'email_pending:';
const EMAIL_PROMPT_KEY = 'email_prompt_done:';
const CODE_TTL_MS = 15 * 60 * 1000;
const PRODUCTS_DIR = process.env.PRODUCTS_PATH || path.join(__dirname, '../../produtos');
const DOWNLOAD_BASE = (process.env.PRODUCT_DOWNLOAD_BASE_URL || process.env.SITE_HANORK || '')
    .trim()
    .replace(/\/$/, '');

const REGISTRATION_INTRO =
    '📧 <b>Cadastrar e-mail na loja</b>\n\n' +
    '<b>Por que cadastrar?</b>\n' +
    '• 📦 Receba links e arquivos das compras no e-mail\n' +
    '• 🔥 Ofertas e novidades antes de todo mundo\n' +
    '• 📢 Avisos importantes (restock, entrega, suporte)\n\n' +
    '<b>Como funciona (1 minuto):</b>\n' +
    '1️⃣ Envie seu e-mail aqui (Gmail, Outlook, etc.)\n' +
    '2️⃣ Abra a caixa de entrada e copie o código de <b>6 dígitos</b>\n' +
    '3️⃣ Cole o código neste chat\n\n' +
    '<i>Exemplo:</i> <code>seuemail@gmail.com</code>\n' +
    '<i>Dica:</i> confira também a pasta <b>Spam/Lixo eletrônico</b>.\n\n' +
    '<i>/cancelar para sair</i>';

function isHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
}

/** Resolve arquivo local, link público ou URL de download configurada */
function resolveItemDelivery(item) {
    const name = item.name || 'Produto';
    const raw = String(item.file_url || item.download_url || '').trim();
    if (!raw) return { name, kind: 'none' };

    if (isHttpUrl(raw)) {
        return { name, kind: 'link', href: raw, label: 'Baixar arquivo' };
    }

    const safeName = path.basename(raw);
    const localPath = resolveLocalFile(PRODUCTS_DIR, raw);
    if (localPath) {
        const out = { name, kind: 'file', localPath, filename: safeName };
        if (DOWNLOAD_BASE) {
            out.kind = 'link';
            out.href = `${DOWNLOAD_BASE}/${encodeURIComponent(safeName)}`;
            out.label = 'Baixar arquivo';
            out.attachmentPath = localPath;
        }
        return out;
    }

    if (DOWNLOAD_BASE && safeName && safeName !== '.' && safeName !== '..') {
        return {
            name,
            kind: 'link',
            href: `${DOWNLOAD_BASE}/${encodeURIComponent(safeName)}`,
            label: 'Baixar arquivo',
        };
    }

    return { name, kind: 'telegram_only' };
}

function buildDeliveryHtmlLines(resolved) {
    return resolved.map((r) => {
        if (r.kind === 'link') {
            return `<li><b>${r.name}</b> — <a href="${r.href}">${r.label}</a></li>`;
        }
        if (r.kind === 'file') {
            const extra = r.attachmentPath ? ' (também em anexo neste e-mail)' : ' (anexo neste e-mail)';
            return `<li><b>${r.name}</b>${extra}</li>`;
        }
        if (r.kind === 'telegram_only') {
            return `<li><b>${r.name}</b> — enviado no Telegram</li>`;
        }
        return `<li><b>${r.name}</b></li>`;
    });
}

function buildDeliveryAttachments(resolved) {
    const attachments = [];
    const seen = new Set();
    for (const r of resolved) {
        const filePath = r.attachmentPath || (r.kind === 'file' ? r.localPath : null);
        if (!filePath || seen.has(filePath)) continue;
        seen.add(filePath);
        attachments.push({
            filename: r.filename || path.basename(filePath),
            path: filePath,
        });
    }
    return attachments;
}

function normalizeEmail(raw) {
    return String(raw || '').trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email) && email.length <= 120;
}

function maskEmail(email) {
    if (!email || !email.includes('@')) return '—';
    const [local, domain] = email.split('@');
    const show = local.length <= 2 ? local[0] + '*' : local.slice(0, 2) + '***';
    return `${show}@${domain}`;
}

function _kvGet(telegramId) {
    try {
        const row = dbRaw()
            .prepare('SELECT value FROM kv_store WHERE key=?')
            .get(`${PENDING_PREFIX}${telegramId}`);
        return row?.value ? JSON.parse(row.value) : null;
    } catch {
        return null;
    }
}

function _kvSet(telegramId, data) {
    dbRaw()
        .prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        )
        .run(`${PENDING_PREFIX}${telegramId}`, JSON.stringify(data));
}

function _kvDel(telegramId) {
    dbRaw().prepare('DELETE FROM kv_store WHERE key=?').run(`${PENDING_PREFIX}${telegramId}`);
}

function ensureUserEmailColumns() {
    const db = dbRaw();
    const cols = new Set(
        db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name)
    );
    if (!cols.has('email')) {
        db.exec('ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL');
    }
    if (!cols.has('email_verified')) {
        db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0');
    }
    if (!cols.has('updated_at')) {
        db.exec('ALTER TABLE users ADD COLUMN updated_at TEXT DEFAULT NULL');
    }
}

function getUserByTelegram(telegramId) {
    return dbRaw()
        .prepare('SELECT * FROM users WHERE telegram_id=?')
        .get(String(telegramId)) || null;
}

function updateUserEmail(userId, email, verified = 1) {
    ensureUserEmailColumns();
    dbRaw()
        .prepare(
            `UPDATE users SET email=?, email_verified=?, updated_at=datetime('now') WHERE id=?`
        )
        .run(email, verified ? 1 : 0, userId);
}

function clearUserEmail(userId) {
    ensureUserEmailColumns();
    dbRaw()
        .prepare(
            `UPDATE users SET email=NULL, email_verified=0, updated_at=datetime('now') WHERE id=?`
        )
        .run(userId);
}

function formatEmailStatus(user) {
    if (!user?.email) {
        return (
            '⚠️ <b>E-mail:</b> não cadastrado\n' +
            '<i>Use /email — leva 1 min: envie o e-mail → código de 6 dígitos → pronto.</i>'
        );
    }
    if (user.email_verified) {
        return `✅ <b>E-mail:</b> <code>${maskEmail(user.email)}</code> (verificado)`;
    }
    return (
        `⏳ <b>E-mail:</b> <code>${maskEmail(user.email)}</code> (aguardando verificação)\n` +
        '<i>Abra o e-mail e digite o código de 6 dígitos aqui, ou toque em Reenviar código.</i>'
    );
}

function buildEmailKeyboard(user) {
    const { Markup } = require('telegraf');
    const rows = [];
    if (!user?.email || !user.email_verified) {
        rows.push([{ text: '📧 Cadastrar e-mail', callback_data: 'user:email:start' }]);
        if (user?.email && !user.email_verified) {
            rows.push([{ text: '🔄 Reenviar código', callback_data: 'user:email:resend' }]);
        }
    } else {
        rows.push([{ text: '📧 Alterar e-mail', callback_data: 'user:email:start' }]);
    }
    if (user?.email) {
        rows.push([{ text: '🗑️ Remover e-mail', callback_data: 'user:email:remove' }]);
    }
    rows.push([{ text: '❓ Como funciona', callback_data: 'user:email:help' }]);
    return rows;
}

async function sendVerificationEmail(to, code) {
    if (!emailService.isEmailConfigured()) {
        return {
            ok: false,
            error: 'O envio por e-mail ainda não está ativo na loja. Avise o suporte.',
        };
    }
    const html = emailService.createEmailTemplate(
        `<h2>Confirme seu e-mail</h2>
        <p>Seu código de verificação Hanork:</p>
        <div class="code">${code}</div>
        <p><b>Válido por 15 minutos.</b> Digite esses 6 números no chat do bot.</p>
        <p>Depois de confirmar você pode receber:</p>
        <ul>
            <li>🔗 Links e arquivos dos produtos comprados</li>
            <li>🔥 Ofertas e novidades</li>
            <li>📢 Avisos importantes da loja</li>
        </ul>
        <p>Se não foi você, ignore este e-mail.</p>`,
        { banner: '📧 HANORK' }
    );
    const result = await emailService.sendEmail(to, `Código Hanork: ${code}`, html);
    if (!result.success) {
        return { ok: false, error: result.error || 'Falha ao enviar e-mail' };
    }
    return { ok: true };
}

async function respondEmailPanel(ctx, text, keyboard = null) {
    const Msg = require('../telegram/Msg');
    const { Markup } = require('telegraf');
    const kb = keyboard || Markup.inlineKeyboard([
        [{ text: '❌ Cancelar', callback_data: 'menu:minha_conta' }],
    ]);
    if (ctx.callbackQuery?.message) {
        await Msg.editCallbackPanel(ctx, text, kb);
    } else {
        await Msg.reply(ctx, text, kb);
    }
}

async function startRegistration(ctx, emailRegisterMode, sessionCleared = null) {
    const { appendDiscardedNote } = require('./BotSessionService');
    const uid = ctx.from?.id;
    if (!uid) return;

    const user = getUserByTelegram(uid);
    if (user?.email_verified) {
        await emailRegisterMode.set(uid, { step: 'await_email', change: true, _ts: Date.now() });
        await respondEmailPanel(
            ctx,
            appendDiscardedNote(
                `📧 <b>Alterar e-mail</b>\n\n` +
                    `Atual: <code>${maskEmail(user.email)}</code>\n\n` +
                    'Envie o <b>novo</b> endereço na próxima mensagem.\n' +
                    'Enviaremos um código de 6 dígitos para confirmar.\n\n' +
                    '<i>/cancelar para sair</i>',
                sessionCleared
            ),
            require('telegraf').Markup.inlineKeyboard([
                [{ text: '❓ Ajuda', callback_data: 'user:email:help' }],
                [{ text: '👤 Minha conta', callback_data: 'menu:minha_conta' }],
            ])
        );
        return;
    }

    await emailRegisterMode.set(uid, { step: 'await_email', _ts: Date.now() });
    await respondEmailPanel(
        ctx,
        appendDiscardedNote(REGISTRATION_INTRO, sessionCleared),
        require('telegraf').Markup.inlineKeyboard([
            [{ text: '❓ Tutorial passo a passo', callback_data: 'user:email:help' }],
            [{ text: '❌ Cancelar', callback_data: 'menu:minha_conta' }],
        ])
    );
}

async function showEmailHelp(ctx) {
    await respondEmailPanel(
        ctx,
        '📖 <b>Tutorial — e-mail na loja</b>\n\n' +
            '<b>Passo 1</b> — Toque em <b>Cadastrar e-mail</b> ou use /email\n' +
            '<b>Passo 2</b> — Envie seu endereço (ex: <code>nome@gmail.com</code>)\n' +
            '<b>Passo 3</b> — Abra o e-mail com assunto <i>Código Hanork</i>\n' +
            '<b>Passo 4</b> — Digite aqui os <b>6 números</b> (ex: <code>123456</code>)\n\n' +
            '✅ Pronto! Suas próximas compras também podem ir para o e-mail.\n\n' +
            '<b>Problemas comuns:</b>\n' +
            '• Código não chegou → pasta Spam / aguarde 2 min / Reenviar código\n' +
            '• Código expirou → peça um novo (válido 15 min)\n' +
            '• Errou o e-mail → /cancelar e comece de novo\n\n' +
            '<i>Comandos: /email ou /gmail · /cancelar para sair</i>',
        require('telegraf').Markup.inlineKeyboard([
            [{ text: '📧 Começar cadastro', callback_data: 'user:email:start' }],
            [{ text: '👤 Minha conta', callback_data: 'menu:minha_conta' }],
        ])
    );
}

async function promptCodeEntry(ctx, email, emailRegisterMode) {
    const uid = ctx.from?.id;
    await emailRegisterMode.set(uid, { step: 'await_code', email, _ts: Date.now() });
    const Msg = require('../telegram/Msg');
    const { Markup } = require('telegraf');
    await Msg.reply(
        ctx,
        `📬 <b>Código enviado!</b>\n\n` +
            `Enviamos um e-mail para:\n<code>${maskEmail(email)}</code>\n\n` +
            '👉 Abra a caixa de entrada e digite aqui os <b>6 dígitos</b>.\n' +
            '(Assunto: <i>Código Hanork: …</i>)\n\n' +
            '<i>Não achou? Veja Spam/Lixo eletrônico ou toque em Reenviar.</i>\n\n' +
            '<i>/cancelar para sair</i>',
        Markup.inlineKeyboard([
            [{ text: '🔄 Reenviar código', callback_data: 'user:email:resend' }],
            [{ text: '❓ Ajuda', callback_data: 'user:email:help' }],
            [{ text: '🔙 Minha conta', callback_data: 'menu:minha_conta' }],
        ])
    );
}

async function verifyPendingCode(ctx, uid, code, pending, emailRegisterMode) {
    const Msg = require('../telegram/Msg');
    const { Markup } = require('telegraf');

    if (!pending?.email || !pending?.code) {
        await emailRegisterMode.delete(uid);
        await Msg.reply(
            ctx,
            '⏱️ Nenhum código pendente. Comece de novo com /email',
            Markup.inlineKeyboard([[{ text: '📧 Cadastrar', callback_data: 'user:email:start' }]])
        );
        return true;
    }

    if (Date.now() > pending.expiresAt) {
        await Msg.reply(
            ctx,
            '⏱️ Código expirado (15 min). Peça um novo.',
            Markup.inlineKeyboard([
                [{ text: '🔄 Reenviar código', callback_data: 'user:email:resend' }],
                [{ text: '📧 Novo cadastro', callback_data: 'user:email:start' }],
            ])
        );
        return true;
    }

    if (pending.code !== code) {
        await Msg.reply(
            ctx,
            '❌ Código incorreto.\n\nConfira os 6 números do e-mail (sem espaços).',
            Markup.inlineKeyboard([
                [{ text: '🔄 Reenviar código', callback_data: 'user:email:resend' }],
                [{ text: '❓ Ajuda', callback_data: 'user:email:help' }],
            ])
        );
        return true;
    }

    const user = getUserByTelegram(uid);
    if (!user) {
        await emailRegisterMode.delete(uid);
        await Msg.reply(ctx, '❌ Faça /start primeiro e tente novamente.');
        return true;
    }

    try {
        updateUserEmail(user.id, pending.email, 1);
    } catch (e) {
        logger.error('[UserEmail] verify db update:', e.message);
        await Msg.reply(ctx, '❌ Erro ao salvar e-mail. Tente /email de novo ou avise o suporte.');
        return true;
    }

    _kvDel(uid);
    await emailRegisterMode.delete(uid);

    await Msg.reply(
        ctx,
        `✅ <b>E-mail confirmado!</b>\n\n` +
            `📧 <code>${maskEmail(pending.email)}</code>\n\n` +
            'A partir de agora você pode receber:\n' +
            '• 📦 Entregas e links das compras\n' +
            '• 🔥 Ofertas exclusivas\n' +
            '• 📢 Avisos da loja\n\n' +
            '<i>Obrigado por cadastrar!</i>',
        Markup.inlineKeyboard([[{ text: '👤 Minha conta', callback_data: 'menu:minha_conta' }]])
    );
    logger.info('[UserEmail] verified', { uid, email: maskEmail(pending.email) });
    return true;
}

async function handleRegistrationText(ctx, text, emailRegisterMode) {
    const uid = ctx.from?.id;
    if (!uid) return false;

    const Msg = require('../telegram/Msg');
    const { Markup } = require('telegraf');
    const trimmed = String(text || '').trim();
    const codeDigits = trimmed.replace(/\D/g, '').slice(0, 6);
    const looksLikeCode = /^\d{6}$/.test(codeDigits);

    const mode = await emailRegisterMode.get(uid);

    // Recuperação: usuário manda código mesmo sem modo ativo (ex.: erro anterior no DB)
    if (looksLikeCode && mode?.step !== 'await_code') {
        const pending = _kvGet(uid);
        if (pending?.code) {
            await emailRegisterMode.set(uid, { step: 'await_code', email: pending.email, _ts: Date.now() });
            return verifyPendingCode(ctx, uid, codeDigits, pending, emailRegisterMode);
        }
    }

    if (!mode?.step) return false;

    if (mode.step === 'await_email') {
        const email = normalizeEmail(trimmed);
        if (!isValidEmail(email)) {
            await Msg.reply(
                ctx,
                '❌ E-mail inválido.\n\nEnvie no formato <code>nome@gmail.com</code>',
                Markup.inlineKeyboard([
                    [{ text: '❓ Ajuda', callback_data: 'user:email:help' }],
                    [{ text: '🔙 Minha conta', callback_data: 'menu:minha_conta' }],
                ])
            );
            return true;
        }

        const code = emailService.generateVerificationCode();
        _kvSet(uid, { email, code, expiresAt: Date.now() + CODE_TTL_MS });

        const sent = await sendVerificationEmail(email, code);
        if (!sent.ok) {
            _kvDel(uid);
            await Msg.reply(ctx, `❌ ${sent.error}`, Markup.inlineKeyboard([[{ text: '🔙 Minha conta', callback_data: 'menu:minha_conta' }]]));
            return true;
        }

        try {
            const user = getUserByTelegram(uid);
            if (user) {
                updateUserEmail(user.id, email, 0);
            }
        } catch (e) {
            logger.error('[UserEmail] pre-verify save:', e.message);
            // Código já foi enviado — segue fluxo; verificação grava no DB depois
        }

        await promptCodeEntry(ctx, email, emailRegisterMode);
        return true;
    }

    if (mode.step === 'await_code') {
        if (!looksLikeCode) {
            await Msg.reply(
                ctx,
                '🔢 Envie os <b>6 dígitos</b> do e-mail (só números).\n\nExemplo: <code>123456</code>',
                Markup.inlineKeyboard([
                    [{ text: '🔄 Reenviar código', callback_data: 'user:email:resend' }],
                    [{ text: '❓ Ajuda', callback_data: 'user:email:help' }],
                ])
            );
            return true;
        }

        const pending = _kvGet(uid);
        if (!pending?.code) {
            await emailRegisterMode.delete(uid);
            await Msg.reply(
                ctx,
                '⏱️ Código expirado ou sessão perdida. Use /email para recomeçar.',
                Markup.inlineKeyboard([[{ text: '📧 Cadastrar', callback_data: 'user:email:start' }]])
            );
            return true;
        }

        if (mode.email && pending.email !== mode.email) {
            await emailRegisterMode.set(uid, { step: 'await_code', email: pending.email, _ts: Date.now() });
        }

        return verifyPendingCode(ctx, uid, codeDigits, pending, emailRegisterMode);
    }

    return false;
}

async function resendCode(ctx, emailRegisterMode) {
    const uid = ctx.from?.id;
    const pending = _kvGet(uid);
    const user = getUserByTelegram(uid);
    const mode = await emailRegisterMode.get(uid);
    const email = normalizeEmail(pending?.email || user?.email || mode?.email);
    if (!isValidEmail(email)) {
        return startRegistration(ctx, emailRegisterMode);
    }
    const code = emailService.generateVerificationCode();
    _kvSet(uid, { email, code, expiresAt: Date.now() + CODE_TTL_MS });
    const sent = await sendVerificationEmail(email, code);
    const Msg = require('../telegram/Msg');
    const { Markup } = require('telegraf');
    if (!sent.ok) {
        return Msg.reply(ctx, `❌ ${sent.error}`, Markup.inlineKeyboard([[{ text: '🔙 Minha conta', callback_data: 'menu:minha_conta' }]]));
    }
    try {
        if (user) updateUserEmail(user.id, email, 0);
    } catch (e) {
        logger.warn('[UserEmail] resend pre-save:', e.message);
    }
    await emailRegisterMode.set(uid, { step: 'await_code', email, _ts: Date.now() });
    return Msg.reply(
        ctx,
        `📬 <b>Novo código enviado</b>\n\n` +
            `Para: <code>${maskEmail(email)}</code>\n\n` +
            'Digite os <b>6 dígitos</b> aqui no chat.',
        Markup.inlineKeyboard([
            [{ text: '❓ Ajuda', callback_data: 'user:email:help' }],
            [{ text: '🔙 Minha conta', callback_data: 'menu:minha_conta' }],
        ])
    );
}

async function removeEmail(ctx) {
    const uid = ctx.from?.id;
    const user = getUserByTelegram(uid);
    if (user) {
        try {
            clearUserEmail(user.id);
        } catch (e) {
            logger.warn('[UserEmail] remove:', e.message);
        }
    }
    _kvDel(uid);
    const Msg = require('../telegram/Msg');
    const { Markup } = require('telegraf');
    return Msg.editCallbackPanel(
        ctx,
        '🗑️ E-mail removido da sua conta.\n\n<i>Você pode cadastrar de novo quando quiser com /email</i>',
        Markup.inlineKeyboard([[{ text: '👤 Minha conta', callback_data: 'menu:minha_conta' }]])
    );
}

/** Envia entrega por e-mail com links e/ou anexos dos arquivos (se verificado) */
async function sendDeliveryEmail(telegramId, items, orderRef = '') {
    const user = getUserByTelegram(telegramId);
    if (!user?.email || !user.email_verified) return { sent: false, reason: 'no_email' };
    if (!emailService.isEmailConfigured()) return { sent: false, reason: 'smtp_off' };

    const resolved = (items || []).map(resolveItemDelivery);
    const lines = buildDeliveryHtmlLines(resolved).join('');
    const attachments = buildDeliveryAttachments(resolved);
    const hasLinks = resolved.some((r) => r.kind === 'link');
    const hasFiles = attachments.length > 0;

    const html = emailService.createEmailTemplate(
        `<h2>✅ Sua compra foi entregue!</h2>
        ${orderRef ? `<p>Pedido: <code>${orderRef}</code></p>` : ''}
        <ul>${lines || '<li>Produto digital</li>'}</ul>
        ${hasLinks ? '<p>🔗 Use os links acima para baixar seus arquivos.</p>' : ''}
        ${hasFiles ? '<p>📎 Os arquivos também estão em anexo neste e-mail.</p>' : ''}
        <p>📱 Tudo foi enviado no Telegram também.</p>
        <p>Obrigado pela compra!</p>`,
        { banner: '📦 HANORK' }
    );
    const r = await emailService.sendEmail(user.email, 'Sua entrega Hanork', html, null, {
        attachments,
    });
    return {
        sent: !!r.success,
        reason: r.success ? 'ok' : r.error,
        attachments: attachments.length,
        links: resolved.filter((x) => x.kind === 'link').length,
    };
}

/**
 * Lembrete no Telegram após a 1ª entrega, se ainda não tiver e-mail verificado.
 */
async function promptRegisterEmailIfNeeded(telegram, chatId) {
    if (!telegram?.sendMessage) return { sent: false, reason: 'no_telegram' };

    const user = getUserByTelegram(chatId);
    if (!user || user.email_verified) return { sent: false, reason: 'has_email' };

    const prompted = dbRaw()
        .prepare('SELECT 1 FROM kv_store WHERE key=?')
        .get(`${EMAIL_PROMPT_KEY}${user.id}`);
    if (prompted) return { sent: false, reason: 'already_prompted' };

    const botUser = process.env.BOT_USERNAME || 'hanork_bot';
    const text =
        '📧 <b>Receba suas próximas compras no e-mail!</b>\n\n' +
        'Você acabou de receber sua entrega no Telegram.\n' +
        'Cadastre seu e-mail em 1 minuto:\n\n' +
        '1️⃣ /email → envie seu Gmail ou outro\n' +
        '2️⃣ Copie o código de 6 dígitos do e-mail\n' +
        '3️⃣ Cole aqui no chat\n\n' +
        'Benefícios: links de download, ofertas e avisos.';

    await telegram.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: normalizeReplyMarkup({
            inline_keyboard: [
                [{ text: '📧 Cadastrar e-mail', callback_data: 'user:email:start' }],
                [{ text: '👤 Minha conta', callback_data: 'menu:minha_conta' }],
                [{ text: '💬 Abrir bot', url: `https://t.me/${botUser}` }],
            ],
        }),
    });

    dbRaw()
        .prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        )
        .run(`${EMAIL_PROMPT_KEY}${user.id}`, '1');

    logger.info('[UserEmail] post-delivery prompt sent', { chatId, userId: user.id });
    return { sent: true };
}

async function broadcastToVerified(subject, htmlBody) {
    ensureUserEmailColumns();
    if (!emailService.isEmailConfigured()) {
        return { sent: 0, failed: 0, total: 0, error: 'smtp_not_configured' };
    }
    const rows = dbRaw()
        .prepare(
            `SELECT email FROM users WHERE email IS NOT NULL AND email != '' AND email_verified=1`
        )
        .all();
    let sent = 0;
    let failed = 0;
    const html = emailService.createEmailTemplate(htmlBody, { banner: '📢 HANORK' });
    for (const row of rows) {
        const r = await emailService.sendEmail(row.email, subject, html);
        if (r.success) sent++;
        else failed++;
        await new Promise((res) => setTimeout(res, 200));
    }
    return { sent, failed, total: rows.length };
}

module.exports = {
    normalizeEmail,
    isValidEmail,
    maskEmail,
    formatEmailStatus,
    buildEmailKeyboard,
    startRegistration,
    showEmailHelp,
    handleRegistrationText,
    resendCode,
    removeEmail,
    sendDeliveryEmail,
    promptRegisterEmailIfNeeded,
    resolveItemDelivery,
    broadcastToVerified,
    getUserByTelegram,
    ensureUserEmailColumns,
};
