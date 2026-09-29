'use strict';
/**
 * Gera marketing/hanork/001.md … 100.md e marketing/smm/001.md … 100.md
 * Textos exclusivos para broadcast / campanhas (não altera CampaignOrchestrator).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'marketing');

const hanorkStyles = [
    'direto',
    'confiança',
    'benefício',
    'urgência suave',
    'storytelling',
    'pergunta',
    'lista',
    'premium',
    'social proof',
    'educativo',
];

const hanorkBenefits = [
    'entrega automática no Telegram após o pagamento',
    'PIX e cartão com confirmação rápida',
    'catálogo digital organizado por formato',
    'suporte humano quando precisar',
    'programa de afiliados com comissão recorrente',
    'downloads gratuitos na central Hanork',
    'ofertas relâmpago com preço especial',
    'assinatura Premium com vantagens exclusivas',
    'carrinho simples — revise antes de pagar',
    'produtos digitais prontos para uso imediato',
];

const hanorkCtas = [
    '🚀 Toque em /start e abra o Catálogo',
    '🛍️ Abra o bot e toque em Começar',
    '💳 Escolha seu produto e pague com PIX',
    '🎫 Dúvidas? Use Suporte no menu',
    '🤝 Indique amigos e ganhe comissão',
    '💎 Conheça os Planos Premium em Minha Conta',
    '⬇️ Baixe conteúdo grátis na Central Downloads',
    '🔥 Veja Ofertas no menu principal',
];

function pad(n) {
    return String(n).padStart(3, '0');
}

function buildHanorkText(i) {
    const style = hanorkStyles[i % hanorkStyles.length];
    const b1 = hanorkBenefits[i % hanorkBenefits.length];
    const b2 = hanorkBenefits[(i + 3) % hanorkBenefits.length];
    const cta = hanorkCtas[i % hanorkCtas.length];
    const n = pad(i);

    const hooks = {
        direto: `<b>Hanork — sua loja digital no Telegram</b>`,
        confiança: `<b>Compre com tranquilidade na Hanork</b>`,
        benefício: `<b>Produtos digitais sem complicação</b>`,
        'urgência suave': `<b>Novidades no catálogo Hanork</b>`,
        storytelling: `<b>Você pediu praticidade — a Hanork entrega</b>`,
        pergunta: `<b>Quer receber seu produto digital em segundos?</b>`,
        lista: `<b>3 motivos para usar a Hanork hoje</b>`,
        premium: `<b>Experiência profissional de ponta a ponta</b>`,
        'social proof': `<b>Quem compra na Hanork volta pelo fluxo simples</b>`,
        educativo: `<b>Como funciona a Hanork em 30 segundos</b>`,
    };

    let body = '';
    if (style === 'lista') {
        body =
            `1️⃣ ${b1}\n` +
            `2️⃣ ${b2}\n` +
            `3️⃣ Pagamento seguro via Mercado Pago\n\n`;
    } else if (style === 'pergunta') {
        body = `${b1.charAt(0).toUpperCase() + b1.slice(1)}.\n${b2.charAt(0).toUpperCase() + b2.slice(1)}.\n\n`;
    } else if (style === 'storytelling') {
        body =
            `Você escolhe no <b>Catálogo</b>, paga com PIX ou cartão e recebe aqui no chat.\n` +
            `${b1.charAt(0).toUpperCase() + b1.slice(1)}.\n\n`;
    } else {
        body =
            `${b1.charAt(0).toUpperCase() + b1.slice(1)}.\n` +
            `${b2.charAt(0).toUpperCase() + b2.slice(1)}.\n\n`;
    }

    return (
        `# Hanork — Texto ${n}\n\n` +
        `**Estilo:** ${style}\n\n` +
        `${hooks[style]}\n\n` +
        `${body}` +
        `<b>${cta}</b>\n\n` +
        `---\n` +
        `_Uso: broadcast Telegram / PV · Hanork v3.0.0 · texto #${i}_`
    );
}

const smmServices = [
    { name: 'seguidores', platform: 'Instagram', note: 'crescimento gradual e natural' },
    { name: 'curtidas', platform: 'Instagram', note: 'mais engajamento nos posts' },
    { name: 'visualizações', platform: 'Reels/TikTok', note: 'alcance para vídeos curtos' },
    { name: 'membros Telegram', platform: 'Telegram', note: 'audiência no seu canal ou grupo' },
    { name: 'inscritos YouTube', platform: 'YouTube', note: 'presença no seu canal' },
    { name: 'visualizações stories', platform: 'Instagram', note: 'destaque nos stories' },
    { name: 'comentários', platform: 'redes sociais', note: 'prova social moderada' },
    { name: 'shares', platform: 'TikTok', note: 'distribuição orgânica complementar' },
];

const smmStyles = [
    'profissional',
    'educativo',
    'benefício',
    'pergunta',
    'confiança',
    'direto',
    'crescimento',
    'marca pessoal',
    'criador de conteúdo',
    'negócios locais',
];

const smmCtas = [
    '📈 Abra Serviços SMM no menu Hanork',
    '🚀 Use /start smm para ver plataformas',
    '💳 Escolha quantidade, pague e acompanhe o pedido',
    '📦 Rastreie em Meus Pedidos',
    '🎫 Suporte humano se precisar de ajuda',
];

function buildSmmText(i) {
    const svc = smmServices[i % smmServices.length];
    const style = smmStyles[i % smmStyles.length];
    const cta = smmCtas[i % smmCtas.length];
    const n = pad(i);

    const titles = {
        profissional: `<b>Serviços SMM Hanork — ${svc.name}</b>`,
        educativo: `<b>Entenda os serviços de ${svc.name} com responsabilidade</b>`,
        benefício: `<b>Impulsione ${svc.name} no ${svc.platform}</b>`,
        pergunta: `<b>Quer reforçar ${svc.name} no ${svc.platform}?</b>`,
        confiança: `<b>Crescimento social com processo claro</b>`,
        direto: `<b>${svc.name.charAt(0).toUpperCase() + svc.name.slice(1)} · ${svc.platform}</b>`,
        crescimento: `<b>Estratégia de crescimento para ${svc.platform}</b>`,
        'marca pessoal': `<b>Marca pessoal: ${svc.name} com método</b>`,
        'criador de conteúdo': `<b>Criadores: ${svc.name} no ${svc.platform}</b>`,
        'negócios locais': `<b>Presença digital: ${svc.name}</b>`,
    };

    const disclaimer =
        `<i>Resultados variam conforme nicho e conteúdo. Sem promessas irreais — ` +
        `pedidos processados com prazo informado no catálogo.</i>`;

    const body =
        `Plataforma: <b>${svc.platform}</b>\n` +
        `Serviço: <b>${svc.name}</b>\n` +
        `${svc.note.charAt(0).toUpperCase() + svc.note.slice(1)}.\n\n` +
        `Pagamento via PIX ou cartão · acompanhamento no bot.\n\n` +
        `${disclaimer}\n\n` +
        `<b>${cta}</b>\n\n` +
        `---\n` +
        `_Uso: divulgação SMM · Hanork v3.0.0 · texto #${i}_`;

    return `# SMM Hanork — Texto ${n}\n\n**Estilo:** ${style}\n\n${titles[style]}\n\n${body}`;
}

function writeDir(sub, builder) {
    const dir = path.join(root, sub);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= 100; i++) {
        fs.writeFileSync(path.join(dir, `${pad(i)}.md`), builder(i), 'utf8');
    }
    console.log(`OK ${sub}/ — 100 arquivos`);
}

writeDir('hanork', buildHanorkText);
writeDir('smm', buildSmmText);
console.log('Marketing copy gerado em marketing/');
