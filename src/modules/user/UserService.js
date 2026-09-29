/**
 * Module: User Service
 * Gestão de usuários, perfis e assinaturas
 */
const { prisma } = require('../../config/database-sqlite');
const logger = require('../../config/logger');
const CustomerSubscriptionService = require('../subscription/CustomerSubscriptionService');
const UserAccountCore = require('./UserAccountCore');

class UserService {
  async getOrCreate(telegramId, userData = {}) {
    try {
      const user = await prisma.user.findUnique({
        where: { telegram_id: String(telegramId) }
      });

      if (user) {
        const patch = {};
        if (userData.first_name) patch.first_name = userData.first_name;
        if (userData.last_name !== undefined) patch.last_name = userData.last_name;
        if (userData.username) patch.username = userData.username;
        if (userData.language_code) patch.language_code = userData.language_code;
        if (userData.is_premium !== undefined) patch.is_premium = userData.is_premium ? 1 : 0;
        if (Object.keys(patch).length) {
          await prisma.user.update({
            where: { id: user.id },
            data: patch
          });
        }
        return { ...user, ...patch };
      }

      const newUser = await prisma.user.upsert({
        where: { telegram_id: String(telegramId) },
        create: {
          telegram_id: String(telegramId),
          first_name: userData.first_name || '',
          last_name: userData.last_name || '',
          username: userData.username || '',
          language_code: userData.language_code || null,
          is_premium: userData.is_premium ? 1 : 0,
        },
        update: {}
      });

      logger.info(`[USER] Novo usuário: ${telegramId}`);
      return newUser;
    } catch (e) {
      logger.error(`[USER] Erro ao getOrCreate ${telegramId}: ${e.message}`);
      throw e;
    }
  }

  async findByTelegramId(telegramId) {
    try {
      return prisma.user.findUnique({
        where: { telegram_id: String(telegramId) }
      });
    } catch (e) {
      logger.error(`[USER] Erro ao buscar ${telegramId}: ${e.message}`);
      return null;
    }
  }

  async findById(userId) {
    try {
      return prisma.user.findUnique({ where: { id: userId } });
    } catch (e) {
      return null;
    }
  }

  async getAccountSummary(telegramId) {
    return UserAccountCore.getAccountSummary(telegramId);
  }

  async addPoints(userId, points, reason = 'purchase') {
    try {
      prisma.loyalty.addPoints(userId, points, reason);
      logger.info(`[POINTS] User ${userId} +${points} (${reason})`);
      return true;
    } catch (e) {
      logger.error(`[POINTS] Erro ao adicionar ${userId}: ${e.message}`);
      return false;
    }
  }

  async isSubscriber(userId) {
    return CustomerSubscriptionService.isActive(userId);
  }

  async getSubscription(userId) {
    return CustomerSubscriptionService.findActive(userId)
      || CustomerSubscriptionService.findLatest(userId);
  }

  async updateAffiliateBalance(userId, amount) {
    try {
      const db = require('../../config/database-sqlite').connect();
      db.prepare('UPDATE affiliates SET earnings = ? WHERE user_id = ?').run(amount, userId);
      return true;
    } catch (e) {
      logger.error(`[USER] Erro ao atualizar saldo ${userId}: ${e.message}`);
      return false;
    }
  }

  async getAffiliateBalance(userId) {
    try {
      const aff = prisma.affiliate.findByUser(userId);
      return aff?.earnings || 0;
    } catch (e) {
      return 0;
    }
  }

  async reserveAffiliateBalance(userId, amount) {
    try {
      const db = require('../../config/database-sqlite').connect();
      const result = db.prepare(
        'UPDATE affiliates SET earnings = earnings - ? WHERE user_id = ? AND earnings >= ?'
      ).run(amount, userId, amount);
      if (result.changes < 1) return false;

      logger.info(`[AFFILIATE] Reservado R$ ${amount} para user ${userId}`);
      return true;
    } catch (e) {
      logger.error(`[AFFILIATE] Erro ao reservar ${userId}: ${e.message}`);
      return false;
    }
  }

  async confirmAffiliateReserve(userId, amount) {
    logger.info(`[AFFILIATE] Confirmado uso de R$ ${amount} por ${userId}`);
    return true;
  }

  async cancelAffiliateReserve(userId, amount) {
    try {
      const db = require('../../config/database-sqlite').connect();
      db.prepare('UPDATE affiliates SET earnings = earnings + ? WHERE user_id = ?').run(amount, userId);
      logger.info(`[AFFILIATE] Cancelada reserva de R$ ${amount} para ${userId}`);
      return true;
    } catch (e) {
      logger.error(`[AFFILIATE] Erro ao cancelar reserva ${userId}: ${e.message}`);
      return false;
    }
  }

  async listSubscribers() {
    try {
      return prisma.subscription?.findAllActive?.() || [];
    } catch (e) {
      return [];
    }
  }

  async count() {
    try {
      return prisma.user.count();
    } catch (e) {
      return 0;
    }
  }
}

module.exports = new UserService();
