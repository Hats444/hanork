'use strict';

const profiles = require('./profiles');
const memoryProfile = require('../utils/memoryProfile');

/**
 * Perfil operacional:
 *   'safe'       — anti-ban máximo (padrão)
 *   'balanced'   — meio termo
 *   'aggressive' — maior alcance (conta madura)
 *
 * Sobrescreva via ambiente: ZERO_DIVU_PROFILE=balanced
 */
const OPERATION_PROFILE = (
  process.env.ZERO_DIVU_PROFILE ||
  process.env.OPERATION_PROFILE ||
  'safe'
).toLowerCase();

const profileCfg = profiles.byName(OPERATION_PROFILE);

/** Ajustes manuais finos (opcional) — têm prioridade sobre o perfil via config.patch.json */
const manualOverrides = {
  GROUP_UPGRADE_MIN_SCORE_DELTA: 12,
  GROUP_UPGRADE_MIN_MEMBER_GAIN: 5,
};

function resumeJoinCap() {
  const n = Number(process.env.ZERO_DIVU_RESUME_JOIN_CAP);
  if (Number.isFinite(n) && n > 0) return Math.min(50, Math.max(5, Math.floor(n)));
  return 25;
}

const cfg = memoryProfile.applyToConfig({
  OPERATION_PROFILE,
  profileLabel: profileCfg.label,
  profileDescription: profileCfg.description,
  RESUME_JOIN_CAP: resumeJoinCap(),
  ...profileCfg,
  ...manualOverrides,
});

if (process.env.ZERO_DIVU_SESSION_DIR && String(process.env.ZERO_DIVU_SESSION_DIR).trim()) {
  cfg.SESSION_DIR = String(process.env.ZERO_DIVU_SESSION_DIR).trim();
}

module.exports = cfg;
