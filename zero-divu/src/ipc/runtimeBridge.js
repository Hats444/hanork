'use strict';

/** Ponte entre connect.js e o processador IPC (sem import circular). */

const handlers = {
  getRuntime: () => ({
    connected: false,
    phone: null,
    botRunning: false,
  }),
  clearLastQr: () => {},
  restartLogin: async () => ({ ok: false, error: 'not_ready' }),
  requestReconnectSession: async () => ({ ok: false, error: 'not_ready' }),
  requestLogout: async () => ({ ok: false, error: 'not_ready' }),
  requestPairing: async () => ({ ok: false, error: 'not_ready' }),
};

exports.register = (partial) => {
  Object.assign(handlers, partial);
};

exports.getRuntime = () => handlers.getRuntime();
exports.clearLastQr = () => handlers.clearLastQr();
exports.restartLogin = () => handlers.restartLogin();
exports.requestReconnectSession = () => handlers.requestReconnectSession();
exports.requestLogout = () => handlers.requestLogout();
exports.requestPairing = (phone, opts) => handlers.requestPairing(phone, opts);
exports.getSock = () => handlers.getSock?.() || null;
