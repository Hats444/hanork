'use strict';

const cfg = require('../config/divulgacao');

function currentHour() {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: cfg.TIMEZONE || 'America/Sao_Paulo',
    }).format(new Date())
  );
}

function inRange(hour, start, end) {
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

exports.isActiveNow = () => {
  if (cfg.ACTIVE_HOURS_ENABLED) {
    const hour = currentHour();
    const start = cfg.ACTIVE_HOURS_START ?? 8;
    const end = cfg.ACTIVE_HOURS_END ?? 23;
    if (!inRange(hour, start, end)) return false;
  }

  if (cfg.QUIET_HOURS_ENABLED !== false) {
    const hour = currentHour();
    const qStart = cfg.QUIET_HOURS_START ?? 1;
    const qEnd = cfg.QUIET_HOURS_END ?? 6;
    if (inRange(hour, qStart, qEnd)) {
      const prob = cfg.QUIET_HOURS_SKIP_PROBABILITY ?? 0.82;
      if (Math.random() < prob) return false;
    }
  }

  return true;
};

exports.getQuietFactor = () => {
  if (cfg.QUIET_HOURS_ENABLED === false) return 1;
  const hour = currentHour();
  const qStart = cfg.QUIET_HOURS_START ?? 1;
  const qEnd = cfg.QUIET_HOURS_END ?? 6;
  if (!inRange(hour, qStart, qEnd)) return 1;
  return cfg.QUIET_HOURS_DELAY_FACTOR ?? 1.45;
};

exports.describe = () => {
  const hour = currentHour();
  const quiet =
    cfg.QUIET_HOURS_ENABLED !== false &&
    inRange(hour, cfg.QUIET_HOURS_START ?? 1, cfg.QUIET_HOURS_END ?? 6);
  return {
    hour,
    active: exports.isActiveNow(),
    quietWindow: quiet,
    timezone: cfg.TIMEZONE || 'America/Sao_Paulo',
  };
};

module.exports = exports;
