#!/usr/bin/env node
'use strict';
const fs = require('fs');
const log = '/home/vendetta/.hanork/terminal.log';
const buf = fs.readFileSync(log);
const text = buf.toString('utf8', Math.max(0, buf.length - 200000));
const lines = text.split('\n');
const start = lines.findIndex((l) => l.includes('divulgação SMM iniciada'));
const slice = start >= 0 ? lines.slice(start, start + 80) : lines.slice(-80);
console.log(slice.join('\n'));
