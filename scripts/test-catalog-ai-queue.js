#!/usr/bin/env node
'use strict';

/**
 * SP-5 — catálogo IA via Bull ai:catalog
 */
const assert = require('assert');

let failed = 0;
let pending = 0;

function finish() {
  console.log(failed ? `\n${failed} falha(s)\n` : '\nOK — catalog AI queue (SP-5)\n');
  process.exit(failed ? 1 : 0);
}

function test(name, fn) {
  pending++;
  Promise.resolve()
    .then(fn)
    .then(() => console.log('  OK', name))
    .catch((e) => {
      failed++;
      console.error('  FAIL', name + ':', e.message);
    })
    .finally(() => {
      pending--;
      if (pending === 0) finish();
    });
}

console.log('\n=== Catalog AI queue (SP-5) ===\n');

test('catalogUsesAsyncAi requer USE_AI', () => {
  const prevAi = process.env.HANORK_WA_CATALOG_USE_AI;
  const prevAsync = process.env.HANORK_WA_CATALOG_ASYNC_AI;
  process.env.HANORK_WA_CATALOG_USE_AI = '0';
  delete require.cache[require.resolve('../src/plugins/zero-divu/hanorkAutoSync')];
  const { catalogUsesAsyncAi } = require('../src/plugins/zero-divu/hanorkAutoSync');
  assert.strictEqual(catalogUsesAsyncAi(), false);
  process.env.HANORK_WA_CATALOG_USE_AI = '1';
  process.env.HANORK_WA_CATALOG_ASYNC_AI = '1';
  delete require.cache[require.resolve('../src/plugins/zero-divu/hanorkAutoSync')];
  const mod2 = require('../src/plugins/zero-divu/hanorkAutoSync');
  assert.strictEqual(mod2.catalogUsesAsyncAi(), true);
  process.env.HANORK_WA_CATALOG_USE_AI = prevAi;
  if (prevAsync !== undefined) process.env.HANORK_WA_CATALOG_ASYNC_AI = prevAsync;
  else delete process.env.HANORK_WA_CATALOG_ASYNC_AI;
});

test('worker registra ai:catalog', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../src/modules/queue/worker.js'), 'utf8');
  assert.ok(src.includes("'ai:catalog'"));
});

test('updateCatalogProductText merge incremental', async () => {
  const fs = require('fs-extra');
  const path = require('path');
  const os = require('os');
  const tmp = path.join(os.tmpdir(), `hanork-catalog-test-${Date.now()}`);
  process.env.ZERO_DIVU_IPC_DIR = tmp;
  await fs.ensureDir(tmp);

  const origEnabled = process.env.ZERO_DIVU_ENABLED;
  process.env.ZERO_DIVU_ENABLED = 'true';

  delete require.cache[require.resolve('../src/plugins/zero-divu/config')];
  delete require.cache[require.resolve('../src/plugins/zero-divu/ZeroDivuClient')];
  delete require.cache[require.resolve('../src/plugins/zero-divu/catalogAiSync')];

  const payload = {
    updatedAt: new Date().toISOString(),
    variacoes: [{ productId: 5, texto: 'old', tipo: 'prod-5' }],
  };
  await fs.writeJson(path.join(tmp, 'hanork_auto_catalog.json'), payload);

  const { updateCatalogProductText } = require('../src/plugins/zero-divu/catalogAiSync');
  const r = await updateCatalogProductText(5, 'new ai text');
  assert.strictEqual(r.ok, true);
  const saved = await fs.readJson(path.join(tmp, 'hanork_auto_catalog.json'));
  assert.strictEqual(saved.variacoes[0].texto, 'new ai text');
  assert.ok(saved.variacoes[0].aiUpdatedAt);

  if (origEnabled !== undefined) process.env.ZERO_DIVU_ENABLED = origEnabled;
  else delete process.env.ZERO_DIVU_ENABLED;
  delete process.env.ZERO_DIVU_IPC_DIR;
  await fs.remove(tmp);
});
