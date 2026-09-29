'use strict';

const R = require('../src/modules/smm/repositories/smmServiceRepository');
const O = require('../src/modules/smm/repositories/smmOrderRepository');
const S = require('../src/modules/smm/repositories/smmSyncHistoryRepository');

console.log('countAll', R.countAll());
console.log('platforms', R.listPlatforms().length);
console.log('listByStatus', O.listByStatus(['submitted'], 1).length);
console.log('syncLast', S.last() ? 'ok' : 'null');
