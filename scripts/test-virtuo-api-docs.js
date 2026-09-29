'use strict';

const { getDocsPage, buildDocsIntroHtml, DOCS_PATH } = require('../src/modules/virtuo/utils/virtuoApiDocs');

const page = getDocsPage(0);
console.log('path:', DOCS_PATH);
console.log('pages:', page.total);
console.log('page0 len:', page.html.length);
console.log('intro:', buildDocsIntroHtml().slice(0, 60) + '…');
