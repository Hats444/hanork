'use strict';

const fs = require('fs-extra');
const path = require('path');
const { IPC_DIR } = require('./paths');

const FILE = path.join(IPC_DIR, 'wa_runtime.json');

function load() {
  try {
    return fs.readJsonSync(FILE);
  } catch {
    return { hanorkCampaignEnabled: true, hanorkAutoSyncEnabled: true, productsOnlyMode: true };
  }
}

function ensureProductsOnlyDefaults() {
  const d = load();
  let changed = false;
  if (d.productsOnlyMode !== true) {
    d.productsOnlyMode = true;
    changed = true;
  }
  if (d.hanorkAutoSyncEnabled == null) {
    d.hanorkAutoSyncEnabled = true;
    changed = true;
  }
  if (d.hanorkCampaignEnabled == null) {
    d.hanorkCampaignEnabled = true;
    changed = true;
  }
  if (changed) {
    d.updatedAt = new Date().toISOString();
    save(d);
  }
  return d;
}

exports.isProductsOnlyMode = () => {
  const d = load();
  return d.productsOnlyMode !== false;
};

function save(data) {
  fs.ensureDirSync(IPC_DIR);
  fs.writeJsonSync(FILE, data, { spaces: 2 });
}

exports.isHanorkCampaignEnabled = () => {
  const d = load();
  return d.hanorkCampaignEnabled !== false;
};

exports.isHanorkAutoSyncEnabled = () => {
  const d = load();
  return d.hanorkAutoSyncEnabled !== false;
};

exports.setHanorkAutoSyncEnabled = (enabled) => {
  const d = load();
  d.hanorkAutoSyncEnabled = Boolean(enabled);
  d.updatedAt = new Date().toISOString();
  save(d);
  return d.hanorkAutoSyncEnabled;
};

exports.setHanorkCampaignEnabled = (enabled) => {
  const d = load();
  d.hanorkCampaignEnabled = Boolean(enabled);
  d.updatedAt = new Date().toISOString();
  save(d);
  return d.hanorkCampaignEnabled;
};

exports.get = () => load();
exports.ensureProductsOnlyDefaults = ensureProductsOnlyDefaults;
