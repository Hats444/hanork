const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../public/admin-dashboard.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const link = '  <link rel="stylesheet" href="/css/admin-nebula.css?v=1" />\n';
html = html.replace(/  <style>[\s\S]*?<\/style>\n/, link);

if (!html.includes('nebula-bg')) {
  html = html.replace(
    '<body>',
    '<body>\n  <div class="nebula-bg" aria-hidden="true"></div>\n  <div class="nebula-grid" aria-hidden="true"></div>\n  <div class="nebula-vignette" aria-hidden="true"></div>'
  );
}

fs.writeFileSync(htmlPath, html);
console.log('OK', html.includes('admin-nebula.css'), html.includes('nebula-bg'));
