'use strict';

const fs = require('fs-extra');
const path = require('path');
const store = require('../utils/debouncedStore');

const cfgPath = path.join(__dirname, '../config/blacklist.json');

let invites = new Set();
let groups = new Set();
let senders = new Set();
let loaded = false;

function loadConfig() {
  if (loaded) return;
  try {
    const d = fs.readJsonSync(cfgPath);
    invites = new Set(d.invites || []);
    groups = new Set(d.groups || []);
    senders = new Set(d.senders || []);
  } catch {
    invites = new Set();
    groups = new Set();
    senders = new Set();
  }
  loaded = true;
}

function persist() {
  fs.writeJsonSync(
    cfgPath,
    {
      invites: [...invites].slice(-5000),
      groups: [...groups].slice(-2000),
      senders: [...senders].slice(-1000),
    },
    { spaces: 2 }
  );
}

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persist();
    persistTimer = null;
  }, 5000);
}

loadConfig();

exports.isInviteBlocked = (code) => {
  loadConfig();
  return invites.has(code);
};
exports.isGroupBlocked = (jid) => {
  loadConfig();
  return groups.has(jid);
};
exports.isSenderBlocked = (jid) => {
  loadConfig();
  return senders.has(jid);
};

exports.blockInvite = (code) => {
  loadConfig();
  if (!invites.has(code)) {
    invites.add(code);
    schedulePersist();
  }
};

exports.unblockInvite = (code) => {
  loadConfig();
  if (invites.has(code)) {
    invites.delete(code);
    schedulePersist();
  }
};

exports.blockGroup = (jid) => {
  loadConfig();
  if (!groups.has(jid)) {
    groups.add(jid);
    schedulePersist();
  }
};

exports.unblockGroup = (jid) => {
  loadConfig();
  if (groups.has(jid)) {
    groups.delete(jid);
    schedulePersist();
  }
};

exports.blockSender = (jid) => {
  loadConfig();
  if (!senders.has(jid)) {
    senders.add(jid);
    schedulePersist();
  }
};

exports.getStats = () => ({
  invites: invites.size,
  groups: groups.size,
  senders: senders.size,
});

exports.listBlockedGroups = () => {
  loadConfig();
  return [...groups];
};

exports.flush = () => {
  if (persistTimer) clearTimeout(persistTimer);
  persist();
};
