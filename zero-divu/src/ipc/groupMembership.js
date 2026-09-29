'use strict';

const groupCache = require('./groupCache');

/** Grupo aparece na última lista groupFetchAllParticipating */
exports.isInParticipatingMap = (jid) => {
  if (!jid) return false;
  const map = groupCache.getMap();
  return Boolean(map[jid]);
};

exports.participatingGroupCount = () => {
  const map = groupCache.getMap();
  return Object.keys(map).filter((k) => k.endsWith('@g.us')).length;
};

/** Com sync carregado: só grupos que estão no mapa WA entram em ciclo de divulgação */
exports.filterInWhatsApp = (groups) => {
  const n = exports.participatingGroupCount();
  if (n <= 0) return groups;
  return groups.filter((g) => g?.id && exports.isInParticipatingMap(g.id));
};

module.exports = exports;
