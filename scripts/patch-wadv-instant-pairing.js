#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const loginPath = path.join(__dirname, '..', 'src', 'modules', 'wa-divulgacao', 'waDivulgacaoLoginService.js');
let s = fs.readFileSync(loginPath, 'utf8');

function replaceOnce(label, from, to) {
  if (!s.includes(from)) {
    console.error(`[patch] MISSING: ${label}`);
    process.exit(1);
  }
  s = s.replace(from, to);
  console.log(`[patch] OK: ${label}`);
}

replaceOnce(
  '_sendPairingIpc',
  `async _sendPairingIpc(client, uid, phone, ipcOpts = {}) { await client.sendCommand('wa.clear_antiban_pause', {}, uid, { timeoutMs: 2000 }).catch(() => {}); const pairArgs = { phone }; if (ipcOpts.forceRefresh) pairArgs.forceRefresh = true; return client.sendCommand('wa.start_pairing', pairArgs, uid, { timeoutMs: USER_IPC_TIMEOUT_MS }); }`,
  `async _dispatchLoginIpc(client, uid, cmd, args = {}) { const raw = client.rawSendCommand; const t = USER_LOGIN_IPC_TIMEOUT_MS; const ack = raw ? await raw(cmd, args, uid, { timeoutMs: t, _noRecover: true }).catch(() => null) : await client.sendCommand(cmd, args, uid, { timeoutMs: t, _noRecover: true }); if (ack?.ok) return ack; if (!ack || ack.error === 'timeout' || ack.error === 'stale_command') { logger.info('[WaDivulgacao] login IPC queued', { telegramId: uid, cmd }); return { ok: true, queued: true, result: { ok: true, waiting: true, ...args } }; } return ack; } async _sendPairingIpc(client, uid, phone, ipcOpts = {}) { const { ensureUserWorker } = require('./waDivulgacaoWorkerService'); ensureUserWorker(uid).catch(() => null); await client.sendCommand('wa.clear_antiban_pause', {}, uid, { timeoutMs: 1200, _noRecover: true }).catch(() => {}); const pairArgs = { phone }; if (ipcOpts.forceRefresh) pairArgs.forceRefresh = true; return this._dispatchLoginIpc(client, uid, 'wa.start_pairing', pairArgs); }`
);

replaceOnce(
  'startPairing ping block',
  `const { client } = guard; if (!client.isWorkerLikelyOnline()) { const ping = await client.sendCommand('wa.ping', {}, uid, { timeoutMs: USER_PING_TIMEOUT_MS }).catch(() => null); if (!ping?.ok) { return { ok: false, offline: true, message: Copy.workerPreparingMessage() }; } } const state = client.readState();`,
  `const { client } = guard; const { ensureUserWorker } = require('./waDivulgacaoWorkerService'); ensureUserWorker(uid).catch(() => null); const state = client.readState();`
);

replaceOnce(
  'startPairing fail',
  `const ack = await this._sendPairingIpc(client, uid, phone, { forceRefresh: Boolean(opts.forceRefresh) }); if (!ack?.ok) { this._clearFlow(fkey); const safe = Copy.sanitizeSubscriberIpcAck(ack); logger.warn('[WaDivulgacao] start_pairing IPC failed', { telegramId: uid, error: ack.message || ack.error, }); const msg = safe.message || 'Falha no pareamento'; return { ok: false, message: msg.startsWith('⏳') || msg.startsWith('') ? msg : \` \${msg}\`, }; }`,
  `const ack = await this._sendPairingIpc(client, uid, phone, { forceRefresh: Boolean(opts.forceRefresh) }); if (!ack?.ok && !ack?.queued) { this._clearFlow(fkey); logger.warn('[WaDivulgacao] start_pairing IPC failed', { telegramId: uid, error: ack?.message || ack?.error, }); return { ok: false, message: Copy.waIpcRetryMessage() }; }`
);

replaceOnce(
  'tryPhoneInput blocking',
  `logger.info('[WaDivulgacao] phone input', { telegramId, phone }); const result = await this.startPairing(telegramId, ctx, phone); const notifyState = this._resolvePairingNotify(fkey, notifyCtx); if (!result.ok) { await this._notify(notifyState, result.message, phonePromptKeyboard()); return true; } if (result.alreadyConnected) { await this._refreshHomePanel(notifyState, result.phone || phone); return true; } await this._notify(notifyState, result.message, this._pairingKeyboardFor(result, result.pairCode)); return true;`,
  `logger.info('[WaDivulgacao] phone input', { telegramId, phone }); deferBackground(\`wadv-pair-phone-\${telegramId}\`, async () => { const result = await this.startPairing(telegramId, ctx, phone); const notifyState = this._resolvePairingNotify(fkey, notifyCtx); if (!notifyState?.notify) return; if (!result.ok) { await this._notify(notifyState, result.message, phonePromptKeyboard()); return; } if (result.alreadyConnected) { await this._refreshHomePanel(notifyState, result.phone || phone); return; } await this._notify(notifyState, result.message, this._pairingKeyboardFor(result, result.pairCode)); }); return true;`
);

replaceOnce(
  'tryPhoneInputDirect blocking',
  `logger.info('[WaDivulgacao] phone input direct', { telegramId, phone }); const result = await this.startPairing(telegramId, ctx, phone); if (!result.ok) { await this._notify(pseudo, result.message, phonePromptKeyboard()); return true; } if (result.alreadyConnected) { await this._refreshHomePanel(pseudo, result.phone || phone); return true; } await this._notify(pseudo, result.message, this._pairingKeyboardFor(result, result.pairCode)); return true;`,
  `logger.info('[WaDivulgacao] phone input direct', { telegramId, phone }); deferBackground(\`wadv-pair-direct-\${telegramId}\`, async () => { const result = await this.startPairing(telegramId, ctx, phone); if (!result.ok) { await this._notify(pseudo, result.message, phonePromptKeyboard()); return; } if (result.alreadyConnected) { await this._refreshHomePanel(pseudo, result.phone || phone); return; } await this._notify(pseudo, result.message, this._pairingKeyboardFor(result, result.pairCode)); }); return true;`
);

replaceOnce(
  'retryPairing blocking',
  `await this._notify( { notify, telegramId }, Copy.pairGeneratingMessage() ); const result = await this.startPairing(telegramId, ctx, phone, { forceRefresh: true }); if (!result.ok) { return { ok: false, message: result.message }; } await this._notify({ notify, telegramId }, result.message, this._pairingKeyboardFor(result, result.pairCode)); return { ok: true, message: result.message, pairCode: result.pairCode }; }`,
  `await this._notify( { notify, telegramId }, Copy.pairGeneratingMessage() ); deferBackground(\`wadv-pair-retry-\${telegramId}\`, async () => { const result = await this.startPairing(telegramId, ctx, phone, { forceRefresh: true }); if (!result.ok) { await this._notify({ notify, telegramId }, result.message, phonePromptKeyboard()); return; } await this._notify({ notify, telegramId }, result.message, this._pairingKeyboardFor(result, result.pairCode)); }); return { ok: true, message: Copy.pairGeneratingMessage() }; }`
);

replaceOnce(
  'startQr ping',
  `if (!client.isWorkerLikelyOnline()) { await ensureUserWorkerForLogin(telegramId).catch(() => null); const ping = await client.sendCommand('wa.ping', {}, uid, { timeoutMs: USER_PING_TIMEOUT_MS }).catch(() => null); if (!ping?.ok) { return { ok: false, message: Copy.workerPreparingMessage() }; } } this._setFlow(fkey, { step: 'qr', telegramId, notify: this._flowNotifyCtx(ctx, telegramId), qrMessageId: null, lastQrToken: null, lastQrSentAt: 0, }); this._ensureEventWatcher(telegramId); this._syncEventOffset(client, telegramId, { tailBytes: 0 }); const ack = await client.sendCommand('wa.start_login', {}, uid, { timeoutMs: USER_IPC_TIMEOUT_MS }); if (!ack?.ok) { this._clearFlow(fkey); const safe = Copy.sanitizeSubscriberIpcAck(ack); return { ok: false, message: safe.message || 'Falha ao iniciar QR' }; }`,
  `ensureUserWorkerForLogin(telegramId).catch(() => null); this._setFlow(fkey, { step: 'qr', telegramId, notify: this._flowNotifyCtx(ctx, telegramId), qrMessageId: null, lastQrToken: null, lastQrSentAt: 0, }); this._ensureEventWatcher(telegramId); this._syncEventOffset(client, telegramId, { tailBytes: 0 }); const ack = await this._dispatchLoginIpc(client, uid, 'wa.start_login', {}); if (!ack?.ok && !ack?.queued) { this._clearFlow(fkey); return { ok: false, message: Copy.waIpcRetryMessage() }; }`
);

replaceOnce(
  'promptPhone fetch',
  `const { client } = getWaDivulgacaoClient(telegramId); const live = client.readState() || (await this.fetchConnectionState(telegramId, client).catch(() => null)); if (live?.connected) {`,
  `const { client } = getWaDivulgacaoClient(telegramId); const live = client.readState() || {}; if (live?.connected) {`
);

fs.writeFileSync(loginPath, s);
require('child_process').execSync(`node --check "${loginPath}"`, { stdio: 'inherit' });
console.log('[patch] waDivulgacaoLoginService.js instant pairing OK');
