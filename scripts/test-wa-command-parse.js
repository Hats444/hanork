'use strict';

const assert = require('assert');
const { parseWaArgs } = require('../src/plugins/zero-divu/waCommandParse');

function ctx(text, match = null, payload = undefined) {
  return {
    message: { text },
    match: match === undefined ? [] : match,
    payload,
  };
}

assert.strictEqual(parseWaArgs(ctx('/wa2_pair 541178918887'), 'wa2_pair'), '541178918887');
assert.strictEqual(parseWaArgs(ctx('/wa2_pair 541178918887', []), 'wa2_pair'), '541178918887');
assert.strictEqual(
  parseWaArgs(ctx('/wa2_pair 541178918887', null, '541178918887'), 'wa2_pair'),
  '541178918887'
);
assert.strictEqual(parseWaArgs(ctx('/wa_pair 5521995930864', []), 'wa_pair'), '5521995930864');

console.log('test-wa-command-parse: OK');
