'use strict';

const DELIVERY_GAP_MS = 350;
const REVIEW_DELAY_MS = 6000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 1️⃣ Cabeçalho único após pagamento confirmado
 */
async function sendPaymentHeader(telegram, chatId, orderId) {
  const short = orderId ? String(orderId).slice(-8) : '????';
  await telegram.sendMessage(
    chatId,
    `<b>✅ Pagamento confirmado</b>\n` +
    `📋 Pedido #${short}\n\n` +
    `<i>Enviando seus produtos…</i>`,
    { parse_mode: 'HTML' }
  );
  await sleep(DELIVERY_GAP_MS);
}

/**
 * 2️⃣ Resumo final após todos os produtos
 */
async function sendDeliverySummary(telegram, chatId, orderId, productNames = []) {
  const { CONFIG } = require('../../config/config');
  const short = orderId ? String(orderId).slice(-8) : '????';
  const unique = [...new Set(productNames.filter(Boolean))];
  const list = unique.length
    ? unique.map((n) => `• ${n}`).join('\n')
    : '• Seus produtos foram enviados acima';

  await telegram.sendMessage(
    chatId,
    `<b>🎉 Entrega concluída</b>\n` +
    `📋 Pedido #${short}\n\n` +
    `${list}\n\n` +
    `📞 Suporte: ${CONFIG?.CONTATO_ESPECIALISTA || ''}`,
    { parse_mode: 'HTML' }
  );
}

/**
 * 3️⃣ Benefícios extras em uma única mensagem (pontos + cashback)
 */
async function sendExtrasBundle(telegram, chatId, extras = {}) {
  const lines = [];
  if (extras.points > 0) {
    lines.push(
      `⭐ <b>+${extras.points} pontos</b> de fidelidade` +
      (extras.loyaltyTotal != null ? ` (total: ${extras.loyaltyTotal})` : '')
    );
  }
  if (extras.cashbackAmount > 0) {
    lines.push(
      `💸 <b>R$ ${extras.cashbackAmount.toFixed(2)}</b> de cashback (${extras.cashbackPercent}%) em ~7 dias`
    );
    if (extras.isPremium) lines.push(`<i>Benefício Premium ativo ✨</i>`);
  }
  if (!lines.length) return;

  await sleep(DELIVERY_GAP_MS);
  await telegram.sendMessage(
    chatId,
    `<b>🎁 Você também ganhou:</b>\n\n${lines.join('\n')}\n\n` +
    `<i>/pontos · /cashback</i>`,
    { parse_mode: 'HTML' }
  );
}

/**
 * 4️⃣ Avaliação por último (com delay para não misturar com a entrega)
 */
function scheduleReviewRequest(telegram, chatId, orderId) {
  if (!telegram || !chatId || !orderId) return;
  setTimeout(async () => {
    try {
      const ReviewService = require('../../services/ReviewService');
      await ReviewService.sendReviewRequest(telegram, chatId, orderId);
    } catch (_) { /* ignore */ }
  }, REVIEW_DELAY_MS);
}

module.exports = {
  DELIVERY_GAP_MS,
  sleep,
  sendPaymentHeader,
  sendDeliverySummary,
  sendExtrasBundle,
  scheduleReviewRequest,
};
