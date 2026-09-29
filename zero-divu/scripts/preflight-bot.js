'use strict';

/** Encerra bots Zero Divu em execução antes de subir outro (evita 440). */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const singleInstance = require('../src/services/singleInstance');

singleInstance
  .killAllOthers({ reason: 'preflight', waitMs: 2500 })
  .then((n) => {
    if (n > 0) {
      process.stderr.write(
        `[zero-divu] ${n} instância(s) anterior(es) encerrada(s) — sessão preservada\n`
      );
    }
    process.exit(0);
  })
  .catch((e) => {
    process.stderr.write(`[zero-divu] preflight: ${e.message}\n`);
    process.exit(0);
  });
