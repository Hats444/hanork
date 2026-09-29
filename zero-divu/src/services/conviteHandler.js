'use strict';

const { extractInviteCodes } = require('../utils/formatter');
const blacklist = require('./blacklist');
const joinManager = require('./joinManager');
const dualJoinRouter = require('./dualJoinRouter');
const inviteLinkArchive = require('./inviteLinkArchive');
const groupValidator = require('./groupValidator');
const { infoLog } = require('../utils/logger');

function getMessageText(msg) {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

exports.handleMessage = async (sock, msg) => {
  if (!msg.message || msg.key.fromMe) return;

  if (msg.message.groupInviteMessage) {
    const inv = msg.message.groupInviteMessage;
    const code = inv.inviteCode;
    if (code) {
      inviteLinkArchive.recordDetected(code, {
        native: true,
        subject: inv.groupName,
        from: msg.key.remoteJid,
        size: inv.groupSize,
      });
    }
    if (code && (await dualJoinRouter.routeIfNeeded(code, { native: true, subject: inv.groupName, from: msg.key.remoteJid }))) {
      return;
    }
    await joinManager.processInviteV4(sock, msg);
    return;
  }

  const text = getMessageText(msg);
  const codes = extractInviteCodes(text);
  if (!codes.length) return;

  const sender = msg.key.participant || msg.key.remoteJid;
  if (blacklist.isSenderBlocked(sender)) return;
  if (!groupValidator.isSenderAllowed(sender)) return;

  for (const code of codes) {
    if (blacklist.isInviteBlocked(code)) continue;

    infoLog(`Link de convite detectado: ${code.slice(0, 10)}…`);
    inviteLinkArchive.recordDetected(code, { from: sender, chat: msg.key.remoteJid });
    if (await dualJoinRouter.routeIfNeeded(code, { from: sender, chat: msg.key.remoteJid })) {
      continue;
    }
    await joinManager.enqueueInvite(sock, code, {
      from: sender,
      chat: msg.key.remoteJid,
    });
  }
};
