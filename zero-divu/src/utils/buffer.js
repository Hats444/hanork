'use strict';

const { downloadContentFromMessage } = require('@kurtucoben/baileys');

/** Mesma lógica da Zero Two (definitions.js) */
async function getFileBuffer(mediakey, mediaType) {
  const stream = await downloadContentFromMessage(mediakey, mediaType);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }
  return buffer;
}

module.exports = { getFileBuffer };
