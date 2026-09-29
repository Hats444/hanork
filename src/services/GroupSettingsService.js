'use strict';

/**
 * Configurações persistentes de grupos (kv_store).
 * VIP, suporte, cooldown de divulgação, filtro admin.
 */

const KEYS = {
    VIP: 'settings:vip_group_id',
    SUPPORT: 'settings:support_group_id',
    SUPPORT_URL: 'settings:support_url',
    VIP_URL: 'settings:vip_group_url',
    COOLDOWN_MIN: 'settings:group_cooldown_minutes',
    REQUIRE_ADMIN: 'settings:broadcast_require_admin',
};

const { withSqliteRetry } = require('../utils/sqliteRetry');

class GroupSettingsService {
    constructor(dbRaw) {
        this.dbRaw = dbRaw;
        this._ensureDefaults();
    }

    _ensureDefaults() {
        if (this._get(KEYS.REQUIRE_ADMIN) === null) {
            const env = String(process.env.BROADCAST_REQUIRE_ADMIN || '').toLowerCase();
            const fromEnv = env === '1' || env === 'true' || env === 'yes';
            const fromEnvOff = env === '0' || env === 'false' || env === 'no';
            this.setRequireAdmin(fromEnv && !fromEnvOff);
        }
        // Legado: support_url sobrescrevia contato pessoal — migrar para link de grupo
        const legacy = this._get(KEYS.SUPPORT_URL);
        if (legacy && String(legacy).trim()) {
            const v = String(legacy).trim();
            if (!this._get(KEYS.VIP_URL) && (v.includes('t.me/+') || v.includes('/joinchat/'))) {
                this._set(KEYS.VIP_URL, v);
            }
            withSqliteRetry(() => {
                this._db().prepare('DELETE FROM kv_store WHERE key=?').run(KEYS.SUPPORT_URL);
            });
        }
    }

    _db() {
        return this.dbRaw();
    }

    _get(key) {
        return withSqliteRetry(
            () => this._db().prepare('SELECT value FROM kv_store WHERE key=?').get(key)?.value ?? null
        );
    }

    _set(key, value) {
        withSqliteRetry(() => {
            this._db()
                .prepare(
                    `INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))`
                )
                .run(key, String(value));
        });
    }

    getVipGroupId() {
        const stored = this._get(KEYS.VIP);
        if (stored) {
            const id = parseInt(stored, 10);
            return Number.isNaN(id) ? null : id;
        }
        const env = process.env.GRUPO_ID;
        if (!env) return null;
        const id = parseInt(env, 10);
        return Number.isNaN(id) ? null : id;
    }

    setVipGroupId(chatId) {
        this._set(KEYS.VIP, String(chatId));
    }

    getSupportGroupId() {
        const stored = this._get(KEYS.SUPPORT);
        if (stored) {
            const id = parseInt(stored, 10);
            return Number.isNaN(id) ? null : id;
        }
        const env = process.env.SUPPORT_GROUP_ID || process.env.GRUPO_SUPORTE_ID;
        if (!env) return null;
        const id = parseInt(env, 10);
        return Number.isNaN(id) ? null : id;
    }

    setSupportGroupId(chatId) {
        this._set(KEYS.SUPPORT, String(chatId));
    }

    /** Contato humano de suporte — sempre do .env, nunca sobrescrito por /atualizarlink */
    getContactUrl() {
        return process.env.CONTATO_ESPECIALISTA || 'https://t.me/hanorkoff';
    }

    /** Link do botão «Referências» no menu — canal @hanorkinfos (fallback legado: kv / LINKGP). */
    getVipGroupUrl() {
        try {
            const { getSalesRefChannelUrl } = require('../config/salesReferenceChannel');
            const channel = getSalesRefChannelUrl();
            if (channel) return channel;
        } catch {
            /* ignore */
        }
        const stored = this._get(KEYS.VIP_URL);
        if (stored && String(stored).trim()) return String(stored).trim();
        return process.env.SALES_REF_CHANNEL_LINK || process.env.LINKGP || 'https://t.me/hanorkinfos';
    }

    setVipGroupUrl(url) {
        this._set(KEYS.VIP_URL, String(url || '').trim());
    }

    clearVipGroupId() {
        withSqliteRetry(() => {
            this._db().prepare('DELETE FROM kv_store WHERE key=?').run(KEYS.VIP);
        });
    }

    clearSupportGroupId() {
        withSqliteRetry(() => {
            this._db().prepare('DELETE FROM kv_store WHERE key=?').run(KEYS.SUPPORT);
        });
    }

    /** Minutos entre divulgações por grupo; 0 = sem cooldown */
    getCooldownMinutes() {
        const v = this._get(KEYS.COOLDOWN_MIN);
        if (v === null || v === '') return 30;
        const n = parseInt(v, 10);
        return Number.isNaN(n) ? 30 : Math.max(0, n);
    }

    setCooldownMinutes(minutes) {
        this._set(KEYS.COOLDOWN_MIN, String(Math.max(0, minutes)));
    }

    isCooldownEnabled() {
        return this.getCooldownMinutes() > 0;
    }

    toggleCooldown() {
        const on = this.isCooldownEnabled();
        this.setCooldownMinutes(on ? 0 : 30);
        return !on;
    }

    /** Se true, só grupos onde o bot é admin entram na divulgação (padrão: todos ativos) */
    isRequireAdmin() {
        const v = this._get(KEYS.REQUIRE_ADMIN);
        if (v === null) return false;
        return v === '1';
    }

    toggleRequireAdmin() {
        const next = !this.isRequireAdmin();
        this.setRequireAdmin(next);
        return next;
    }

    setRequireAdmin(requireAdmin) {
        this._set(KEYS.REQUIRE_ADMIN, requireAdmin ? '1' : '0');
    }

    getGroupLabel(db, chatId) {
        if (!chatId) return '—';
        const row = db
            .prepare('SELECT title FROM telegram_groups WHERE chat_id=?')
            .get(String(chatId));
        return row?.title || String(chatId);
    }

    formatConfigSummary(db) {
        const vip = this.getVipGroupId();
        const sup = this.getSupportGroupId();
        const cd = this.getCooldownMinutes();
        const reqAdmin = this.isRequireAdmin();
        const vipLink = this.getVipGroupUrl();
        const contact = this.getContactUrl();
        return (
            `⭐ <b>VIP:</b> ${vip ? this.getGroupLabel(db, vip) : '—'} <code>${vip || ''}</code>\n` +
            `🎫 <b>Suporte (tickets):</b> ${sup ? this.getGroupLabel(db, sup) : '—'} <code>${sup || ''}</code>\n` +
            `👥 <b>Link grupo:</b> <code>${vipLink}</code>\n` +
            `📞 <b>Contato suporte:</b> <code>${contact}</code>\n` +
            `⏱️ <b>Cooldown:</b> ${cd > 0 ? `${cd} min/grupo` : '🔴 Desligado'}\n` +
            `🔐 <b>Divulgação:</b> ${reqAdmin ? 'Só onde bot é admin' : 'Todos os grupos ativos'}`
        );
    }
}

module.exports = { GroupSettingsService, SETTINGS_KEYS: KEYS };
