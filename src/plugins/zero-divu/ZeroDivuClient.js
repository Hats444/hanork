'use strict';

const fs = require('fs-extra');
const crypto = require('crypto');
const path = require('path');
const { ZERO_DIVU_CONFIG, getIpcToken } = require('./config');

function buildCommandPayload(cmd, args, adminId, id = crypto.randomUUID()) {
  const payload = {
    id,
    cmd,
    args,
    adminId,
    at: new Date().toISOString(),
  };
  const token = getIpcToken();
  if (token) payload.token = token;
  return payload;
}

class ZeroDivuClient {
  constructor(options = {}) {
    this.ipcDir = options.ipcDir || ZERO_DIVU_CONFIG.ipcDir;
    this.commandTimeoutMs = options.commandTimeoutMs || ZERO_DIVU_CONFIG.commandTimeoutMs;
    this.files = {
      commands: path.join(this.ipcDir, 'commands.jsonl'),
      ack: path.join(this.ipcDir, 'commands.ack'),
      events: path.join(this.ipcDir, 'events.jsonl'),
      state: path.join(this.ipcDir, 'state.json'),
    };
  }

  ensureDir() {
    fs.ensureDirSync(this.ipcDir);
    if (!fs.existsSync(this.files.commands)) fs.writeFileSync(this.files.commands, '', 'utf8');
    if (!fs.existsSync(this.files.events)) fs.writeFileSync(this.files.events, '', 'utf8');
    if (!fs.existsSync(this.files.ack)) fs.writeJsonSync(this.files.ack, {}, { spaces: 2 });
    if (!fs.existsSync(this.files.state)) {
      fs.writeJsonSync(
        this.files.state,
        { connected: false, ipcOnline: false, updatedAt: null },
        { spaces: 2 }
      );
    }
  }

  isWorkerLikelyOnline() {
    try {
      if (!fs.existsSync(this.files.state)) return false;
      const st = fs.readJsonSync(this.files.state);
      if (!st?.ipcOnline) return false;
      const age = Date.now() - new Date(st.updatedAt || 0).getTime();
      return age < 15000;
    } catch {
      return false;
    }
  }

  readState() {
    try {
      if (!fs.existsSync(this.files.state)) return null;
      return fs.readJsonSync(this.files.state);
    } catch {
      return null;
    }
  }

  async sendCommand(cmd, args = {}, adminId = null, opts = {}) {
    this.ensureDir();
    const id = crypto.randomUUID();
    const line = JSON.stringify(buildCommandPayload(cmd, args, adminId, id));
    await fs.appendFile(this.files.commands, `${line}\n`, 'utf8');

    const timeoutMs = Number(opts.timeoutMs) || this.commandTimeoutMs;
    const deadline = Date.now() + timeoutMs;
    let result = { id, ok: false, error: 'timeout', message: 'WhatsApp worker offline ou sem resposta.' };
    while (Date.now() < deadline) {
      const ack = await this.readAck(id);
      if (ack) {
        result = { id, ...ack };
        break;
      }
      await new Promise((r) => setTimeout(r, this.pollMs()));
    }

    if (adminId) {
      try {
        const { insert } = require('./WaAdminAudit');
        insert({
          telegramId: adminId,
          command: cmd,
          commandId: id,
          args,
          ok: Boolean(result.ok),
          result: result.ok ? result.result ?? result : null,
          error: result.ok ? null : result.message || result.error || null,
        });
      } catch {
        /* ignore */
      }
    }

    return result;
  }

  pollMs() {
    return ZERO_DIVU_CONFIG.pollMs;
  }

  async readAck(id) {
    try {
      const map = (await fs.readJson(this.files.ack)) || {};
      return map[id] || null;
    } catch {
      return null;
    }
  }

  async readEventsSince(offset = 0) {
    try {
      if (!fs.existsSync(this.files.events)) return { events: [], nextOffset: 0 };
      const raw = await fs.readFile(this.files.events, 'utf8');
      const body = raw.slice(offset);
      const events = body
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      return { events, nextOffset: raw.length };
    } catch {
      return { events: [], nextOffset: offset };
    }
  }
}

let singleton = null;
const sessionClients = new Map();

function getZeroDivuClient(sessionId = null) {
  if (!sessionId) {
    if (!singleton) singleton = new ZeroDivuClient();
    return singleton;
  }
  if (sessionClients.has(sessionId)) return sessionClients.get(sessionId);
  const { resolveSession } = require('./waSessionsManifest');
  const conf = resolveSession(sessionId);
  const client = new ZeroDivuClient({ ipcDir: conf.ipcDir });
  sessionClients.set(sessionId, client);
  return client;
}

module.exports = { ZeroDivuClient, getZeroDivuClient, buildCommandPayload };
