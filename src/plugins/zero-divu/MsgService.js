/**
 * MsgService — Slots por chat (grupos + PV) com edição prioritária
 * Persistência SQLite (DeliverySlotStore) — sobrevive a reinício do bot
 */

'use strict';

const logger = require('../config/logger');
const broadcastRateLimit = require('../services/broadcastRateLimit');
const { stateManager } = require('../infrastructure');
const { getDeliverySlotStore } = require('../services/DeliverySlotStore');
const SLOT_TTL_MS = 86400 * 30 * 1000;
const {
    deliverMessage,
    deleteSlotMessage,
    pickTelegramOpts,
    normalizeSlotChatId,
    slotMessageId,
    isBlockedError,
    isNetworkError,
    formatNetworkErr,
} = require('./messageDelivery');

class MsgService {
    constructor(bot, options = {}) {
        this.bot = bot;
        this.lastMenuMsg = options.lastMenuMsg || null;
        this.slotStore = options.slotStore || getDeliverySlotStore(options.dbRaw);
    }

    _slotKey(chatId) {
        return `group_slot:${normalizeSlotChatId(chatId)}`;
    }

    async _getSlot(chatId) {
        const key = normalizeSlotChatId(chatId);

        const persisted = await this.slotStore.get(key);
        if (persisted?.messageId) {
            return persisted;
        }

        if (this.lastMenuMsg) {
            const t = await this.lastMenuMsg.get(key);
            const mid = slotMessageId(t);
            if (mid) {
                const adopted = await this.slotStore.adoptFromRedis(key, t);
                if (adopted) return adopted;
                return { messageId: mid, chatId: key, updatedAt: t.updatedAt, menuType: 'promo' };
            }
        }

        const slot = await stateManager.get(this._slotKey(key));
        if (slot) {
            const adopted = await this.slotStore.adoptFromRedis(key, slot);
            if (adopted) return adopted;
            return { ...slot, messageId: slotMessageId(slot), chatId: key };
        }
        return null;
    }

    async _saveSlot(chatId, messageId, text = '', meta = {}) {
        const key = normalizeSlotChatId(chatId);
        const data = {
            messageId,
            chatId: key,
            text: text.slice(0, 400),
            menuType: meta.menuType || 'promo',
            messageType: meta.messageType || 'text',
            updatedAt: Date.now(),
        };

        await this.slotStore.save(key, data);

        if (this.lastMenuMsg) {
            await this.lastMenuMsg.set(key, data);
        }
        await stateManager.set(this._slotKey(key), data, SLOT_TTL_MS);
    }

    async _clearSlot(chatId) {
        const key = normalizeSlotChatId(chatId);
        await this.slotStore.delete(key);
        if (this.lastMenuMsg) {
            await this.lastMenuMsg.delete(key);
        }
        await stateManager.delete(this._slotKey(key));
    }

    /**
     * PV promo: edita slot (nunca apaga+nova); grupos: apaga e envia nova quando forceNew.
     */
    async sendToChat(chatId, text, options = {}) {
        const key = normalizeSlotChatId(chatId);
        const telegramOpts = pickTelegramOpts(options);
        const pvPromo = !!options.pvPromo;
        const promoMode =
            !!options.promoMode ||
            String(options.menuType || '').includes('promo');

        let photo = options.photo;
        if (photo && promoMode && !pvPromo && !options.forcePhoto) {
            try {
                const { isTextOnly } = require('../services/tgPromoTextOnly');
                if (isTextOnly(key)) photo = null;
            } catch {
                /* ignore */
            }
        }

        let deliveryOpts = {
            photo,
            forceNew: pvPromo ? false : !!options.forceNew,
            promoMode,
            pvPromo,
            editOnly: !!options.editOnly,
            groupPromoReplace: options.groupPromoReplace,
            messageIsPhoto: options.messageIsPhoto,
            requirePhoto: !!options.requirePhoto,
        };

        try {
            let slot = options.forceNew && !pvPromo ? null : await this._getSlot(key);

            let messageIsPhoto = options.messageIsPhoto;
            if (pvPromo && slot?.messageType) {
                messageIsPhoto = slot.messageType === 'photo';
            }

            deliveryOpts = {
                ...deliveryOpts,
                messageIsPhoto,
            };

            if (options.forceNew && !pvPromo) {
                const oldSlot = await this._getSlot(key);
                if (oldSlot?.messageId) {
                    const deleted = await deleteSlotMessage(this.bot.telegram, key, oldSlot);
                    if (deleted) {
                        await this._clearSlot(key);
                        slot = null;
                    } else {
                        options = {
                            ...options,
                            forceNew: false,
                            groupPromoReplace: false,
                        };
                        slot = oldSlot;
                        deliveryOpts = {
                            ...deliveryOpts,
                            forceNew: false,
                            groupPromoReplace: false,
                        };
                    }
                } else {
                    await this._clearSlot(key);
                    slot = null;
                }
            }

            let r = await deliverMessage(
                this.bot.telegram,
                key,
                slot,
                text,
                telegramOpts,
                deliveryOpts
            );

            if (
                (!r?.messageId ||
                    r.action === 'blocked' ||
                    r.action === 'failed') &&
                !options.forceNew &&
                !pvPromo
            ) {
                const stale = await this._getSlot(key);
                if (stale?.messageId) {
                    await deleteSlotMessage(this.bot.telegram, key, stale);
                }
                await this._clearSlot(key);
                r = await deliverMessage(this.bot.telegram, key, null, text, telegramOpts, {
                    ...deliveryOpts,
                    forceNew: true,
                    promoMode,
                });
            }

            if (r?.messageId && r.action !== 'blocked') {
                await this._saveSlot(key, r.messageId, text, {
                    messageType: photo ? 'photo' : 'text',
                    menuType: options.menuType || 'promo',
                });
                if (photo && promoMode && options.forcePhoto) {
                    try {
                        const { clearTextOnly } = require('../services/tgPromoTextOnly');
                        clearTextOnly(key);
                    } catch {
                        /* ignore */
                    }
                }
                if (r.photoFallback && promoMode) {
                    try {
                        const { markTextOnly } = require('../services/tgPromoTextOnly');
                        markTextOnly(key, r.photoFallbackReason || 'foto bloqueada');
                    } catch {
                        /* ignore */
                    }
                }
            } else if (r?.action === 'failed' || isMissingSlotAfterEdit(r)) {
                await this._clearSlot(key);
            }
            return r || { action: 'failed', messageId: null };
        } catch (err) {
            if (isBlockedError(err)) {
                return { action: 'blocked', messageId: null };
            }
            const retryable = isNetworkError(err) && !options._netRetried;
            if (retryable) {
                await new Promise((r) => setTimeout(r, 2000));
                try {
                    if (pvPromo) {
                        const slot = await this._getSlot(key);
                        const r2 = await deliverMessage(
                            this.bot.telegram,
                            key,
                            slot,
                            text,
                            telegramOpts,
                            { ...deliveryOpts, _netRetried: true }
                        );
                        if (r2?.messageId && r2.action !== 'blocked') {
                            await this._saveSlot(key, r2.messageId, text, {
                                messageType: photo ? 'photo' : 'text',
                                menuType: options.menuType || 'promo',
                            });
                        }
                        return r2 || { action: 'failed', messageId: null };
                    }
                    const sent = await this.bot.telegram.sendMessage(key, text, telegramOpts);
                    await this._saveSlot(key, sent.message_id, text, {
                        menuType: options.menuType || 'promo',
                    });
                    return { action: 'sent', messageId: sent.message_id };
                } catch (retryErr) {
                    if (isBlockedError(retryErr)) {
                        return { action: 'blocked', messageId: null };
                    }
                    logger.error(`[MsgService] sendToChat ${chatId}:`, formatNetworkErr(retryErr));
                    return { action: 'failed', messageId: null, error: formatNetworkErr(retryErr) };
                }
            }
            if (pvPromo) {
                logger.warn(`[MsgService] PV promo falhou (sem nova mensagem): ${chatId}`, formatNetworkErr(err));
                return { action: 'failed', messageId: null, error: formatNetworkErr(err) };
            }
            try {
                const stale = await this._getSlot(key);
                if (stale?.messageId) {
                    await deleteSlotMessage(this.bot.telegram, key, stale);
                }
                await this._clearSlot(key);
                const sent = await this.bot.telegram.sendMessage(key, text, telegramOpts);
                await this._saveSlot(key, sent.message_id, text, {
                    menuType: options.menuType || 'promo',
                });
                return { action: 'sent', messageId: sent.message_id };
            } catch (err2) {
                logger.error(`[MsgService] sendToChat ${chatId}:`, formatNetworkErr(err2));
                return { action: 'failed', messageId: null, error: formatNetworkErr(err2) };
            }
        }
    }

    async canPostInChat(chatId, options = {}) {
        try {
            const me = this.bot.botInfo || (await this.bot.telegram.getMe());
            const member = await this.bot.telegram.getChatMember(chatId, me.id);
            if (member.status === 'left' || member.status === 'kicked') {
                return { ok: false, reason: member.status };
            }
            const isChannel = options.chatType === 'channel' || options.requireChannelAdmin;
            if (isChannel) {
                if (!['administrator', 'creator'].includes(member.status)) {
                    return { ok: false, reason: 'channel_not_admin' };
                }
                if (member.can_post_messages === false) {
                    return { ok: false, reason: 'channel_no_post' };
                }
                return { ok: true, reason: 'channel_admin' };
            }
            if (member.status === 'restricted' && member.can_send_messages === false) {
                return { ok: false, reason: 'restricted_no_send' };
            }
            return { ok: true, reason: member.status };
        } catch (e) {
            return { ok: true, reason: 'check_failed_will_try_send' };
        }
    }

    async _sendPlainPromo(chatId, text) {
        const cid = normalizeSlotChatId(chatId);
        const n = Number(cid);
        const apiId = Number.isFinite(n) ? n : cid;
        return this.bot.telegram.sendMessage(apiId, text, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
    }

    async sendToUser(chatId, text, options = {}) {
        return this.sendToChat(chatId, text, { ...options, menuType: 'menu' });
    }

    async sendToGroup(chatId, text, options = {}) {
        return this.sendToChat(chatId, text, options);
    }

    async sendToAdmin(chatId, text, options = {}) {
        return this.sendToChat(chatId, text, options);
    }

    async broadcastToUsers(targets, text, options = {}) {
        const results = { edited: 0, sent: 0, unchanged: 0, failed: 0, blocked: 0 };

        for (const target of targets) {
            try {
                const r = await this.sendToUser(target, text, options);
                if (r.action === 'edited' || r.action === 'unchanged') results.edited++;
                else if (r.action === 'sent') results.sent++;
                else if (r.action === 'blocked') results.blocked++;
            } catch {
                results.failed++;
            }
            await this._delay(50);
        }

        logger.info(`[MsgService] Broadcast users: edited=${results.edited} sent=${results.sent}`);
        return results;
    }

    async broadcastToGroups(groups, text, options = {}) {
        return this._broadcastDestinations(groups, text, { ...options, destinationKind: 'group' });
    }

    async broadcastToChannels(channels, text, options = {}) {
        return this._broadcastDestinations(channels, text, {
            ...options,
            destinationKind: 'channel',
            requireChannelAdmin: true,
        });
    }

    async _broadcastDestinations(targets, text, options = {}) {
        const results = {
            edited: 0, sent: 0, unchanged: 0, failed: 0, cooldown: 0, skipped: 0, rateLimited: 0,
        };

        const {
            cooldownMs: cooldownOpt,
            cooldownMode = 'new_only',
            skipPermissionCheck = true,
            allowPlainFallback = true,
            forceNew,
            destinationKind = 'group',
            requireChannelAdmin = false,
            enforceAutoRateLimit = false,
            dbRaw = null,
            ...sendOpts
        } = options;
        const useForceNew = forceNew === true;
        const cooldownMs =
            cooldownOpt !== undefined ? cooldownOpt : 30 * 60 * 1000;

        const kindLabel = destinationKind === 'channel' ? 'canais' : 'grupos';
        if (!targets?.length) {
            logger.warn(`[MsgService] Broadcast ${kindLabel}: nenhum alvo (adicione o bot ou use /canal add)`);
            return results;
        }

        for (const group of targets) {
            const rawId = typeof group === 'object' ? group.chat_id : group;
            const chatId = normalizeSlotChatId(rawId);
            const title = typeof group === 'object' ? group.title : chatId;
            const chatType = typeof group === 'object' ? group.type : null;
            const isChannel = destinationKind === 'channel' || chatType === 'channel';

            if (!skipPermissionCheck) {
                const perm = await this.canPostInChat(chatId, {
                    chatType: isChannel ? 'channel' : undefined,
                    requireChannelAdmin: requireChannelAdmin || isChannel,
                });
                if (!perm.ok) {
                    results.skipped++;
                    if (results.skipped <= 5) {
                        logger.warn(`[MsgService] skip ${title}: ${perm.reason}`);
                    }
                    await this._delay(200);
                    continue;
                }
            }

            const rateChannel = destinationKind === 'channel' ? 'channel' : 'group';
            let rateLimitedEditOnly = false;
            const gate = broadcastRateLimit.canSendPromo(dbRaw, chatId, {
                channel: rateChannel,
                enforceWindow: !!enforceAutoRateLimit,
            });
            if (!gate.ok) {
                if (gate.allowEditOnly) {
                    const slotProbe = await this._getSlot(chatId);
                    if (slotProbe?.messageId) rateLimitedEditOnly = true;
                    else {
                        results.rateLimited++;
                        if (results.rateLimited <= 3 && gate.reason === 'min_gap') {
                            logger.info(`[MsgService] skip ${title}: intervalo mínimo (${gate.waitSec}s)`);
                        }
                        await this._delay(80);
                        continue;
                    }
                } else {
                    results.rateLimited++;
                    await this._delay(80);
                    continue;
                }
            }

            const menuType = isChannel ? 'channel_promo' : 'group_promo';

            try {
                const slot = useForceNew && !rateLimitedEditOnly ? null : await this._getSlot(chatId);

                // skip = não atualiza durante cooldown; new_only = substitui (apaga + nova) se há slot
                if (
                    !useForceNew &&
                    cooldownMs > 0 &&
                    cooldownMode === 'skip' &&
                    slot?.updatedAt &&
                    Date.now() - slot.updatedAt < cooldownMs
                ) {
                    results.cooldown++;
                    continue;
                }

                let r = await this.sendToChat(chatId, text, {
                    ...sendOpts,
                    forceNew: rateLimitedEditOnly ? false : useForceNew,
                    promoMode: true,
                    groupPromoReplace: rateLimitedEditOnly ? false : destinationKind === 'group',
                    requirePhoto: !!sendOpts.requirePhoto,
                    forcePhoto: !!sendOpts.forcePhoto,
                    menuType,
                });
                if (r.action === 'blocked' || r.action === 'failed' || !r?.messageId) {
                    results.failed++;
                    const errDetail = r.error || r.action || 'failed';
                    try {
                        const BroadcastAdaptiveThrottle = require('../services/BroadcastAdaptiveThrottle');
                        const mapped = BroadcastAdaptiveThrottle.mapErrorToSignal(errDetail);
                        if (mapped) BroadcastAdaptiveThrottle.recordSignal(mapped.signal, { severity: mapped.severity });
                    } catch {
                        /* ignore */
                    }
                    if (options.groupService?.recordPromoFailure) {
                        options.groupService.recordPromoFailure(chatId, errDetail, {
                            bridge: false,
                            title,
                        });
                    }
                    if (results.failed <= 8) {
                        logger.warn(`[MsgService] fail ${title}: ${errDetail}`);
                    }
                } else if (r.action === 'edited' || r.action === 'unchanged') {
                    results.edited++;
                } else if (r.action === 'sent') {
                    results.sent++;
                    if (dbRaw) {
                        broadcastRateLimit.recordAutoSend(dbRaw, chatId, { channel: rateChannel });
                    }
                }
            } catch (err) {
                results.failed++;
                if (options.groupService?.recordPromoFailure) {
                    options.groupService.recordPromoFailure(chatId, err.message || String(err), {
                        bridge: false,
                        title,
                    });
                }
                if (results.failed <= 8) {
                    logger.error(`[MsgService] broadcast ${kindLabel} ${title}:`, err.message);
                }
            }
            await this._delay(options.delayMs ?? 1200);
        }

        logger.info(
            `[MsgService] Broadcast ${kindLabel}: targets=${targets.length} edited=${results.edited} sent=${results.sent} ` +
            `cooldown=${results.cooldown} skip=${results.skipped} rateLimited=${results.rateLimited} fail=${results.failed}`
        );
        return results;
    }

    _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

function isMissingSlotAfterEdit(r) {
    return r?.action === 'failed';
}

let instance = null;

module.exports = {
    init: (bot, options = {}) => {
        instance = new MsgService(bot, options);
        return instance;
    },
    get: () => {
        if (!instance) throw new Error('MsgService not initialized');
        return instance;
    },
};
