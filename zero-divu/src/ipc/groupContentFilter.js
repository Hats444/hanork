'use strict';

/**
 * Filtro unificado de conteúdo de grupo — Telegram + WhatsApp.
 * Bloqueia adulto/+18/putaria, spam óbvio, usernames e títulos suspeitos.
 * Usado antes de entrar, ao registrar e antes de divulgar.
 */

const STRONG_PATTERNS = [
  /\b(?:\+?\s*18|18\s*\+|\+18|maior\s*de\s*18|only\s*18|adult\s*only|dezoito\s*\+|eighteen\s*\+)\b/i,
  /\b(?:onlyfans|only\s*fans|privacy\s*\.?\s*com|fansly|patreon\s*\+18|close\s*friends)\b/i,
  /\b(?:pack\s*(?:\+|de)?\s*18|pack\s*vip|pack\s*hot|conteudo\s*\+18|conteúdo\s*\+18|midia\s*\+18|m[ií]dia\s*\+18)\b/i,
  /\b(?:nudes?|nudez|porn[oô]?|putaria|putariao|safad[ao]s?|tarad[ao]s?|sexo\s*explicito|sex\s*tape|sex\s*chat)\b/i,
  /\b(?:peitudinha?s?|peituda?s?|bunduda?s?|bundao|gostosinha?s?|gostosao|novinha?s?\s*\+18|garotas?\s*hot)\b/i,
  /\b(?:hentai|xvideos|pornhub|x\s*hamster|redtube|camgirl|webcam\s*girl|live\s*cam\s*girl)\b/i,
  /\b(?:amadoras?\s*\+18|videos?\s*\+18|fotos?\s*\+18|vip\s*\+18|premium\s*\+18|canal\s*\+18|grupo\s*\+18)\b/i,
  /\b(?:fetiche|fetish|bdsm|swing\s*club|troca\s*de\s*nudes?|vazados?|leaked|leaks?\s*vip)\b/i,
  /\b(?:acompanhante?s?|gp\s*vip|garota\s*de\s*programa|programa\s*vip|massagem\s*final\s*feliz)\b/i,
  /\b(?:hot\s*girls?|sexy\s*girls?|naughty|nsfw|xxx+|porn\s*star|modelo\s*vip\s*hot)\b/i,
  /\b(?:corno\s*vip|casais?\s*swing|troca\s*de\s*casais?|ménage|menage)\b/i,
  /\b(?:sugar\s*baby|sugar\s*daddy|findom|paypig|conteudo\s*exclusivo\s*hot)\b/i,
  /\b(?:material\s*\+18|conteudo\s*adulto|conteúdo\s*adulto|adult\s*content|conteudo\s*proibido)\b/i,
  /\b(?:sigilo\s*\+18|vip\s*sigilo|canal\s*sigilo\s*hot|grupo\s*sigilo\s*hot)\b/i,
  /\b(?:lives?\s*\+18|live\s*hot|live\s*privada|live\s*vip\s*hot)\b/i,
  /(?:🔞|🍑|🍆|💦|👙|🥵|😈|🫦|🔥\s*hot|hot\s*🔥|💋|👅|🍒🔥|🔥🍒)/,
  /(?:𝐏𝐄𝐈𝐓𝐔|PEITUD|PUTAR|SAFAD|GOSTOS|NOVINH|NUDES?|PORN|XXX|\+18|18\+|PRIVACY|ONLYFANS)/i,
  /(?:تع[\u0640-\u065f\s]*ال|ن[\u0640-\u065f\s]*ار|حب|سكس|جنس|عهر|قح|شهو)/u,
  /(?:🤤|🥵).*?(?:🔥|نار)/u,
  /\b(?:1\s*8\s*\+|1\s*8\s*plus|\+?\s*1\s*8)\b/i,
  /(?:1️⃣8️⃣|🔞\s*1️⃣8️⃣|1️⃣8️⃣\s*🔞)/,
];

const MEDIUM_PATTERNS = [
  /\b(?:hot\s*chat|chat\s*hot|dating\s*vip|match\s*hot|crush\s*vip|flirt\s*vip)\b/i,
  /\b(?:roleta|cassino|bet\s*365|apostas?\s*vip|ganhe\s*dinheiro\s*facil|jogo\s*do\s*tigrinho)\b/i,
  /\b(?:divulg[aã]o\s*liberad[ao]|achadinho?s?\s*hot|promo\s*hot|links?\s*hot)\b/i,
  /\b(?:conteudo\s*vip\s*hot|vip\s*hot|grupo\s*hot|canal\s*hot|chat\s*privado\s*hot)\b/i,
  /\b(?:modelo\s*vip|model\s*vip|influencer\s*\+18|creators?\s*\+18)\b/i,
  /(?:🍒\s*💕|💕\s*🍒|👀\s*24hr|24\s*hr\s*👀|💋\s*🔥|🔥\s*💋)/,
];

const USERNAME_PATTERNS = [
  /(?:^|[_\-.])(?:pack|nude|porn|putaria|safad|gostos|peitud|bundud|novinh|hotgirl|onlyfan|privacy|xxx|nsfw|adult|hentai|xvideos|pornhub)(?:\d|[_\-.]|$)/i,
  /(?:^|[_\-.]|)(?:pack|nude|porn|putaria|safad|gostos|peitud|bundud|novinh|hotgirl|onlyfan|privacy|xxx|nsfw|adult|hentai)(?:vip|hot|18|xxx)/i,
  /(?:^|[_\-.])18(?:plus|vip|hot|pack|nude|xxx|)?(?:\d|[_\-.]|$)/i,
  /(?:^|[_\-.])hot(?:\d|[_\-.]|$)/i,
  /(?:^|[_\-.])vip(?:[_\-.]?)(?:18|hot|pack|nude|xxx)/i,
];

const SUSPICIOUS_EMOJIS = new Set([
  '🔞', '🍑', '🍆', '💦', '👙', '🥵', '😈', '🫦', '💋', '👅', '🍒', '🤤', '🔥',
]);

const TITLE_ONLY_EMOJI_BLOCK =
  /^[\s\p{Emoji}\p{Extended_Pictographic}👙🔞😈🍒💕🥵💦🍑🫦💋👅🤤🔥]+$/u;

const LEET_MAP = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's',
};

function stripInvisible(text) {
  return String(text || '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\u00ad/g, '');
}

function applyLeet(text) {
  return String(text || '')
    .split('')
    .map((ch) => LEET_MAP[ch] ?? ch)
    .join('');
}

/** Remove separadores entre letras: p.e.i.t.u.d.a → peituda */
function collapseSpacedLetters(text) {
  return String(text || '').replace(/\b([a-z])(?:[\s._\-*]+[a-z]){2,}\b/gi, (m) =>
    m.replace(/[\s._\-*]+/g, '')
  );
}

function normalizeBlob(parts) {
  const raw = String(parts.filter(Boolean).join(' '));
  const base = stripInvisible(raw)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const leet = applyLeet(base);
  const collapsed = collapseSpacedLetters(leet);
  return `${base} ${leet} ${collapsed}`.replace(/\s+/g, ' ').trim();
}

function normalizeUsername(username) {
  return String(username || '')
    .replace(/^@/, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9_\-+.]/g, '');
}

function matchPatterns(blob, patterns) {
  for (const re of patterns) {
    if (re.test(blob)) return re;
  }
  return null;
}

function analyzeEmojiTitle(title) {
  const t = String(title || '').trim();
  if (!t) return null;

  if (TITLE_ONLY_EMOJI_BLOCK.test(t)) {
    return { reason: 'titulo_so_emoji_suspeito', severity: 'strong', matched: 'emoji-only' };
  }

  const chars = [...t];
  const emojiChars = chars.filter((ch) => /\p{Extended_Pictographic}/u.test(ch));
  const suspiciousCount = emojiChars.filter((ch) => SUSPICIOUS_EMOJIS.has(ch)).length;
  const textLen = t.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s/g, '').length;

  if (suspiciousCount >= 3 && textLen < 12) {
    return { reason: 'titulo_emoji_adulto', severity: 'strong', matched: 'emoji-density' };
  }
  if (emojiChars.length >= 4 && textLen <= 2) {
    return { reason: 'titulo_emoji_adulto', severity: 'strong', matched: 'emoji-heavy' };
  }
  return null;
}

function analyzeUsername(username) {
  const slug = normalizeUsername(username);
  if (!slug || slug.length < 3) return null;
  const hit = matchPatterns(slug, USERNAME_PATTERNS);
  if (hit) {
    return {
      reason: 'username_adulto_ou_suspeito',
      severity: 'strong',
      matched: String(hit),
    };
  }
  return null;
}

/**
 * @returns {{ blocked: boolean, reason: string|null, severity: 'strong'|'medium'|null, matched: string|null, channel: 'tg'|'wa'|null }}
 */
function analyzeGroupContent({
  title = '',
  description = '',
  inviteText = '',
  username = '',
  channel = null,
} = {}) {
  if (process.env.GROUP_CONTENT_FILTER_ENABLED === '0') {
    return { blocked: false, reason: null, severity: null, matched: null, channel };
  }

  const blob = normalizeBlob([title, description, inviteText]);
  const ch = channel === 'wa' || channel === 'tg' ? channel : null;

  const emojiHit = analyzeEmojiTitle(title);
  if (emojiHit) {
    return { blocked: true, ...emojiHit, channel: ch };
  }

  const userHit = analyzeUsername(username);
  if (userHit) {
    return { blocked: true, ...userHit, channel: ch };
  }

  if (!blob && !username) {
    return { blocked: false, reason: null, severity: null, matched: null, channel: ch };
  }

  const strong = matchPatterns(blob, STRONG_PATTERNS);
  if (strong) {
    return {
      blocked: true,
      reason: 'conteudo_adulto_ou_18',
      severity: 'strong',
      matched: String(strong),
      channel: ch,
    };
  }

  const medium = matchPatterns(blob, MEDIUM_PATTERNS);
  if (medium) {
    return {
      blocked: true,
      reason: 'titulo_spam_ou_suspeito',
      severity: 'medium',
      matched: String(medium),
      channel: ch,
    };
  }

  return { blocked: false, reason: null, severity: null, matched: null, channel: ch };
}

/** API unificada para decisão de entrada (WA + TG). */
function validateGroupJoin(fields = {}) {
  const analysis = analyzeGroupContent(fields);
  return {
    allowed: !analysis.blocked,
    ...analysis,
  };
}

function shouldBlockGroupJoin(fields) {
  return !validateGroupJoin(fields).allowed;
}

function isBlockedGroupContent(fields) {
  return analyzeGroupContent(fields).blocked;
}

function formatBlockLog(fields) {
  const r = analyzeGroupContent(fields);
  if (!r.blocked) return null;
  const name = fields.title || fields.subject || fields.username || '?';
  return `${name}: ${r.reason}`;
}

/** Mensagem amigável para admin Telegram. */
function formatBlockUserMessage(analysis) {
  const r = analysis?.blocked != null ? analysis : analyzeGroupContent(analysis || {});
  if (!r.blocked) return '';
  const labels = {
    conteudo_adulto_ou_18: 'conteúdo adulto / +18',
    titulo_spam_ou_suspeito: 'spam ou título suspeito',
    titulo_so_emoji_suspeito: 'título só com emojis suspeitos',
    titulo_emoji_adulto: 'título com emojis adultos',
    username_adulto_ou_suspeito: 'username suspeito (+18/adulto)',
  };
  const label = labels[r.reason] || r.reason || 'conteúdo bloqueado';
  return (
    `🚫 <b>Grupo bloqueado pelo filtro anti +18</b>\n\n` +
    `Motivo: <i>${label}</i>\n\n` +
    `<i>Telegram e WhatsApp usam o mesmo filtro — entrada e divulgação negadas.</i>`
  );
}

module.exports = {
  analyzeGroupContent,
  validateGroupJoin,
  shouldBlockGroupJoin,
  isBlockedGroupContent,
  formatBlockLog,
  formatBlockUserMessage,
  normalizeBlob,
  STRONG_PATTERNS,
  MEDIUM_PATTERNS,
  USERNAME_PATTERNS,
};
