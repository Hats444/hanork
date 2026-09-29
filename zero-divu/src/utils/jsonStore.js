'use strict';

const store = require('./debouncedStore');

module.exports = {
  readJson: store.load,
  writeJson: store.set,
  filePath: store.filePath,
  flushAll: store.flushAll,
};
