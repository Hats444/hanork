#!/usr/bin/env node
'use strict';
const root = require('path').join(__dirname, '..');
process.chdir(root);
require('dotenv').config({ path: require('path').join(root, '.env') });
const { getPrisma } = require(require('path').join(root, 'src/modules/smm/repositories/smmPrismaAccess'));

const id = process.argv[2] || '41fc5168-dd00-4ab1-9f46-d5663d875a36';
const vo = getPrisma().virtuoOrder.findByHanorkOrderId(id);
console.log(JSON.stringify(vo, null, 2));
