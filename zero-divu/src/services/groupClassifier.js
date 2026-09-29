'use strict';

const fs = require('fs-extra');
const path = require('path');
const cfg = require('../config/divulgacao');

const rulesPath = path.join(__dirname, '../config/groupClassifier.json');

const PERMISSIVE_PHRASES = [
  'divulga livre',
  'divulgacao livre',
  'divulgação livre',
  'tudo liberado',
  'tudo permitido',
  'links liberados',
  'pode divulgar',
  'podem divulgar',
  'livre para divulgar',
  'livre divulgar',
  'sem restricao',
  'sem restricoes',
  'pode postar links',
  'divulgue a vontade',
  'links permitidos',
  'midia liberada',
  'liberado para divulgar',
  'divulgacao liberada',
  'divulgação liberada',
  'aberto para divulgacao',
  'aberto para divulgação',
];

const STRONG_CHAT_BAN = [
  'sem divulgacao',
  'sem divulgação',
  'sem divulgar',
  'proibido divulgar',
  'proibida divulgacao',
  'proibida divulgação',
  'nao divulgar',
  'não divulgar',
  'no ads',
  'proibido links',
  'sem links',
  'apenas conversa',
  'so conversa',
  'somente conversa',
  'anti-divulga',
  'proibido spam',
  'proibido propaganda',
];

const NEGATION_ALLOW_HINTS = [
  'nao e proibido divulgar',
  'não é proibido divulgar',
  'nao e proibido link',
  'não é proibido link',
  'pode divulgar sim',
  'divulgacao permitida',
  'divulgação permitida',
];

const RULES_SECTION_RE =
  /(?:regras?|rules?|normas?|avisos?|atencao|atenção|importante|proibido|permitido)\s*:?\s*([\s\S]{0,2000})/gi;

let rulesCache = null;

function loadRules() {
  if (rulesCache) return rulesCache;
  try {
    rulesCache = fs.readJsonSync(rulesPath);
  } catch {
    rulesCache = { divulgacao: [], chat: [], rulesBan: [], rulesAllow: [], patterns: {} };
  }
  return rulesCache;
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s@#+\-./|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Evita falso positivo em substring (ex.: "familia" dentro de outra palavra) */
function containsTerm(blob, term) {
  const t = normalize(term);
  if (t.length < 3) return false;
  if (t.includes(' ')) return blob.includes(t);
  const re = new RegExp(`(?:^|[\\s|])${escapeRegExp(t)}(?:$|[\\s|])`, 'i');
  return re.test(` ${blob} `);
}

function getDescription(profile) {
  return String(profile.desc || profile.description || '').trim();
}

function isEmptyDescription(profile) {
  return normalize(getDescription(profile)).length < 12;
}

function extractRulesText(desc) {
  if (!desc) return '';
  const raw = String(desc);
  const chunks = [];
  let m;
  const re = new RegExp(RULES_SECTION_RE.source, RULES_SECTION_RE.flags);
  while ((m = re.exec(raw)) !== null) {
    if (m[1]?.trim()) chunks.push(m[1].trim());
  }
  if (chunks.length) return chunks.join(' | ').slice(0, 2500);
  return raw.slice(0, 1200);
}

function buildProfileBlob(profile) {
  const subject = profile.subject || '';
  const desc = getDescription(profile);
  return normalize([subject, desc, profile.inviteText].filter(Boolean).join(' | '));
}

function buildRulesBlob(profile) {
  const desc = getDescription(profile);
  const rules = extractRulesText(desc);
  const rulesNorm = normalize(rules);
  if (rulesNorm.length >= 8) return rulesNorm;
  return normalize(desc.slice(0, 1200));
}

function scoreTerms(blob, list) {
  let score = 0;
  const hits = [];
  for (const { term, weight } of list) {
    if (containsTerm(blob, term)) {
      score += weight;
      hits.push(normalize(term));
    }
  }
  return { score, hits };
}

function scorePatternList(blob, patterns = []) {
  let score = 0;
  const hits = [];
  for (const p of patterns) {
    try {
      const re = new RegExp(p.re, p.flags || 'i');
      if (re.test(blob)) {
        score += p.weight || 8;
        hits.push(p.label || p.re);
      }
    } catch {
      /* ignore */
    }
  }
  return { score, hits };
}

function hasNegationAllow(blob) {
  return NEGATION_ALLOW_HINTS.some((p) => blob.includes(normalize(p)));
}

function hasStrongBanSignal(hits, score, minScore = 14) {
  if (score < 0) return false;
  if (score >= minScore + 6) return true;
  return hits.some((h) => STRONG_CHAT_BAN.some((s) => h.includes(s) || s.includes(h)));
}

function isPermissiveDescription(profile) {
  if (cfg.GROUP_CLASSIFY_PERMISSIVE_AS_DIVULG === false) return false;
  const desc = normalize(getDescription(profile));
  if (!desc) return false;
  return PERMISSIVE_PHRASES.some((p) => desc.includes(normalize(p)));
}

function metadataQuality(profile) {
  const descLen = normalize(getDescription(profile)).length;
  const fetched = profile.metadataFetched === true;
  const complete = profile.metadataComplete === true || descLen >= 12;
  if (fetched && complete) return 'full';
  if (descLen >= 12) return 'cached';
  if (fetched && !complete) return 'empty';
  return 'missing';
}

/** Camada 1 — conteúdo geral (nome + descrição completa) */
function analyzeContent(profile) {
  const rules = loadRules();
  const blob = buildProfileBlob(profile);
  const div = scoreTerms(blob, rules.divulgacao || []);
  const chat = scoreTerms(blob, rules.chat || []);
  const patDiv = scorePatternList(blob, rules.patterns?.divulgacao || []);
  const patChat = scorePatternList(blob, rules.patterns?.chat || []);

  let divScore = div.score + patDiv.score;
  let chatScore = chat.score + patChat.score;
  const divHits = [...div.hits, ...patDiv.hits].slice(0, 8);
  const chatHits = [...chat.hits, ...patChat.hits].slice(0, 8);

  const negationAllow = hasNegationAllow(blob);
  let explicitBan = hasStrongBanSignal(chatHits, chatScore);
  if (negationAllow && explicitBan && chatScore < 22) explicitBan = false;

  const permissiveDesc = isPermissiveDescription(profile);

  const notes = [];
  if (divHits.length) notes.push(`conteúdo divulgação: ${divHits.slice(0, 2).join(', ')}`);
  if (chatHits.length) notes.push(`conteúdo social: ${chatHits.slice(0, 2).join(', ')}`);
  if (explicitBan) notes.push('texto do perfil indica restrição a divulgação');
  if (permissiveDesc) notes.push('descrição permissiva no perfil');
  if (negationAllow) notes.push('texto indica permissão explícita (nega proibição)');

  return {
    divScore,
    chatScore,
    divHits,
    chatHits,
    explicitBan,
    permissiveDesc,
    negationAllow,
    notes,
  };
}

/** Camada 2 — bloco de regras (prioridade para PODE/NÃO PODE postar) */
function analyzeRules(profile) {
  const rules = loadRules();
  const blob = buildRulesBlob(profile);
  const ban = scoreTerms(blob, rules.rulesBan || []);
  const allow = scoreTerms(blob, rules.rulesAllow || []);
  const patBan = scorePatternList(blob, rules.patterns?.rulesBan || []);
  const patAllow = scorePatternList(blob, rules.patterns?.rulesAllow || []);

  let banScore = ban.score + patBan.score;
  let allowScore = allow.score + patAllow.score;
  const banHits = [...ban.hits, ...patBan.hits].slice(0, 6);
  const allowHits = [...allow.hits, ...patAllow.hits].slice(0, 6);

  const minBan = cfg.GROUP_CLASSIFY_RULES_BAN_MIN || 14;
  const minAllow = cfg.GROUP_CLASSIFY_RULES_ALLOW_MIN || 14;

  const negationAllow = hasNegationAllow(blob);
  let explicitBan = hasStrongBanSignal(banHits, banScore, minBan) || banScore >= minBan;
  let explicitAllow =
    allowScore >= minAllow || allowHits.length >= 2 || negationAllow;

  if (explicitBan && explicitAllow) {
    if (allowScore > banScore + 4) explicitBan = false;
    else if (banScore > allowScore + 4) explicitAllow = false;
    else {
      explicitBan = false;
      explicitAllow = false;
    }
  }

  const notes = [];
  if (explicitBan) notes.push(`regras proíbem: ${banHits.slice(0, 2).join(', ') || 'termo restritivo'}`);
  if (explicitAllow) notes.push(`regras permitem: ${allowHits.slice(0, 2).join(', ') || 'termo permissivo'}`);
  if (!blob) notes.push('sem bloco de regras identificável');

  return {
    banScore,
    allowScore,
    banHits,
    allowHits,
    explicitBan,
    explicitAllow,
    rulesEmpty: blob.length < 8,
    negationAllow,
    notes,
  };
}

/** Camada 3 — estrutura do grupo */
function analyzeStructure(profile, content) {
  const size = profile.size || 0;
  let divBoost = 0;
  let chatBoost = 0;
  const signals = [];

  if (profile.announce === true) {
    divBoost += cfg.GROUP_CLASSIFY_ANNOUNCE_BONUS || 12;
    signals.push('somente-admins');
  }
  if (profile.announce === false) {
    chatBoost += cfg.GROUP_CLASSIFY_OPEN_CHAT_BONUS || 4;
    signals.push('membros-postam');
  }
  if (profile.isCommunity || profile.isCommunityAnnounce) {
    divBoost += 6;
    signals.push('comunidade');
  }
  if (size >= 50 && content.divScore >= 6) {
    divBoost += 4;
    signals.push('grupo-grande');
  }
  if (size > 0 && size < 8 && !isEmptyDescription(profile)) {
    chatBoost += 5;
    signals.push('grupo-pequeno');
  }

  const emptyDesc = isEmptyDescription(profile);
  const notes = [...signals];
  if (emptyDesc) notes.push('descrição vazia ou muito curta');

  return { divBoost, chatBoost, signals, emptyDesc, notes };
}

function resolvePostPermission(profile, content, rules, structure) {
  const metaQ = metadataQuality(profile);
  const requireExplicit = cfg.GROUP_CLASSIFY_REQUIRE_EXPLICIT_ALLOW !== false;
  const defaultOpen = cfg.GROUP_CLASSIFY_DEFAULT_OPEN === true;
  const emptyAsDivulg = cfg.GROUP_CLASSIFY_EMPTY_DESC_AS_DIVULG === true;

  if (rules.explicitBan) {
    return { postPermission: 'denied', trust: 'verified_deny', note: '[permissão] negada pelas regras do grupo' };
  }

  if (rules.explicitAllow || content.permissiveDesc || content.negationAllow || rules.negationAllow) {
    return {
      postPermission: 'allowed',
      trust: 'verified_allow',
      note: rules.explicitAllow
        ? '[permissão] liberada pelas regras do grupo'
        : '[permissão] liberada pela descrição permissiva',
    };
  }

  if (content.explicitBan && !content.permissiveDesc) {
    return {
      postPermission: 'denied',
      trust: 'verified_deny',
      note: '[permissão] negada por texto anti-divulgação no perfil',
    };
  }

  if (structure.emptyDesc) {
    if (emptyAsDivulg && !content.explicitBan) {
      return {
        postPermission: 'allowed',
        trust: 'inferred',
        note: '[permissão] sem descrição — aberto salvo proibição explícita',
      };
    }
    return {
      postPermission: 'unknown',
      trust: 'inconclusive',
      note: '[permissão] sem descrição — aguardando verificação das regras',
    };
  }

  if (requireExplicit && !defaultOpen) {
    return {
      postPermission: 'unknown',
      trust: 'inconclusive',
      note: '[permissão] sem liberação explícita nas regras — bloqueado por segurança',
    };
  }

  if (defaultOpen && !content.explicitBan) {
    return {
      postPermission: 'allowed',
      trust: 'inferred',
      note: '[permissão] padrão aberto — sem proibição nas regras',
    };
  }

  if (metaQ === 'missing') {
    return {
      postPermission: 'unknown',
      trust: 'inconclusive',
      note: '[permissão] metadados incompletos — não inferida',
    };
  }

  return {
    postPermission: 'unknown',
    trust: 'inconclusive',
    note: '[permissão] indefinida — sem sinal claro',
  };
}

function buildVerdict(profile, content, rules, structure) {
  const divScore = content.divScore + structure.divBoost;
  const chatScore = content.chatScore + structure.chatBoost;
  const reasons = [];
  const minDiv = cfg.GROUP_CLASSIFY_MIN_DIV_SCORE || 10;
  const minChat = cfg.GROUP_CLASSIFY_MIN_CHAT_SCORE || 10;
  const margin = cfg.GROUP_CLASSIFY_MARGIN || 4;
  const metaQ = metadataQuality(profile);

  for (const n of [...rules.notes, ...content.notes, ...structure.notes]) {
    if (n && !reasons.includes(n)) reasons.push(n);
  }

  const perm = resolvePostPermission(profile, content, rules, structure);
  let postPermission = perm.postPermission;
  reasons.push(perm.note);

  const scoreGap = Math.abs(divScore - chatScore);
  const inferDiv =
    cfg.GROUP_CLASSIFY_INFER_DIV_FROM_SIGNALS !== false &&
    postPermission === 'unknown' &&
    divScore >= minDiv &&
    divScore >= chatScore &&
    !content.explicitBan &&
    !rules.explicitBan;

  if (inferDiv) {
    postPermission = 'allowed';
    reasons.push('[permissão] inferida — sinais de divulgação no grupo');
  }
  const isMixed =
    !rules.explicitBan &&
    divScore >= 7 &&
    chatScore >= 7 &&
    scoreGap <= margin;

  let groupType = 'unknown';
  let confidence = 'baixa';

  const { banScore, allowScore } = rules;

  if (rules.explicitBan && banScore >= allowScore) {
    groupType = 'chat';
    confidence = 'alta';
    reasons.push('[propósito] regras proíbem divulgação');
  } else if (isMixed) {
    groupType = 'mixed';
    confidence = 'média';
    reasons.push(`[propósito] misto — div ${divScore} vs chat ${chatScore}`);
  } else if (divScore >= minDiv && divScore >= chatScore + margin) {
    groupType = 'divulgacao';
    confidence = divScore >= minDiv + 10 ? 'alta' : 'média';
    reasons.push(
      `[propósito] divulgação (${content.divHits.slice(0, 2).join(', ') || 'sinais no nome/descrição'})`
    );
  } else if (chatScore >= minChat && chatScore > divScore + margin) {
    groupType = 'chat';
    confidence = chatScore >= minChat + 8 ? 'alta' : 'média';
    reasons.push(
      `[propósito] conversa (${content.chatHits.slice(0, 2).join(', ') || 'perfil social'})`
    );
  } else if (postPermission === 'denied') {
    groupType = 'chat';
    confidence = 'média';
    reasons.push('[propósito] alinhado à proibição de divulgar');
  } else if (divScore > chatScore && divScore >= 7) {
    groupType = 'divulgacao';
    confidence = 'baixa';
    reasons.push(`[propósito] tendência divulgação (${divScore}/${chatScore})`);
  } else if (cfg.GROUP_CLASSIFY_DEFAULT_OPEN === true) {
    groupType = 'divulgacao';
    reasons.push('[propósito] mantido — sem sinais fortes de chat');
  } else {
    groupType = 'unknown';
    reasons.push('[propósito] sem sinais claros — tratado com cautela');
  }

  let action = 'stay';

  if (postPermission === 'denied') {
    action = 'visit_once';
    reasons.push('[ação] visita única — divulgação proibida');
  } else if (postPermission === 'unknown') {
    action = 'stay_cautious';
    reasons.push('[ação] aguardando confirmação das regras — não entra no ciclo');
  } else if (groupType === 'chat') {
    if (cfg.GROUP_CLASSIFY_STRICT_CHAT !== false) {
      action = 'visit_once';
      reasons.push('[ação] visita única — grupo de conversa (modo rigoroso)');
    } else if (rules.explicitAllow || postPermission === 'allowed') {
      action = 'stay_cautious';
      reasons.push('[ação] permanece com cautela — chat, mas regras permitem links');
    } else {
      action = 'visit_once';
      reasons.push('[ação] visita única — conversa sem liberação nas regras');
    }
  } else if (groupType === 'mixed' && postPermission !== 'allowed') {
    action = 'stay_cautious';
    reasons.push('[ação] permanece com cautela — perfil misto sem liberação clara');
  } else if (
    groupType === 'divulgacao' &&
    confidence === 'baixa' &&
    postPermission !== 'allowed' &&
    cfg.GROUP_CLASSIFY_REQUIRE_EXPLICIT_ALLOW !== false
  ) {
    action = 'stay_cautious';
    postPermission = 'unknown';
    reasons.push('[ação] confiança baixa — exige liberação explícita antes de divulgar');
  } else if (groupType === 'divulgacao' && postPermission === 'allowed') {
    action = 'stay';
    reasons.push('[ação] permanece no ciclo de status');
  } else {
    action = 'stay';
    reasons.push('[ação] permanece no ciclo de status');
  }

  const summary = reasons
    .filter((r) => r.startsWith('['))
    .slice(0, 4)
    .map((r) => r.replace(/^\[[^\]]+\]\s*/, ''))
    .join(' · ');

  return {
    type: groupType,
    groupType,
    postPermission,
    action,
    confidence,
    trustLevel: perm.trust,
    metadataQuality: metaQ,
    reason: summary || 'análise em camadas concluída',
    reasons,
    divScore,
    chatScore,
    divHits: content.divHits,
    chatHits: content.chatHits,
    layers: {
      content: {
        divScore: content.divScore,
        chatScore: content.chatScore,
        explicitBan: content.explicitBan,
      },
      rules: {
        banScore: rules.banScore,
        allowScore: rules.allowScore,
        explicitBan: rules.explicitBan,
        explicitAllow: rules.explicitAllow,
      },
      structure: {
        divBoost: structure.divBoost,
        chatBoost: structure.chatBoost,
        emptyDesc: structure.emptyDesc,
      },
    },
  };
}

exports.classify = (profile = {}) => {
  const content = analyzeContent(profile);
  const rules = analyzeRules(profile);
  const structure = analyzeStructure(profile, content);
  return buildVerdict(profile, content, rules, structure);
};

exports.isPostAllowedByVerdict = (result) => {
  if (!result) return false;
  if (result.postPermission === 'denied') return false;
  if (result.action === 'visit_once') return false;
  if (result.postPermission === 'unknown') return cfg.GROUP_CLASSIFY_BLOCK_UNKNOWN === false;
  if (result.postPermission === 'allowed') return true;
  return cfg.GROUP_CLASSIFY_DEFAULT_OPEN === true;
};

/** Grupo entra no ciclo de divulgação */
exports.isEligibleForCycle = (group) => {
  if (!group?.id) return false;
  if (group.visitOnly || group.leftPending || group.pendingApproval) return false;
  if (group.classifyPendingVerify) return false;
  if (!cfg.ENABLE_GROUP_CLASSIFIER) return true;

  if (group.postPermission === 'denied') return false;
  if (group.classifyAction === 'visit_once') return false;
  if (group.postPermission === 'unknown' && cfg.GROUP_CLASSIFY_BLOCK_UNKNOWN !== false) return false;

  if (group.classifyAction === 'stay_cautious') {
    if (group.postPermission !== 'allowed') return false;
    if (group.groupType === 'chat' && cfg.GROUP_CLASSIFY_STRICT_CHAT !== false) return false;
  }

  if (['stay'].includes(group.classifyAction) && group.postPermission === 'allowed') return true;

  if (group.groupType === 'divulgacao' && group.postPermission === 'allowed') return true;
  if (group.groupType === 'mixed' && group.postPermission === 'allowed') return true;

  if (
    group.groupType === 'divulgacao' &&
    group.postPermission !== 'denied' &&
    cfg.GROUP_CLASSIFY_REQUIRE_EXPLICIT_ALLOW === false &&
    cfg.GROUP_CLASSIFY_DEFAULT_OPEN === true
  ) {
    return true;
  }

  return false;
};

exports.isDivulgacao = (group) => exports.isEligibleForCycle(group);

exports.isChat = (group) =>
  group?.groupType === 'chat' ||
  group?.classifyAction === 'visit_once' ||
  group?.postPermission === 'denied';

exports.formatVerdictLog = (result) => {
  const perm =
    result.postPermission === 'allowed'
      ? 'pode divulgar'
      : result.postPermission === 'denied'
        ? 'não pode divulgar'
        : 'aguardando confirmação';
  const trust = result.trustLevel ? ` · ${result.trustLevel}` : '';
  return `${perm}${trust} · ${result.reason}`;
};

exports.reloadRules = () => {
  rulesCache = null;
  return loadRules();
};

exports.metadataQuality = metadataQuality;

module.exports = exports;
