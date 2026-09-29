'use strict';

/**
 * Ponte MTProto automática — sincroniza .env, valida sessão no boot,
 * persiste sessão no .env após login, avisa admin só se faltar telefone.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

const KV_NOTIFY = 'bridge:setup_notified';

function _envPath() {
    return path.join(__dirname, '../../.env');
}

function _updateEnvLine(key, value) {
    const envPath = _envPath();
    if (!fs.existsSync(envPath)) return false;
    try {
        let content = fs.readFileSync(envPath, 'utf8');
        const re = new RegExp(`^${key}=.*$`, 'm');
        const line = `${key}=${value}`;
        if (re.test(content)) {
            content = content.replace(re, line);
        } else {
            content = content.trimEnd() + `\n${line}\n`;
        }
        fs.writeFileSync(envPath, content, 'utf8');
        return true;
    } catch (e) {
        logger.warn('[BridgeAuto] .env write:', e.message);
        return false;
    }
}

function syncFromEnv(dbRaw) {
    const bridge = require('./TelegramUserBridge');
    bridge.setDbRaw(dbRaw);

    const apiId = process.env.TELEGRAM_USER_API_ID?.trim();
    const apiHash = process.env.TELEGRAM_USER_API_HASH?.trim();
    const session = process.env.TELEGRAM_USER_SESSION?.trim();

    if (apiId && apiHash) {
        try {
            bridge.saveCredentials(parseInt(apiId, 10), apiHash);
        } catch {
            /* já ok */
        }
    }
    if (session) {
        bridge.saveSession(session);
    }

    return {
        hasCredentials: bridge.hasCredentials(),
        configured: bridge.isConfigured(),
    };
}

async function validateSessionOnBoot() {
    const bridge = require('./TelegramUserBridge');
    if (!bridge.isConfigured()) {
        return { ok: false, reason: 'no_session' };
    }

    const timeoutMs = Math.max(10000, parseInt(process.env.BRIDGE_VALIDATE_TIMEOUT_MS || '45000', 10));
    const maxAttempts = Math.max(1, parseInt(process.env.BRIDGE_VALIDATE_RETRIES || '2', 10));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const valid = await Promise.race([
                bridge.validateSession(),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(new Error(`timeout validação MTProto (${timeoutMs}ms)`)),
                        timeoutMs
                    )
                ),
            ]);
            if (valid) {
                logger.info('[BridgeAuto] sessão MTProto validada');
                return { ok: true };
            }
            _updateEnvLine('TELEGRAM_USER_SESSION', '');
            return { ok: false, reason: 'invalid_session' };
        } catch (e) {
            const isTimeout = /timeout/i.test(e.message || '');
            if (isTimeout && attempt < maxAttempts) {
                logger.info(`[BridgeAuto] validação MTProto timeout (tentativa ${attempt}/${maxAttempts}) — retentando…`);
                await new Promise((r) => setTimeout(r, 2500));
                continue;
            }
            logger.warn('[BridgeAuto] validação MTProto:', { detail: e.message, attempt });
            return { ok: false, reason: isTimeout ? 'timeout' : 'timeout_or_error' };
        }
    }
    return { ok: false, reason: 'timeout' };
}

function persistSessionToEnv(sessionStr) {
    if (!sessionStr) return;
    process.env.TELEGRAM_USER_SESSION = sessionStr;
    if (_updateEnvLine('TELEGRAM_USER_SESSION', sessionStr)) {
        logger.info('[BridgeAuto] TELEGRAM_USER_SESSION salvo no .env');
    }
}

function isPhoneText(text) {
    const raw = String(text || '').trim().replace(/\s/g, '');
    return /^\+?\d{10,15}$/.test(raw);
}

/**
 * Inicia conexão da ponte (QR) para admin.
 */
async function connectBridge(ctx, dbRaw, { pendingLink = null, groupService = null } = {}) {
    const { getBridgeLoginService } = require('./BridgeLoginService');
    const login = getBridgeLoginService(dbRaw);
    const start = login.start(ctx.from.id, { pendingLink });

    if (!start.started) {
        return { ok: false, connected: !!start.already, message: start.message };
    }

    await ctx.reply(start.message, { parse_mode: 'HTML' });

    if (start.method === 'qr' && !start.resumed) {
        const launched = login.launchQr(ctx.from.id, ctx, {
            groupService,
            background: true,
        });
        if (launched?.launched !== false) {
            return { ok: true, connected: false, launched: true, message: start.message };
        }
    }

    return { ok: true, connected: false, resumed: !!start.resumed, message: start.message };
}

async function tryAutoPhoneLogin(uid, text, dbRaw) {
    /* Telefone automático desativado — Telegram bloqueia código no chat. Use QR. */
    if (!isPhoneText(text)) return null;
    return {
        handled: true,
        useQr: true,
        message:
            '⚠️ <b>Não envie telefone aqui.</b>\n\n' +
            'O Telegram bloqueia login por código no bot.\n\n' +
            'Digite <code>/conectar</code> para receber o <b>QR code</b> e escanear no app.',
    };
}

async function runOnBoot(bot, adminIds, dbRaw) {
    const bridge = require('./TelegramUserBridge');
    const status = syncFromEnv(dbRaw);

    if (!bridge.canUseBridge()) {
        logger.debug('[BridgeAuto] pacote telegram ausente — ponte desativada');
        return status;
    }

    if (!status.hasCredentials) {
        logger.debug('[BridgeAuto] TELEGRAM_USER_API_ID/HASH ausentes no .env');
        return status;
    }

    logger.info('[BridgeAuto] credenciais OK (my.telegram.org)');

    if (status.configured) {
        logger.info('[BridgeAuto] sessão encontrada (.env/kv) — validando…');
        const validation = await validateSessionOnBoot();
        if (validation.ok && bridge.isConfigured()) {
            logger.info('[BridgeAuto] ponte pronta — /entrar e pool automático ativos');
            return { ...status, configured: true };
        }
        if (!validation.ok) {
            if (validation.reason === 'timeout') {
                logger.warn(
                    '[BridgeAuto] validação MTProto demorou — sessão mantida; use /entrar ou /conectar se a ponte falhar'
                );
            } else if (validation.reason === 'invalid_session') {
                logger.warn('[BridgeAuto] sessão MTProto inválida — use /conectar (QR)');
            } else {
                logger.warn('[BridgeAuto] validação MTProto falhou — use /conectar (QR) se necessário');
            }
        }
    } else {
        logger.info('[BridgeAuto] aguardando /conectar (QR, 1ª vez)');
    }

    try {
        const db = typeof dbRaw === 'function' ? dbRaw() : null;
        if (!db || !adminIds?.length) return status;

        const row = db.prepare('SELECT value FROM kv_store WHERE key=?').get(KV_NOTIFY);
        if (row?.value) return status;

        const msg =
            '📲 <b>Conectar ponte (automático, 1ª vez)</b>\n\n' +
            'Suas credenciais API já estão configuradas.\n\n' +
            '👉 Digite <code>/conectar</code> — o bot envia um <b>QR code</b>.\n' +
            'Escaneie no Telegram: Configurações → Dispositivos → Conectar.\n\n' +
            '<i>Depois disso /entrar funciona sozinho. Não digite código SMS no bot.</i>';

        for (const aid of adminIds) {
            try {
                await bot.telegram.sendMessage(aid, msg, { parse_mode: 'HTML' });
            } catch {
                /* ignore */
            }
        }
        db.prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(KV_NOTIFY, String(Date.now()));
    } catch (e) {
        logger.debug('[BridgeAuto] notify:', e.message);
    }

    return status;
}

function clearSetupNotified(dbRaw) {
    try {
        const db = typeof dbRaw === 'function' ? dbRaw() : null;
        db?.prepare('DELETE FROM kv_store WHERE key=?').run(KV_NOTIFY);
    } catch {
        /* ignore */
    }
}

module.exports = {
    syncFromEnv,
    validateSessionOnBoot,
    persistSessionToEnv,
    isPhoneText,
    connectBridge,
    tryAutoPhoneLogin,
    runOnBoot,
    clearSetupNotified,
};
