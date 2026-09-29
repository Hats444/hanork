'use strict';

const {
    getServiceInputProfile,
    isFlatRatePricing,
    normalizeServiceType,
    PLATFORM_LINK_HINTS,
} = require('../constants/serviceTypes');

const PLATFORM_INTRO = {
    Instagram: 'Perfil ou post <b>público</b>. Use link https do Instagram.',
    TikTok: 'Vídeo ou perfil <b>público</b>. Cole o link completo do TikTok.',
    YouTube: 'Canal ou vídeo <b>público</b>. Link youtube.com ou youtu.be.',
    Telegram: 'Canal/grupo com link t.me ou invite.',
    Facebook: 'Página ou post <b>público</b>.',
    'Free Fire': 'Pacotes digitais — informe <b>ID do jogo</b>, não link.',
    IPTV: 'Planos e painéis — informe dados de acesso (usuário, e-mail, MAC).',
    Canva: 'Assinatura — informe <b>e-mail</b> da conta.',
    Outros: 'Leia <b>como comprar</b> em cada produto antes de pagar.',
};

const SUBCATEGORY_SYNTHETIC = {
    Seguidores: [
        'Perfil deve estar <b>público</b>',
        'Não mude @usuario durante a entrega',
        'Cole o link do <b>perfil</b> (não só o @)',
    ],
    Curtidas: [
        'Post deve estar <b>público</b>',
        'Não apague o post durante a execução',
        'Link direto do post ou reel',
    ],
    Visualizações: [
        'Vídeo/post acessível sem login',
        'Link direto do conteúdo',
    ],
    Comentários: [
        'Link do post onde comentar',
        'Textos legais — você é responsável pelo conteúdo',
    ],
    Membros: [
        'Grupo/canal deve aceitar membros',
        'Link de convite ou @público conforme serviço',
    ],
    Inscritos: [
        'Canal <b>público</b> no YouTube',
        'Link do canal completo',
    ],
    Reações: [
        'Post/canal acessível',
        'Link direto do conteúdo',
    ],
    Compartilhamentos: ['Conteúdo público', 'Não altere privacidade durante entrega'],
    Stories: ['Perfil público', 'Story visível na hora da entrega'],
    Lives: ['Live ativa ou link da transmissão'],
};

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function normalizeDesc(desc) {
    return String(desc || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/observa[cç][oõ]es\s*:/gi, '')
        .trim();
}

function getEffectiveGuideText(service) {
    const api = normalizeDesc(service?.description);
    if (api.length > 8) return api;
    const cat = String(service?.category_raw || '').trim();
    const name = String(service?.name || '').trim();
    if (cat && cat !== name) return `Categoria: ${cat}`;
    return '';
}

function descBullets(text) {
    const normalized = normalizeDesc(text);
    if (!normalized) return [];
    return normalized
        .split(/\n+/)
        .map((line) => line.replace(/^[-•*]\s*/, '').trim())
        .filter((line) => line.length > 2);
}

function extractLinkFieldInstruction(service) {
    const hay = `${getEffectiveGuideText(service)}\n${service?.name || ''}\n${service?.category_raw || ''}`;
    const patterns = [
        /no\s+campo\s+link[^.\n]{0,200}/i,
        /campo\s+link[^.\n]{0,200}/i,
        /(?:digite|informe|envie)\s+(?:o\s+|seu\s+|sua\s+)?(?:id[^.\n]{0,80}|nome[^.\n]{0,60}|usu[aá]rio[^.\n]{0,60}|login[^.\n]{0,60}|e-?mail[^.\n]{0,60}|whatsapp[^.\n]{0,60}|telefone[^.\n]{0,60}|nick[^.\n]{0,40}|mac[^.\n]{0,40})/i,
        /level\s+m[ií]nimo[^.\n]{0,80}/i,
        /fa[cç]a\s+o\s+pedido\s+e\s+aguarde[^.\n]{0,120}/i,
        /chame\s+(?:o\s+)?suporte[^.\n]{0,120}/i,
        /utilize\s+link\s+ou\s+@[^.\n]{0,80}/i,
    ];
    for (const p of patterns) {
        const m = hay.match(p);
        if (m) return m[0].trim();
    }
    return null;
}

function buildSyntheticInstructions(service) {
    const bullets = [];
    const profile = getServiceInputProfile(service);
    const sub = service?.subcategory || 'Outros';
    const platform = service?.platform || 'Outros';

    if (SUBCATEGORY_SYNTHETIC[sub]) {
        bullets.push(...SUBCATEGORY_SYNTHETIC[sub]);
    }

    if (profile.targetMode === 'text') {
        if (platform === 'Free Fire') bullets.push('No pedido, envie o <b>ID numérico</b> do jogo');
        else if (platform === 'IPTV') bullets.push('Envie dados de acesso pedidos (usuário, e-mail, MAC, etc.)');
        else if (platform === 'Canva') bullets.push('Envie o <b>e-mail</b> da conta Canva');
        else bullets.push('Informe os dados pedidos — <b>não precisa ser link http</b>');
    } else if (PLATFORM_LINK_HINTS[platform]) {
        bullets.push(`Link: ${PLATFORM_LINK_HINTS[platform].replace(/<[^>]+>/g, '')}`);
    }

    const name = String(service?.name || '');
    if (/reposi/i.test(name) && service?.refill) bullets.push('Serviço com <b>reposição</b> conforme prazo no nome');
    if (/brasileir|(\bbr\b)/i.test(name)) bullets.push('Público/alvo <b>Brasil</b> quando aplicável');
    if (/instant|r[aá]pid/i.test(name)) bullets.push('Entrega tende a iniciar <b>rápido</b> após pagamento');
    if (/level\s+\d+/i.test(name)) bullets.push('Verifique requisito de <b>level</b> no nome/descrição');

    if (!bullets.length) {
        bullets.push('Leia o nome do serviço e siga o fluxo de compra abaixo');
        bullets.push('Entrega após confirmação do pagamento');
    }

    return [...new Set(bullets)].slice(0, 8);
}

function defaultCheckoutSteps(service) {
    const profile = getServiceInputProfile(service);
    const steps = [];

    if (profile.needsComments) {
        steps.push('Envie o <b>link</b> do post ou vídeo.');
        steps.push('Digite os <b>comentários</b>, um por linha (quantidade = linhas).');
        steps.push('Confirme e pague com PIX ou cartão.');
        steps.push('Pedido enviado ao fornecedor após pagamento.');
        return steps;
    }

    if (profile.targetMode === 'text') {
        steps.push(`Informe <b>${profile.targetLabel.toLowerCase()}</b> (conforme instruções abaixo).`);
        if (profile.fixedQuantity) {
            steps.push('Pacote com quantidade fixa — não precisa digitar quantidade.');
        } else {
            steps.push('Escolha a <b>quantidade</b>.');
        }
    } else {
        steps.push('Envie o <b>link completo</b> (https://…) do alvo.');
        steps.push('Escolha a <b>quantidade</b> dentro do mín/máx.');
    }

    steps.push('Confirme o resumo e pague (PIX ou cartão).');
    steps.push('Após pagar, o pedido vai <b>automaticamente</b> para o fornecedor.');
    return steps;
}

function buildHowToBuySteps(service) {
    return defaultCheckoutSteps(service);
}

function formatProviderInstructions(service) {
    const apiBullets = descBullets(getEffectiveGuideText(service));
    const synthetic = buildSyntheticInstructions(service);
    const merged = apiBullets.length ? apiBullets : synthetic;
    return merged.slice(0, 10).map((b) => `• ${escapeHtml(b)}`).join('\n');
}

function buildPlatformIntro(platform) {
    return PLATFORM_INTRO[platform] || PLATFORM_INTRO.Outros;
}

function buildWizardIntro(service) {
    const steps = buildHowToBuySteps(service).slice(0, 4);
    const provider = formatProviderInstructions(service);
    let block = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    if (provider) {
        block += `\n\n📎 <b>Importante</b>\n${provider.split('\n').slice(0, 5).join('\n')}`;
    }
    return block;
}

/** Tela inicial do wizard — instruções do fornecedor uma vez, sem repetir. */
function buildWizardStartMessage(service, profile) {
    const provider = formatProviderInstructions(service);
    const hay = getEffectiveGuideText(service);
    const postPay = /whatsapp|suporte|chame|chamar/i.test(hay)
        ? '\n\n📱 <i>Depois de pagar: siga as instruções acima (ex.: chamar no WhatsApp).</i>'
        : '';

    let body = `Serviço: <i>${escapeHtml(String(service?.name || '').slice(0, 80))}</i>\n\n`;

    if (provider) {
        body += `📎 <b>Instruções do fornecedor</b>\n${provider}\n\n`;
    }

    body += `✏️ <b>Agora digite abaixo</b>\n`;
    if (profile.targetMode === 'text') {
        const apiLine = extractLinkFieldInstruction(service);
        body += apiLine
            ? `<i>${escapeHtml(apiLine.charAt(0).toUpperCase() + apiLine.slice(1))}</i>\n<i>Não precisa ser link http.</i>`
            : '<i>Informe os dados pedidos (ID, nome, e-mail…).</i>';
    } else {
        body += '<i>Envie o link completo começando com https://</i>';
    }

    if (profile.fixedQuantity) {
        body += '\n\n<i>Em seguida: confirmar e pagar (pacote fixo, sem escolher quantidade).</i>';
    }

    return body + postPay;
}

function buildWizardTargetHint(service) {
    const profile = getServiceInputProfile(service);
    const apiLine = extractLinkFieldInstruction(service);

    if (apiLine) {
        return (
            `📋 <b>Instrução do fornecedor</b>\n` +
            `<i>${escapeHtml(apiLine.charAt(0).toUpperCase() + apiLine.slice(1))}</i>\n\n` +
            (profile.targetMode === 'text'
                ? 'Digite abaixo (não precisa ser link http):'
                : 'Use um link completo começando com https://')
        );
    }

    const synthetic = buildSyntheticInstructions(service).slice(0, 3);
    const synBlock = synthetic.length
        ? `\n\n<i>${synthetic.map((s) => escapeHtml(s)).join('\n')}</i>`
        : '';

    return `${profile.targetHint}${synBlock}`;
}

function buildWizardCommentsHint(service) {
    const bullets = descBullets(getEffectiveGuideText(service));
    const extra = bullets.length
        ? `\n\n<b>Do fornecedor:</b>\n${bullets.slice(0, 4).map((b) => `• ${escapeHtml(b)}`).join('\n')}`
        : '';
    return (
        'Envie os comentários desejados, <b>um por linha</b>.\n' +
        'A quantidade do pedido será igual ao número de linhas.' +
        extra
    );
}

function buildWizardQuantityHint(service) {
    const profile = getServiceInputProfile(service);
    const bullets = descBullets(getEffectiveGuideText(service));
    const extra = bullets.find((b) => /m[ií]n|m[aá]x|somente|por dia|level/i.test(b));
    const extraLine = extra ? `\n\n<i>${escapeHtml(extra)}</i>` : '';

    if (profile.fixedQuantity) {
        return `Este pacote é fixo: <b>${profile.defaultQuantity || service.min_quantity}</b> un.${extraLine}`;
    }

    return (
        `Mínimo: <b>${service.min_quantity}</b> · Máximo: <b>${Number(service.max_quantity).toLocaleString('pt-BR')}</b>` +
        extraLine
    );
}

function buildPurchaseGuideBlock(service) {
    const steps = buildHowToBuySteps(service);
    const provider = formatProviderInstructions(service);
    const type = normalizeServiceType(service?.service_type);

    let block = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');

    if (provider) {
        block += `\n\n📎 <b>Instruções</b>\n${provider}`;
    }

    if (type === 'Package') {
        block += '\n\n<i>📦 Pacote digital: ativação/entrega conforme instruções acima após confirmação do pagamento.</i>';
    }

    if (type === 'Custom Comments') {
        block += '\n\n<i>💬 Comentários custom: um texto por linha; conteúdo ilegal ou ofensivo pode ser recusado.</i>';
    }

    return block;
}

function buildServiceDetailExtras(service) {
    const provider = formatProviderInstructions(service);
    const linkInstr = extractLinkFieldInstruction(service);
    const parts = [];

    if (linkInstr) {
        parts.push(`📝 <b>O que enviar no pedido</b>\n<i>${escapeHtml(linkInstr)}</i>`);
    }
    if (provider) {
        parts.push(`📎 <b>Requisitos e ativação</b>\n${provider}`);
    }

    parts.push(`🛒 <b>Como comprar</b>\n${buildPurchaseGuideBlock(service)}`);

    return parts.join('\n\n');
}

function pricingUnitLabel(service) {
    return isFlatRatePricing(service?.service_type) ? 'por pacote' : 'por 1.000';
}

function formatSearchPrice(service) {
    const unit = pricingUnitLabel(service);
    return `R$ ${Number(service.sale_price).toFixed(2)}/${unit === 'por pacote' ? 'pacote' : '1k'}`;
}

module.exports = {
    buildHowToBuySteps,
    buildPurchaseGuideBlock,
    buildServiceDetailExtras,
    buildWizardTargetHint,
    buildWizardCommentsHint,
    buildWizardQuantityHint,
    buildWizardIntro,
    buildWizardStartMessage,
    buildPlatformIntro,
    extractLinkFieldInstruction,
    formatProviderInstructions,
    formatSearchPrice,
    pricingUnitLabel,
    descBullets,
    buildSyntheticInstructions,
};
