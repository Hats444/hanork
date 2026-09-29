'use strict';

const CATALOG_SERVICE_TYPES = new Set(['Default', 'Package', 'Custom Comments']);

const CATALOG_SERVICE_TYPE_SQL = "(COALESCE(service_type, 'Default') IN ('Default', 'Package', 'Custom Comments'))";

/** Exemplos de link por plataforma (serviços Default). */
const PLATFORM_LINK_HINTS = {
    Instagram: 'Ex.: <code>https://instagram.com/seu_perfil</code> ou link do post/reel',
    TikTok: 'Ex.: <code>https://tiktok.com/@usuario</code> ou link do vídeo',
    YouTube: 'Ex.: <code>https://youtube.com/@canal</code> ou link do vídeo',
    Telegram: 'Ex.: <code>https://t.me/canal</code> ou link de convite',
    Facebook: 'Ex.: <code>https://facebook.com/pagina</code> ou link do post',
    Discord: 'Ex.: <code>https://discord.gg/convite</code>',
    Spotify: 'Ex.: <code>https://open.spotify.com/artist/…</code>',
    Twitch: 'Ex.: <code>https://twitch.tv/canal</code> ou link da live',
    Twitter: 'Ex.: <code>https://x.com/perfil</code> ou link do post',
    Kwai: 'Ex.: <code>https://kwai.com/@usuario</code>',
    'Free Fire': 'Informe seu <b>ID do jogo</b> (número), não link de perfil',
    IPTV: 'Informe <b>usuário, e-mail, MAC ou dados</b> pedidos na descrição',
    Canva: 'Informe o <b>e-mail</b> da conta Canva para ativar',
    Outros: 'Siga a descrição do serviço — link ou dados conforme indicado',
};

function normalizeServiceType(type) {
    const t = String(type || 'Default').trim() || 'Default';
    return t;
}

function isCatalogServiceType(type) {
    return CATALOG_SERVICE_TYPES.has(normalizeServiceType(type));
}

function isFlatRatePricing(type) {
    return normalizeServiceType(type) === 'Package';
}

function serviceGuideHaystack(service) {
    return `${service?.description || ''}\n${service?.name || ''}\n${service?.category_raw || ''}`.toLowerCase();
}

/** API pede ID/dados no campo link em vez de URL. */
function descriptionRequiresTextTarget(service) {
    const hay = serviceGuideHaystack(service);
    return (
        /campo\s+link[^.\n]{0,80}(?:id|usu[aá]rio|login|e-mail|email|whatsapp|telefone|nick|mac)/i.test(hay) ||
        /(?:digite|informe|envie)\s+(?:o\s+|seu\s+|sua\s+)?(?:id\s+do\s+jogo|id\s+do\s+free|e-mail|email|whatsapp)/i.test(hay) ||
        /chame\s+(?:o\s+)?suporte|whatsapp\s+ap[oó]s\s+a\s+compra/i.test(hay)
    );
}

function getServiceInputProfile(service) {
    const type = normalizeServiceType(service?.service_type);
    const minQ = Math.max(1, Number(service?.min_quantity) || 1);
    const maxQ = Math.max(minQ, Number(service?.max_quantity) || minQ);
    const fixedQuantity = minQ === maxQ;
    const platform = service?.platform || 'Outros';
    const linkExample = PLATFORM_LINK_HINTS[platform] || PLATFORM_LINK_HINTS.Outros;
    const textByDesc = descriptionRequiresTextTarget(service);
    const textByPlatform = ['Free Fire', 'IPTV', 'Canva'].includes(platform);

    if (type === 'Package' || textByDesc || (type === 'Default' && textByPlatform)) {
        let targetHint =
            'Envie <b>ID, usuário, e-mail, WhatsApp ou MAC</b> conforme a descrição do serviço.\n' +
            '<i>Não precisa ser link http.</i>';
        if (platform === 'Free Fire') {
            targetHint = 'Digite seu <b>ID do Free Fire</b> (número do jogo).\n<i>O fornecedor usa o campo link para receber o ID.</i>';
        } else if (platform === 'IPTV') {
            targetHint = 'Informe <b>usuário, e-mail, MAC ou lista</b> pedidos na descrição.\n<i>Pacote IPTV — ativação manual após pagamento.</i>';
        } else if (platform === 'Canva') {
            targetHint = 'Informe o <b>e-mail</b> da conta Canva.\n<i>Após pagar, aguarde ativação conforme instruções.</i>';
        }
        return {
            serviceType: type,
            targetMode: 'text',
            targetLabel: 'Dados do pedido',
            targetHint,
            needsComments: false,
            fixedQuantity: type === 'Package' ? fixedQuantity : fixedQuantity,
            defaultQuantity: fixedQuantity ? minQ : null,
            flatPricing: type === 'Package',
        };
    }

    if (type === 'Custom Comments') {
        return {
            serviceType: type,
            targetMode: 'url',
            targetLabel: 'Link alvo',
            targetHint:
                `Envie o <b>link completo</b> do post, reel ou vídeo.\n${linkExample}`,
            needsComments: true,
            fixedQuantity: false,
            defaultQuantity: null,
            flatPricing: false,
        };
    }

    return {
        serviceType: 'Default',
        targetMode: 'url',
        targetLabel: 'Link alvo',
        targetHint:
            `Envie o <b>link completo</b> (https://…) do perfil, post, canal ou grupo.\n${linkExample}`,
        needsComments: false,
        fixedQuantity: false,
        defaultQuantity: null,
        flatPricing: false,
    };
}

/** Passos do wizard de compra (dados → pagamento). Comentários custom não têm passo de quantidade separado. */
function wizardStepTotal(profile) {
    let steps = 1;
    if (profile.needsComments) steps += 1;
    else if (!profile.fixedQuantity) steps += 1;
    steps += 1;
    return steps;
}

function wizardStepIndex(profile, phase) {
    const total = wizardStepTotal(profile);
    if (phase === 'payment') return total;
    if (phase === 'target') return 1;
    if (phase === 'comments') return 2;
    if (phase === 'quantity') return profile.needsComments ? null : 2;
    return 1;
}

function quantityUnitLabel(service, quantity) {
    const profile = getServiceInputProfile(service);
    const qty = Number(quantity);
    if (profile.needsComments) {
        return qty === 1 ? 'comentário' : 'comentários';
    }
    if (isFlatRatePricing(service?.service_type) && qty === 1) return 'pacote';
    if (profile.fixedQuantity && qty === 1) return 'pacote';
    return 'un.';
}

function formatQuantityDisplay(service, quantity) {
    const qty = Number(quantity);
    const unit = quantityUnitLabel(service, qty);
    if (unit === 'pacote' && qty === 1) return '1 pacote';
    if (unit === 'comentário' && qty === 1) return '1 comentário';
    if (unit === 'comentários') return `${qty.toLocaleString('pt-BR')} comentários`;
    return `${qty.toLocaleString('pt-BR')} ${unit}`;
}

module.exports = {
    CATALOG_SERVICE_TYPES,
    CATALOG_SERVICE_TYPE_SQL,
    PLATFORM_LINK_HINTS,
    normalizeServiceType,
    isCatalogServiceType,
    isFlatRatePricing,
    getServiceInputProfile,
    wizardStepTotal,
    wizardStepIndex,
    quantityUnitLabel,
    formatQuantityDisplay,
    descriptionRequiresTextTarget,
};
