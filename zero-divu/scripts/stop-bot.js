'use strict';

/** Para o bot com segurança — não apaga sessão. */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const singleInstance = require('../src/services/singleInstance');

singleInstance
  .killAllOthers({ reason: 'stop', waitMs: 1500 })
  .then(async (n) => {
    singleInstance.release();
    const foreign = singleInstance.getForeignHeartbeat?.();
    if (foreign) {
      console.log(
        `Aviso: heartbeat ativo no PID ${foreign.pid} (pode ser outro terminal WSL/Windows) — pare lá também`
      );
    }
    if (n > 0) {
      console.log(`Zero Divu parado (${n} processo(s) encerrado(s)) — sessão preservada`);
    } else {
      console.log('Nenhum bot Zero Divu estava rodando neste ambiente');
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(`Erro ao parar: ${e.message}`);
    process.exit(1);
  });
