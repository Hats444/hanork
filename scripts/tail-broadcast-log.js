#!/usr/bin/env node
'use strict';
const fs = require('fs');
const log = '/home/vendetta/.hanork/terminal.log';
const buf = fs.readFileSync(log);
const text = buf.toString('utf8', Math.max(0, buf.length - 120000));
const lines = text.split('\n').filter((l) =>
    /AUTOBROADCAST|queued_smm|smmBroadcast|divulgação SMM|ciclo OK|Broadcast|executeFull|smm-launch/i.test(l)
);
console.log(lines.slice(-40).join('\n') || '(no matches)');
