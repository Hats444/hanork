'use strict';

const ipc = process.argv[2] || process.env.ZERO_IPC_DIR;
const peer = process.argv[3] || process.env.WA_DUAL_IPC_DIR_PEER;
if (ipc) process.env.ZERO_IPC_DIR = ipc;
if (peer) process.env.WA_DUAL_IPC_DIR_PEER = peer;

const cat = require('../src/ipc/hanorkAutoCatalog');
const overlay = require('../src/services/hanorkAutoOverlay');
const mensagens = require('../src/services/mensagens');

const summary = cat.summary();
const camps = mensagens.listCampaigns().map((c) => overlay.applyHanorkAutoOverlay(c));
console.log(
  JSON.stringify({
    ipc,
    summary,
    campaigns: camps.map((c) => ({
      id: c.id,
      variacoes: c.variacoes?.length || 0,
      dynamic: !!c._hanorkDynamicPromo,
      autoSync: !!c._hanorkAutoSync,
    })),
  })
);
