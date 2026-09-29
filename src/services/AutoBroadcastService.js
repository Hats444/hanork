'use strict';

/**
 * AutoBroadcastService — divulgação automática periódica
 * Produtos em ordem aleatória (fila embaralhada persistida) · grupos/canais · anti-flood
 */

const logger = require('../config/logger');
const { Markup } = require('telegraf');
const { stateManager } = require('../infrastructure');
const { isScheduledBroadcastSource } = require('./broadcastRateLimit');
const { buildAutoBroadcastGroupKeyboard, buildGroupPromoKeyboard, buildSmmBroadcastGroupKeyboard } = require('../telegram/groupPromo');
const { buyBtn, flashBuyBtn } = require('../utils/buttonLabels');
const { resolveProductPhotoInput, resolveProductPhotoWithMenuFallback } = require('../utils/productPhoto');

const KV = {
    ENABLED: 'auto_broadcast:enabled',
    LAST_SENT: 'auto_broadcast:last_sent',
    LAST_PARTIAL: 'auto_broadcast:last_partial',
    COUNT: 'auto_broadcast:count',
    PRODUCT_QUEUE: 'auto_broadcast:product_queue',
    PRODUCT_IDX: 'auto_broadcast:product_idx',
    LAST_SUMMARY: 'auto_broadcast:last_summary',
};

const {
    SMM_QUEUE_MARKER,
    isSmmBroadcastEnabled,
    mixSmmIntoProductQueue,
    filterQueueMarkers,
    pickSmmBroadcast,
    formatSmmTelegramHtml,
} = require('../data/smmBroadcastVariants');
const {
    VIRTUO_QUEUE_MARKER,
    isVirtuoBroadcastEnabled,
    mixVirtuoIntoProductQueue,
    pickVirtuoBroadcast,
    formatVirtuoTelegramHtml,
} = require('../data/virtuoBroadcastVariants');
const {
    WADV_QUEUE_MARKER,
    isWadvBroadcastEnabled,
    mixWadvIntoProductQueue,
    pickWadvBroadcast,
    formatWadvTelegramHtml,
} = require('../data/wadvBroadcastVariants');
const { validatePromoPair } = require('../utils/promoMediaValidation');

/** Fisher–Yates */
function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

class AutoBroadcastService {
    constructor({
        dbRaw,
        broadcastService,
        loadProducts,
        getMaintenanceMode,
        getBotUsername,
        prisma,
        photosDir,
        intervalMs,
        userDelayMs,
        groupDelayMs,
        channelDelayMs,
        pvCycleGuardMs,
    }) {
        this.dbRaw = dbRaw;
        this.broadcastService = broadcastService;
        this.loadProducts = loadProducts;
        this.getMaintenanceMode = getMaintenanceMode || (() => false);
        this.getBotUsername = getBotUsername || (async () => process.env.BOT_USERNAME || '');
        this.prisma = prisma || null;
        this.photosDir = photosDir || null;
        this.intervalMs = intervalMs || 7200000;
        this.pvCycleGuardMs = pvCycleGuardMs || this.intervalMs;
        this.userDelayMs = userDelayMs ?? 60000;
        this.groupDelayMs = groupDelayMs ?? 1500;
        this.channelDelayMs = channelDelayMs ?? 1800;
        this._timer = null;
        this._cycleRunning = false;
        this._ensureDefaults();
    }

    _db() {
        return this.dbRaw();
    }

    _get(key) {
        return this._db().prepare('SELECT value FROM kv_store WHERE key=?').get(key)?.value ?? null;
    }

    _set(key, value) {
        this._db()
            .prepare(
                `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
            )
            .run(key, String(value));
    }

    _ensureDefaults() {
        if (this._get(KV.ENABLED) === null) {
            this._set(KV.ENABLED, '1');
        }
    }

    isEnabled() {
        const v = this._get(KV.ENABLED);
        if (v === null) return true;
        return v === '1' || v === 'true';
    }

    setEnabled(enabled) {
        this._set(KV.ENABLED, enabled ? '1' : '0');
        logger.info(`[AutoBroadcast] ${enabled ? 'ativado' : 'pausado'}`);
    }

    getLastSent() {
        return parseInt(this._get(KV.LAST_SENT) || '0', 10);
    }

    getCount() {
        return parseInt(this._get(KV.COUNT) || '0', 10);
    }

    getIntervalMs() {
        return this.intervalMs;
    }

    isCycleRunning() {
        return this._cycleRunning;
    }

    getLastSummary() {
        try {
            const raw = this._get(KV.LAST_SUMMARY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    start() {
        if (this._timer) return;
        const tick = () => {
            this._maybeRun().catch((e) => logger.error('[AutoBroadcast] tick:', e.message));
        };
        this._timer = setInterval(tick, 5 * 60 * 1000);
        const bootTickMs = Math.max(0, parseInt(process.env.AUTO_BROADCAST_BOOT_TICK_MS || '15000', 10));
        setTimeout(tick, bootTickMs);
        logger.info('[AutoBroadcast] scheduler ON', {
            enabled: this.isEnabled(),
            intervalMs: this.intervalMs,
            intervalMin: Math.round(this.intervalMs / 60000),
            intervalH: (this.intervalMs / 3600000).toFixed(2),
            pvCycleGuardH: (this.pvCycleGuardMs / 3600000).toFixed(2),
            userDelayMs: this.userDelayMs,
            groupDelayMs: this.groupDelayMs,
            channelDelayMs: this.channelDelayMs,
            mode: (() => {
                try {
                    const { isCampaignOrchestratorEnabled } = require('../config/campaignConfig');
                    return isCampaignOrchestratorEnabled() ? 'campaign_orchestrator' : 'produtos_aleatorios';
                } catch {
                    return 'produtos_aleatorios';
                }
            })(),
        });
        try {
            const { isCampaignOrchestratorEnabled } = require('../config/campaignConfig');
            if (isCampaignOrchestratorEnabled()) {
                const { getCampaignStore } = require('./campaign/CampaignStore');
                getCampaignStore(this.dbRaw);
                logger.info('[CampaignOrchestrator] ativo — slots grupo 0/6/12/18 · PV 1x/dia (~10h)');
            }
        } catch (e) {
            logger.warn('[CampaignOrchestrator] init:', e.message);
        }
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    _bootGraceMs() {
        return Math.max(0, parseInt(process.env.AUTO_BROADCAST_BOOT_GRACE_MS || '600000', 10));
    }

    async _maybeRun() {
        if (!this.isEnabled()) return;
        if (this.getMaintenanceMode()) return;
        if (this._cycleRunning || this.broadcastService.isRunning) return;

        const pendingSmm = this._get('auto_broadcast:run_smm_now');
        if (pendingSmm) {
            if (!stateManager.acquireLock('auto_broadcast:cycle', 120000)) return;
            this._set('auto_broadcast:run_smm_now', '');
            try {
                await this.runSmmBroadcastNow('queued_smm');
            } finally {
                stateManager.releaseLock('auto_broadcast:cycle');
            }
            return;
        }

        const { isCampaignOrchestratorEnabled } = require('../config/campaignConfig');
        if (isCampaignOrchestratorEnabled()) {
            const { maybeRunCampaignOrchestrator } = require('./campaign/CampaignOrchestrator');
            await maybeRunCampaignOrchestrator(this);
            return;
        }

        const bootGrace = this._bootGraceMs();
        const uptimeMs = Math.round(process.uptime() * 1000);
        if (bootGrace > 0 && uptimeMs < bootGrace) {
            if (!this._bootGraceLogged || uptimeMs < 60000) {
                this._bootGraceLogged = true;
                logger.info('[AutoBroadcast] ciclo adiado — grace pós-boot', {
                    graceMin: Math.round(bootGrace / 60000),
                    uptimeSec: Math.round(uptimeMs / 1000),
                });
            }
            return;
        }

        const BroadcastAdaptiveThrottle = require('./BroadcastAdaptiveThrottle');
        BroadcastAdaptiveThrottle.bindDb(this.dbRaw);

        const partial = parseInt(this._get(KV.LAST_PARTIAL) || '0', 10);
        const partialRetry = BroadcastAdaptiveThrottle.getPartialRetryMs();
        if (partial && Date.now() - partial < partialRetry) return;

        const last = this.getLastSent();
        if (last && Date.now() - last < this.intervalMs) {
            return;
        }

        const lastSummary = this.getLastSummary();
        if (lastSummary?.at && Date.now() - lastSummary.at < this.pvCycleGuardMs) {
            return;
        }

        const lockTtl = Math.max(this.intervalMs - 60000, 120000);
        if (!stateManager.acquireLock('auto_broadcast:cycle', lockTtl)) {
            return;
        }

        try {
            await this.runCycle('auto');
        } catch (e) {
            logger.error('[AutoBroadcast] runCycle:', e.message);
        } finally {
            stateManager.releaseLock('auto_broadcast:cycle');
        }
    }

    /** Lista produtos elegíveis para divulgação automática (só catálogo Hanork) */
    async _getEligibleProducts() {
        let filterFn = null;
        try {
            filterFn = require('../plugins/zero-divu/divulgacaoCatalog').filterDivulgacaoProducts;
        } catch {
            /* plugin opcional */
        }
        const products = await this.loadProducts();
        const base = (products || []).filter((p) => p.active !== false && (p.stock ?? 999) > 0);
        return filterFn ? filterFn(base) : base;
    }

    _loadProductQueue() {
        try {
            const raw = this._get(KV.PRODUCT_QUEUE);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.map(Number).filter((n) => Number.isFinite(n)) : [];
        } catch {
            return [];
        }
    }

    _saveProductQueue(ids) {
        this._set(KV.PRODUCT_QUEUE, JSON.stringify(ids));
    }

    /**
     * Próximo item — fila embaralhada (produtos + slot SMM quando SMM_PUBLIC=1).
     */
    async _pickNextProduct() {
        const active = await this._getEligibleProducts();
        if (!active.length && !isSmmBroadcastEnabled() && !isVirtuoBroadcastEnabled() && !isWadvBroadcastEnabled()) {
            return null;
        }

        const activeIds = active.map((p) => Number(p.id));
        const byId = Object.fromEntries(active.map((p) => [Number(p.id), p]));

        let queue = filterQueueMarkers(this._loadProductQueue(), activeIds);
        queue = queue.filter((id) => id !== VIRTUO_QUEUE_MARKER || isVirtuoBroadcastEnabled());
        queue = queue.filter((id) => id !== WADV_QUEUE_MARKER || isWadvBroadcastEnabled());

        if (!queue.length) {
            queue = mixSmmIntoProductQueue(activeIds);
            queue = mixVirtuoIntoProductQueue(activeIds, queue);
            queue = mixWadvIntoProductQueue(activeIds, queue);
            if (queue.length) {
                logger.info('[AutoBroadcast] nova rodada aleatória', {
                    total: queue.length,
                    smmSlots: queue.filter((x) => x === SMM_QUEUE_MARKER).length,
                    virtuoSlots: queue.filter((x) => x === VIRTUO_QUEUE_MARKER).length,
                    wadvSlots: queue.filter((x) => x === WADV_QUEUE_MARKER).length,
                });
            }
        }

        if (!queue.length && (isSmmBroadcastEnabled() || isVirtuoBroadcastEnabled() || isWadvBroadcastEnabled())) {
            if (isSmmBroadcastEnabled()) return { __smmBroadcast: true };
            if (isVirtuoBroadcastEnabled()) return { __virtuoBroadcast: true };
            if (isWadvBroadcastEnabled()) return { __wadvBroadcast: true };
        }

        const picked = queue.shift();
        this._saveProductQueue(queue);

        if (picked === SMM_QUEUE_MARKER) {
            return { __smmBroadcast: true };
        }
        if (picked === VIRTUO_QUEUE_MARKER) {
            return { __virtuoBroadcast: true };
        }
        if (picked === WADV_QUEUE_MARKER) {
            return { __wadvBroadcast: true };
        }

        const legacyIdx = activeIds.indexOf(picked);
        if (legacyIdx >= 0) {
            this._set(KV.PRODUCT_IDX, String((legacyIdx + 1) % activeIds.length));
        }

        return byId[picked] || active[0] || null;
    }

    /** Produto Hanork (sem slot SMM) — usado pelo orquestrador de campanhas. */
    async _pickHanorkProduct() {
        const active = await this._getEligibleProducts();
        if (!active.length) return null;

        const activeIds = active.map((p) => Number(p.id));
        const byId = Object.fromEntries(active.map((p) => [Number(p.id), p]));

        let queue = filterQueueMarkers(this._loadProductQueue(), activeIds).filter(
            (x) => x !== SMM_QUEUE_MARKER && x !== VIRTUO_QUEUE_MARKER && x !== WADV_QUEUE_MARKER
        );

        if (!queue.length) {
            queue = [...activeIds].sort(() => Math.random() - 0.5);
        }

        const picked = queue.shift();
        this._saveProductQueue(queue);

        const legacyIdx = activeIds.indexOf(picked);
        if (legacyIdx >= 0) {
            this._set(KV.PRODUCT_IDX, String((legacyIdx + 1) % activeIds.length));
        }

        return byId[picked] || active[0] || null;
    }

    /** Monta payload de divulgação por tipo de campanha (hanork | smm). */
    async buildForCampaignType(type) {
        const { buildForCampaignType: build } = require('./campaign/campaignContent');
        return build(this, type);
    }

    _getFlashSale(productId) {
        if (!this.prisma?.flashSale?.findActive) return null;
        try {
            this.prisma.flashSale.expire?.();
            return this.prisma.flashSale.findActive(productId);
        } catch {
            return null;
        }
    }

    async _buildSmmMessage() {
        const kv = { get: (k) => this._get(k), set: (k, v) => this._set(k, v) };
        const picked = pickSmmBroadcast(kv, this.photosDir);
        const variant = picked.variant;
        let photo = picked.photo;
        const photoFile = picked.photoFile;
        const mediaCheck = validatePromoPair('smm', {
            variant,
            photo,
            photoFile,
            photosDir: this.photosDir,
            usedMenuFallback: Boolean(picked.usedMenuFallback),
        });
        if (!mediaCheck.ok) photo = null;

        let username = await this.getBotUsername();
        if (!username && this.broadcastService?.bot?.telegram) {
            try {
                const me = await this.broadcastService.bot.telegram.getMe();
                username = me.username || '';
            } catch { /* ignore */ }
        }
        const botLink = require('../data/smmBroadcastVariants').smmBotLink(username);
        const texto = formatSmmTelegramHtml(variant, { username, botLink });

        const { MENU_BTN } = require('../telegram/menus/menuCopy');
        const userRows = [
            [{ text: MENU_BTN.smm, url: botLink }],
            [{ text: '🛍️ Catálogo', url: username ? `https://t.me/${username}?start=comprar` : botLink }],
            [{ text: MENU_BTN.menu, callback_data: 'menu:home' }],
        ];

        const promoKeyboard = buildSmmBroadcastGroupKeyboard(username);

        return {
            texto,
            keyboard: Markup.inlineKeyboard(userRows),
            groupKeyboard: promoKeyboard,
            channelKeyboard: promoKeyboard,
            productId: null,
            productName: 'SMM Serviços',
            photo,
            smmBroadcast: true,
            smmVariantId: variant.id,
            promoMediaBlocked: !mediaCheck.ok,
        };
    }

    async _buildVirtuoMessage() {
        const kv = { get: (k) => this._get(k), set: (k, v) => this._set(k, v) };
        const picked = pickVirtuoBroadcast(kv, this.photosDir);
        const variant = picked.variant;
        let photo = picked.photo;
        const photoFile = picked.photoFile;
        const mediaCheck = validatePromoPair('virtuo', {
            variant,
            photo,
            photoFile,
            photosDir: this.photosDir,
            usedMenuFallback: Boolean(picked.usedMenuFallback),
        });
        if (!mediaCheck.ok) photo = null;

        let username = await this.getBotUsername();
        if (!username && this.broadcastService?.bot?.telegram) {
            try {
                const me = await this.broadcastService.bot.telegram.getMe();
                username = me.username || '';
            } catch { /* ignore */ }
        }
        const botLink = require('../data/virtuoBroadcastVariants').virtuoBotLink(username);
        const texto = formatVirtuoTelegramHtml(variant, { username, botLink });

        const { MENU_BTN } = require('../telegram/menus/menuCopy');
        const userRows = [
            [{ text: MENU_BTN.virtuo || '📱 Números SMS', url: botLink }],
            [{ text: '🛍️ Catálogo', url: username ? `https://t.me/${username}?start=comprar` : botLink }],
            [{ text: MENU_BTN.menu, callback_data: 'menu:home' }],
        ];

        const promoKeyboard = buildSmmBroadcastGroupKeyboard(username);

        return {
            texto,
            keyboard: Markup.inlineKeyboard(userRows),
            groupKeyboard: promoKeyboard,
            channelKeyboard: promoKeyboard,
            productId: null,
            productName: 'Números SMS Virtuo',
            photo,
            virtuoBroadcast: true,
            virtuoVariantId: variant.id,
            promoMediaBlocked: !mediaCheck.ok,
        };
    }

    async _buildWadvMessage() {
        const kv = { get: (k) => this._get(k), set: (k, v) => this._set(k, v) };
        const picked = pickWadvBroadcast(kv, this.photosDir);
        const variant = picked.variant;
        let photo = picked.photo;
        const photoFile = picked.photoFile;
        const mediaCheck = validatePromoPair('wadv', {
            variant,
            photo,
            photoFile,
            photosDir: this.photosDir,
            usedMenuFallback: Boolean(picked.usedMenuFallback),
        });
        if (!mediaCheck.ok) photo = null;

        let username = await this.getBotUsername();
        if (!username && this.broadcastService?.bot?.telegram) {
            try {
                const me = await this.broadcastService.bot.telegram.getMe();
                username = me.username || '';
            } catch { /* ignore */ }
        }
        const botLink = require('../data/wadvBroadcastVariants').wadvBotLink(username);
        const texto = formatWadvTelegramHtml(variant, { username, botLink });

        const userRows = [
            [{ text: '📣 Hanork Div VIP', url: botLink }],
            [{ text: '🛍️ Catálogo', url: username ? `https://t.me/${username}?start=comprar` : botLink }],
            [{ text: '🏠 Menu', callback_data: 'menu:home' }],
        ];

        const promoKeyboard = buildSmmBroadcastGroupKeyboard(username);

        return {
            texto,
            keyboard: Markup.inlineKeyboard(userRows),
            groupKeyboard: promoKeyboard,
            channelKeyboard: promoKeyboard,
            productId: null,
            productName: 'Hanork Div VIP',
            photo,
            wadvBroadcast: true,
            wadvVariantId: variant.id,
            promoMediaBlocked: !mediaCheck.ok,
        };
    }

    async _buildProductMessage(p) {
        const sale = this._getFlashSale(p.id);
        const preco = sale ? sale.sale_price : Number(p.price);
        const precoTxt = sale
            ? `<s>R$ ${Number(p.price).toFixed(2)}</s> ➜ <b>R$ ${Number(preco).toFixed(2)}</b> 🔥`
            : `<b>R$ ${Number(preco).toFixed(2)}</b>`;

        let username = await this.getBotUsername();
        if (!username && this.broadcastService?.bot?.telegram) {
            try {
                const me = await this.broadcastService.bot.telegram.getMe();
                username = me.username || '';
            } catch { /* ignore */ }
        }
        const botLink = username ? `https://t.me/${username}?start=buy_${p.id}` : null;

        const { HANORK_PRODUCT_ID, pickHanorkBroadcast, formatHanorkTelegramHtml } =
            require('../data/hanorkBroadcastVariants');
        let texto;
        let photo;
        let variant = null;
        let photoFile = null;
        let promoMediaBlocked = false;
        if (Number(p.id) === HANORK_PRODUCT_ID) {
            const kv = { get: (k) => this._get(k), set: (k, v) => this._set(k, v) };
            const picked = pickHanorkBroadcast(kv, this.photosDir);
            variant = picked.variant;
            photoFile = picked.photoFile;
            photo = picked.photo;
            const mediaCheck = validatePromoPair('hanork', {
                variant,
                photo,
                photoFile,
                photosDir: this.photosDir,
                usedMenuFallback: Boolean(picked.usedMenuFallback),
            });
            if (!mediaCheck.ok) {
                photo = null;
                promoMediaBlocked = true;
            }
            texto = formatHanorkTelegramHtml(variant, p, { sale, botLink, precoTxt });
        } else {
            const { generateProductPromoHtml } = require('../utils/broadcastAiCopy');
            const autoUseAi = ['1', 'true', 'yes'].includes(
                String(process.env.AUTO_BROADCAST_USE_AI || '').toLowerCase()
            );
            texto = await generateProductPromoHtml(p, {
                sale,
                botLink,
                dbRaw: this.dbRaw,
                channel: 'tg',
                forceTemplate: !autoUseAi,
            });
        }

        const userRows = [];
        if (botLink) {
            userRows.push([{ text: buyBtn(preco), url: botLink }]);
        }
        userRows.push(
            [{ text: '📦 Ver produto', callback_data: `p_${p.id}` }],
            [{ text: '🛍️ Catálogo', callback_data: 'cat' }],
            [{ text: '🏠 Menu', callback_data: 'menu:home' }]
        );

        const promoKeyboard = buildAutoBroadcastGroupKeyboard(
            username,
            p.id,
            `R$ ${Number(preco).toFixed(2)}`
        );

        if (!photo) {
            const { photo: resolved, usedMenuFallback } = resolveProductPhotoWithMenuFallback(
                p,
                this.photosDir,
                variant ? `auto-bcast:hanork-${variant.id}` : `auto-bcast:${p.id}`
            );
            photo = resolved;
            if (photo && promoMediaBlocked) {
                logger.info('[AutoBroadcast] mídia pareada ausente — menu fallback', {
                    productId: p.id,
                    variant: variant?.id,
                    photoFile,
                });
                promoMediaBlocked = false;
            } else if (usedMenuFallback) {
                logger.info('[AutoBroadcast] Hanork variant sem foto — menu fallback', {
                    productId: p.id,
                    variant: variant?.id,
                });
            } else if (!photo) {
                logger.warn('[AutoBroadcast] produto sem foto (produto e menu)', {
                    productId: p.id,
                    productName: p.name,
                });
            }
        }

        return {
            texto,
            keyboard: Markup.inlineKeyboard(userRows),
            groupKeyboard: promoKeyboard,
            channelKeyboard: promoKeyboard,
            productId: p.id,
            productName: p.name,
            photo,
        };
    }

    _buildCatalogFallback() {
        const texto =
            `🛍️ <b>Catálogo Hanork</b>\n\n` +
            `Nenhum produto ativo no momento.\n\n` +
            `Cadastre produtos no painel admin para a divulgação automática rotacionar entre eles.`;
        const keyboard = Markup.inlineKeyboard([
            [{ text: '🏠 Menu', callback_data: 'menu:home' }],
        ]);
        const promoKeyboard = buildGroupPromoKeyboard(process.env.BOT_USERNAME || '');
        const { getMenuPhotoInput } = require('../telegram/menuPhoto');
        const photo = getMenuPhotoInput(null, 'catalog-empty');
        return {
            texto,
            keyboard,
            groupKeyboard: promoKeyboard,
            channelKeyboard: promoKeyboard,
            productId: null,
            productName: null,
            photo,
        };
    }

    async _buildMessage() {
        const picked = await this._pickNextProduct();
        if (picked?.__smmBroadcast) {
            return this._buildSmmMessage();
        }
        if (picked?.__virtuoBroadcast) {
            return this._buildVirtuoMessage();
        }
        if (picked?.__wadvBroadcast) {
            return this._buildWadvMessage();
        }
        if (picked) {
            return this._buildProductMessage(picked);
        }
        if (isWadvBroadcastEnabled()) {
            return this._buildWadvMessage();
        }
        if (isVirtuoBroadcastEnabled()) {
            return this._buildVirtuoMessage();
        }
        if (isSmmBroadcastEnabled()) {
            return this._buildSmmMessage();
        }
        return this._buildCatalogFallback();
    }

    /**
     * Divulgação ponte MTProto (grupos onde só o número posta).
     * Usado após broadcast completo do bot — não chamar em modos só-grupos/canais/ponte.
     */
    async runBridgePromoAfterBot({ texto, photo = null, groupReplyMarkup = null, source = 'after_bot' } = {}) {
        try {
            const { getBridgeBroadcastService } = require('./BridgeBroadcastService');
            const bridgeBc = getBridgeBroadcastService({
                dbRaw: this.dbRaw,
                groupService: this.broadcastService?.groupService,
                getBotUsername: this.getBotUsername,
                groupDelayMs: this.groupDelayMs,
            });
            if (!bridgeBc.isAvailable()) {
                return { skipped: true, reason: 'bridge_unavailable' };
            }
            return await bridgeBc.broadcastPromo({
                texto,
                photo,
                groupReplyMarkup,
                source,
            });
        } catch (e) {
            logger.warn('[AutoBroadcast] bridge promo:', e.message);
            return { skipped: true, reason: e.message || 'bridge_error' };
        }
    }

    /** Divulgação SMM imediata (manual / script). */
    async runSmmBroadcastNow(source = 'manual_smm') {
        if (this._cycleRunning || this.broadcastService.isRunning) {
            return { success: false, error: 'already_running' };
        }
        if (!isSmmBroadcastEnabled()) {
            return { success: false, error: 'smm_broadcast_disabled' };
        }
        this._cycleRunning = true;
        try {
            const built = await this._buildSmmMessage();
            logger.info('[AutoBroadcast] divulgação SMM iniciada', {
                source,
                variant: built.smmVariantId,
            });
            const result = await this._executeBuiltBroadcast(built, source);
            if (!result.success) {
                logger.warn('[AutoBroadcast] SMM skipped', { source, error: result.error });
                return { ...result, smmBroadcast: true };
            }
            const u = result.users || {};
            const g = result.groups || {};
            const c = result.channels || {};
            const bp = result.bridgePromo || {};
            logger.info('[AutoBroadcast] ciclo OK', {
                source,
                count: this.getCount(),
                productName: 'SMM Serviços',
                smmBroadcast: true,
                variant: built.smmVariantId,
                usersEdited: u.edited,
                usersSent: u.sent,
                groupsEdited: g.edited,
                groupsSent: g.sent,
                channelsEdited: c.edited,
                channelsSent: c.sent,
                bridgePromo: bp,
            });
            return { ...result, smmBroadcast: true };
        } finally {
            this._cycleRunning = false;
        }
    }

    async _executeBuiltBroadcast(
        { texto, keyboard, groupKeyboard, channelKeyboard, productId, productName, photo, smmBroadcast, virtuoBroadcast, wadvBroadcast },
        source,
        execOpts = {}
    ) {
        const enforceAutoRateLimit =
            execOpts.enforceAutoRateLimit !== undefined
                ? !!execOpts.enforceAutoRateLimit
                : isScheduledBroadcastSource(source);
        const BroadcastAdaptiveThrottle = require('./BroadcastAdaptiveThrottle');
        BroadcastAdaptiveThrottle.bindDb(this.dbRaw);
        const tgLim = BroadcastAdaptiveThrottle.getLimits();
        const cycleId = Date.now();
        const targets = execOpts.targets || { users: true, groups: true, channels: true };
        const { groupCooldownMs: campaignGroupCooldown } = require('../config/campaignConfig');
        const groupCooldown =
            execOpts.campaignType != null ? campaignGroupCooldown() : execOpts.groupCooldownMs ?? 0;
        const result = await this.broadcastService.executeTargetedBroadcast(texto, 'HTML', keyboard, {
            targets,
            photo,
            requirePhoto: true,
            forcePhoto: true,
            forceNewGroups: false,
            groupCooldownMs: groupCooldown,
            groupReplyMarkup: groupKeyboard,
            channelReplyMarkup: channelKeyboard || groupKeyboard,
            skipPermissionCheck: true,
            syncGroupsFirst: true,
            syncChannelsFirst: true,
            userDelayMs: Math.max(this.userDelayMs, tgLim.userDelayMs ?? 0),
            groupDelayMs: Math.max(this.groupDelayMs, tgLim.groupDelayMs ?? 0),
            channelDelayMs: Math.max(this.channelDelayMs, tgLim.channelDelayMs ?? 0),
            cooldownMode: 'new_only',
            enforceAutoRateLimit,
            cycleId,
            campaignType: execOpts.campaignType,
            campaignSlotKey: execOpts.campaignSlotKey,
            campaignMaxPerDay: execOpts.campaignMaxPerDay,
        });

        if (!result.success) return result;

        let bridgePromo = null;
        if (targets.groups !== false && !execOpts.skipBridgePromo) {
            bridgePromo = await this.runBridgePromoAfterBot({
                texto,
                photo,
                groupReplyMarkup: groupKeyboard,
                source,
            });
        }

        const u = result.users || {};
        const g = result.groups || {};
        const c = result.channels || {};
        const bp = bridgePromo || {};
        const impact =
            (u.sent || 0) + (u.edited || 0) +
            (g.sent || 0) + (g.edited || 0) +
            (c.sent || 0) + (c.edited || 0) +
            (bp.sent || 0) + (bp.edited || 0);
        const onlyRateLimited =
            impact === 0 &&
            ((u.rateLimited || 0) + (g.rateLimited || 0) + (c.rateLimited || 0) + (bp.rateLimited || 0) > 0);

        const count = this.getCount() + 1;
        this._set(KV.COUNT, String(count));

        if (onlyRateLimited) {
            this._set(KV.LAST_PARTIAL, String(Date.now()));
            logger.info('[AutoBroadcast] ciclo sem entregas — limite ativo, retry parcial agendado', {
                partialRetryMin: Math.round(BroadcastAdaptiveThrottle.getPartialRetryMs() / 60000),
            });
        } else if ((u.deferred || 0) > 0) {
            this._set(KV.LAST_PARTIAL, String(Date.now()));
            logger.info('[AutoBroadcast] PV adiados — retry parcial agendado', {
                deferred: u.deferred,
                partialRetryMin: Math.round(BroadcastAdaptiveThrottle.getPartialRetryMs() / 60000),
            });
        } else {
            this._set(KV.LAST_SENT, String(Date.now()));
            this._set(KV.LAST_PARTIAL, '0');
            if (impact > 0) BroadcastAdaptiveThrottle.recordSuccess('tg');
        }
        this._set(
            KV.LAST_SUMMARY,
            JSON.stringify({
                source,
                at: Date.now(),
                productId,
                productName,
                smmBroadcast: Boolean(smmBroadcast),
                virtuoBroadcast: Boolean(virtuoBroadcast),
                wadvBroadcast: Boolean(wadvBroadcast),
                users: result.users,
                groups: result.groups,
                channels: result.channels,
                bridgePromo,
            })
        );
        return {
            ...result,
            productId,
            productName,
            bridgePromo,
            smmBroadcast: Boolean(smmBroadcast),
            virtuoBroadcast: Boolean(virtuoBroadcast),
            wadvBroadcast: Boolean(wadvBroadcast),
        };
    }

    /**
     * Ciclo completo: usuários + grupos + canais
     */
    async runCycle(source = 'auto') {
        if (this._cycleRunning || this.broadcastService.isRunning) {
            logger.warn('[AutoBroadcast] ciclo ignorado — já em andamento', { source });
            return { success: false, error: 'already_running' };
        }

        this._cycleRunning = true;
        try {
            const built = await this._buildMessage();
            const result = await this._executeBuiltBroadcast(built, source);
            if (!result.success) {
                logger.warn('[AutoBroadcast] skipped', { source, error: result.error });
                return result;
            }

            const { productId, productName, smmBroadcast, bridgePromo } = result;
            const count = this.getCount();
            const u = result.users || {};
            const g = result.groups || {};
            const c = result.channels || {};
            const bp = bridgePromo || {};
            const impact =
                (u.sent || 0) + (u.edited || 0) +
                (g.sent || 0) + (g.edited || 0) +
                (c.sent || 0) + (c.edited || 0) +
                (bp.sent || 0) + (bp.edited || 0);

            if (impact > 0) {
                const BroadcastAdaptiveThrottle = require('./BroadcastAdaptiveThrottle');
                BroadcastAdaptiveThrottle.recordSuccess('tg');
            }

            try {
                const OpsMetricsStore = require('./ops/OpsMetricsStore');
                OpsMetricsStore.record(this._db(), {
                    channel: 'tg',
                    kind: 'info',
                    target: productName || 'ciclo auto',
                    detail: `PV ${u.sent || 0}/${u.total || 0} · GP ${g.sent || 0} · bloq ${u.blocked || 0}`,
                });
            } catch {
                /* ignore */
            }

            logger.info('[AutoBroadcast] ciclo OK', {
                source,
                count,
                productId,
                productName: productName || '(catálogo vazio)',
                smmBroadcast: Boolean(smmBroadcast),
                usersEdited: u.edited,
                usersSent: u.sent,
                groupsEdited: g.edited,
                groupsSent: g.sent,
                channelsEdited: c.edited,
                channelsSent: c.sent,
                bridgePromo: bp,
            });

            return result;
        } finally {
            this._cycleRunning = false;
        }
    }

    /** Divulgação manual só nos grupos ponte (conta MTProto). */
    async runBridgePromoOnly(source = 'manual_bridge') {
        if (this._cycleRunning || this.broadcastService.isRunning) {
            return { success: false, error: 'already_running' };
        }
        this._cycleRunning = true;
        try {
            const { texto, groupKeyboard, productId, productName, photo } = await this._buildMessage();
            const { getBridgeBroadcastService } = require('./BridgeBroadcastService');
            const bridgeBc = getBridgeBroadcastService({
                dbRaw: this.dbRaw,
                groupService: this.broadcastService?.groupService,
                getBotUsername: this.getBotUsername,
                groupDelayMs: this.groupDelayMs,
            });
            if (!bridgeBc.isAvailable()) {
                return { success: false, error: 'bridge_unavailable' };
            }
            const bridgePromo = await bridgeBc.broadcastPromo({
                texto,
                photo,
                groupReplyMarkup: groupKeyboard,
                source,
            });
            if (!bridgePromo?.total && bridgePromo?.skipped) {
                return { success: false, error: bridgePromo.reason || 'bridge_skipped', bridgePromo };
            }
            return {
                success: true,
                bridgePromo,
                productId,
                productName,
                groups: { total: 0, edited: 0, sent: 0 },
                users: { total: 0, edited: 0, sent: 0 },
                channels: { total: 0, edited: 0, sent: 0 },
            };
        } finally {
            this._cycleRunning = false;
        }
    }

    /** Reembaralha manualmente a fila (admin) */
    reshuffleProductQueue() {
        this._saveProductQueue([]);
        logger.info('[AutoBroadcast] fila de produtos zerada — próximo ciclo reembaralha');
    }

    /**
     * Divulgação manual de flash sale — mesmo pipeline da divulgação automática
     * (foto do produto, PV + grupos + canais, edita slot rastreado).
     */
    async broadcastFlashSale(productId) {
        if (this._cycleRunning || this.broadcastService.isRunning) {
            logger.warn('[FlashBroadcast] ignorado — broadcast em andamento');
            return { success: false, error: 'already_running' };
        }

        this.prisma?.flashSale?.expire?.();
        const sale = this._getFlashSale(productId);
        if (!sale) return { success: false, error: 'no_active_sale' };

        const products = await this.loadProducts();
        const p = (products || []).find((x) => Number(x.id) === Number(productId));
        if (!p) return { success: false, error: 'product_not_found' };

        const productName = sale.product_name || p.name;
        const { formatTimer } = require('../modules/flash/flashSaleUi');
        const ms = new Date(sale.ends_at) - Date.now();
        const precoTxt = `R$ ${Number(sale.sale_price).toFixed(2)}`;

        let username = await this.getBotUsername();
        if (!username && this.broadcastService?.bot?.telegram) {
            try {
                const me = await this.broadcastService.bot.telegram.getMe();
                username = me.username || '';
            } catch { /* ignore */ }
        }
        const botLink = username ? `https://t.me/${username}?start=buy_${p.id}` : null;

        const { generateProductPromoHtml } = require('../utils/broadcastAiCopy');
        let texto = await generateProductPromoHtml(p, {
            sale,
            botLink,
            dbRaw: this.dbRaw,
            channel: 'tg',
        });
        const flashBanner = `🔥 <b>OFERTA RELÂMPAGO</b> — termina em <b>${formatTimer(ms)}</b>\n\n`;
        if (!/rel[aâ]mpago|flash/i.test(texto)) {
            texto = flashBanner + texto;
        }

        const userRows = [];
        if (botLink) {
            userRows.push([{ text: flashBuyBtn(sale.sale_price), url: botLink }]);
        } else {
            userRows.push([{ text: flashBuyBtn(sale.sale_price), callback_data: `fs_buy_${p.id}_${sale.id}` }]);
        }
        userRows.push(
            [{ text: '🔥 Ver ofertas', callback_data: 'flash_sales' }],
            [{ text: '📦 Ver produto', callback_data: `p_${p.id}` }],
            [{ text: '🛍️ Catálogo', callback_data: 'cat' }],
            [{ text: '🏠 Menu', callback_data: 'menu:home' }]
        );

        const promoKeyboard = buildAutoBroadcastGroupKeyboard(username, p.id, precoTxt);
        const { photo } = resolveProductPhotoWithMenuFallback(
            p,
            this.photosDir,
            `flash-bcast:${p.id}`
        );

        this._cycleRunning = true;
        try {
            const result = await this.broadcastService.executeFullBroadcast(
                texto,
                'HTML',
                Markup.inlineKeyboard(userRows),
                {
                    photo,
                    requirePhoto: true,
                    forcePhoto: true,
                    forceNewGroups: false,
                    groupCooldownMs: 0,
                    groupReplyMarkup: promoKeyboard,
                    channelReplyMarkup: promoKeyboard,
                    skipPermissionCheck: true,
                    syncGroupsFirst: true,
                    syncChannelsFirst: true,
                    userDelayMs: this.userDelayMs,
                    groupDelayMs: this.groupDelayMs,
                    channelDelayMs: this.channelDelayMs,
                    cooldownMode: 'new_only',
                }
            );

            let bridgePromo = null;
            if (result.success) {
                bridgePromo = await this.runBridgePromoAfterBot({
                    texto,
                    photo,
                    groupReplyMarkup: promoKeyboard,
                    source: 'flash_sale',
                });
            }

            if (result.success) {
                logger.info('[FlashBroadcast] OK', {
                    productId: p.id,
                    productName,
                    usersEdited: result.users?.edited,
                    usersSent: result.users?.sent,
                    groupsEdited: result.groups?.edited,
                    groupsSent: result.groups?.sent,
                    channelsEdited: result.channels?.edited,
                    channelsSent: result.channels?.sent,
                    bridgePromo,
                });
            } else {
                logger.warn('[FlashBroadcast] skipped', { productId: p.id, error: result.error });
            }

            return { ...result, productId: p.id, productName, bridgePromo };
        } finally {
            this._cycleRunning = false;
        }
    }
}

module.exports = { AutoBroadcastService };
