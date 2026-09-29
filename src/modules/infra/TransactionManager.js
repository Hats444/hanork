/**
 * TransactionManager — executa passos em transação SQLite (via prisma.$transaction)
 */
const { prisma } = require('../../config/database-sqlite');
const logger = require('../../config/logger');

class TransactionManager {
  static async withTransaction(fn) {
    return prisma.$transaction(fn);
  }

  /**
   * @param {Array<(ctx: { tx: object, log: Function }) => Promise<any>>} steps
   */
  static async execute(steps) {
    const txId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const results = [];
    try {
      await prisma.$transaction(async (tx) => {
        const ctx = {
          tx,
          log: (tag, data) => logger.debug(`[TX:${txId}] ${tag}`, data || {}),
        };
        for (const step of steps) {
          results.push(await step(ctx));
        }
      });
      return { success: true, txId, results };
    } catch (error) {
      logger.error(`[TX] Falhou ${txId}: ${error.message}`);
      return { success: false, txId, error: error.message, results };
    }
  }
}

module.exports = TransactionManager;
