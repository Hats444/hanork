'use strict';

const profiles = require('./profiles');
const memoryProfile = require('../utils/memoryProfile');
const pathResolver = require('../utils/pathResolver');

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

/** Ajustes manuais finos (opcional) — têm prioridade sobre o perfil */
const manualOverrides = {
  MAX_GROUPS: 25,
  GROUP_UPGRADE_MIN_SCORE_DELTA: 12,
  GROUP_UPGRADE_MIN_MEMBER_GAIN: 5,
};

const cfg = memoryProfile.applyToConfig({
  OPERATION_PROFILE,
  profileLabel: profileCfg.label,
  profileDescription: profileCfg.description,
  ...profileCfg,
  ...manualOverrides,
  SESSION_DIR: pathResolver.getSessionDir(),
});

module.exports = cfg;
