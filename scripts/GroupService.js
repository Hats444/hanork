'use strict';

const logger = require('../config/logger');
const { withSqliteRetry } = require('../utils/sqliteRetry');
const { isBlockedGroupContent, analyzeGroupContent } = require('./groupContentFilter');
const { getSalesRefChannelId, isSalesRefChannel } = require('../config/salesReferenceChannel');

const STRIKE_KEY_PREFIX = 'promo_strike:';
const BRIDGE_PIN_PREFIX = 'bridge_pin:';
const STRIKE_MAX_PERMISSION = Math.max(1, parseInt(process.env.PROMO_STRIKE_MAX_PERMISSION || '2', 10));
const STRIKE_MAX_FLOOD = Math.max(2, parseInt(process.env.PROMO_STRIKE_MAX_FLOOD || '3', 10));

const GROUP_TYPES = new Set(['group', 'supergroup']);
const CHANNEL_TYPE = 'channel';

/**
 * Grupos + canais Telegram (telegram_groups) — sync, alvos de divulgação.
 */
class GroupService {
    constructor({ dbRaw, groupSettings, bot, adminActivityNotifier = null }) {
        this.dbRaw = dbRaw;
        this.settings = groupSettings;
        this.bot = bot;
        this.adminActivityNotifier = adminActivityNotifier;
    }

    _humanizePromoReason(reason = '') {
        const r = String(reason || '').toUpperCase();
        if (r.includes('CHAT_WRITE_FORBIDDEN') || r.includes('WRITE_FORBIDDEN')) {
            return 'grupo só permite mensagens de administradores (membros não podem postar)';
        }
        if (r.includes('CHAT_ADMIN_REQUIRED')) {
            return 'precisa ser administrador para enviar mensagens';
        }
        if (r.includes('USER_BANNED')) {
            return 'conta banida ou restrita neste grupo';
        }
        if (r.includes('FLOOD')) {
            return 'limite de envio do Telegram (FLOOD)';
        }
        return String(reason || 'sem permissão').slice(0, 120);
    }

    _notifyBridge(level, message) {
        try {
            this.adminActivityNotifier?.notifyCritical?.('Ponte Telegram', message, level);
        } catch {
            /* ignore */
        }
    }

    pinBridgeGroup(chatId, source = 'admin') {
        if (!chatId) return;
        try {
            this._db()
                .prepare(
                    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
                )
                .run(
                    `${BRIDGE_PIN_PREFIX}${String(chatId)}`,
                    JSON.stringify({ at: Date.now(), source: String(source).slice(0, 40) })
                );
        } catch {
            /* ignore */
        }
    }

    isBridgePinned(chatId) {
        if (!chatId) return false;
        try {
            const row = this._db()
                .prepare('SELECT 1 FROM kv_store WHERE key=?')
                .get(`${BRIDGE_PIN_PREFIX}${String(chatId)}`);
            return !!row;
        } catch {
            return false;
        }
    }

    unpinBridgeGroup(chatId) {
        if (!chatId) return;
        try {
            this._db()
                .prepare('DELETE FROM kv_store WHERE key=?')
                .run(`${BRIDGE_PIN_PREFIX}${String(chatId)}`);
        } catch {
            /* ignore */
        }
    }

    _db() {
        return this.dbRaw();
    }

    /** Exclui @hanorkinfos (referências) dos alvos de divulgação automática. */
    _salesRefExcludeSql(column = 'chat_id') {
        const id = getSalesRefChannelId();
        if (!id) return { clause: '', param: null };
        return { clause: ` AND ${column} != ?`, param: id };
    }

    /** Garante broadcast_enabled=0 no canal de referências. */
    excludeSalesRefFromAutoBroadcast() {
        const id = getSalesRefChannelId();
        if (!id) return false;
        try {
            const r = this._db()
                .prepare(
                    `UPDATE telegram_groups SET broadcast_enabled=0, updated_at=datetime('now') WHERE chat_id=?`
                )
                .run(id);
            if (r.changes > 0) {
                logger.info('[GroupService] canal referências: divulgação automática OFF', { chatId: id });
            }
            return true;
        } catch (e) {
            logger.warn('[GroupService] excludeSalesRefFromAutoBroadcast:', e.message);
            return false;
        }
    }

    _groupTypeFilterSql() {
        return `type IN ('group', 'supergroup')`;
    }

    _strikeKey(chatId) {
        return `${STRIKE_KEY_PREFIX}${String(chatId)}`;
    }

    _readStrike(chatId) {
        try {
            const row = this._db().prepare('SELECT value FROM kv_store WHERE key=?').get(this._strikeKey(chatId));
            if (!row?.value) return { count: 0, reasons: [] };
            const parsed = JSON.parse(row.value);
            return {
                count: Number(parsed.count) || 0,
                reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
            };
        } catch {
            return { count: 0, reasons: [] };
        }
    }

    _writeStrike(chatId, data) {
        this._db()
            .prepare(
                `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
            )
            .run(this._strikeKey(chatId), JSON.stringify(data));
    }

    _clearStrike(chatId) {
        this._db().prepare('DELETE FROM kv_store WHERE key=?').run(this._strikeKey(chatId));
    }

    /** Desativa divulgação bot (grupo com bot membro). */
    disableBotGroupPromo(chatId, reason = '') {
        if (!chatId) return;
        try {
            withSqliteRetry(() => {
                this._db()
                    .prepare(
                        `UPDATE telegram_groups SET broadcast_enabled=0, updated_at=datetime('now') WHERE chat_id=?`
                    )
                    .run(String(chatId));
            });
            logger.warn(
                `[GroupService] divulgação pausada ${chatId}${reason ? `: ${reason}` : ''}`
            );
        } catch (e) {
            logger.warn('[GroupService] disableBotGroupPromo:', e.message);
        }
    }

    /** Falhas repetidas de envio → pausa divulgação; permissão → sai mais cedo. */
    recordPromoFailure(chatId, reason = '', opts = {}) {
        if (!chatId) return { evicted: false, strikes: 0 };
        const detail = String(reason || '');
        const isPermission =
            /write_forbidden|sem permiss|no rights|not enough rights|chat_write|CHAT_WRITE|blocked/i.test(
                detail
            );
        const isFlood = /\bflood\b/i.test(detail);
        const threshold = isPermission
            ? STRIKE_MAX_PERMISSION
            : isFlood
              ? STRIKE_MAX_FLOOD
              : Math.max(3, parseInt(process.env.PROMO_STRIKE_MAX_OTHER || '4', 10));

        const prev = this._readStrike(chatId);
        const next = {
            count: prev.count + 1,
            reasons: [...prev.reasons, detail.slice(0, 120)].slice(-6),
            lastAt: Date.now(),
        };

        if (next.count >= threshold) {
            this._clearStrike(chatId);
            if (opts.bridge) {
                const title = opts.title || String(chatId);
                const human = this._humanizePromoReason(detail);
                if (this.isBridgePinned(chatId)) {
                    this.disableBridgePromoSend(chatId, detail.slice(0, 80));
                    this._notifyBridge(
                        'warn',
                        `«${title}» — divulgação pausada (entrada manual): ${human}. A conta permanece no grupo. Libere mensagens de membros ou promova a conta para divulgar.`
                    );
                    return { evicted: false, strikes: next.count, threshold, paused: true, pinned: true };
                }
                this._notifyBridge(
                    'warn',
                    `Saiu de «${title}» após ${next.count} falha(s): ${human}. O grupo não permite que a conta divulgue por mensagem.`
                );
                this.removeBridgePromoGroup(chatId, `strikes_${next.count}: ${detail.slice(0, 80)}`, {
                    skipNotify: true,
                });
            } else {
                this.disableBotGroupPromo(chatId, `strikes_${next.count}: ${detail.slice(0, 80)}`);
                if (opts.leaveBot !== false && this.bot?.telegram?.leaveChat) {
                    this.bot.telegram.leaveChat(Number(chatId)).catch(() => {});
                }
            }
            try {
                const OpsMetricsStore = require('./ops/OpsMetricsStore');
                OpsMetricsStore.record(this._db(), {
                    channel: opts.bridge ? 'tg_bridge' : 'tg',
                    kind: 'fail',
                    target: opts.title || String(chatId),
                    detail: detail.slice(0, 240),
                    countermeasure: opts.bridge
                        ? 'removido da ponte após strikes'
                        : 'promo desativada + bot saiu',
                });
            } catch {
                /* ignore */
            }
            return { evicted: true, strikes: next.count, threshold };
        }

        this._writeStrike(chatId, next);
        if (isPermission && opts.bridge && next.count === 1) {
            const title = opts.title || String(chatId);
            const human = this._humanizePromoReason(detail);
            const pinNote = this.isBridgePinned(chatId)
                ? ' (entrada manual — não sai automaticamente)'
                : ` — na ${threshold}ª falha sai do grupo`;
            this._notifyBridge(
                'warn',
                `«${title}»: não consegui divulgar — ${human}. Strike 1/${threshold}${pinNote}.`
            );
        }
        try {
            const OpsMetricsStore = require('./ops/OpsMetricsStore');
            OpsMetricsStore.record(this._db(), {
                channel: opts.bridge ? 'tg_bridge' : 'tg',
                kind: 'retry',
                target: opts.title || String(chatId),
                detail: detail.slice(0, 240),
                countermeasure: `strike ${next.count}/${threshold}`,
            });
        } catch {
            /* ignore */
        }
        return { evicted: false, strikes: next.count, threshold };
    }

    /** Remove alvos adulto/spam da rotação e desativa no DB. */
    _sanitizeBroadcastRows(rows, { bridge = false } = {}) {
        const safe = [];
        for (const g of rows) {
            const block = analyzeGroupContent({ title: g.title, username: g.username, channel: 'tg' });
            if (block.blocked) {
                if (bridge) {
                    this.removeBridgePromoGroup(g.chat_id, block.reason);
                } else {
                    this.disableBotGroupPromo(g.chat_id, block.reason);
                }
                logger.warn(
                    `[GroupService] filtro conteúdo — removido ${g.title || g.chat_id} (${block.reason})`
                );
                continue;
            }
            safe.push(g);
        }
        return safe;
    }

    /** Alvos de divulgação em grupos (comportamento legado). */
    getBroadcastTargets() {
        return this.getGroupBroadcastTargets();
    }

  _broadcastRequireAdminOnly() {
        const env = String(process.env.BROADCAST_REQUIRE_ADMIN || '').toLowerCase();
        if (env === '1' || env === 'true' || env === 'yes') return true;
        if (env === '0' || env === 'false' || env === 'no') return false;
        return this.settings.isRequireAdmin();
    }

    /**
     * Grupos para divulgação.
     * Padrão: admin + membro comum (não precisa ler mensagens — só enviar).
     * BROADCAST_REQUIRE_ADMIN=true no .env restringe só a admin.
     */
    getGroupBroadcastTargets() {
        const db = this._db();
        const base = `active=1 AND COALESCE(broadcast_enabled, 1)=1 AND ${this._groupTypeFilterSql()}`;
        const ex = this._salesRefExcludeSql('chat_id');
        if (this._broadcastRequireAdminOnly()) {
            return this._sanitizeBroadcastRows(
                db
                    .prepare(
                        `SELECT chat_id, title, type, bot_is_admin FROM telegram_groups
                     WHERE ${base} AND bot_is_admin=1 AND COALESCE(promo_via_bridge, 0)=0${ex.clause}
                     ORDER BY updated_at DESC`
                    )
                    .all(...(ex.param ? [ex.param] : []))
            );
        }
        return this._sanitizeBroadcastRows(
            db
                .prepare(
                    `SELECT chat_id, title, type, bot_is_admin, username FROM telegram_groups
                 WHERE ${base} AND COALESCE(promo_via_bridge, 0)=0${ex.clause}
                 ORDER BY bot_is_admin DESC, updated_at DESC`
                )
                .all(...(ex.param ? [ex.param] : []))
        );
    }

    /** Grupos onde só a conta MTProto divulga (bot não entrou). */
    getBridgePromoTargets() {
        this.repairBridgePromoGroups();
        return this._sanitizeBroadcastRows(
            this._db()
                .prepare(
                    `SELECT chat_id, title, type, username, bot_is_admin FROM telegram_groups
                 WHERE active=1 AND COALESCE(broadcast_enabled, 1)=1
                   AND COALESCE(promo_via_bridge, 0)=1
                   AND ${this._groupTypeFilterSql()}
                 ORDER BY updated_at DESC`
                )
                .all(),
            { bridge: true }
        );
    }

    /** Corrige alvos ponte inválidos (canais broadcast salvos por engano). */
    repairBridgePromoGroups() {
        try {
            withSqliteRetry(() => {
                const db = this._db();
                const r = db
                    .prepare(
                        `UPDATE telegram_groups SET broadcast_enabled=0, updated_at=datetime('now')
                     WHERE COALESCE(promo_via_bridge, 0)=1 AND type='channel'`
                    )
                    .run();
                if (r.changes > 0) {
                    logger.info(`[GroupService] ponte: ${r.changes} canal(is) broadcast pausado(s)`);
                }
            });
        } catch (e) {
            logger.warn('[GroupService] repairBridgePromo:', e.message);
        }
    }

    /** Desativa divulgação ponte (sem permissão de envio ou erro permanente). */
    disableBridgePromoSend(chatId, reason = '') {
        if (!chatId) return;
        try {
            withSqliteRetry(() => {
                this._db()
                    .prepare(
                        `UPDATE telegram_groups SET broadcast_enabled=0, updated_at=datetime('now') WHERE chat_id=?`
                    )
                    .run(String(chatId));
            });
            logger.warn(
                `[GroupService] ponte promo pausada ${chatId}${reason ? `: ${reason}` : ''}`
            );
        } catch (e) {
            logger.warn('[GroupService] disableBridgePromoSend:', e.message);
        }
    }

    /** Remove grupo ponte — DB + slot promo. */
    removeBridgePromoGroup(chatId, reason = '', opts = {}) {
        if (!chatId) return;
        try {
            const db = this._db();
            const row = db
                .prepare('SELECT title FROM telegram_groups WHERE chat_id=?')
                .get(String(chatId));
            db.prepare(
                `UPDATE telegram_groups SET active=0, promo_via_bridge=0, broadcast_enabled=0,
                 updated_at=datetime('now') WHERE chat_id=?`
            ).run(String(chatId));
            db.prepare('DELETE FROM kv_store WHERE key=?').run(`bridge_promo_slot:${String(chatId)}`);
            this.unpinBridgeGroup(chatId);
            logger.info(
                `[GroupService] ponte removido ${chatId}${reason ? `: ${reason}` : ''}`
            );
            if (!opts.skipNotify && reason) {
                const title = row?.title || chatId;
                this._notifyBridge(
                    'warn',
                    `Grupo ponte removido: «${title}» — ${this._humanizePromoReason(reason)}`
                );
            }
        } catch (e) {
            logger.warn('[GroupService] removeBridgePromo:', e.message);
        }
    }

    updateBridgeMemberCount(chatId, count) {
        if (!chatId || !Number.isFinite(count)) return;
        try {
            this._db()
                .prepare(
                    `UPDATE telegram_groups SET member_count=?, updated_at=datetime('now') WHERE chat_id=?`
                )
                .run(Math.floor(count), String(chatId));
        } catch {
            /* ignore */
        }
    }

    /** Marca grupo para divulgação via ponte (conta conectada). Respeita cap externo (BridgePool). */
    upsertBridgePromoGroup(chat, memberCount = null) {
        if (!chat?.id) return false;
        const type = chat.type;
        if (type === 'channel') {
            logger.warn(
                `[GroupService] ponte promo ignorado: canal broadcast ${chat.title || chat.id} — só admins postam`
            );
            return false;
        }
        if (!GROUP_TYPES.has(type)) {
            logger.warn(`[GroupService] ponte promo ignorado: tipo ${chat.type} id ${chat.id}`);
            return false;
        }
        try {
            const db = this._db();
            const mc = memberCount != null ? Math.floor(memberCount) : null;
            db.prepare(
                `INSERT INTO telegram_groups (chat_id, title, type, username, member_count, bot_is_admin, broadcast_enabled, promo_via_bridge, updated_at)
                 VALUES (?, ?, ?, ?, ?, 0, 1, 1, datetime('now'))
                 ON CONFLICT(chat_id) DO UPDATE SET
                    title=excluded.title, type=excluded.type,
                    username=excluded.username, promo_via_bridge=1,
                    member_count=COALESCE(excluded.member_count, telegram_groups.member_count),
                    active=1, broadcast_enabled=1, updated_at=datetime('now')`
            ).run(
                String(chat.id),
                chat.title || 'Grupo',
                type,
                chat.username || null,
                mc
            );
            logger.info(`[GroupService] ponte promo: ${chat.title || chat.id} (bot ausente${mc ? `, ${mc} membros` : ''})`);
            return true;
        } catch (e) {
            logger.warn('[GroupService] upsertBridgePromo:', e.message);
            return false;
        }
    }

    /** Remove grupo da divulgação ponte (bot passa a ser o único canal, se estiver no grupo). */
    clearBridgePromo(chatId) {
        try {
            this._db()
                .prepare(
                    `UPDATE telegram_groups SET promo_via_bridge=0, updated_at=datetime('now') WHERE chat_id=?`
                )
                .run(String(chatId));
        } catch {
            /* ignore */
        }
    }

    countBridgePromoGroups() {
        this.repairBridgePromoGroups();
        return (
            this._db()
                .prepare(
                    `SELECT COUNT(*) as c FROM telegram_groups
                     WHERE active=1 AND COALESCE(promo_via_bridge,0)=1
                       AND COALESCE(broadcast_enabled,1)=1`
                )
                .get()?.c || 0
        );
    }

    listBridgePromoGroups(limit = 12, offset = 0) {
        this.repairBridgePromoGroups();
        return this._db()
            .prepare(
                `SELECT chat_id, title, type, username, member_count, bot_is_admin, broadcast_enabled,
                        COALESCE(promo_via_bridge,0) as promo_via_bridge, updated_at
                 FROM telegram_groups
                 WHERE active=1 AND COALESCE(promo_via_bridge,0)=1
                 ORDER BY COALESCE(member_count,0) DESC, updated_at DESC
                 LIMIT ? OFFSET ?`
            )
            .all(limit, offset);
    }

    getGroupRow(chatId) {
        return this._db()
            .prepare(
                `SELECT chat_id, title, type, username, bot_is_admin, broadcast_enabled,
                        COALESCE(promo_via_bridge,0) as promo_via_bridge
                 FROM telegram_groups WHERE chat_id=?`
            )
            .get(String(chatId));
    }

    /** Canais exigem bot administrador com permissão de postar. */
    getChannelBroadcastTargets() {
        const ex = this._salesRefExcludeSql('chat_id');
        return this._db()
            .prepare(
                `SELECT chat_id, title, type, bot_is_admin FROM telegram_groups
                 WHERE active=1 AND type='channel' AND bot_is_admin=1
                   AND COALESCE(broadcast_enabled, 1)=1${ex.clause}
                 ORDER BY updated_at DESC`
            )
            .all(...(ex.param ? [ex.param] : []));
    }

    listActiveGroups(limit = 30) {
        return this._db()
            .prepare(
                `SELECT * FROM telegram_groups WHERE active=1 AND ${this._groupTypeFilterSql()}
                 ORDER BY updated_at DESC LIMIT ?`
            )
            .all(limit);
    }

    listActiveChannels(limit = 30) {
        return this._db()
            .prepare(
                `SELECT * FROM telegram_groups WHERE active=1 AND type='channel'
                 ORDER BY updated_at DESC LIMIT ?`
            )
            .all(limit);
    }

    listAllBroadcastDestinations(limit = 40) {
        return this._db()
            .prepare(
                `SELECT * FROM telegram_groups WHERE active=1
                 ORDER BY type DESC, updated_at DESC LIMIT ?`
            )
            .all(limit);
    }

    isChannel(chat) {
        return chat?.type === CHANNEL_TYPE;
    }

    isGroup(chat) {
        return GROUP_TYPES.has(chat?.type);
    }

    isBroadcastDestination(chat) {
        return this.isGroup(chat) || this.isChannel(chat);
    }

    setBroadcastEnabled(chatId, enabled) {
        if (enabled && isSalesRefChannel(chatId)) {
            logger.info('[GroupService] canal referências: divulgação permanece OFF', { chatId });
            this._db()
                .prepare(
                    `UPDATE telegram_groups SET broadcast_enabled=0, updated_at=datetime('now') WHERE chat_id=?`
                )
                .run(String(chatId));
            return false;
        }
        this._db()
            .prepare(
                `UPDATE telegram_groups SET broadcast_enabled=?, updated_at=datetime('now') WHERE chat_id=?`
            )
            .run(enabled ? 1 : 0, String(chatId));
        return true;
    }

    toggleBroadcastEnabled(chatId) {
        if (isSalesRefChannel(chatId)) {
            this.setBroadcastEnabled(chatId, false);
            return false;
        }
        const row = this._db()
            .prepare('SELECT broadcast_enabled FROM telegram_groups WHERE chat_id=?')
            .get(String(chatId));
        const next = row ? (row.broadcast_enabled === 0 ? 1 : 0) : 1;
        this.setBroadcastEnabled(chatId, next === 1);
        return next === 1;
    }

    upsertGroup(chat, botIsAdmin = 0) {
        if (!chat?.id || !this.isBroadcastDestination(chat)) return;
        const block = analyzeGroupContent({
            title: chat.title,
            username: chat.username,
            channel: 'tg',
        });
        if (block.blocked) {
            logger.warn(
                `[GroupService] cadastro bloqueado +18: ${chat.title || chat.id} (${block.reason})`
            );
            this.disableBotGroupPromo(chat.id, block.reason);
            return;
        }
        try {
            const db = this._db();
            const defaultTitle = this.isChannel(chat) ? 'Canal' : 'Grupo';
            db.prepare(
                `INSERT INTO telegram_groups (chat_id, title, type, username, bot_is_admin, broadcast_enabled, updated_at)
                 VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
                 ON CONFLICT(chat_id) DO UPDATE SET
                    title=excluded.title, type=excluded.type,
                    username=excluded.username, bot_is_admin=excluded.bot_is_admin,
                    updated_at=datetime('now'), active=1`
            ).run(
                String(chat.id),
                chat.title || defaultTitle,
                chat.type,
                chat.username || null,
                botIsAdmin ? 1 : 0
            );
            if (this.isChannel(chat)) {
                logger.info(`[Channel] cadastrado: ${chat.title || chat.id} (admin=${botIsAdmin ? 1 : 0})`);
            }
        } catch (e) {
            logger.warn('[GroupService] upsert:', e.message);
        }
    }

    /** Registra canal pelo ID (admin no PV). */
    async registerChannelById(chatIdRaw) {
        const chatId = String(chatIdRaw).trim();
        const chat = await this.bot.telegram.getChat(chatId);
        if (chat.type !== CHANNEL_TYPE) {
            throw new Error('Este ID não é um canal Telegram.');
        }
        const me = await this.bot.telegram.getMe();
        const member = await this.bot.telegram.getChatMember(chat.id, me.id);
        if (!['administrator', 'creator'].includes(member.status)) {
            throw new Error('O bot precisa ser administrador do canal com permissão de publicar.');
        }
        if (member.can_post_messages === false) {
            throw new Error('O bot não tem permissão de publicar mensagens neste canal.');
        }
        this.upsertGroup(chat, 1);
        return chat;
    }

    async refreshBotStatusInChat(chatId) {
        const me = await this.bot.telegram.getMe();
        const member = await this.bot.telegram.getChatMember(chatId, me.id);
        let isAdmin = ['administrator', 'creator'].includes(member.status) ? 1 : 0;
        const active = !['left', 'kicked'].includes(member.status) ? 1 : 0;
        const row = this._db().prepare('SELECT type FROM telegram_groups WHERE chat_id=?').get(String(chatId));
        if (row?.type === CHANNEL_TYPE && member.status === 'administrator' && member.can_post_messages === false) {
            isAdmin = 0;
        }
        withSqliteRetry(() => {
            this._db()
                .prepare(
                    `UPDATE telegram_groups SET bot_is_admin=?, active=?, updated_at=datetime('now') WHERE chat_id=?`
                )
                .run(isAdmin, active, String(chatId));
        });
        return {
            isAdmin: !!isAdmin,
            active: !!active,
            status: member.status,
            canPost: member.can_post_messages !== false,
        };
    }

    _isBotGoneError(err) {
        const msg = String(err?.message || err?.description || '').toLowerCase();
        return (
            msg.includes('chat not found') ||
            msg.includes('bot was kicked') ||
            msg.includes('bot is not a member') ||
            msg.includes('user is deactivated') ||
            msg.includes('group chat was upgraded') ||
            msg.includes('have no rights')
        );
    }

    async syncAllGroups() {
        const db = this._db();
        const groups = db
            .prepare('SELECT chat_id, title, type FROM telegram_groups WHERE active=1')
            .all();
        const me = await this.bot.telegram.getMe();
        let ok = 0;
        let failed = 0;
        let withAdmin = 0;
        let members = 0;

        for (const g of groups) {
            try {
                const promoRow = db
                    .prepare('SELECT COALESCE(promo_via_bridge,0) as promo FROM telegram_groups WHERE chat_id=?')
                    .get(String(g.chat_id));
                if (promoRow?.promo === 1) {
                    withSqliteRetry(() => {
                        db.prepare(
                            `UPDATE telegram_groups SET bot_is_admin=0, active=1, updated_at=datetime('now') WHERE chat_id=?`
                        ).run(g.chat_id);
                    });
                    ok++;
                    continue;
                }

                const member = await this.bot.telegram.getChatMember(g.chat_id, me.id);
                const isChannel = g.type === CHANNEL_TYPE;
                let isAdmin = ['administrator', 'creator'].includes(member.status) ? 1 : 0;
                const isMember = ['member', 'administrator', 'creator', 'restricted'].includes(member.status);
                const active = isMember && !['left', 'kicked'].includes(member.status) ? 1 : 0;

                if (isChannel) {
                    if (member.status === 'administrator' && member.can_post_messages === false) {
                        isAdmin = 0;
                    }
                    if (!['administrator', 'creator'].includes(member.status)) {
                        isAdmin = 0;
                    }
                } else if (member.status === 'restricted' && member.can_send_messages === false) {
                    isAdmin = 0;
                }

                withSqliteRetry(() => {
                    db.prepare(
                        `UPDATE telegram_groups SET bot_is_admin=?, active=?, updated_at=datetime('now') WHERE chat_id=?`
                    ).run(isAdmin, active, g.chat_id);
                });
                if (active) {
                    ok++;
                    if (isAdmin) withAdmin++;
                    else members++;
                }
            } catch (e) {
                if (this._isBotGoneError(e)) {
                    withSqliteRetry(() => {
                        db.prepare(
                            `UPDATE telegram_groups SET active=0, updated_at=datetime('now') WHERE chat_id=?`
                        ).run(g.chat_id);
                    });
                } else {
                    logger.warn(`[GroupService] sync ${g.chat_id} (${g.title}): ${e.message}`);
                }
                failed++;
            }
            await new Promise((r) => setTimeout(r, 100));
        }

        return { total: groups.length, ok, failed, withAdmin, members };
    }

    getStats() {
        const db = this._db();
        this.repairBridgePromoGroups();
        const groupTargets = this.getGroupBroadcastTargets().length;
        const channelTargets = this.getChannelBroadcastTargets().length;
        const bridgeTargets = this.getBridgePromoTargets().length;
        return {
            total: db.prepare(`SELECT COUNT(*) as c FROM telegram_groups WHERE active=1 AND ${this._groupTypeFilterSql()}`).get()?.c || 0,
            admin: db.prepare(`SELECT COUNT(*) as c FROM telegram_groups WHERE active=1 AND ${this._groupTypeFilterSql()} AND bot_is_admin=1`).get()?.c || 0,
            channels: db.prepare("SELECT COUNT(*) as c FROM telegram_groups WHERE active=1 AND type='channel'").get()?.c || 0,
            channelsAdmin: db.prepare("SELECT COUNT(*) as c FROM telegram_groups WHERE active=1 AND type='channel' AND bot_is_admin=1").get()?.c || 0,
            bridgePromo: db
                .prepare(
                    'SELECT COUNT(*) as c FROM telegram_groups WHERE active=1 AND COALESCE(promo_via_bridge,0)=1'
                )
                .get()?.c || 0,
            bridgeTargets,
            broadcastOn: db
                .prepare(
                    'SELECT COUNT(*) as c FROM telegram_groups WHERE active=1 AND COALESCE(broadcast_enabled,1)=1'
                )
                .get()?.c || 0,
            targets: groupTargets,
            channelTargets,
            allTargets: groupTargets + channelTargets + bridgeTargets,
        };
    }
}

module.exports = { GroupService };
