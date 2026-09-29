/**
 * OrderRepository - Repository Pattern para pedidos
 * Centraliza todas as queries SQL relacionadas a orders
 * Inclui tenant isolation automática via BaseRepository + tenantScope
 */

const BaseRepository = require('../../infrastructure/BaseRepository');

class OrderRepository extends BaseRepository {
    constructor() {
        super('orders', { hasTenant: true, tenantColumn: 'tenant_id' });
    }

    /**
     * Busca pedido por external_reference (usado em webhooks MP)
     */
    async findByExternalReference(externalRef) {
        return this._getScoped(
            `SELECT * FROM ${this.table} WHERE external_reference = ?`,
            [externalRef]
        );
    }

    /**
     * Busca pedido por payment_id (idempotência de webhooks)
     */
    async findByPaymentId(paymentId) {
        return this._getScoped(
            `SELECT * FROM ${this.table} WHERE payment_id = ?`,
            [String(paymentId)]
        );
    }

    /**
     * Atualiza status do pedido com lock de entrega
     */
    async updateStatus(orderId, status, additionalData = {}) {
        const updates = ['status = ?', 'updated_at = datetime("now")'];
        const values = [status];

        for (const [key, val] of Object.entries(additionalData)) {
            if (val !== undefined) {
                updates.push(`${key} = ?`);
                values.push(val);
            }
        }

        values.push(orderId);
        return this._runScoped(
            `UPDATE ${this.table} SET ${updates.join(', ')} WHERE id = ?`,
            values
        );
    }

    /**
     * Lista pedidos pendentes de pagamento
     */
    async findPendingPayment() {
        return this._allScoped(
            `SELECT * FROM ${this.table} WHERE status = 'WAITING_PAYMENT' ORDER BY created_at DESC`
        );
    }

    /**
     * Lista pedidos pagos mas não entregues (para recovery)
     */
    async findPaidNotDelivered(cutoffMinutes = 5) {
        const cutoff = new Date(Date.now() - cutoffMinutes * 60 * 1000).toISOString();
        return this._allScoped(
            `SELECT * FROM ${this.table} WHERE status = 'PAID' AND (paid_at IS NULL OR paid_at < ?)`,
            [cutoff]
        );
    }

    /**
     * Calcula receita total do período
     */
    async getRevenue(period = 'today') {
        const today = new Date().toISOString().slice(0, 10);
        const month = new Date().toISOString().slice(0, 7);

        let dateFilter;
        switch (period) {
            case 'today':
                dateFilter = `date(created_at) = '${today}'`;
                break;
            case 'month':
                dateFilter = `substr(created_at,1,7) = '${month}'`;
                break;
            default:
                dateFilter = '1=1';
        }

        const row = this._getScoped(
            `SELECT COALESCE(SUM(total), 0) as revenue FROM ${this.table}
             WHERE status IN ('PAID', 'DELIVERED') AND ${dateFilter}`
        );
        return row?.revenue || 0;
    }
}

module.exports = new OrderRepository();
