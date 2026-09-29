'use strict';

const fs = require('fs');
const path = require('path');

const adminDir = path.join(__dirname, '../src/telegram/commands/admin');
const files = fs.readdirSync(adminDir).filter((f) => f.endsWith('.js'));

/** Um nível a mais: admin/*.js vs commands/admin.js */
const replacements = [
    [/\.\.\/\.\.\/plugins\//g, '../../../plugins/'],
    [/\.\.\/\.\.\/services\//g, '../../../services/'],
    [/\.\.\/\.\.\/modules\//g, '../../../modules/'],
    [/\.\.\/\.\.\/infrastructure\//g, '../../../infrastructure/'],
    [/\.\.\/\.\.\/config\//g, '../../../config/'],
    [/\.\.\/broadcastNotify/g, '../../broadcastNotify'],
    [/\.\.\/htmlEscape/g, '../../htmlEscape'],
    [/\.\.\/menus\//g, '../../menus/'],
    [/\.\/helpJsonDelivery/g, '../helpJsonDelivery'],
];

for (const file of files) {
    const fp = path.join(adminDir, file);
    let src = fs.readFileSync(fp, 'utf8');
    let changed = false;
    for (const [from, to] of replacements) {
        if (from.test(src)) {
            src = src.replace(from, to);
            changed = true;
        }
    }
    if (changed) {
        fs.writeFileSync(fp, src);
        console.log('fixed', file);
    }
}

console.log('done');
