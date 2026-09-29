/**
 * UserRepository - Repository Pattern para usuários
 * Centraliza todas as queries SQL relacionadas a users
 */

const BaseRepository = require('../../infrastructure/BaseRepository');

class UserRepository extends BaseRepository {
    constructor() {
        super('users', { hasTenant: true, tenantColumn: 'tenant_id' });
    }

    /**
     * Busca usuário por telegram_id (campo único por tenant)
     */
    async findByTelegramId(telegramId) {
        return this._getScoped(
            `SELECT * FROM ${this.table} WHERE telegram_id = ?`,
            [String(telegramId)]
        );
    }

    /**
     * Cria ou atualiza usuário (upsert)
     */
    async upsert(telegramId, userData) {
        const existing = await this.findByTelegramId(telegramId);

        if (existing) {
            await this.update(existing.id, userData);
            return { ...existing, ...userData };
        }

        return this.create({
            telegram_id: String(telegramId),
            ...userData,
        });
    }

    /**
     * Lista usuários recentes (últimos N dias)
     */
    async findRecent(days = 7) {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        return this._allScoped(
            `SELECT * FROM ${this.table} WHERE created_at > ? ORDER BY created_at DESC`,
            [cutoff]
        );
    }

    /**
     * Busca usuários com pedidos (clientes ativos)
     */
    async findWithOrders() {
        const tu = this._tenantClause('u.tenant_id');
        const to = this._tenantClause('o.tenant_id');

        let sql = `
            SELECT DISTINCT u.* FROM ${this.table} u
            JOIN orders o ON o.user_id = u.id
            WHERE o.status IN ('PAID', 'DELIVERED')
        `;
        const values = [];
        sql += tu.clause;
        values.push(...tu.params);
        sql += to.clause;
        values.push(...to.params);

        return this.getDb().prepare(sql).all(...values);
    }

    /**
     * Atualiza dados do perfil
     */
    async updateProfile(userId, data) {
        const allowed = ['first_name', 'last_name', 'username', 'email', 'email_verified'];
        const updates = {};

        for (const key of allowed) {
            if (data[key] !== undefined) {
                updates[key] = data[key];
            }
        }

        if (Object.keys(updates).length === 0) return null;

        return this.update(userId, updates);
    }
}

module.exports = new UserRepository();
