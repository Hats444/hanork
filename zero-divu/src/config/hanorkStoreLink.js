'use strict';

/** Link da loja Hanork no Telegram — clientes vão direto pro bot. */
function botUsername() {
  return String(process.env.BOT_USERNAME || process.env.HANORK_BOT_USERNAME || 'hanork_bot').replace(
    /^@/,
    ''
  );
}

function getHanorkStoreLink(start = 'catalogo') {
  const fromEnv = process.env.HANORK_STORE_URL || process.env.HANORK_TELEGRAM_LINK;
  if (fromEnv) return String(fromEnv).trim();
  const user = botUsername();
  if (!user) return 'https://t.me/hanork_bot?start=catalogo';
  if (start) return `https://t.me/${user}?start=${start}`;
  return `https://t.me/${user}`;
}

function getProductLink(productId) {
  if (!productId) return getHanorkStoreLink('catalogo');
  return getHanorkStoreLink(`buy_${productId}`);
}

function isLegacyWaContact(link) {
  return /wa\.me/i.test(String(link || ''));
}

module.exports = {
  getHanorkStoreLink,
  getProductLink,
  isLegacyWaContact,
  botUsername,
};
