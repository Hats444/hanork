/**
 * Module: Audit Service
 * Logs de auditoria e compliance
 */
const { prisma } = require('../../config/database-sqlite');
const logger = require('../../config/logger');

class AuditService {
  /**
   * Registra evento de auditoria
   */
  async log(userId, telegramId, action, entityType, entityId, oldValue = null, newValue = null) {
    try {
      prisma.audit.log(userId, telegramId ? String(telegramId) : null, action, entityType, entityId ? String(entityId) : null, oldValue, newValue);
    } catch (e) {
      logger.warn(`[AUDIT] Erro: ${e.message}`);
    }
  }

  /**
   * Registra evento financeiro
   */
  async logFinancial(userId, orderId, type, amount, details = {}) {
    try {
      await this.log(userId, null, `FINANCIAL_${type}`, 'order', orderId, null, { amount, ...details });
    } catch (e) { }
  }

  /**
   * Registra acesso administrativo
   */
  async logAdminAccess(adminId, action, target = null) {
    try {
      await this.log(adminId, null, `ADMIN_${action}`, 'admin', target);
      logger.warn(`[ADMIN] ${adminId}: ${action}${target ? ` -> ${target}` : ''}`);
    } catch (e) { }
  }

  /**
   * Busca logs por usuário
   */
  async findByUser(userId, limit = 100) {
    try {
      return prisma.audit?.getByUser?.(userId, limit) || [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Busca logs por entidade
   */
  async findByEntity(entityType, entityId) {
    try {
      return prisma.audit?.getByAction?.(entityType, limit) || [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Limpa logs antigos
   */
  async cleanup(days = 90) {
    try {
      const count = prisma.audit?.cleanupOld?.(days) || 0;
      logger.info(`[AUDIT] ${count} logs antigos removidos`);
      return count;
    } catch (e) {
      return 0;
    }
  }
}

module.exports = new AuditService();
