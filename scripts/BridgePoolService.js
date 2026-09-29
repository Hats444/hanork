'use strict';

/**
 * Pool automático de grupos ponte MTProto — máx 30, mín 50 membros, fila persistente.
 * Ranking/upgrade alinhado ao Zero Divu (melhores grupos, sai só com substituto maior).
 */
const logger = require('../config/logger');
const { formatErrorReason } = require('../utils/formatErrorReason');
const { analyzeGroupContent } = require('./groupContentFilter');
const bridgeQuality = require('./bridgeGroupQuality');
const {
    normalizeInviteLink,
    isPrivateInviteLink,
    isPrivateCLink,
    extractBridgePoolLinks,
    isLikelyGroupUsername,
    isPublicPoolUsernameLink,
    isAutoPoolInviteLink,
} = require('./inviteLinkUtils');

const MAX_GROUPS = Math.max(1, parseInt(process.env.BRIDGE_PROMO_MAX || '30', 10));
const MIN_MEMBERS = Math.max(1, parseInt(process.env.BRIDGE_PROMO_MIN_MEMBERS || '50', 10));
const MAINT_INTERVAL_MS = Math.max(60000, parseInt(process.env.BRIDGE_POOL_MAINT_MS || '900000', 10));
const MAX_LINKS_PER_MSG = Math.max(1, parseInt(process.env.BRIDGE_POOL_MAX_LINKS_PER_MSG || '5', 10));
const PROCESS_DEBOUNCE_MS = Math.max(2000, parseInt(process.env.BRIDGE_POOL_DEBOUNCE_MS || '8000', 10));

function normalizePoolLink(link) {
    const s = String(link || '').trim();
    if (!s) return '';
    if (isPrivateInviteLink(s)) return normalizeInviteLink(s);
    return s;
}

function isAdminPoolSource(source) {
    return String(source || '').startsWith('admin_pv');
}

function isPermanentFailReason(reason) {
    const r = String(reason || '').toLowerCase();
    return (
        r.includes('username_invalid') ||
        r.includes('username_not_occupied') ||
        r.includes('no user has') ||
        r.includes('inputpeeruser') ||
        r.includes('não é um grupo') ||
        r.includes('nao e um grupo') ||
        r.includes('bot/canal') ||
        r.includes('legacy_public') ||
        r.includes('auto_pool') ||
        r.includes('spam_word') ||
        r.includes('stars_payment_required') ||
        r.includes('allow_payment_required') ||
        r.includes('conteudo_adulto') ||
        r.includes('filtro_conteudo')
    );
}

function isExpectedPoolFailReason(reason) {
    const r = String(reason || '').toLowerCase();
    return (
        isPermanentFailReason(reason) ||
        r.includes('membros_insuficientes') ||
        r.includes('nao_e_grupo') ||
        r.includes('sem_permissao') ||
        r.includes('chat not found') ||
        r.includes('nao achei') ||
        r.includes('stars_payment_required') ||
        r.includes('allow_payment_required') ||
        r.includes('invite_hash_expired') ||
        r.includes('invite_hash_invalid') ||
        r.includes('[object object]')
    );
}

class BridgePoolService {
    constructor({ dbRaw, groupService, telegram, getBotUsername, adminActivityNotifier } = {}) {
        this.dbRaw = dbRaw;
        this.groupService = groupService;
        this.telegram = telegram;
        this.getBotUsername = getBotUsername || (async () => process.env.BOT_USERNAME || '');
        this._adminNotifier = adminActivityNotifier || null;
        this._processing = false;
        this._maintTimer = null;
        this._watcherStarted = false;
        this._processTimer = null;
        this._lastWatchAt = new Map();
    }

    _db() {
        return typeof this.dbRaw === 'function' ? this.dbRaw() : null;
    }

    _bridge() {
        try {
            return require('./TelegramUserBridge');
        } catch {
            return null;
        }
    }

    _poolNotify(message, level = 'info') {
        try {
            this._adminNotifier?.notifySystem?.('Ponte Telegram', message, level);
        } catch {
            /* ignore */
        }
    }

    maxGroups() {
        return MAX_GROUPS;
    }

    minMembers() {
        return MIN_MEMBERS;
    }

    getActiveCount() {
        return this.groupService?.countBridgePromoGroups?.() || 0;
    }

    hasCapacity() {
        return this.getActiveCount() < MAX_GROUPS;
    }

    _listBridgeGroupsForQuality() {
        return this.groupService?.listBridgePromoGroups?.(MAX_GROUPS + 20, 0) || [];
    }

    async _resolveInvitePreview(link) {
        const bridge = this._bridge();
        if (!bridge?.precheckInvite || !isPrivateInviteLink(link)) {
            return { size: 0, title: null };
        }
        try {
            const pre = await bridge.precheckInvite(link);
            if (!pre?.ok) return { size: 0, title: pre?.title || null };
            return {
                size: Number(pre.participantsCount || 0),
                title: pre.title || null,
            };
        } catch {
            return { size: 0, title: null };
        }
    }

    _parseJoinedAtMs(updatedAt) {
        if (!updatedAt) return 0;
        const t = Date.parse(String(updatedAt).replace(' ', 'T') + 'Z');
        return Number.isFinite(t) ? t : 0;
    }

    async _pickWeakestBridgeGroup() {
        const groups = this._listBridgeGroupsForQuality();
        const bridge = this._bridge();
        const enriched = [];
        for (const g of groups) {
            let mem = Number(g.member_count || 0);
            if (bridge?.getChatMemberCount && g.chat_id) {
                try {
                    const gramChat = {
                        id: Number(g.chat_id),
                        title: g.title,
                        type: g.type,
                        username: g.username,
                    };
                    const live = await bridge.getChatMemberCount(gramChat);
                    if (live > 0) mem = live;
                } catch {
                    /* use DB */
                }
            }
            enriched.push({ ...g, member_count: mem, active: 1 });
        }
        return bridgeQuality.pickSmallestBridgeGroup(enriched);
    }

    /**
     * Pool cheio: sai do menor grupo só se o convite for claramente melhor (mesma regra do WA).
     * @returns {boolean} true se liberou vaga
     */
    async _tryUpgradeForInvite(inviteInfo) {
        if (!bridgeQuality.ENABLE_UPGRADE) return false;
        const inviteSize = Number(inviteInfo?.size || inviteInfo?.participantsCount || 0);
        const min = bridgeQuality.minMembers();
        if (inviteSize > 0 && inviteSize < min) {
            logger.debug(
                `[BridgePool] Convite ignorado (${inviteSize} < ${min} membros): ${inviteInfo?.title || inviteInfo?.link || '?'}`
            );
            return false;
        }

        const weakest = await this._pickWeakestBridgeGroup();
        if (!weakest) return false;

        const weakestRecord = { ...weakest, member_count: weakest.size ?? weakest.member_count };
        if (!bridgeQuality.shouldVacateForInvite(weakestRecord, inviteInfo)) return false;

        try {
            const churn = require('./bridgeChurnGuard');
            const joinedAt = this._parseJoinedAtMs(weakest.updated_at);
            const vacateGate = churn.canVacateForUpgrade(joinedAt);
            if (!vacateGate.ok) {
                logger.info(
                    `[BridgePool] Upgrade adiado ~${vacateGate.remainingMin} min — ${weakest.title || weakest.chat_id}`
                );
                return false;
            }
        } catch {
            /* ignore */
        }

        const gramChat = {
            id: Number(weakest.chat_id),
            title: weakest.title,
            type: weakest.type,
            username: weakest.username,
        };
        logger.info(
            `[BridgePool] Upgrade: saindo de «${weakest.title || weakest.chat_id}» (${weakest.size ?? weakest.member_count} membros) → convite ~${inviteSize || '?'}`
        );
        await this.rejectAndLeave(gramChat, 'substituido_por_grupo_maior');
        this._poolNotify(
            `Upgrade ponte: saiu de «${weakest.title || weakest.chat_id}» (${weakest.size} membros) para grupo maior (~${inviteSize})`,
            'info'
        );
        return this.hasCapacity();
    }

    /** Remove spam e @públicos legados (pool automático só processa convites). */
    purgeSpamQueue() {
        const db = this._db();
        if (!db) return 0;
        const pending = db
            .prepare(`SELECT id, link, source FROM bridge_join_queue WHERE status='pending'`)
            .all();
        let n = 0;
        for (const row of pending) {
            const link = row.link || '';
            const source = row.source || '';

            if (isPublicPoolUsernameLink(link) && !isAdminPoolSource(source)) {
                db.prepare(
                    `UPDATE bridge_join_queue SET status='failed', fail_reason='legacy_public',
                     updated_at=datetime('now') WHERE id=?`
                ).run(row.id);
                n++;
                continue;
            }

            if (isAutoPoolInviteLink(link)) continue;

            const slug = link
                .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '')
                .split(/[/?#]/)[0]
                .replace(/^@/, '');
            if (!slug || isLikelyGroupUsername(slug)) continue;
            db.prepare(
                `UPDATE bridge_join_queue SET status='failed', fail_reason='spam_word',
                 updated_at=datetime('now') WHERE id=?`
            ).run(row.id);
            n++;
        }
        if (n > 0) {
            logger.info(`[BridgePool] Fila limpa · ${n} link(s) inválido(s) removido(s)`);
        }
        return n;
    }

    /** Enfileira link (dedup por URL normalizada). */
    enqueueLink(link, source = '') {
        const db = this._db();
        if (!db) return false;
        const norm = normalizePoolLink(link);
        if (!norm) return false;
        if (isPublicPoolUsernameLink(norm) && !isAdminPoolSource(source)) return false;
        try {
            const existing = db
                .prepare('SELECT id, status, fail_reason FROM bridge_join_queue WHERE link=?')
                .get(norm);
            if (existing) {
                const canRetry =
                    (existing.status === 'failed' || existing.status === 'skipped') &&
                    !isPermanentFailReason(existing.fail_reason) &&
                    (isPrivateInviteLink(norm) || isPrivateCLink(norm));
                if (canRetry) {
                    db.prepare(
                        `UPDATE bridge_join_queue SET status='pending', source=?, fail_reason=NULL,
                         attempts=0, updated_at=datetime('now') WHERE id=?`
                    ).run(String(source || ''), existing.id);
                    return true;
                }
                return false;
            }
            db.prepare(
                `INSERT INTO bridge_join_queue (link, status, source, created_at, updated_at)
                 VALUES (?, 'pending', ?, datetime('now'), datetime('now'))`
            ).run(norm, String(source || ''));
            return true;
        } catch (e) {
            logger.warn('[BridgePool] Enfileirar falhou', { detail: e.message });
            return false;
        }
    }

    /** Links em texto (admin PV ou mensagem em grupo ponte). */
    handleIncomingText(text, { source = 'message', inviteOnly = false } = {}) {
        const links = extractBridgePoolLinks(String(text || ''), { inviteOnly }).slice(
            0,
            MAX_LINKS_PER_MSG
        );
        if (!links.length) return { queued: 0, links: [] };

        let queued = 0;
        const added = [];
        for (const l of links) {
            if (this.enqueueLink(l, source)) {
                queued++;
                added.push(l);
            }
        }
        if (queued > 0) {
            logger.info(
                `[BridgePool] +${queued} na fila · pool ${this.getActiveCount()}/${MAX_GROUPS}`,
                { links: added.slice(0, 3).map((x) => x.slice(0, 60)) }
            );
            this.scheduleProcess();
        }
        return { queued, links: added };
    }

    scheduleProcess() {
        if (this._processTimer) return;
        this._processTimer = setTimeout(() => {
            this._processTimer = null;
            this.processQueue().catch((e) =>
                logger.warn('[BridgePool] Processamento interrompido', { detail: e.message })
            );
        }, PROCESS_DEBOUNCE_MS);
    }

    _nextPendingLink() {
        const db = this._db();
        if (!db) return null;
        return db
            .prepare(
                `SELECT id, link, attempts, source FROM bridge_join_queue
                 WHERE status='pending'
                 ORDER BY
                   CASE WHEN link LIKE '%+%' OR link LIKE '%joinchat%' OR link LIKE '%/c/%' THEN 0 ELSE 1 END,
                   created_at ASC
                 LIMIT 1`
            )
            .get();
    }

    _setQueueStatus(id, status, { chatId = null, failReason = null, countAttempt = true } = {}) {
        const db = this._db();
        if (!db || !id) return;
        const attemptSql = countAttempt ? 'attempts=attempts+1,' : '';
        db.prepare(
            `UPDATE bridge_join_queue SET status=?, chat_id=?, fail_reason=?,
             ${attemptSql} updated_at=datetime('now') WHERE id=?`
        ).run(status, chatId ? String(chatId) : null, failReason, id);
    }

    async validateChatForPool(gramChat) {
        const bridge = this._bridge();
        if (!gramChat?.id || !bridge?.isConfigured?.()) {
            return { ok: false, reason: 'ponte_indisponivel', members: 0, canPost: false };
        }
        if (!['group', 'supergroup'].includes(gramChat.type)) {
            return { ok: false, reason: 'nao_e_grupo', members: 0, canPost: false };
        }
        const contentBlock = analyzeGroupContent({
            title: gramChat.title,
            username: gramChat.username,
            channel: 'tg',
        });
        if (contentBlock.blocked) {
            return {
                ok: false,
                reason: `conteudo_adulto: ${contentBlock.reason}`,
                members: 0,
                canPost: false,
            };
        }
        try {
            const members = await bridge.getChatMemberCount(gramChat);
            const canPost = await bridge.checkCanPostInChat(gramChat);
            if (members < MIN_MEMBERS) {
                return {
                    ok: false,
                    reason: `membros_insuficientes (${members}/${MIN_MEMBERS})`,
                    members,
                    canPost,
                };
            }
            if (!canPost) {
                return { ok: false, reason: 'sem_permissao_envio', members, canPost };
            }
            return { ok: true, members, canPost };
        } catch (e) {
            return { ok: false, reason: e.message || 'validacao_falhou', members: 0, canPost: false };
        }
    }

    async registerValidatedGroup(gramChat, memberCount) {
        if (!gramChat?.id) return { ok: false, reason: 'no_chat' };
        if (!this.hasCapacity()) {
            const upgraded = await this._tryUpgradeForInvite({
                size: memberCount,
                title: gramChat.title,
            });
            if (!upgraded && !this.hasCapacity()) {
                await this._leaveChatSafe(gramChat);
                return { ok: false, reason: 'pool_cheio' };
            }
        }
        this.groupService?.upsertBridgePromoGroup?.(gramChat, memberCount);
        return { ok: true };
    }

    async rejectAndLeave(gramChat, reason, link = null) {
        if (gramChat?.id) {
            await this._leaveChatSafe(gramChat);
            this.groupService?.removeBridgePromoGroup?.(gramChat.id, reason);
            try {
                require('./bridgeChurnGuard').recordLeave(this.dbRaw, {
                    chatId: gramChat.id,
                    link,
                    reason,
                });
            } catch {
                /* ignore */
            }
        }
        return { ok: false, reason };
    }

    async _leaveChatSafe(gramChat) {
        try {
            const bridge = this._bridge();
            if (bridge?.leaveChat) await bridge.leaveChat(gramChat);
        } catch (e) {
            logger.debug('[BridgePool] Sair do grupo ignorado', { detail: e.message });
        }
    }

    _formatLinkLabel(link) {
        const s = String(link || '');
        if (isPrivateInviteLink(s)) return 'convite +';
        if (isPrivateCLink(s)) return 'link privado';
        const slug = s.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '').split(/[/?#]/)[0];
        return slug ? `@${slug}` : s.slice(0, 40);
    }

    /** Entra + valida + registra ou sai (mesma lógica do /entrar). */
    async processOneLink(row) {
        const bridge = this._bridge();
        if (!bridge?.isConfigured?.()) {
            return { ok: false, reason: 'ponte_indisponivel' };
        }

        const link = row.link;
        const label = this._formatLinkLabel(link);
        this._setQueueStatus(row.id, 'processing');

        if (!this.hasCapacity()) {
            const preview = await this._resolveInvitePreview(link);
            const upgraded = await this._tryUpgradeForInvite({
                size: preview.size,
                title: preview.title,
                link,
            });
            if (!upgraded && !this.hasCapacity()) {
                this._setQueueStatus(row.id, 'pending', {
                    failReason: 'pool_cheio',
                    countAttempt: false,
                });
                return { ok: false, reason: 'pool_cheio' };
            }
        }

        try {
            const bridgeChurn = require('./bridgeChurnGuard');
            const gate = bridgeChurn.canJoin(this.dbRaw, { link });
            if (!gate.ok) {
                this._setQueueStatus(row.id, 'pending', {
                    failReason: `churn_cooldown_${gate.remainingMin}m`,
                    countAttempt: false,
                });
                bridgeChurn.logSkip(label, gate.remainingMin);
                return { ok: false, reason: 'churn_cooldown' };
            }
        } catch {
            /* ignore */
        }

        const fromAdmin = isAdminPoolSource(row.source);
        if (isPublicPoolUsernameLink(link) && !fromAdmin) {
            this._setQueueStatus(row.id, 'failed', { failReason: 'auto_pool_só_convite' });
            logger.debug(`[BridgePool] Ignorado · ${label} (automático só convites)`);
            return { ok: false, reason: 'auto_pool_só_convite' };
        }

        if (isPublicPoolUsernameLink(link)) {
            const slug = link
                .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '')
                .split(/[/?#]/)[0]
                .replace(/^@/, '');
            if (!isLikelyGroupUsername(slug)) {
                this._setQueueStatus(row.id, 'failed', { failReason: 'spam_word' });
                logger.debug(`[BridgePool] Ignorado · @${slug} (username inválido)`);
                return { ok: false, reason: 'spam_word' };
            }
            const slugBlock = analyzeGroupContent({ username: slug, title: slug, channel: 'tg' });
            if (slugBlock.blocked) {
                this._setQueueStatus(row.id, 'failed', {
                    failReason: `conteudo_adulto: ${slugBlock.reason}`,
                });
                logger.info(`[BridgePool] Ignorado · @${slug} (filtro +18: ${slugBlock.reason})`);
                return { ok: false, reason: slugBlock.reason };
            }
        }

        const preview = await this._resolveInvitePreview(link);
        if (preview.title) {
            const preBlock = analyzeGroupContent({ title: preview.title, channel: 'tg' });
            if (preBlock.blocked) {
                this._setQueueStatus(row.id, 'failed', {
                    failReason: `conteudo_adulto: ${preBlock.reason}`,
                });
                logger.info(
                    `[BridgePool] Ignorado · ${label} (filtro +18 antes de entrar: ${preBlock.reason})`
                );
                return { ok: false, reason: preBlock.reason };
            }
        }

        const { JoinChatService } = require('./JoinChatService');
        const joiner = new JoinChatService(this.telegram, this.groupService);
        let result;
        try {
            result = await joiner.joinOneForPool(link);
        } catch (e) {
            const reason = formatErrorReason(e?.message || e, 'erro_entrada');
            this._setQueueStatus(row.id, 'failed', { failReason: reason.slice(0, 200) });
            if (isExpectedPoolFailReason(reason)) {
                logger.debug(`[BridgePool] Entrada falhou · ${label}`, { detail: reason.slice(0, 120) });
            } else {
                logger.warn(`[BridgePool] Entrada falhou · ${label}`, { detail: reason.slice(0, 120) });
            }
            return { ok: false, reason };
        }

        const chat = result?.chat;
        if (!chat?.id) {
            const reason = formatErrorReason(
                result?.error || result?.hint || result,
                'entrada_falhou'
            ).slice(0, 200);
            this._setQueueStatus(row.id, 'failed', { failReason: reason });
            if (isExpectedPoolFailReason(reason)) {
                logger.debug(`[BridgePool] Entrada falhou · ${label}`, { detail: reason.slice(0, 120) });
            } else {
                logger.warn(`[BridgePool] Entrada falhou · ${label}`, { detail: reason.slice(0, 120) });
            }
            return { ok: false, reason };
        }

        const validation = await this.validateChatForPool(chat);
        if (!validation.ok) {
            if (
                String(validation.reason || '').includes('membros_insuficientes') &&
                validation.members > 0 &&
                !bridgeQuality.inviteLikelyWorthJoining({ size: validation.members })
            ) {
                logger.debug(
                    `[BridgePool] Convite abaixo do mínimo (${validation.members}/${MIN_MEMBERS}) · ${label}`
                );
            }
            await this.rejectAndLeave(chat, validation.reason, link);
            this._setQueueStatus(row.id, 'skipped', {
                chatId: chat.id,
                failReason: validation.reason,
            });
            logger.info(
                `[BridgePool] Rejeitado · ${chat.title || label} · ${validation.reason}`
            );
            this._poolNotify(
                `Grupo recusado: «${chat.title || label}» — ${validation.reason}`,
                'warn'
            );
            return { ok: false, reason: validation.reason, chat };
        }

        if (!this.hasCapacity()) {
            const upgraded = await this._tryUpgradeForInvite({
                size: validation.members,
                title: chat.title,
                link,
            });
            if (!upgraded && !this.hasCapacity()) {
                await this.rejectAndLeave(chat, 'pool_cheio', link);
                this._setQueueStatus(row.id, 'skipped', { chatId: chat.id, failReason: 'pool_cheio' });
                return { ok: false, reason: 'pool_cheio', chat };
            }
        }

        const reg = await this.registerValidatedGroup(chat, validation.members);
        if (!reg.ok) {
            this._setQueueStatus(row.id, 'skipped', { chatId: chat.id, failReason: reg.reason });
            return { ok: false, reason: reg.reason, chat };
        }

        if (fromAdmin) {
            this.groupService?.pinBridgeGroup?.(chat.id, row.source || 'admin_pv');
        }

        this._setQueueStatus(row.id, 'done', { chatId: chat.id });
        logger.info(
            `[BridgePool] Entrada OK · ${chat.title || label} · ${validation.members} membros · ${this.getActiveCount()}/${MAX_GROUPS}`
        );
        this._poolNotify(
            `Entrou no grupo «${chat.title || label}» (${validation.members} membros) · pool ${this.getActiveCount()}/${MAX_GROUPS}`
        );
        return { ok: true, chat, members: validation.members };
    }

    /** Processa fila até encher o pool ou acabar pendentes. */
    async processQueue() {
        if (this._processing) return { skipped: true, reason: 'busy' };
        const bridge = this._bridge();
        if (!bridge?.isConfigured?.()) return { skipped: true, reason: 'ponte_indisponivel' };

        this._processing = true;
        const results = { ok: 0, fail: 0 };
        try {
            while (this.hasCapacity()) {
                const row = this._nextPendingLink();
                if (!row) break;
                if (row.attempts >= 3) {
                    this._setQueueStatus(row.id, 'failed', { failReason: 'max_tentativas' });
                    continue;
                }
                const r = await this.processOneLink(row);
                if (r.ok) results.ok++;
                else results.fail++;
                await new Promise((res) => setTimeout(res, 1500));
            }
        } finally {
            this._processing = false;
        }

        const stats = this.getQueueStats();
        if (results.ok || results.fail) {
            logger.info(
                `[BridgePool] Ciclo · +${results.ok} ok · ${results.fail} falha · fila ${stats.pending} · pool ${stats.active}/${stats.max}`
            );
        }
        return { ...results, ...stats };
    }

    async _enforceCap() {
        const groups = this._listBridgeGroupsForQuality();
        const sorted = bridgeQuality.sortGroupsWeakestFirst(
            groups.map((g) => ({ ...g, active: 1 }))
        );
        while (sorted.length > MAX_GROUPS) {
            const g = sorted.shift();
            const gramChat = {
                id: Number(g.chat_id),
                title: g.title,
                type: g.type,
                username: g.username,
            };
            await this.rejectAndLeave(gramChat, 'cap_excedido');
            logger.info(
                `[BridgePool] Cap · removido ${g.title || g.chat_id} (${g.member_count ?? g.size ?? '?'} membros)`
            );
        }
    }

    async syncBridgeMembership() {
        const bridge = this._bridge();
        if (!bridge?.isConfigured?.()) return { synced: 0 };

        await this._enforceCap();

        const groups = this.groupService?.listBridgePromoGroups?.(MAX_GROUPS + 10, 0) || [];
        let evicted = 0;

        for (const g of groups) {
            const gramChat = {
                id: Number(g.chat_id),
                title: g.title,
                type: g.type,
                username: g.username,
            };
            try {
                const member = await bridge.isMemberOfChat(gramChat);
                if (!member) {
                    this.groupService?.removeBridgePromoGroup?.(g.chat_id, 'conta_saiu');
                    evicted++;
                    continue;
                }
                const validation = await this.validateChatForPool(gramChat);
                if (!validation.ok) {
                    const reason = String(validation.reason || '');
                    const isSmall = reason.includes('membros_insuficientes');
                    const mem = Number(validation.members || g.member_count || 0);
                    if (isSmall && mem > 0 && mem >= MIN_MEMBERS - 10 && mem < MIN_MEMBERS) {
                        logger.debug(
                            `[BridgePool] Grupo ${g.title || g.chat_id} com ${mem} membros — aguardando (mín ${MIN_MEMBERS})`
                        );
                    } else {
                        await this.rejectAndLeave(gramChat, validation.reason);
                        evicted++;
                    }
                } else if (validation.members) {
                    this.groupService?.updateBridgeMemberCount?.(g.chat_id, validation.members);
                }
            } catch (e) {
                logger.debug('[BridgePool] Sync ignorado', { chatId: g.chat_id, detail: e.message });
            }
            await new Promise((r) => setTimeout(r, 500));
        }

        if (evicted > 0) {
            logger.info(`[BridgePool] Manutenção · ${evicted} grupo(s) removido(s) · pool ${this.getActiveCount()}/${MAX_GROUPS}`);
        }

        if (this.hasCapacity()) {
            this.scheduleProcess();
        }

        return { synced: groups.length, evicted, active: this.getActiveCount() };
    }

    async startLinkWatcher() {
        const bridge = this._bridge();
        if (!bridge?.installBridgeLinkWatcher) return;
        if (this._watcherStarted && bridge.isConfigured?.()) return;

        const ok = await bridge.installBridgeLinkWatcher(async (text, chatId) => {
            const row = this.groupService?.getGroupRow?.(chatId);
            if (!row || row.promo_via_bridge !== 1) return;

            const now = Date.now();
            const last = this._lastWatchAt.get(chatId) || 0;
            if (now - last < 15000) return;
            this._lastWatchAt.set(chatId, now);

            this.handleIncomingText(text, { source: `grupo:${chatId}`, inviteOnly: true });
        });
        if (ok) {
            this._watcherStarted = true;
            logger.info('[BridgePool] Monitor MTProto · só convites (+) e t.me/c/');
        }
    }

    startMaintenance() {
        if (this._maintTimer) return;
        this.purgeSpamQueue();
        const tick = () => {
            this.syncBridgeMembership().catch((e) =>
                logger.warn('[BridgePool] Manutenção falhou', { detail: e.message })
            );
        };
        this._maintTimer = setInterval(tick, MAINT_INTERVAL_MS);
        setTimeout(tick, 60000);
        logger.info(
            `[BridgePool] Pool ativo · máx ${MAX_GROUPS} grupos · mín ${MIN_MEMBERS} membros · revisão ${Math.round(MAINT_INTERVAL_MS / 60000)} min`
        );
    }

    stopMaintenance() {
        if (this._maintTimer) {
            clearInterval(this._maintTimer);
            this._maintTimer = null;
        }
    }

    getQueueStats() {
        const db = this._db();
        if (!db) return { pending: 0, done: 0, failed: 0, active: 0, max: MAX_GROUPS };
        const pending = db.prepare(`SELECT COUNT(*) as c FROM bridge_join_queue WHERE status='pending'`).get()?.c || 0;
        const done = db.prepare(`SELECT COUNT(*) as c FROM bridge_join_queue WHERE status='done'`).get()?.c || 0;
        const failed = db.prepare(`SELECT COUNT(*) as c FROM bridge_join_queue WHERE status IN ('failed','skipped')`).get()?.c || 0;
        return { pending, done, failed, active: this.getActiveCount(), max: MAX_GROUPS };
    }
}

let _singleton = null;

function getBridgePoolService(deps = {}) {
    if (!_singleton) {
        _singleton = new BridgePoolService(deps);
    }
    if (deps.dbRaw) _singleton.dbRaw = deps.dbRaw;
    if (deps.groupService) _singleton.groupService = deps.groupService;
    if (deps.telegram) _singleton.telegram = deps.telegram;
    if (deps.getBotUsername) _singleton.getBotUsername = deps.getBotUsername;
    if (deps.adminActivityNotifier) _singleton._adminNotifier = deps.adminActivityNotifier;
    return _singleton;
}

module.exports = { BridgePoolService, getBridgePoolService, MAX_GROUPS, MIN_MEMBERS };
