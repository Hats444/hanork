'use strict';

const fs = require('fs-extra');
const crypto = require('crypto');
const { FILES, ensureDir } = require('./paths');
const { writeStateSnapshot } = require('./stateWriter');
const runtimeBridge = require('./runtimeBridge');
const operations = require('./operations');
const configApplier = require('./configApplier');
const idempotency = require('./idempotency');
const ipcAuth = require('./auth');
const { infoLog, warningLog } = require('../utils/logger');

const POLL_MS = Number(process.env.ZERO_IPC_POLL_MS) || 500;
const ACK_TIMEOUT_HINT_MS = 30000;
const STALE_CMD_MS = 10 * 60 * 1000;
const LOGIN_CMD_STALE_MS = 90 * 1000;
const LOGIN_CMDS = new Set(['wa.start_pairing', 'wa.start_login', 'wa.refresh_qr']);

let started = false;
let pollTimer = null;
let processedIds = new Set();
let ackCache = {};

async function readAckMap() {
  try {
    return (await fs.readJson(FILES.ack)) || {};
  } catch {
    return {};
  }
}

async function writeAck(id, payload) {
  ackCache = { ...ackCache, [id]: { ...payload, at: new Date().toISOString() } };
  const keys = Object.keys(ackCache);
  if (keys.length > 200) {
    for (const k of keys.slice(0, keys.length - 200)) delete ackCache[k];
  }
  await fs.writeJson(FILES.ack, ackCache, { spaces: 2 });
}

async function readNewCommands() {
  if (!fs.existsSync(FILES.commands)) return [];
  const raw = await fs.readFile(FILES.commands, 'utf8');
  if (!raw.trim()) return [];
  const lines = raw.split('\n').filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

async function handleCommand(cmd) {
  const { id, cmd: name, args = {} } = cmd;
  const rt = runtimeBridge.getRuntime();

  switch (name) {
    case 'wa.ping':
      return { ok: true, result: { pong: true, pid: process.pid } };

    case 'wa.get_status': {
      const snap = await writeStateSnapshot();
      return { ok: true, result: snap };
    }

    case 'wa.start_login': {
      if (rt.connected) {
        const snap = await writeStateSnapshot({ connected: true, phone: rt.phone });
        return { ok: true, result: { alreadyConnected: true, ...snap } };
      }
      runtimeBridge.clearLastQr();
      runtimeBridge.armQrLogin?.();
      try {
        // Fire-and-forget: não bloquear ACK por causa de rede/handshake do Baileys.
        Promise.resolve(runtimeBridge.restartLogin()).catch(() => {});
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        result: {
          waitingQr: true,
          restarted: true,
          message: 'Gerando QR — imagem chega no Telegram',
          timeoutMs: ACK_TIMEOUT_HINT_MS,
        },
      };
    }

    case 'wa.refresh_qr': {
      if (rt.connected) {
        return {
          ok: false,
          error: 'already_connected',
          message: 'WhatsApp já conectado — desconecte antes de novo QR.',
        };
      }
      runtimeBridge.clearLastQr();
      runtimeBridge.armQrLogin?.();
      try {
        Promise.resolve(runtimeBridge.restartLogin()).catch(() => {});
      } catch {
        /* ignore */
      }
      return { ok: true, result: { waitingQr: true, restarted: true } };
    }

    case 'wa.pause':
      return { ok: true, result: await operations.pausePosts() };

    case 'wa.resume':
      return { ok: true, result: await operations.resumePosts() };

    case 'wa.post_now': {
      const out = await operations.runPostNow(args);
      if (!out.ok) return out;
      return { ok: true, result: out };
    }

    case 'wa.sync_groups': {
      const out = await operations.syncGroups();
      if (!out.ok) return out;
      return { ok: true, result: out };
    }

    case 'wa.list_groups':
      return {
        ok: true,
        result: { groups: operations.listGroups(args.limit || 20) },
      };

    case 'wa.list_invalid':
      return {
        ok: true,
        result: { groups: operations.listInvalidGroups(args.limit || 20) },
      };

    case 'wa.leave_group': {
      const out = await operations.leaveGroup(args.id || args.query);
      if (!out.ok) return out;
      return { ok: true, result: out };
    }

    case 'wa.set_max': {
      const out = await operations.setMaxGroups(args.n ?? args.max);
      return { ok: true, result: out };
    }

    case 'wa.set_profile': {
      const out = await operations.setProfile(args.profile || args.name, { manual: true });
      return { ok: true, result: out };
    }

    case 'wa.auto_profile': {
      const on =
        args.enabled === true ||
        args.on === true ||
        String(args.mode || args.state || '').toLowerCase() === 'on';
      const off =
        args.enabled === false ||
        args.off === true ||
        String(args.mode || args.state || '').toLowerCase() === 'off';
      if (!on && !off) {
        return {
          ok: true,
          result: require('../services/autoProfile').getStatus(),
        };
      }
      const out = await operations.setAutoProfile(on);
      return { ok: true, result: out };
    }

    case 'wa.set_delay': {
      const out = await operations.setDelay(args.kind || 'post', args.ms);
      return { ok: true, result: out };
    }

    case 'wa.set_min_members': {
      const out = await operations.setMinMembers(args.n ?? args.min ?? args.members);
      return { ok: true, result: out };
    }

    case 'wa.set_auto_join': {
      const out = await operations.setAutoJoin(args.enabled ?? args.on ?? args.state);
      return { ok: true, result: out };
    }

    case 'wa.set_auto_post_on_join': {
      const out = await operations.setAutoPostOnJoin(args.enabled ?? args.on ?? args.state);
      return { ok: true, result: out };
    }

    case 'wa.set_max_join_per_hour': {
      const out = await operations.setMaxJoinsPerHour(args.n ?? args.max ?? args.perHour);
      return { ok: true, result: out };
    }

    case 'wa.preset_prod': {
      const out = await operations.applyProdPreset(args);
      return { ok: true, result: out };
    }

    case 'wa.get_limits':
      return { ok: true, result: operations.getLimitsSummary() };

    case 'wa.list_campaigns':
      return { ok: true, result: { campaigns: operations.listCampaigns() } };

    case 'wa.get_text': {
      const out = operations.getCampaignTexts(args.campaign || args.name);
      if (!out.ok) return out;
      return { ok: true, result: out };
    }

    case 'wa.set_text': {
      const out = operations.setCampaignTexts(args.campaign || args.name, args);
      if (!out.ok) return out;
      return { ok: true, result: out };
    }

    case 'wa.list_media': {
      const out = operations.listCampaignMedia(args.campaign || args.name);
      if (!out.ok) return out;
      return { ok: true, result: out };
    }

    case 'wa.save_media': {
      const out = await operations.saveCampaignMedia(args);
      if (!out.ok) return out;
      return { ok: true, result: out };
    }

    case 'wa.remove_media': {
      const out = operations.removeCampaignMedia(args);
      if (!out.ok) return out;
      return { ok: true, result: out };
    }

    case 'wa.reload_config':
      return { ok: true, result: operations.reloadContentConfig() };

    case 'wa.enqueue_promo': {
      const out = await operations.enqueuePromo(args);
      if (!out.ok) return out;
      return { ok: true, result: out };
    }

    case 'wa.list_promo':
      return { ok: true, result: { jobs: operations.listPromoQueue() } };

    case 'wa.process_promo': {
      const out = await operations.processPromoQueue();
      if (!out.ok) return out;
      return { ok: true, result: out };
    }

    case 'wa.set_hanork_campaign': {
      const on = args.enabled ?? args.on;
      const enabled =
        on === true ||
        on === 'on' ||
        on === '1' ||
        String(on).toLowerCase() === 'true';
      const disabled =
        on === false ||
        on === 'off' ||
        on === '0' ||
        String(on).toLowerCase() === 'false';
      if (!enabled && !disabled) {
        return { ok: false, error: 'invalid_arg', message: 'Use on ou off' };
      }
      return {
        ok: true,
        result: operations.setHanorkCampaign(enabled && !disabled),
      };
    }

    case 'wa.set_hanork_auto_sync': {
      const on = args.enabled ?? args.on;
      const enabled =
        on === true ||
        on === 'on' ||
        on === '1' ||
        String(on).toLowerCase() === 'true';
      const disabled =
        on === false ||
        on === 'off' ||
        on === '0' ||
        String(on).toLowerCase() === 'false';
      if (!enabled && !disabled) {
        return { ok: false, error: 'invalid_arg', message: 'Use on ou off' };
      }
      return {
        ok: true,
        result: operations.setHanorkAutoSync(enabled && !disabled),
      };
    }

    case 'wa.get_hanork_campaign':
      return { ok: true, result: operations.getHanorkCampaign() };

    case 'wa.logout': {
      const out = await operations.requestLogout();
      if (!out.ok) return out;
      return { ok: true, result: out };
    }

    case 'wa.start_pairing': {
      const phone = args.phone || args.numero || args.tel;
      if (!phone) {
        return { ok: false, error: 'missing_phone', message: 'Informe o número com DDI' };
      }
      if (rt.connected) {
        const snap = await writeStateSnapshot({ connected: true, phone: rt.phone });
        return { ok: true, result: { alreadyConnected: true, ...snap } };
      }
      try {
        const out = await operations.startPairing(phone);
        if (!out?.ok) {
          return { ok: false, error: out?.error || 'pairing_failed', message: out?.message };
        }
        return {
          ok: true,
          result: {
            ...out,
            phone: out.phone || phone,
            message: out.formatted
              ? 'Código de pareamento gerado'
              : out.message || 'Gerando código de pareamento — aguarde no Telegram',
            timeoutMs: ACK_TIMEOUT_HINT_MS,
          },
        };
      } catch (e) {
        return { ok: false, error: 'pairing_failed', message: e?.message || String(e) };
      }
    }

    default:
      return { ok: false, error: 'unknown_command', message: `Comando desconhecido: ${name}` };
  }
}

async function processPendingCommands() {
  const cmds = await readNewCommands();
  if (!cmds.length) return;

  ackCache = await readAckMap();
  let changed = false;

  for (const cmd of cmds) {
    const id = cmd.id || crypto.randomUUID();

    if (ackCache[id]) {
      processedIds.add(id);
      continue;
    }
    if (processedIds.has(id)) continue;

    // Evita replay de comandos antigos quando o worker reinicia e o commands.jsonl ainda contém linhas.
    // Isso era o que disparava conexão "sozinha" no boot.
    try {
      const atMs = cmd.at ? new Date(cmd.at).getTime() : 0;
      const age = Date.now() - atMs;
      const cmdName = cmd.cmd || cmd.name || '';
      const staleMs = LOGIN_CMDS.has(cmdName) ? LOGIN_CMD_STALE_MS : STALE_CMD_MS;
      if (atMs > 0 && age > staleMs) {
        await writeAck(id, { ok: false, error: 'stale_command', message: 'Comando antigo ignorado' });
        processedIds.add(id);
        changed = true;
        continue;
      }
    } catch {
      /* ignore */
    }

    const idemKey = idempotency.resolveKey(cmd);
    if (idemKey) {
      const cached = idempotency.getCached(idemKey);
      if (cached) {
        await writeAck(id, cached);
        processedIds.add(id);
        changed = true;
        continue;
      }
    }

    processedIds.add(id);
    if (processedIds.size > 500) {
      processedIds = new Set([...processedIds].slice(-250));
    }

    const authCheck = ipcAuth.validateCommand(cmd);
    if (!authCheck.ok) {
      await writeAck(id, {
        ok: false,
        error: authCheck.error,
        message: authCheck.message,
      });
      changed = true;
      continue;
    }

    let ack;
    try {
      ack = await handleCommand({ ...cmd, id });
    } catch (e) {
      ack = { ok: false, error: 'handler_error', message: e?.message || String(e) };
    }
    if (idemKey && ack) idempotency.store(idemKey, ack);
    await writeAck(id, ack);
    changed = true;
  }

  if (changed) {
    await writeStateSnapshot();
  }
}

async function tick() {
  try {
    await processPendingCommands();
    await configApplier.loadAndApplyFromFile();
  } catch (e) {
    warningLog(`IPC: ${e?.message || e}`);
  }
}

exports.start = async () => {
  if (started) return;
  started = true;
  ensureDir();
  ackCache = await readAckMap();
  await configApplier.initFromFile();
  ipcAuth.logStartupAuthState();
  writeStateSnapshot({ ipcOnline: true }).catch(() => {});
  infoLog(`IPC Hanork ativo · ${FILES.commands.replace(/\\/g, '/')}`);
  pollTimer = setInterval(tick, POLL_MS);
  const hanorkWorker = process.env.HANORK_ZERO_WORKER === '1';
  if (!hanorkWorker && pollTimer.unref) pollTimer.unref();
  const stateTimer = setInterval(() => {
    writeStateSnapshot().catch(() => {});
  }, 10000);
  if (!hanorkWorker && stateTimer.unref) stateTimer.unref();
  tick();
};

exports.stop = async () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  started = false;
  await writeStateSnapshot({ ipcOnline: false }).catch(() => {});
};

exports.handleCommand = handleCommand;
