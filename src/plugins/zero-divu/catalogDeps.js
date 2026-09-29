'use strict';

/** Deps do plugin Zero Divu — usado por jobs Bull ai:catalog. */
let _deps = null;

function setCatalogDeps(deps) {
  _deps = deps;
}

function getCatalogDeps() {
  return _deps;
}

module.exports = { setCatalogDeps, getCatalogDeps };
