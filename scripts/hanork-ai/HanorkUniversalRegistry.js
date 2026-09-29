'use strict';

const { ACTIONS } = require('../../config/hanork-ai-actions');
const { getIntentComposites } = require('./HanorkIntentComposites');
const {
    getAllCommandEntries,
    getAllPanelButtons,
} = require('../../telegram/commands/botCommandsCatalog');

const HANORK_RE = /\bhanork\b/i;
const STOP_WORDS = new Set([
    'hanork', 'bot', 'por', 'favor', 'pfv', 'pf', 'pra', 'para', 'um', 'uma', 'o', 'a', 'de', 'da', 'do',
    'no', 'na', 'em', 'e', 'ou', 'que', 'como', 'me', 'eu', 'voce', 'você', 'the', 'a', 'os', 'as',
]);

const PHRASE_FILLERS = new Set(['nos', 'no', 'na', 'em', 'o', 'a', 'de', 'do', 'da', 'ao', 'aos', 'as']);

function flexPhraseMatch(norm, phrase) {
    if (!phrase || !norm) return false;
    const p = phrase.trim().toLowerCase();
    // Palavras curtas (pix, cupom) — só match com limite de palavra, não substring.
    if (p.length <= 4 && !/\s/.test(p)) {
        return wordBoundaryMatch(norm, p);
    }
    if (norm.includes(phrase)) return true;
    const parts = phrase.split(/\s+/).filter(Boolean);
    const words = norm.split(/\s+/);
    let wi = 0;
    for (const part of parts) {
        let found = false;
        while (wi < words.length) {
            if (words[wi] === part) {
                found = true;
                wi += 1;
                break;
            }
            if (PHRASE_FILLERS.has(words[wi])) {
                wi += 1;
                continue;
            }
            break;
        }
        if (!found) return false;
    }
    return true;
}

let _rules = null;

function normalize(text) {
    return String(text || '')
        .replace(HANORK_RE, ' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function tokens(text) {
    return normalize(text)
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

const USER_CALLBACKS = new Set(['menu:home', 'downloads:open', 'home_user', 'cat', 'cat_hub']);

/** Prefixos de callbacks de loja — não são só admin (Hanork AI / painéis). */
const USER_CALLBACK_PREFIXES = [
    'menu:',
    'downloads:',
    'help:',
    'search:',
    'catalog:',
    'cart:',
    'flash:',
    'user:',
    'order:',
    'subscription:',
];

function isCallbackAdminOnly(cb) {
    const c = String(cb || '').trim().toLowerCase();
    if (!c) return true;
    if (USER_CALLBACKS.has(c)) return false;
    if (c === 'noop') return false;
    if (USER_CALLBACK_PREFIXES.some((p) => c.startsWith(p))) return false;
    if (/^cat_/.test(c)) return false;
    return /^(a_|prod_|wa_|gw_|help_sec_|a_cmd_)/.test(c);
}

function isAdminOnlyEntry(entry) {
    const cmd = (entry.cmd || '').toLowerCase();
    if (entry.cb) return isCallbackAdminOnly(entry.cb);
    const adminPrefixes = [
        '/admin', '/add', '/edit', '/remove', '/reativar', '/listprodutos', '/gerenciar',
        '/flashsale', '/relatorio', '/backup', '/broadcast', '/usuarios', '/userinfo',
        '/reembolso', '/carrinhos', '/restock', '/entrar', '/conectar', '/ponte', '/addcupom',
        '/registrar_loja', '/admin_', '/planos', '/wa_', '/grupo', '/canal',
    ];
    return adminPrefixes.some((p) => cmd.startsWith(p.replace(/\/$/, '')) || cmd.startsWith(p));
}

function keywordsFromText(cmd, desc, label) {
    const keys = new Set();
    const cmdSpoken = cmd.replace(/^\//, '').trim();
    if (cmdSpoken) {
        keys.add(cmdSpoken);
        cmdSpoken.split(/\s+/).forEach((p) => keys.add(p));
    }
    const blob = `${desc || ''} ${label || ''}`.toLowerCase();
    for (const t of tokens(blob)) keys.add(t);
    return [...keys];
}

function buildRules() {
    const rules = [];

    for (const c of getIntentComposites()) {
        rules.push({ kind: 'composite', ...c });
    }

    for (const entry of getAllCommandEntries()) {
        const cmd = entry.cmd.trim();
        const slash = cmd.replace(/^\//, '');
        rules.push({
            kind: 'slash',
            slash,
            cmd,
            adminOnly: isAdminOnlyEntry(entry),
            keys: keywordsFromText(cmd, entry.desc, null),
            label: entry.desc,
        });
    }

    for (const btn of getAllPanelButtons()) {
        if (!btn.cb) continue;
        rules.push({
            kind: 'callback',
            callback: btn.cb,
            adminOnly: isCallbackAdminOnly(btn.cb),
            keys: keywordsFromText('', btn.desc, btn.label),
            label: btn.label || btn.desc,
        });
    }

    try {
        const wa = require('../../plugins/zero-divu/waCommandsHelp');
        if (wa?.WA_COMMANDS_FLAT) {
            for (const entry of wa.WA_COMMANDS_FLAT) {
                const slash = (entry.cmd || '').replace(/^\//, '').trim();
                rules.push({
                    kind: 'slash',
                    slash,
                    cmd: entry.cmd,
                    adminOnly: true,
                    keys: keywordsFromText(entry.cmd, entry.desc, null),
                    label: entry.desc,
                });
            }
        }
    } catch {
        /* plugin off */
    }

    return rules;
}

function getRules() {
    if (!_rules) _rules = buildRules();
    return _rules;
}

function wordBoundaryMatch(norm, word) {
    if (!word || word.length < 2) return false;
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`, 'i').test(norm);
}

function slashMatches(norm, slashNorm, tokSet) {
    if (!slashNorm) return false;
    const parts = slashNorm.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
        const w = parts[0];
        if (w.length <= 3) return tokSet.has(w) || norm === w;
        return tokSet.has(w) || norm === w || norm.startsWith(`${w} `);
    }
    return flexPhraseMatch(norm, slashNorm) || tokSet.has(parts[0]);
}

function scoreRule(rule, norm, tokSet) {
    let score = 0;

    if (rule.kind === 'composite') {
        for (const phrase of rule.keys) {
            if (flexPhraseMatch(norm, phrase)) score = Math.max(score, rule.score);
        }
        return score;
    }

    const slash = rule.slash || '';
    const slashNorm = slash.replace(/\s+/g, ' ');

    if (/\bdivulga/.test(norm) && /^grupo\b/.test(slashNorm)) {
        return 0;
    }

    if (slashNorm && slashMatches(norm, slashNorm, tokSet)) {
        score += 55;
    }

    if (rule.callback && wordBoundaryMatch(norm, rule.callback.replace(/_/g, ' '))) {
        score += 50;
    }

    for (const k of rule.keys) {
        if (k.length < 4) continue;
        if (wordBoundaryMatch(norm, k)) score += 18;
        if (tokSet.has(k)) score += 22;
    }

    if (rule.label) {
        for (const t of tokens(rule.label)) {
            if (tokSet.has(t)) score += 8;
        }
    }

    const head = slashNorm.split(/\s+/)[0] || '';
    const wordCount = norm.split(/\s+/).filter(Boolean).length;

    if (
        rule.kind === 'slash' &&
        head === 'produto' &&
        /\b(mostra|ver|abrir|lista|catalogo|loja)\b/.test(norm)
    ) {
        return 0;
    }

    if (
        rule.kind === 'slash' &&
        head === 'admin' &&
        /\b(painel\s+admin|abrir\s+painel|modo\s+admin)\b/.test(norm)
    ) {
        score += 35;
    }

    if (
        rule.kind === 'slash' &&
        head === 'backup' &&
        norm !== 'backup' &&
        !/^backup\b/.test(norm)
    ) {
        score = Math.min(score, 48);
    }

    if (
        rule.kind === 'slash' &&
        /^(tiktok|instagram|play|downloads?)$/.test(head) &&
        wordCount >= 3 &&
        !/\b(baix|baixa|abaixa|download|salvar|manda|envia|\/tiktok|\/instagram|\/play)\b/.test(norm)
    ) {
        score = Math.min(score, 48);
    }

    return Math.min(100, score);
}

function matchUniversal(text, ctx = {}) {
    const norm = normalize(text);
    if (!norm || norm.length < 3) return null;

    const tokSet = new Set(tokens(text));
    let best = null;

    for (const rule of getRules()) {
        if (rule.adminOnly && !ctx.isAdmin) continue;

        const score = scoreRule(rule, norm, tokSet);
        if (score < 50) continue;

        let candidate = null;
        if (rule.kind === 'composite') {
            if (rule.action === ACTIONS.RUN_CALLBACK && rule.callback) {
                candidate = {
                    action: ACTIONS.RUN_CALLBACK,
                    confidence: score,
                    params: { callback: rule.callback, label: rule.label || 'Painel' },
                };
            } else if (rule.action === ACTIONS.RUN_SLASH && rule.slash) {
                candidate = {
                    action: ACTIONS.RUN_SLASH,
                    confidence: score,
                    params: { slash: rule.slash, args: extractSlashArgs(norm, rule.slash) },
                };
            } else {
                candidate = { action: rule.action, confidence: score, params: rule.params || {} };
            }
        } else if (rule.kind === 'slash') {
            candidate = {
                action: ACTIONS.RUN_SLASH,
                confidence: score,
                params: { slash: rule.slash, args: extractSlashArgs(norm, rule.slash) },
            };
        } else if (rule.kind === 'callback') {
            candidate = {
                action: ACTIONS.RUN_CALLBACK,
                confidence: score,
                params: { callback: rule.callback, label: rule.label },
            };
        }

        if (candidate && (!best || candidate.confidence > best.confidence)) {
            best = { ...candidate, rule };
        }
    }

    return best;
}

function extractSlashArgs(norm, slash) {
    const spoken = String(slash || '').trim();
    if (!spoken) return '';
    const words = norm.split(/\s+/).filter(Boolean);
    const parts = spoken.split(/\s+/).filter(Boolean);
    let start = -1;
    for (let i = 0; i <= words.length - parts.length; i += 1) {
        if (parts.every((p, j) => words[i + j] === p)) {
            start = i;
            break;
        }
    }
    if (start === -1) return '';
    const tail = words.slice(start + parts.length).join(' ');
    return tail.length >= 2 ? tail : '';
}

function refreshRules() {
    _rules = null;
}

module.exports = {
    matchUniversal,
    normalize,
    getRules,
    refreshRules,
    isCallbackAdminOnly,
    USER_CALLBACK_PREFIXES,
};
