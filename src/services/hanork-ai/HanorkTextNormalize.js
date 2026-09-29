'use strict';

/**
 * Normalização leve para NL — typos e abreviações comuns (não lista de comandos).
 */

function stripAccents(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizeForIntent(text) {
    let s = stripAccents(String(text || '').trim().toLowerCase());
    if (!s) return '';

    const replacements = [
        [/\bvc\b/g, 'voce'],
        [/\bvoce\b/g, 'voce'],
        [/\bpfv\b/g, 'por favor'],
        [/\bblz\b/g, 'beleza'],
        [/\bqto\b/g, 'quanto'],
        [/\btd\b/g, 'tudo'],
        [/\bcmg\b/g, 'comigo'],
        [/\bpra\b/g, 'para'],
        [/\bpro\b/g, 'para o'],
        [/\bdivulga[cç]ao\b/g, 'divulgacao'],
        [/\bcat[aá]logo\b/g, 'catalogo'],
        [/\bpre[cç]o\b/g, 'preco'],
        [/\bpre[cç]os\b/g, 'precos'],
        [/\bpr[eé]co\b/g, 'preco'],
        [/\bpreco\b/g, 'preco'],
        [/\bvalor\b/g, 'valor'],
        [/\bproduto\b/g, 'produto'],
        [/\bprodutos\b/g, 'produtos'],
        [/\bcarrinho\b/g, 'carrinho'],
        [/\bcheck\s*out\b/g, 'checkout'],
        [/\bwhats\b/g, 'whatsapp'],
        [/\bzap\b/g, 'whatsapp'],
        [/\bpedido\b/g, 'pedido'],
        [/\bpedidos\b/g, 'pedidos'],
        [/\bmanda\b/g, 'manda'],
        [/\babaixa\b/g, 'baixa'],
        [/\babaixar\b/g, 'baixar'],
    ];

    for (const [re, rep] of replacements) {
        s = s.replace(re, rep);
    }

    const typoFixes = [
        ['precoo', 'preco'],
        ['precso', 'preco'],
        ['prco', 'preco'],
        ['precço', 'preco'],
        ['divulag', 'divulga'],
        ['divulagr', 'divulgar'],
        ['alterar', 'altera'],
        ['mudar', 'muda'],
        ['trocar', 'troca'],
        ['catalogo', 'catalogo'],
        ['chekout', 'checkout'],
        ['chek out', 'checkout'],
    ];
    for (const [from, to] of typoFixes) {
        if (s.includes(from)) s = s.split(from).join(to);
    }

    return s.replace(/\s+/g, ' ').trim();
}

module.exports = {
    normalizeForIntent,
    stripAccents,
};
