'use strict';

const fs = require('fs');
const p = require('../src/modules/virtuo/utils/virtuoApiDocs');

console.log('DOCS_PATH:', p.DOCS_PATH);
console.log('exists:', fs.existsSync(p.DOCS_PATH));
const page = p.getDocsPage(0);
console.log('pages:', page.total, 'htmlLen:', page.html.length);
console.log('intro:', p.buildDocsIntroHtml());

const raw = p.loadDocsRaw();
const bad = raw.includes('api.virtuoesim.com/api/v1');
console.log('has wrong /api/v1 in doc:', bad);
console.log('apiBaseV1:', p.apiBaseUrlV1());
