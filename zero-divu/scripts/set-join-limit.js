'use strict';

const fs = require('fs');
const limit = Math.max(1, Number(process.argv[2]) || 7);
const paths = process.argv.slice(3).length
  ? process.argv.slice(3)
  : [
      '/home/vendetta/hanork/shared/zero-ipc/config.patch.json',
      '/home/vendetta/hanork/shared/zero-ipc-b/config.patch.json',
    ];

for (const p of paths) {
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  data.MAX_JOIN_PER_HOUR = limit;
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`OK ${p} → MAX_JOIN_PER_HOUR=${limit}`);
}
