'use strict';

const cfg = require('../config/divulgacao');
const postGuard = require('./postGuard');
const groupCache = require('./groupCache');
const logThrottle = require('../utils/logThrottle');
const { infoLog, warningLog } = require('../utils/logger');

/**
 * Evita “grupo o dia todo sem postar” por:
 * - timers perdidos após rate limit/reconnect
 * - sync parcial que bloqueia o ciclo
 * - risco alto que pausou e depois liberou
 *
 * Regra: NUNCA dispara rajada — só re-prime timers (event-driven) ou deixa o ciclo normal.
 */
exports.kickIfStuck = async (sock) => {
  try {
    if (!sock) return { kicked: false, reason: 'no_sock' };
    if (!cfg.POST_ON_START) return { kicked: false, reason: 'post_on_start_off' };

    const eventDriven = (() => {
      try {
        return require('./groupEventScheduler').isEnabled();
      } catch {
        return false;
      }
    })();
    if (!eventDriven) return { kicked: false, reason: 'not_event_driven' };

    // se sync não é confiável, não mexe — evita loop com WA rate limit
    if (!groupCache.isSyncTrustworthy()) return { kicked: false, reason: 'sync_partial' };

    const analysis = postGuard.analyzeDivulgacaoGroups();
    if (!analysis?.due?.length) return { kicked: false, reason: 'no_due' };

    const nextMs = require('./groupEventScheduler').getNextEventMs();
    const farMs = cfg.WATCHDOG_STUCK_THRESHOLD_MS ?? 45 * 60 * 1000;
    const isFar = !nextMs || nextMs - Date.now() > farMs;
    if (!isFar) return { kicked: false, reason: 'next_event_ok' };

    const n = require('./groupEventScheduler').primeDueGroups();
    if (n > 0) {
      if (logThrottle.shouldLog('watchdog-kick', 10 * 60 * 1000)) {
        warningLog(`Watchdog: timers rearmados para ${n} grupo(s) due (evita ficar sem postar)`);
      }
      return { kicked: true, groups: n };
    }

    if (logThrottle.shouldLog('watchdog-no-prime', 15 * 60 * 1000)) {
      infoLog('Watchdog: grupos due encontrados, mas não foi possível rearmar timers');
    }
    return { kicked: false, reason: 'prime_zero' };
  } catch {
    return { kicked: false, reason: 'error' };
  }
};

