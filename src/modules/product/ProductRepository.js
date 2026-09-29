/**
 * ProductRepository - Repository Pattern para produtos
 * Centraliza todas as queries SQL relacionadas a products
 */

const BaseRepository = require('../../infrastructure/BaseRepository');

class ProductRepository extends BaseRepository {
    constructor() {
        super('products', { hasTenant: true, tenantColumn: 'tenant_id' });
    }

    /**
     * Lista apenas produtos ativos
     */
    async findActive(options = {}) {
        const conditions = { active: 1, ...options };
        return this.find(conditions);
    }

    /**
     * Busca produtos por categoria
     */
    async findByCategory(category) {
        return this.find({ category, active: 1 });
    }

    /**
     * Busca produtos com estoque baixo
     */
    async findLowStock(threshold = 5) {
        return this._allScoped(
            `SELECT * FROM ${this.table} WHERE stock <= ? AND stock > 0 AND active = 1 ORDER BY stock ASC`,
            [threshold]
        );
    }

    /**
     * Decrementa estoque de produto (com lock)
     */
    async decrementStock(productId, quantity = 1) {
        return this._runScoped(
            `UPDATE ${this.table} SET stock = stock - ?, updated_at = datetime('now')
             WHERE id = ? AND stock >= ?`,
            [quantity, productId, quantity]
        );
    }

    /**
     * Conta produtos ativos (para limite de plano)
     */
    async countActive() {
        return this.count({ active: 1 });
    }

    /**
     * Busca produtos em flash sale ativa
     */
    async findInActiveFlashSale() {
        const now = new Date().toISOString();
        const tp = this._tenantClause('p.tenant_id');
        const tfs = this._tenantClause('fs.tenant_id');

        let sql = `
            SELECT p.*, fs.sale_price, fs.ends_at
            FROM ${this.table} p
            JOIN flash_sales fs ON fs.product_id = p.id
            WHERE fs.active = 1 AND fs.ends_at > ? AND p.active = 1
        `;
        const values = [now];
        sql += tp.clause;
        values.push(...tp.params);
        sql += tfs.clause;
        values.push(...tfs.params);

        return this.getDb().prepare(sql).all(...values);
    }
}

module.exports = new ProductRepository();
