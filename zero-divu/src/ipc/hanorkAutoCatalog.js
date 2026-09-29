'use strict';

const fs = require('fs-extra');
const path = require('path');
const { IPC_DIR } = require('./paths');

const FILE = path.join(IPC_DIR, 'hanork_auto_catalog.json');

exports.load = () => {
  try {
    if (!fs.existsSync(FILE)) return null;
    const data = fs.readJsonSync(FILE);
    if (!data?.variacoes?.length) return null;
    return data;
  } catch {
    return null;
  }
};

exports.path = () => FILE;

exports.summary = () => {
  const data = exports.load();
  if (!data) return { synced: false, count: 0 };
  return {
    synced: true,
    count: data.variacoes.length,
    updatedAt: data.updatedAt,
    source: data.source,
  };
};
