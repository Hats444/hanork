/**
 * Queue Jobs Index
 * Exporta todos os processadores de jobs
 */
const { processTelegramBroadcast, processEmailBroadcast, processPvPromoDelivery } = require('./broadcastJob');
const { processDelivery, processResend } = require('./deliveryJob');
const { processAbandonedCart, processPixReminder, processGiveawayWinner, processSubscriptionReminder, processAdminNotify } = require('./notificationJob');
const { processDailyReport, processSalesReport } = require('./reportJob');
const { processCatalogAi } = require('./catalogAiJob');
const { processSmmFulfill } = require('../../smm/queue/smmFulfillJob');
const { processVirtuoFulfill } = require('../../virtuo/queue/virtuoFulfillJob');
const { processWaDivCampaign } = require('../../wa-divulgacao/queue/waDivulgacaoCampaignJob');

module.exports = {
  // Broadcast
  processTelegramBroadcast,
  processEmailBroadcast,
  processPvPromoDelivery,
  
  // Delivery
  processDelivery,
  processResend,
  
  // Notification
  processAbandonedCart,
  processPixReminder,
  processGiveawayWinner,
  processSubscriptionReminder,
  processAdminNotify,
  
  // Report
  processDailyReport,
  processSalesReport,

  // AI catalog (Zero Divu WA)
  processCatalogAi,

  // SMM FornecedorBrasil
  processSmmFulfill,

  // Virtuo SMS (E-SIM)
  processVirtuoFulfill,

  // Hanork Div campanhas agendadas
  processWaDivCampaign,
};
