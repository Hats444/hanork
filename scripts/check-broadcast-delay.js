'use strict';
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const c = require('./src/config/broadcastConfig');
console.log('AUTO_BROADCAST_DELAYS', c.AUTO_BROADCAST_DELAYS);
console.log('resolvePvMinGapMs', c.resolvePvMinGapMs());
console.log('env AUTO_BROADCAST_USER_DELAY_MS', process.env.AUTO_BROADCAST_USER_DELAY_MS);
