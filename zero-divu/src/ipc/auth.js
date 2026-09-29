'use strict';

const crypto = require('crypto');
const { getIpcToken, isIpcAuthRequired } = require('../config/env');
const { infoLog, warningLog } = require('../utils/logger');
const logThrottle = require('../utils/logThrottle');

function tokensMatch(provided, expected) {
  if (provided == null || expected == null) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function validateCommand(cmd) {
  const required = isIpcAuthRequired();
  const expected = getIpcToken();
  const provided = cmd?.token != null && String(cmd.token) !== '' ? String(cmd.token) : null;
  const name = cmd?.cmd || '?';

  if (required && !expected) {
    return {
      ok: false,
      error: 'ipc_auth_misconfigured',
      message: 'ZERO_IPC_AUTH_REQUIRED ativo mas ZERO_IPC_TOKEN não configurado',
    };
  }

  if (!required) {
    if (!provided) {
      if (logThrottle.shouldLog('ipc:unauthenticated', 60000)) {
        warningLog(
          `IPC: comando sem token (${name}) — modo compat; defina ZERO_IPC_AUTH_REQUIRED=1 após o Hanork enviar token`
        );
      }
    } else if (expected && !tokensMatch(provided, expected)) {
      if (logThrottle.shouldLog('ipc:bad-token-compat', 60000)) {
        warningLog(`IPC: token inválido em modo compat (${name})`);
      }
    }
    return { ok: true };
  }

  if (!provided) {
    return { ok: false, error: 'ipc_auth_missing', message: 'Token IPC ausente' };
  }

  if (!tokensMatch(provided, expected)) {
    return { ok: false, error: 'ipc_auth_invalid', message: 'Token IPC inválido' };
  }

  return { ok: true };
}

function logStartupAuthState() {
  const required = isIpcAuthRequired();
  const token = getIpcToken();
  if (required && !token) {
    warningLog('IPC: ZERO_IPC_AUTH_REQUIRED=1 mas ZERO_IPC_TOKEN vazio — comandos serão rejeitados');
    return;
  }
  if (required) {
    infoLog('IPC: autenticação obrigatória ativa (ZERO_IPC_AUTH_REQUIRED)');
  }
}

module.exports = { validateCommand, tokensMatch, logStartupAuthState };
