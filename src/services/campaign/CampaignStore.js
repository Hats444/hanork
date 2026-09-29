'use strict';

const logger = require('../../config/logger');
const { dayKey } = require('./campaignTimeWindows');

const DEFAULT_CAMPAIGNS = [
    { code: 'tg_group_hanork_00', campaign_type: 'hanork', channel: 'telegram_group', slot_hour: 0, interval_hours: 6 },
    { code: 'tg_group_hanork_06', campaign_type: 'hanork', channel: 'telegram_group', slot_hour: 6, interval_hours: 6 },
    { code: 'tg_group_smm_12', campaign_type: 'smm', channel: 'telegram_group', slot_hour: 12, interval_hours: 6 },
    { code: 'tg_group_smm_18', campaign_type: 'smm', channel: 'telegram_group', slot_hour: 18, interval_hours: 6 },
    { code: 'tg_pv_hanork_08', campaign_type: 'hanork', channel: 'telegram_pv', slot_hour: 8, interval_hours: 24 },
    { code: 'tg_pv_smm_18', campaign_type: 'smm', channel: 'telegram_pv', slot_hour: 18, interval_hours: 24 },
];

class CampaignStore {
    constructor(dbRaw) {
        this.dbRaw = dbRaw;
    }

    _db() {
        return typeof this.dbRaw === 'function' ? this.dbRaw() : this.dbRaw;
    }

    ensureSeeded() {
        const db = this._db();
        if (!db) return;
        const insert = db.prepare(
            `INSERT OR IGNORE INTO campaigns (code, campaign_type, channel, slot_hour, interval_hours, active)
             VALUES (?, ?, ?, ?, ?, 1)`
        );
        for (const c of DEFAULT_CAMPAIGNS) {
            insert.run(c.code, c.campaign_type, c.channel, c.slot_hour, c.interval_hours);
        }
    }

    isSlotCompleted(slotKey) {
        const db = this._db();
        if (!db || !slotKey) return false;
        const row = db
            .prepare(
                `SELECT 1 FROM campaign_deliveries
                 WHERE dest_type = 'slot' AND dest_id = ? AND status IN ('sent','edited','completed')
                 LIMIT 1`
            )
            .get(slotKey);
        return !!row;
    }

    markSlotCompleted(slotKey, { campaignType, channel, stats = null } = {}) {
        const db = this._db();
        if (!db || !slotKey) return;
        const day = dayKey();
        try {
            db.prepare(
                `INSERT OR IGNORE INTO campaign_deliveries
                 (campaign_type, channel, dest_type, dest_id, day_key, slot_key, status, meta_json)
                 VALUES (?, ?, 'slot', ?, ?, ?, 'completed', ?)`
            ).run(
                campaignType || 'unknown',
                channel || 'unknown',
                slotKey,
                day,
                slotKey,
                stats ? JSON.stringify(stats) : null
            );
        } catch (e) {
            logger.warn('[CampaignStore] markSlotCompleted:', e.message);
        }
    }

    countUserCampaignsToday(destId, day = dayKey()) {
        const db = this._db();
        if (!db || destId == null) return 0;
        const row = db
            .prepare(
                `SELECT COUNT(*) AS c FROM campaign_deliveries
                 WHERE dest_type = 'user' AND dest_id = ? AND day_key = ?
                   AND status IN ('sent','edited')`
            )
            .get(String(destId), day);
        return row?.c || 0;
    }

    hasUserCampaignTypeToday(destId, campaignType, day = dayKey()) {
        const db = this._db();
        if (!db || destId == null) return false;
        const row = db
            .prepare(
                `SELECT 1 FROM campaign_deliveries
                 WHERE dest_type = 'user' AND dest_id = ? AND day_key = ?
                   AND campaign_type = ? AND status IN ('sent','edited')
                 LIMIT 1`
            )
            .get(String(destId), day, campaignType);
        return !!row;
    }

    canDeliverUser(destId, campaignType, { maxPerDay = 2 } = {}) {
        const day = dayKey();
        if (this.hasUserCampaignTypeToday(destId, campaignType, day)) {
            return { ok: false, reason: 'type_already_sent_today' };
        }
        if (this.countUserCampaignsToday(destId, day) >= maxPerDay) {
            return { ok: false, reason: 'daily_cap' };
        }
        return { ok: true };
    }

    recordUserDelivery(destId, { campaignType, channel, status, messageId = null, slotKey = null, meta = null } = {}) {
        const db = this._db();
        if (!db || destId == null) return;
        const day = dayKey();
        try {
            db.prepare(
                `INSERT INTO campaign_deliveries
                 (campaign_type, channel, dest_type, dest_id, day_key, slot_key, status, message_id, meta_json)
                 VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?)`
            ).run(
                campaignType,
                channel,
                String(destId),
                day,
                slotKey,
                status,
                messageId != null ? String(messageId) : null,
                meta ? JSON.stringify(meta) : null
            );
        } catch (e) {
            if (!String(e.message).includes('UNIQUE')) {
                logger.warn('[CampaignStore] recordUserDelivery:', e.message);
            }
        }
    }

    recordHistory({ slotKey, campaignType, channel, source, stats, startedAt, finishedAt }) {
        const db = this._db();
        if (!db) return;
        try {
            db.prepare(
                `INSERT INTO campaign_history (slot_key, campaign_type, channel, source, started_at, finished_at, stats_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).run(
                slotKey,
                campaignType,
                channel,
                source || 'auto',
                startedAt ? new Date(startedAt).toISOString() : new Date().toISOString(),
                finishedAt ? new Date(finishedAt).toISOString() : new Date().toISOString(),
                stats ? JSON.stringify(stats) : null
            );
        } catch (e) {
            logger.warn('[CampaignStore] recordHistory:', e.message);
        }
    }

    enqueueSlotRetry({ idempotencyKey, campaignType, channel, runAtMs, payload = null }) {
        const db = this._db();
        if (!db || !idempotencyKey) return false;
        try {
            db.prepare(
                `INSERT OR IGNORE INTO campaign_queue
                 (idempotency_key, campaign_type, channel, run_at_ms, payload_json, status)
                 VALUES (?, ?, ?, ?, ?, 'pending')`
            ).run(
                idempotencyKey,
                campaignType,
                channel,
                runAtMs,
                payload ? JSON.stringify(payload) : null
            );
            return true;
        } catch (e) {
            logger.warn('[CampaignStore] enqueueSlotRetry:', e.message);
            return false;
        }
    }

    listDueQueueRetries(nowMs = Date.now()) {
        const db = this._db();
        if (!db) return [];
        try {
            return db
                .prepare(
                    `SELECT id, idempotency_key, campaign_type, channel, run_at_ms, payload_json
                     FROM campaign_queue
                     WHERE status = 'pending' AND run_at_ms <= ?
                     ORDER BY run_at_ms ASC
                     LIMIT 10`
                )
                .all(nowMs);
        } catch {
            return [];
        }
    }

    markQueueDone(idempotencyKey, status = 'done') {
        const db = this._db();
        if (!db || !idempotencyKey) return;
        try {
            db.prepare(
                `UPDATE campaign_queue SET status = ?, updated_at = datetime('now') WHERE idempotency_key = ?`
            ).run(status, idempotencyKey);
        } catch (e) {
            logger.warn('[CampaignStore] markQueueDone:', e.message);
        }
    }
}

let singleton = null;

function getCampaignStore(dbRaw) {
    if (!singleton || dbRaw) {
        singleton = new CampaignStore(dbRaw);
        try {
            singleton.ensureSeeded();
        } catch (e) {
            logger.warn('[CampaignStore] seed:', e.message);
        }
    }
    return singleton;
}

module.exports = { CampaignStore, getCampaignStore };
