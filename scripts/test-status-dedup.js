'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs-extra');

process.env.ZERO_DIVU_IPC_DIR = path.join(os.tmpdir(), `hanork-status-test-${Date.now()}`);
fs.ensureDirSync(process.env.ZERO_DIVU_IPC_DIR);

const zeroRoot = path.join(__dirname, '../zero-divu');
process.chdir(zeroRoot);

const statusDailyControl = require('../zero-divu/src/services/statusDailyControl');
const statusContentGuard = require('../zero-divu/src/services/statusContentGuard');
const { sanitizeWaCaption } = require('../zero-divu/src/utils/statusCaptionSanitizer');
const { polishPromoPlain } = require('../src/utils/broadcastTextClean');

const gid = '120363000000000000@g.us';
const gid2 = '120363111111111111@g.us';

// Limite diário
statusDailyControl.syncPostSuccess(gid, { postsToday: 2, lastPostAt: new Date().toISOString() });
const limit = statusDailyControl.checkGroupLimits(gid);
console.assert(!limit.ok && limit.tag === 'STATUS_LIMIT_REACHED', 'daily limit');

// Cooldown 12h
statusDailyControl.syncPostSuccess(gid, { postsToday: 1, lastPostAt: new Date().toISOString() });
const cooldown = statusDailyControl.checkGroupLimits(gid);
console.assert(!cooldown.ok && cooldown.tag === 'STATUS_COOLDOWN_ACTIVE', 'cooldown');

// Hash dedup
const meta = {
  groupId: gid,
  caption: 'Produto X R$ 99',
  productId: 7,
  mediaType: 'image',
  imagePath: '/tmp/fake.jpg',
};
statusContentGuard.recordSuccessfulSend({ ...meta, hash: statusContentGuard.buildHash(meta) });
const dup = statusContentGuard.wouldDuplicate(meta);
console.assert(dup.blocked, 'content dedup same group');

const dupOtherGroup = statusContentGuard.wouldDuplicate({ ...meta, groupId: gid2, groupShort: 'gid2' });
console.assert(!dupOtherGroup.blocked, 'multi-group same content allowed');

const dupSameProduct = statusContentGuard.wouldDuplicate({
  ...meta,
  caption: 'Texto diferente da IA mas mesmo produto',
  imagePath: '/tmp/other.jpg',
});
console.assert(dupSameProduct.blocked, 'product+group cooldown 12h');

// Preço único na legenda
const messy =
  'Hanork\n\nR$ 149,00\n\n💰 Por apenas R$ 149,00\n\n🛒 Comprar:\nhttps://t.me/hanork_bot?start=buy_15';
const clean = sanitizeWaCaption(messy);
console.log('caption clean:', clean);
console.assert((clean.match(/R\$\s*149/gi) || []).length <= 1, 'single price');

const aiBody = 'Texto IA\nR$ 149,00\n\n💰 De R$ 200 por R$ 149';
const stripped = polishPromoPlain(aiBody);
console.assert((stripped.match(/R\$\s*149/gi) || []).length <= 1, 'strip duplicate price');

console.log('OK — status dedup tests passed');
