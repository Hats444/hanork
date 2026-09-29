/**
 * StateManager - Interface de domínio sobre RedisState
 *
 * Chaves compostas: "namespace:id" (ex: broadcast:123, last_menu:456)
 */

'use strict';

const RedisState = require('./RedisState');

function isPendingPurchaseIndexEnabled() {
    const v = process.env.PENDING_PURCHASE_INDEX_ENABLED;
    if (v === '0' || v === 'false') return false;
    return true;
}

class StateManager {
    constructor() {
        this._redisState = RedisState.getInstance();
    }

    static getInstance() {
        if (!StateManager.instance) {
            StateManager.instance = new StateManager();
        }
        return StateManager.instance;
    }

    /** Compat: expõe RedisState para código legado */
    get redis() {
        return this._redisState;
    }

    _parseKey(compositeKey) {
        const s = String(compositeKey);
        const i = s.indexOf(':');
        if (i <= 0) return { namespace: 'default', key: s };
        return { namespace: s.slice(0, i), key: s.slice(i + 1) };
    }

    async get(compositeKey) {
        const { namespace, key } = this._parseKey(compositeKey);
        return this._redisState.get(namespace, key);
    }

    async set(compositeKey, value, ttl = 3600) {
        const { namespace, key } = this._parseKey(compositeKey);
        return this._redisState.set(namespace, key, value, ttl);
    }

    async delete(compositeKey) {
        const { namespace, key } = this._parseKey(compositeKey);
        return this._redisState.delete(namespace, key);
    }

    async has(compositeKey) {
        const { namespace, key } = this._parseKey(compositeKey);
        return this._redisState.exists(namespace, key);
    }

    async keysInNamespace(namespace) {
        return this._redisState.keys(namespace);
    }

    _pendingIndexNs() {
        return 'pending_idx';
    }

    async _indexPendingOrder(orderId, purchaseKey, ttl = 1800) {
        if (!isPendingPurchaseIndexEnabled() || orderId == null) return;
        await this._redisState.set(this._pendingIndexNs(), String(orderId), String(purchaseKey), ttl);
    }

    async _unindexPendingOrder(orderId) {
        if (!isPendingPurchaseIndexEnabled() || orderId == null) return;
        await this._redisState.delete(this._pendingIndexNs(), String(orderId));
    }

    // Métodos específicos de domínio
    async getPendingPurchase(key) {
        return this.get(`pending_purchase:${key}`);
    }

    async setPendingPurchase(key, value, ttl = 1800) {
        await this.set(`pending_purchase:${key}`, value, ttl);
        if (value?.orderId != null) {
            await this._indexPendingOrder(value.orderId, key, ttl);
        }
    }

    async deletePendingPurchase(key) {
        const existing = await this.getPendingPurchase(key);
        await this.delete(`pending_purchase:${key}`);
        if (existing?.orderId != null) {
            await this._unindexPendingOrder(existing.orderId);
        }
    }

    /** Busca compra pendente pelo orderId — índice O(1) + fallback scan (5.2). */
    async findPendingPurchaseByOrderId(orderId) {
        if (orderId == null) return null;
        const oid = String(orderId);
        try {
            if (isPendingPurchaseIndexEnabled()) {
                const purchaseKey = await this._redisState.get(this._pendingIndexNs(), oid);
                if (purchaseKey) {
                    const pending = await this.getPendingPurchase(purchaseKey);
                    if (pending?.orderId != null && String(pending.orderId) === oid) {
                        return pending;
                    }
                    await this._unindexPendingOrder(oid);
                }
            }
            const keys = await this.keysInNamespace('pending_purchase');
            for (const key of keys) {
                const pending = await this.getPendingPurchase(key);
                if (pending?.orderId != null && String(pending.orderId) === oid) {
                    await this._indexPendingOrder(oid, key);
                    return pending;
                }
            }
        } catch {
            /* ignore */
        }
        return null;
    }

    async getAppliedCoupon(key) { return this.get(`applied_coupon:${key}`); }
    async setAppliedCoupon(key, value, ttl = 3600) { return this.set(`applied_coupon:${key}`, value, ttl); }
    async deleteAppliedCoupon(key) { return this.delete(`applied_coupon:${key}`); }

    async getAffSaldoApplied(key) { return this.get(`aff_saldo:${key}`); }
    async setAffSaldoApplied(key, value, ttl = 3600) { return this.set(`aff_saldo:${key}`, value, ttl); }
    async deleteAffSaldoApplied(key) { return this.delete(`aff_saldo:${key}`); }

    async getEmailMode(key) { return this.get(`email_mode:${key}`); }
    async setEmailMode(key, value, ttl = 3600) { return this.set(`email_mode:${key}`, value, ttl); }
    async deleteEmailMode(key) { return this.delete(`email_mode:${key}`); }

    async getGiveawayMode(key) { return this.get(`giveaway_mode:${key}`); }
    async setGiveawayMode(key, value, ttl = 3600) { return this.set(`giveaway_mode:${key}`, value, ttl); }
    async deleteGiveawayMode(key) { return this.delete(`giveaway_mode:${key}`); }

    async getSupportMode(key) { return this.get(`support_mode:${key}`); }
    async setSupportMode(key, value, ttl = 3600) { return this.set(`support_mode:${key}`, value, ttl); }
    async deleteSupportMode(key) { return this.delete(`support_mode:${key}`); }

    async getHanorkAssistMode(key) { return this.get(`hanork_assist:${key}`); }
    async setHanorkAssistMode(key, value, ttl = 7200) { return this.set(`hanork_assist:${key}`, value, ttl); }
    async deleteHanorkAssistMode(key) { return this.delete(`hanork_assist:${key}`); }

    async getHanorkRouterContext(key) { return this.get(`hanork_router_ctx:${key}`); }
    async setHanorkRouterContext(key, value, ttl = 7200) { return this.set(`hanork_router_ctx:${key}`, value, ttl); }
    async deleteHanorkRouterContext(key) { return this.delete(`hanork_router_ctx:${key}`); }

    async getActiveChat(key) { return this.get(`active_chat:${key}`); }
    async setActiveChat(key, value, ttl = 3600) { return this.set(`active_chat:${key}`, value, ttl); }
    async deleteActiveChat(key) { return this.delete(`active_chat:${key}`); }

    async getLastMenuMsg(key) { return this.get(`last_menu:${key}`); }
    async setLastMenuMsg(key, value, ttl = 3600) { return this.set(`last_menu:${key}`, value, ttl); }
    async deleteLastMenuMsg(key) { return this.delete(`last_menu:${key}`); }

    async getCart(key) { return this.get(`cart:${key}`); }
    async setCart(key, value, ttl = 3600) { return this.set(`cart:${key}`, value, ttl); }
    async deleteCart(key) { return this.delete(`cart:${key}`); }
    async hasCart(key) { return this.has(`cart:${key}`); }

    async isCartAbandonedNotified(key) { return this.has(`abandoned:${key}`); }
    async setCartAbandonedNotified(key, ttl = 86400) { return this.set(`abandoned:${key}`, '1', ttl); }

    async getBroadcastMode(key) { return this.get(`broadcast:${key}`); }
    async setBroadcastMode(key, value, ttl = 3600) { return this.set(`broadcast:${key}`, value, ttl); }
    async deleteBroadcastMode(key) { return this.delete(`broadcast:${key}`); }

    async getAddProductMode(key) { return this.get(`add_prod:${key}`); }
    async setAddProductMode(key, value, ttl = 3600) { return this.set(`add_prod:${key}`, value, ttl); }
    async deleteAddProductMode(key) { return this.delete(`add_prod:${key}`); }

    async getEditProductMode(key) { return this.get(`edit_prod:${key}`); }
    async setEditProductMode(key, value, ttl = 3600) { return this.set(`edit_prod:${key}`, value, ttl); }
    async deleteEditProductMode(key) { return this.delete(`edit_prod:${key}`); }

    async getAdminMsgTarget(key) { return this.get(`admin_msg:${key}`); }
    async setAdminMsgTarget(key, value, ttl = 3600) { return this.set(`admin_msg:${key}`, value, ttl); }
    async deleteAdminMsgTarget(key) { return this.delete(`admin_msg:${key}`); }

    async getUserState(userId, key) { return this.get(`user:${userId}:${key}`); }
    async setUserState(userId, key, value, ttl = 3600) { return this.set(`user:${userId}:${key}`, value, ttl); }

    save() { /* no-op — Redis/fallback gerencia TTL */ }
    load() { return null; }
    clear() { /* no-op */ }
}

module.exports = { StateManager, isPendingPurchaseIndexEnabled };
