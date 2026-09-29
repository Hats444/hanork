'use strict';

const logger = require('../../config/logger');
const {
    Violation,
    formatRemaining,
    logReason,
} = require('./BanMessages');

/**
 * Anti-spam com advertências, bans progressivos e mensagens claras por violação.
 */
class AntiSpamService {
    constructor(options = {}) {
        this.adminIds = options.adminIds || [];
        this.WINDOWS = [
            { ms: 1000, max: 5, code: Violation.RATE_1S },
            { ms: 5000, max: 14, code: Violation.RATE_5S },
            { ms: 30000, max: 35, code: Violation.RATE_30S },
        ];
        this.CB_COOLDOWN = 400;
        this.MSG_COOLDOWN = 350;
        this.WARN_BEFORE_BAN = 2;
        this.BAN_STEPS = [30, 120, 600, 1800, 86400];
        this.BLACKLIST_AT = 5;
        this.BAN_NOTIFY_COOLDOWN_MS = 45000;

        this.msgs = new Map();
        this.cbCool = new Map();
        this.lastMsg = new Map();
        this.msgText = new Map();
        this.warnings = new Map();
        this.memBans = new Map();
        this.lastBanNotify = new Map();

        this._db = null;
        setInterval(() => this._cleanup(), 120000);
    }

    setAdminIds(ids) {
        this.adminIds = ids || [];
    }

    initDb(db) {
        this._db = db;
        const now = Date.now();
        try {
            const rows = db.prepare(`
                SELECT user_id, ban_count, expiry, permanent, reason, violation_code
                FROM spam_bans
                WHERE permanent = 1 OR expiry > ?
            `).all(now);
            for (const r of rows) {
                this.memBans.set(r.user_id, {
                    expiry: r.expiry,
                    count: r.ban_count || 0,
                    permanent: r.permanent === 1,
                    violation: r.violation_code || r.reason || Violation.RATE_5S,
                    reason: r.reason || null,
                });
            }
            logger.info(`[AntiSpam] ${rows.length} penalidade(s) restaurada(s) do banco`);
        } catch (e) {
            logger.warn('[AntiSpam] initDb', { message: e?.message });
        }
    }

    _persist(uid, b) {
        if (!this._db || !b) return;
        try {
            const reason = b.reason || logReason(b.violation || Violation.RATE_5S);
            this._db.prepare(`
                INSERT INTO spam_bans (user_id, ban_count, expiry, permanent, reason, violation_code, telegram_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(user_id) DO UPDATE SET
                    ban_count = excluded.ban_count,
                    expiry = excluded.expiry,
                    permanent = excluded.permanent,
                    reason = excluded.reason,
                    violation_code = excluded.violation_code,
                    telegram_id = excluded.telegram_id,
                    updated_at = excluded.updated_at
            `).run(
                uid,
                b.count,
                b.expiry,
                b.permanent ? 1 : 0,
                reason,
                b.violation || Violation.RATE_5S,
                String(uid)
            );
        } catch (e) {
            logger.warn('[AntiSpam] persist', { uid, message: e?.message });
        }
    }

    _cleanup() {
        const now = Date.now();
        const maxW = Math.max(...this.WINDOWS.map((w) => w.ms));
        for (const [k, v] of this.msgs) {
            const f = v.filter((t) => now - t < maxW);
            f.length ? this.msgs.set(k, f) : this.msgs.delete(k);
        }
        for (const [k, v] of this.cbCool) {
            if (now - v > 30000) this.cbCool.delete(k);
        }
        for (const [k, v] of this.lastMsg) {
            if (now - v > 60000) this.lastMsg.delete(k);
        }
        for (const [k, v] of this.msgText) {
            if (now - v.ts > 60000) this.msgText.delete(k);
        }
        for (const [k, v] of this.warnings) {
            if (now - v.ts > 300000) this.warnings.delete(k);
        }
        for (const [k, v] of this.memBans) {
            if (!v.permanent && v.expiry < now) this.memBans.delete(k);
        }
        for (const [k, t] of this.lastBanNotify) {
            if (now - t > 300000) this.lastBanNotify.delete(k);
        }
        if (this._db) {
            try {
                this._db.prepare('DELETE FROM spam_bans WHERE permanent = 0 AND expiry < ?').run(now);
            } catch { /* ignore */ }
        }
    }

    isBanned(uid) {
        const b = this.memBans.get(uid);
        if (!b) return { banned: false };
        if (b.permanent) {
            return {
                banned: true,
                permanent: true,
                violation: b.violation || Violation.BLACKLIST,
                count: b.count,
                reason: b.reason,
            };
        }
        if (Date.now() > b.expiry) {
            this.memBans.delete(uid);
            return { banned: false };
        }
        return {
            banned: true,
            expiry: b.expiry,
            count: b.count,
            violation: b.violation || Violation.RATE_5S,
            reason: b.reason,
            remaining: formatRemaining(b.expiry),
        };
    }

    _shouldNotifyBan(uid) {
        const last = this.lastBanNotify.get(uid) || 0;
        if (Date.now() - last < this.BAN_NOTIFY_COOLDOWN_MS) return false;
        this.lastBanNotify.set(uid, Date.now());
        return true;
    }

    shouldNotifyUser(uid) {
        return this._shouldNotifyBan(uid);
    }

    _recordWarning(uid, violation) {
        const w = this.warnings.get(uid) || { count: 0, ts: Date.now(), lastViolation: violation };
        w.count++;
        w.ts = Date.now();
        w.lastViolation = violation;
        this.warnings.set(uid, w);
        return w.count;
    }

    _ban(uid, violation) {
        const b = this.memBans.get(uid) || { expiry: 0, count: 0, permanent: false, violation };
        b.count++;
        b.violation = violation;
        b.reason = logReason(violation);

        if (b.count >= this.BLACKLIST_AT) {
            b.permanent = true;
            b.expiry = 0;
            b.violation = Violation.BLACKLIST;
            this.memBans.set(uid, b);
            this._persist(uid, b);
            logger.spam(uid, {
                event: 'BLACKLIST',
                strike: b.count,
                violation: Violation.BLACKLIST,
                detail: logReason(Violation.BLACKLIST),
            });
            return {
                permanent: true,
                duration: Infinity,
                count: b.count,
                violation: Violation.BLACKLIST,
                notify: true,
            };
        }

        const secs = this.BAN_STEPS[Math.min(b.count - 1, this.BAN_STEPS.length - 1)];
        b.expiry = Date.now() + secs * 1000;
        this.memBans.set(uid, b);
        this._persist(uid, b);
        this.warnings.delete(uid);

        logger.spam(uid, {
            event: 'BAN',
            strike: b.count,
            durationSec: secs,
            violation,
            detail: logReason(violation),
        });

        return {
            permanent: false,
            duration: secs,
            count: b.count,
            violation,
            expiry: b.expiry,
            notify: this._shouldNotifyBan(uid),
        };
    }

    _applyViolation(uid, violation) {
        const warnCount = this._recordWarning(uid, violation);
        if (warnCount < this.WARN_BEFORE_BAN) {
            logger.spam(uid, {
                event: 'WARN',
                strike: warnCount,
                violation,
                detail: logReason(violation),
            });
            return {
                allowed: false,
                reason: 'warning',
                violation,
                warnCount,
                warnsLeft: this.WARN_BEFORE_BAN - warnCount,
                notify: this._shouldNotifyBan(uid),
            };
        }
        const info = this._ban(uid, violation);
        return { allowed: false, reason: 'flood_ban', ...info };
    }

    _isRepeat(uid, text) {
        if (!text || text.startsWith('/')) return false;
        const entry = this.msgText.get(uid) || { texts: [], ts: 0 };
        entry.ts = Date.now();
        entry.texts.push(text.trim().toLowerCase().slice(0, 80));
        if (entry.texts.length > 10) entry.texts.shift();
        this.msgText.set(uid, entry);
        const last5 = entry.texts.slice(-5);
        const last = last5[last5.length - 1];
        if (!last || last.length < 3) return false;
        return last5.filter((t) => t === last).length >= 4;
    }

    check(uid, text = '') {
        if (this.adminIds.includes(uid)) return { allowed: true };

        const bs = this.isBanned(uid);
        if (bs.banned) {
            if (bs.permanent) {
                return {
                    allowed: false,
                    reason: 'blacklist',
                    violation: bs.violation || Violation.BLACKLIST,
                    notify: this._shouldNotifyBan(uid),
                };
            }
            const remaining = formatRemaining(bs.expiry);
            return {
                allowed: false,
                reason: 'banned',
                expiry: bs.expiry,
                count: bs.count,
                violation: bs.violation,
                remaining,
                notify: this._shouldNotifyBan(uid),
            };
        }

        const now = Date.now();
        const lastT = this.lastMsg.get(uid) || 0;
        if (now - lastT < this.MSG_COOLDOWN) {
            return {
                allowed: false,
                reason: 'cooldown',
                violation: Violation.COOLDOWN,
                retryAfterMs: this.MSG_COOLDOWN - (now - lastT),
                notify: false,
            };
        }
        this.lastMsg.set(uid, now);

        const history = this.msgs.get(uid) || [];
        history.push(now);
        this.msgs.set(uid, history);

        for (const { ms, max, code } of this.WINDOWS) {
            if (history.filter((t) => now - t <= ms).length > max) {
                return this._applyViolation(uid, code);
            }
        }

        if (this._isRepeat(uid, text)) {
            return this._applyViolation(uid, Violation.DUPLICATE_TEXT);
        }

        return { allowed: true };
    }

    checkCallback(chatId, action, uid = null) {
        if (uid && this.adminIds.includes(uid)) return true;

        const key = `${chatId}:${action}`;
        const keyAll = `${chatId}:*`;
        const now = Date.now();
        const lastAll = this.cbCool.get(keyAll) || 0;

        if (now - lastAll < this.CB_COOLDOWN) {
            const lastSpecific = this.cbCool.get(key) || 0;
            if (now - lastSpecific < this.CB_COOLDOWN / 2) {
                if (uid) {
                    logger.spam(uid, {
                        event: 'CB_COOLDOWN',
                        violation: Violation.CALLBACK_FLOOD,
                        detail: action,
                    });
                }
                return false;
            }
        }

        this.cbCool.set(key, now);
        this.cbCool.set(keyAll, now);
        return true;
    }

    getCallbackCooldownMs(chatId, action) {
        const key = `${chatId}:${action}`;
        const keyAll = `${chatId}:*`;
        const now = Date.now();
        const last = Math.max(this.cbCool.get(key) || 0, this.cbCool.get(keyAll) || 0);
        const remaining = this.CB_COOLDOWN - (now - last);
        return remaining > 0 ? remaining : 0;
    }

    banUser(uid, permanent = false, reason = null, violation = Violation.MANUAL) {
        const b = this.memBans.get(uid) || { expiry: 0, count: 0, permanent: false };
        if (permanent) {
            b.permanent = true;
            b.expiry = 0;
            b.violation = Violation.BLACKLIST;
            b.reason = reason || logReason(Violation.MANUAL);
        } else {
            b.count = Math.max(b.count, 1);
            const secs = this.BAN_STEPS[Math.min(b.count - 1, this.BAN_STEPS.length - 1)];
            b.expiry = Date.now() + secs * 1000;
            b.violation = violation;
            b.reason = reason || logReason(violation);
        }
        this.memBans.set(uid, b);
        this._persist(uid, b);
        this.lastBanNotify.delete(uid);
        logger.spam(uid, {
            event: permanent ? 'MANUAL_PERMANENT' : 'MANUAL_TEMP',
            violation: b.violation,
            detail: b.reason,
        });
    }

    unbanUser(uid) {
        this.memBans.delete(uid);
        this.msgs.delete(uid);
        this.lastMsg.delete(uid);
        this.msgText.delete(uid);
        this.warnings.delete(uid);
        this.lastBanNotify.delete(uid);
        if (this._db) {
            try {
                this._db.prepare('DELETE FROM spam_bans WHERE user_id = ? OR telegram_id = ?').run(uid, String(uid));
            } catch { /* ignore */ }
        }
        logger.info(`[AntiSpam] usuário ${uid} desbanido`);
    }

    getStats() {
        const vals = [...this.memBans.values()];
        const permanent = vals.filter((b) => b.permanent).length;
        const temp = vals.filter((b) => !b.permanent && b.expiry > Date.now()).length;
        return {
            trackedUsers: this.msgs.size,
            bannedUsers: temp,
            blacklisted: permanent,
            warnedUsers: this.warnings.size,
            totalPenalties: vals.length,
        };
    }

    getRecentBans(limit = 8) {
        if (!this._db) return [];
        try {
            return this._db.prepare(`
                SELECT user_id, ban_count, expiry, permanent, reason, violation_code, updated_at
                FROM spam_bans
                WHERE permanent = 1 OR expiry > ?
                ORDER BY updated_at DESC
                LIMIT ?
            `).all(Date.now(), limit);
        } catch {
            return [];
        }
    }

    /** Compatibilidade painel admin legado */
    get WARN_LIMIT() {
        return this.WARN_BEFORE_BAN;
    }
    get MAX_ACTIONS() {
        return this.WINDOWS[1]?.max ?? 14;
    }
    get WINDOW() {
        return this.WINDOWS[1]?.ms ?? 5000;
    }
    get BAN_DURATION() {
        return (this.BAN_STEPS[0] || 30) * 1000;
    }
}

module.exports = AntiSpamService;
