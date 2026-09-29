'use strict';

/**
 * Divulgação automática via conta MTProto (número conectado) em grupos
 * onde o bot não está — mesmo texto + botões URL que o bot usa em grupos.
 */
const logger = require('../config/logger');
const { gramJsButtonsFromReplyMarkup } = require('../telegram/groupPromo');
const { analyzeGroupContent } = require('./groupContentFilter');
const broadcastRateLimit = require('./broadcastRateLimit');
const BroadcastAdaptiveThrottle = require('./BroadcastAdaptiveThrottle');

const KV_PREFIX = 'bridge_promo_slot:';
const TEXT_ONLY_PREFIX = 'bridge_text_only:';

function opsRecord(db, event) {
    try {
        const OpsMetricsStore = require('./ops/OpsMetricsStore');
        OpsMetricsStore.record(typeof db === 'function' ? db() : db, event);
    } catch {
        /* ignore */
    }
}

function isBridgeSendBlockedError(err) {
    const msg = String(err?.errorMessage || err?.message || err || '').toUpperCase();
    return (
        msg.includes('CHAT_ADMIN_REQUIRED') ||
        msg.includes('CHAT_WRITE_FORBIDDEN') ||
        msg.includes('USER_BANNED_IN_CHANNEL') ||
        msg.includes('CHANNEL_PRIVATE') ||
        msg.includes('PEER_ID_INVALID')
    );
}

function bridgeErrorText(err) {
    return String(err?.errorMessage || err?.message || err || '').trim();
}

function isBridgeStarsPaymentError(err) {
    const msg = bridgeErrorText(err).toUpperCase();
    return (
        msg.includes('ALLOW_PAYMENT_REQUIRED') ||
        msg.includes('STARS_PAYMENT_REQUIRED') ||
        msg.includes('STARS_PAYMENT')
    );
}

function isBridgePhotoForbiddenError(err) {
    const msg = bridgeErrorText(err).toUpperCase();
    return (
        msg.includes('CHAT_SEND_PHOTOS_FORBIDDEN') ||
        isBridgeStarsPaymentError(err) ||
        msg.includes('MEDIA_INVALID') ||
        msg.includes('PHOTO_INVALID')
    );
}

class BridgeBroadcastService {
    constructor({ dbRaw, groupService, getBotUsername, groupDelayMs = 1500 } = {}) {
        this.dbRaw = dbRaw;
        this.groupService = groupService;
        this.getBotUsername = getBotUsername || (async () => process.env.BOT_USERNAME || '');
        this.groupDelayMs = groupDelayMs;
    }

    _db() {
        return typeof this.dbRaw === 'function' ? this.dbRaw() : null;
    }

    isAvailable() {
        try {
            const bridge = require('./TelegramUserBridge');
            return bridge.canUseBridge() && bridge.isConfigured();
        } catch {
            return false;
        }
    }

    _slotKey(chatId) {
        return `${KV_PREFIX}${String(chatId)}`;
    }

    _textOnlyKey(chatId) {
        return `${TEXT_ONLY_PREFIX}${String(chatId)}`;
    }

    _isTextOnly(chatId) {
        const db = this._db();
        if (!db) return false;
        try {
            return !!db.prepare('SELECT 1 FROM kv_store WHERE key=?').get(this._textOnlyKey(chatId));
        } catch {
            return false;
        }
    }

    _markTextOnly(chatId, reason = '') {
        const db = this._db();
        if (!db) return;
        try {
            db.prepare(
                `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
            ).run(
                this._textOnlyKey(chatId),
                JSON.stringify({ at: Date.now(), reason: String(reason).slice(0, 120) })
            );
            opsRecord(db, {
                channel: 'tg_bridge',
                kind: 'countermeasure',
                target: String(chatId),
                detail: String(reason || 'foto bloqueada').slice(0, 240),
                countermeasure: 'ponte: só texto neste grupo',
            });
        } catch {
            /* ignore */
        }
    }

    _getSlot(chatId) {
        const db = this._db();
        if (!db) return null;
        try {
            const row = db.prepare('SELECT value FROM kv_store WHERE key=?').get(this._slotKey(chatId));
            if (!row?.value) return null;
            return JSON.parse(row.value);
        } catch {
            return null;
        }
    }

    _saveSlot(chatId, messageId) {
        const db = this._db();
        if (!db || !messageId) return;
        db.prepare(
            `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
        ).run(
            this._slotKey(chatId),
            JSON.stringify({ messageId: Number(messageId), updatedAt: Date.now() })
        );
    }

    _clearSlot(chatId) {
        const db = this._db();
        db?.prepare('DELETE FROM kv_store WHERE key=?').run(this._slotKey(chatId));
    }

    _peerForGroup(g) {
        if (g.username) return `@${String(g.username).replace(/^@/, '')}`;
        return Number(g.chat_id);
    }

    async broadcastPromo({ texto, photo = null, groupReplyMarkup = null, source = 'auto' } = {}) {
        if (!this.isAvailable()) {
            logger.warn('[BridgeBroadcast] ponte indisponível');
            return { skipped: true, reason: 'bridge_unavailable' };
        }

        if (!this.groupService?.getBridgePromoTargets) {
            logger.warn('[BridgeBroadcast] groupService ausente no singleton');
            return { skipped: true, reason: 'no_group_service' };
        }

        const targets = this.groupService.getBridgePromoTargets();
        if (!targets.length) {
            logger.info('[BridgeBroadcast] nenhum grupo ponte (promo_via_bridge=1) — use /entrar @grupo');
            return { total: 0, edited: 0, sent: 0, failed: 0 };
        }

        logger.info(`[BridgeBroadcast] ${targets.length} alvo(s) ponte`, {
            titles: targets.slice(0, 5).map((g) => g.title || g.chat_id),
        });

        const bridge = require('./TelegramUserBridge');
        const body = String(texto || '');
        const buttons = gramJsButtonsFromReplyMarkup(groupReplyMarkup);

        const results = { total: targets.length, edited: 0, sent: 0, failed: 0, rateLimited: 0 };
        const enforceAutoRateLimit = broadcastRateLimit.isScheduledBroadcastSource(source);

        for (const g of targets) {
            const contentBlock = analyzeGroupContent({
                title: g.title,
                username: g.username,
                channel: 'tg',
            });
            if (contentBlock.blocked) {
                results.failed++;
                opsRecord(this._db(), {
                    channel: 'tg_bridge',
                    kind: 'skip',
                    target: g.title || String(g.chat_id),
                    detail: `filtro_conteudo: ${contentBlock.reason}`,
                    countermeasure: 'removido da ponte + sair',
                });
                this.groupService?.removeBridgePromoGroup?.(
                    g.chat_id,
                    `filtro_conteudo: ${contentBlock.reason}`
                );
                try {
                    const bridge = require('./TelegramUserBridge');
                    await bridge.leaveChat({
                        id: Number(g.chat_id),
                        title: g.title,
                        type: g.type,
                        username: g.username,
                    });
                } catch {
                    /* ignore */
                }
                logger.warn(
                    `[BridgeBroadcast] ${g.title || g.chat_id}: bloqueado por filtro (${contentBlock.reason})`
                );
                continue;
            }

            let bridgeEditOnly = false;
            if (this.dbRaw) {
                const gate = broadcastRateLimit.canSendPromo(this.dbRaw, g.chat_id, {
                    channel: 'bridge',
                    enforceWindow: enforceAutoRateLimit,
                });
                if (!gate.ok) {
                    const slotProbe = this._getSlot(g.chat_id);
                    if (gate.allowEditOnly && slotProbe?.messageId) bridgeEditOnly = true;
                    else {
                        results.rateLimited++;
                        if (gate.reason === 'min_gap' && results.rateLimited <= 3) {
                            logger.info(
                                `[BridgeBroadcast] skip ${g.title || g.chat_id}: intervalo mínimo (${gate.waitSec}s)`
                            );
                        }
                        continue;
                    }
                }
            }

            const peer = this._peerForGroup(g);
            const slot = this._getSlot(g.chat_id);
            try {
                const r = await bridge.withClient(async (client) => {
                    if (bridgeEditOnly && slot?.messageId) {
                        try {
                            await client.editMessage(peer, {
                                message: Number(slot.messageId),
                                text: body,
                                parseMode: 'html',
                                buttons,
                            });
                            return { action: 'edited', messageId: slot.messageId };
                        } catch (editErr) {
                            const ed = bridgeErrorText(editErr);
                            if (/\bflood\b/i.test(ed)) throw editErr;
                            logger.debug(`[BridgeBroadcast] edit-only falhou ${g.title}:`, ed);
                            return { action: 'failed', error: ed };
                        }
                    }

                    if (slot?.messageId) {
                        try {
                            await client.deleteMessages(peer, [Number(slot.messageId)], {
                                revoke: true,
                            });
                        } catch (delErr) {
                            logger.debug('[BridgeBroadcast] apagar anterior:', delErr.message);
                        }
                        this._clearSlot(g.chat_id);
                    }

                    let sent;
                    const preferText = this._isTextOnly(g.chat_id);
                    const hasPhoto = !preferText && !!(photo?.source || photo?.url);
                    try {
                        if (photo?.source && !preferText) {
                            sent = await client.sendFile(peer, {
                                file: photo.source,
                                caption: body,
                                parseMode: 'html',
                                buttons,
                            });
                        } else if (photo?.url && !preferText) {
                            sent = await client.sendFile(peer, {
                                file: photo.url,
                                caption: body,
                                parseMode: 'html',
                                buttons,
                            });
                        } else {
                            sent = await client.sendMessage(peer, {
                                message: body,
                                parseMode: 'html',
                                linkPreview: true,
                                buttons,
                            });
                        }
                    } catch (photoErr) {
                        if (hasPhoto && isBridgePhotoForbiddenError(photoErr)) {
                            const detail = String(
                                photoErr?.errorMessage || photoErr?.message || photoErr
                            ).trim();
                            logger.debug(
                                `[BridgeBroadcast] ${g.title || g.chat_id}: foto bloqueada — texto`,
                                { detail }
                            );
                            this._markTextOnly(g.chat_id, detail);
                            sent = await client.sendMessage(peer, {
                                message: body,
                                parseMode: 'html',
                                linkPreview: true,
                                buttons,
                            });
                            opsRecord(this._db(), {
                                channel: 'tg_bridge',
                                kind: 'countermeasure',
                                target: g.title || String(g.chat_id),
                                detail,
                                countermeasure: 'fallback texto (foto bloqueada)',
                            });
                        } else {
                            throw photoErr;
                        }
                    }
                    const mid = sent?.id ?? sent?.message?.id ?? sent?.messages?.[0]?.id;
                    return { action: 'sent', messageId: mid };
                });

                if (r?.action === 'sent') {
                    results.sent++;
                    if (r.messageId) this._saveSlot(g.chat_id, r.messageId);
                    if (this.dbRaw) {
                        broadcastRateLimit.recordAutoSend(this.dbRaw, g.chat_id, { channel: 'bridge' });
                    }
                } else if (r?.action === 'edited') {
                    results.edited++;
                } else results.failed++;
            } catch (e) {
                results.failed++;
                const detail = bridgeErrorText(e);
                if (isBridgeStarsPaymentError(e)) {
                    this.groupService?.removeBridgePromoGroup?.(
                        g.chat_id,
                        'stars_payment_required'
                    );
                    this._clearSlot(g.chat_id);
                    opsRecord(this._db(), {
                        channel: 'tg_bridge',
                        kind: 'skip',
                        target: g.title || String(g.chat_id),
                        detail,
                        countermeasure: 'removido da ponte (grupo exige Stars)',
                    });
                    logger.info(
                        `[BridgeBroadcast] ${g.title || g.chat_id}: grupo exige Stars — removido da ponte`
                    );
                    continue;
                }
                if (isBridgeSendBlockedError(e)) {
                    const strike = this.groupService?.recordPromoFailure?.(g.chat_id, detail, {
                        bridge: true,
                        title: g.title,
                    });
                    opsRecord(this._db(), {
                        channel: 'tg_bridge',
                        kind: strike?.evicted ? 'fail' : 'retry',
                        target: g.title || String(g.chat_id),
                        detail,
                        countermeasure: strike?.evicted ? 'evict ponte + sair' : `strike ${strike?.strikes}/${strike?.threshold}`,
                    });
                    if (strike?.evicted) {
                        try {
                            const bridge = require('./TelegramUserBridge');
                            await bridge.leaveChat({
                                id: Number(g.chat_id),
                                title: g.title,
                                type: g.type,
                                username: g.username,
                            });
                        } catch {
                            /* ignore */
                        }
                        const { getBridgePoolService } = require('./BridgePoolService');
                        getBridgePoolService({ groupService: this.groupService })?.scheduleProcess?.();
                        this._clearSlot(g.chat_id);
                    }
                    logger.warn(
                        `[BridgeBroadcast] ${g.title || g.chat_id}: sem permissão (${strike?.strikes ?? 1}/${strike?.threshold ?? '?'})`,
                        { detail, evicted: Boolean(strike?.evicted) }
                    );
                } else if (/\bflood\b/i.test(detail)) {
                    BroadcastAdaptiveThrottle.recordSignal('tg_flood', { severity: 25 });
                    const strike = this.groupService?.recordPromoFailure?.(g.chat_id, detail, {
                        bridge: true,
                        title: g.title,
                    });
                    opsRecord(this._db(), {
                        channel: 'tg_bridge',
                        kind: 'retry',
                        target: g.title || String(g.chat_id),
                        detail,
                        countermeasure: strike?.evicted ? 'evict ponte (flood)' : `flood strike ${strike?.strikes}`,
                    });
                    logger.warn(`[BridgeBroadcast] ${g.title || g.chat_id}: FLOOD`, {
                        detail,
                        strikes: strike?.strikes,
                        evicted: strike?.evicted,
                    });
                    if (strike?.evicted) {
                        try {
                            const bridge = require('./TelegramUserBridge');
                            await bridge.leaveChat({
                                id: Number(g.chat_id),
                                title: g.title,
                                type: g.type,
                                username: g.username,
                            });
                        } catch {
                            /* ignore */
                        }
                        this._clearSlot(g.chat_id);
                    }
                } else {
                    opsRecord(this._db(), {
                        channel: 'tg_bridge',
                        kind: 'fail',
                        target: g.title || String(g.chat_id),
                        detail,
                    });
                    logger.warn(`[BridgeBroadcast] ${g.title || g.chat_id}: falha`, { detail });
                }
            }
            await new Promise((r) => setTimeout(r, this.groupDelayMs));
        }

        logger.info('[BridgeBroadcast] ciclo OK', { source, ...results });
        return results;
    }
}

let _singleton = null;

function getBridgeBroadcastService(deps = {}) {
    if (!_singleton) {
        _singleton = new BridgeBroadcastService(deps);
        return _singleton;
    }
    if (deps.dbRaw) _singleton.dbRaw = deps.dbRaw;
    if (deps.groupService) _singleton.groupService = deps.groupService;
    if (deps.getBotUsername) _singleton.getBotUsername = deps.getBotUsername;
    if (deps.groupDelayMs != null) _singleton.groupDelayMs = deps.groupDelayMs;
    return _singleton;
}

module.exports = { BridgeBroadcastService, getBridgeBroadcastService };
