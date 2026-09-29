/**
 * Module: Cashback Service
 */
const { prisma } = require('../../config/database-sqlite');
const logger = require('../../config/logger');

class CashbackService {
  async create(userId, orderId, amount, percentage = 5) {
    try {
      const cb = prisma.cashback.create(userId, orderId, amount, percentage);
      const cashbackAmount = (amount * percentage) / 100;
      logger.info(`[CASHBACK] ${userId}: R$ ${cashbackAmount.toFixed(2)}`);
      return cb;
    } catch (e) {
      logger.error(`[CASHBACK] Erro: ${e.message}`);
      return null;
    }
  }

  async getBalance(userId) {
    try {
      return prisma.cashback.getAvailable(userId) || 0;
    } catch (e) { return 0; }
  }

  async listActive(userId) {
    try {
      const db = require('../../config/database-sqlite').connect();
      return db.prepare("SELECT * FROM cashback WHERE user_id=? AND status IN ('available','pending') ORDER BY available_date ASC").all(userId) || [];
    } catch (e) { return []; }
  }

  async activate(cashbackId) {
    try {
      prisma.cashback.markAvailable(cashbackId);
      logger.info(`[CASHBACK] Ativado: ${cashbackId}`);
      return true;
    } catch (e) { return false; }
  }

  async expireOld() {
    try {
      const db = require('../../config/database-sqlite').connect();
      const result = db.prepare("UPDATE cashback SET status='expired' WHERE status IN ('available','pending') AND date(available_date) < date('now')").run();
      if (result.changes > 0) logger.info(`[CASHBACK] ${result.changes} expirados`);
      return result.changes || 0;
    } catch (e) { return 0; }
  }
}

module.exports = new CashbackService();
