'use strict';

/**
 * Impede subir um segundo bot — rode antes de connect.js (npm run bot / start.sh).
 * Mata instâncias órfãs; se ainda houver outra viva, aborta com instrução clara.
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const singleInstance = require('../src/services/singleInstance');
const cfg = require('../src/config/divulgacao');

async function main() {
  if (cfg.SINGLE_INSTANCE_LOCK === false) {
    process.exit(0);
  }

  const others = singleInstance.findConnectJsPids();
  if (others.length) {
    process.stderr.write(
      `[zero-divu] ${others.length} instância(s) detectada(s): ${others.join(', ')}\n`
    );
    if (cfg.SINGLE_INSTANCE_KILL_DUPES !== false) {
      const n = await singleInstance.killAllOthers({ reason: 'preflight', waitMs: 3000 });
      if (n) {
        process.stderr.write(`[zero-divu] ${n} processo(s) anterior(es) encerrado(s)\n`);
      }
    }
  }

  await singleInstance.waitUntilAlone(cfg.SINGLE_INSTANCE_WAIT_MS ?? 120000);
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`[zero-divu] ensure-single: ${e.message}\n`);
  process.exit(1);
});
