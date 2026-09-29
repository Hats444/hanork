#!/usr/bin/env node
'use strict';
const c = require('/home/vendetta/hanork/src/config/broadcastConfig');
console.log('AUTO_BROADCAST_DELAYS', JSON.stringify(c.AUTO_BROADCAST_DELAYS));
console.log('resolvePvMinGapMs', c.resolvePvMinGapMs());
console.log('env', process.env.AUTO_BROADCAST_USER_DELAY_MS);
