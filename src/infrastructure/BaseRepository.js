/**
 * BaseRepository - Classe base para Repository Pattern
 * Centraliza acesso a dados com tenant isolation via tenantScope.js
 */

const dbRaw = require('../config/database-sqlite').connect;
const { appendTenantWhere, getScopeFromContext, tenantSql } = require('../modules/tenant/tenantScope');
const logger = require('../config/logger');

class BaseRepository {
    constructor(tableName, options = {}) {
        this.table = tableName;
        this.hasTenant = options.hasTenant !== false;
        this.tenantColumn = options.tenantColumn || 'tenant_id';
    }

    getDb() {
        return dbRaw();
    }

    /** @deprecated Use getScopeFromContext() via _scope() */
    getTenantId() {
        const s = getScopeFromContext();
        if (s.mode === 'tenant' && s.tenantId != null) return s.tenantId;
        return null;
    }

    _scope() {
        return getScopeFromContext();
    }

    /** Aplica filtro tenant (legacy IS NULL / tenant = ? / platform 1=1) */
    _applyTenant(sql, params, column = null) {
        if (!this.hasTenant) return { sql, params };
        return appendTenantWhere(sql, params, column || this.tenantColumn);
    }

    /** Clausula AND qualificada para JOINs: ` AND p.tenant_id = ?` */
    _tenantClause(qualifiedColumn = null) {
        if (!this.hasTenant) return { clause: '', params: [] };
        const col = qualifiedColumn || this.tenantColumn;
        const t = tenantSql(col, getScopeFromContext());
        if (t.clause === '1=1') return { clause: '', params: [] };
        return { clause: ` AND ${t.clause}`, params: [...t.params] };
    }

    _tenantIdForInsert() {
        if (!this.hasTenant) return null;
        const s = getScopeFromContext();
        if (s.mode === 'tenant' && s.tenantId != null) return s.tenantId;
        return null;
    }

    async find(conditions = {}, options = {}) {
        const where = [];
        const values = [];

        for (const [key, val] of Object.entries(conditions)) {
            if (val === undefined) continue;
            where.push(`${key} = ?`);
            values.push(val);
        }

        let sql = `SELECT * FROM ${this.table}`;
        if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
        if (options.orderBy) sql += ` ORDER BY ${options.orderBy} ${options.orderDesc ? 'DESC' : 'ASC'}`;
        if (options.limit) sql += ` LIMIT ${options.limit}`;

        const { sql: scopedSql, params } = this._applyTenant(sql, values);
        return this.getDb().prepare(scopedSql).all(...params);
    }

    async findById(id) {
        let sql = `SELECT * FROM ${this.table} WHERE id = ?`;
        const { sql: scopedSql, params } = this._applyTenant(sql, [id]);
        return this.getDb().prepare(scopedSql).get(...params);
    }

    async findOne(conditions) {
        const results = await this.find(conditions, { limit: 1 });
        return results[0] || null;
    }

    async count(conditions = {}) {
        const where = [];
        const values = [];

        for (const [key, val] of Object.entries(conditions)) {
            if (val === undefined) continue;
            where.push(`${key} = ?`);
            values.push(val);
        }

        let sql = `SELECT COUNT(*) as c FROM ${this.table}`;
        if (where.length) sql += ` WHERE ${where.join(' AND ')}`;

        const { sql: scopedSql, params } = this._applyTenant(sql, values);
        return this.getDb().prepare(scopedSql).get(...params)?.c || 0;
    }

    async create(data) {
        const fields = { ...data };
        const tenantId = this._tenantIdForInsert();
        if (tenantId != null) {
            fields[this.tenantColumn] = tenantId;
        }

        const keys = Object.keys(fields);
        const values = Object.values(fields);
        const placeholders = keys.map(() => '?').join(',');

        const sql = `INSERT INTO ${this.table} (${keys.join(',')}) VALUES (${placeholders})`;

        try {
            const result = this.getDb().prepare(sql).run(...values);
            return { id: result.lastInsertRowid, ...fields };
        } catch (err) {
            logger.error(`[REPO] Create error: ${err.message}`);
            throw err;
        }
    }

    async update(id, data) {
        const sets = Object.keys(data).map((k) => `${k} = ?`).join(',');
        const values = [...Object.values(data), id];

        let sql = `UPDATE ${this.table} SET ${sets} WHERE id = ?`;
        const { sql: scopedSql, params } = this._applyTenant(sql, values);
        return this.getDb().prepare(scopedSql).run(...params);
    }

    async delete(id) {
        let sql = `DELETE FROM ${this.table} WHERE id = ?`;
        const { sql: scopedSql, params } = this._applyTenant(sql, [id]);
        return this.getDb().prepare(scopedSql).run(...params);
    }

    /** SELECT .get() com escopo tenant */
    _getScoped(baseSql, params = []) {
        const { sql, params: scopedParams } = this._applyTenant(baseSql, params);
        return this.getDb().prepare(sql).get(...scopedParams);
    }

    /** SELECT .all() com escopo tenant */
    _allScoped(baseSql, params = []) {
        const { sql, params: scopedParams } = this._applyTenant(baseSql, params);
        return this.getDb().prepare(sql).all(...scopedParams);
    }

    /** UPDATE/DELETE .run() com escopo tenant */
    _runScoped(baseSql, params = []) {
        const { sql, params: scopedParams } = this._applyTenant(baseSql, params);
        return this.getDb().prepare(sql).run(...scopedParams);
    }
}

module.exports = BaseRepository;
