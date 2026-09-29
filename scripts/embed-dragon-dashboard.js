const fs = require('fs');
const path = require('path');
const pub = path.join(__dirname, '../public');
const dash = fs.readFileSync(path.join(pub, 'admin-dashboard.html'), 'utf8');
const idx = fs.readFileSync(path.join(__dirname, '../produtos/dragon_preview/dragon/index.html'), 'utf8');
const m = idx.match(/<defs>[\s\S]*?<\/defs>/);
if (!m) throw new Error('defs not found');
const defs = m[0];
const block = `<div id="dragon-layer">
    <svg id="dragon-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      ${defs}
      <g id="screen" />
    </svg>
  </div>`;
const out = dash.replace(/<div id="dragon-layer">[\s\S]*?<\/div>/, block);
fs.writeFileSync(path.join(pub, 'admin-dashboard.html'), out);
console.log('embedded', defs.length, 'chars');
