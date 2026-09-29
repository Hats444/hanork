#!/usr/bin/env node
'use strict';
require('dotenv').config();
const tid = process.argv[2] || '7078046700';
const { getWaDivulgacaoClient } = require('../src/modules/wa-divulgacao/waDivulgacaoClient');
const { client } = getWaDivulgacaoClient(tid);
const uid = Number(tid);

(async () => {
  const sync = await client.sendCommand('wa.sync_groups', {}, uid).catch((e) => ({ ok: false, error: e.message }));
  const listed = await client.sendCommand('wa.list_groups', { limit: 500 }, uid);
  const groups = listed?.result?.groups || listed?.groups || [];
  const state = client.readState?.() || {};
  console.log(JSON.stringify({
    syncOk: sync?.ok,
    listOk: listed?.ok,
    groupCount: groups.length,
    connected: state.connected,
    sample: groups.slice(0, 3).map((g) => ({ id: g.id, subject: g.subject })),
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
