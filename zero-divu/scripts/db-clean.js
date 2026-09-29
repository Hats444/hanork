'use strict';

/**
 * Limpeza manual do database (sem precisar do WhatsApp conectado).
 * Uso: npm run db:clean
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const dm = require('../src/services/databaseMaintenance');
const { infoLog } = require('../src/utils/logger');

(async () => {
  infoLog('Limpeza manual do database…');
  const stats = await dm.run(null);
  if (!stats) {
    infoLog('Manutenção desativada (DATABASE_MAINTENANCE_ENABLED=false)');
    process.exit(0);
  }
  const total = Object.values(stats).reduce((a, b) => a + (Number(b) || 0), 0);
  infoLog(`Concluído — ${total} item(ns) removido(s)/aparado(s)`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
