'use strict';

const { serviceDisplayLabel, categoryBreadcrumb } = require('./displayLabelService');
const { formatMoney, truncate } = require('../utils/smmTextFormat');
const { buildServiceDetailExtras, pricingUnitLabel } = require('./purchaseGuideService');
const { getServiceInputProfile } = require('../constants/serviceTypes');

const SUBCATEGORY_HINTS = {
    Seguidores: [
        'Perfil deve estar público',
        'Não altere o nome de usuário durante a execução',
        'Entrega pode ser gradual (drip feed)',
        'Não garantimos permanência vitalícia',
    ],
    Curtidas: [
        'Post ou perfil deve estar público',
        'Não remova o conteúdo durante a execução',
        'Entrega iniciada após confirmação do pagamento',
    ],
    Visualizações: [
        'Link do vídeo ou post deve estar acessível',
        'Entrega pode ser distribuída ao longo do tempo',
    ],
    Comentários: [
        'Use apenas textos adequados e legais',
        'Você é responsável pelos textos enviados',
        'Conteúdo ofensivo ou ilegal é proibido',
    ],
    Compartilhamentos: [
        'Conteúdo deve estar público',
        'Não altere privacidade durante a execução',
    ],
    Stories: [
        'Perfil deve estar público',
        'Story deve estar visível no momento da entrega',
    ],
    Reações: [
        'Post ou canal deve estar acessível',
        'Entrega conforme disponibilidade do serviço',
    ],
    Lives: [
        'Live deve estar ativa ou agendada conforme o serviço',
        'Verifique requisitos na descrição',
    ],
    Membros: [
        'Grupo ou canal deve permitir entrada de membros',
        'Não altere configurações de privacidade durante a execução',
    ],
    Inscritos: [
        'Canal deve estar público',
        'Entrega pode ser gradual',
    ],
    Assinatura: [
        'Informe os dados pedidos (nome, e-mail, usuário, MAC…)',
        'Não altere os dados durante a ativação',
        'Entrega após confirmação do pagamento',
    ],
    Pacote: [
        'Leia o nome do pacote e siga as instruções do fornecedor',
        'Informe ID ou dados corretos quando pedido',
        'Entrega após confirmação do pagamento',
    ],
};

const DEFAULT_HINTS = [
    'Siga as instruções do fornecedor abaixo',
    'Entrega iniciada após confirmação do pagamento',
    'Pode ocorrer entrega gradual',
    'Não altere os dados informados durante a execução',
    'Reposição conforme disponibilidade do serviço',
];

function deliveryTimeHint(svc) {
    const avg = svc?.average_time || svc?.provider_average_time;
    if (avg && String(avg).trim()) {
        return `Normalmente: <i>${String(avg).slice(0, 80)}</i>`;
    }
    return 'Normalmente iniciado em poucas horas.';
}

function refillLine(svc) {
    if (svc?.refill) {
        return '✅ Este serviço possui <b>reposição</b> conforme condições contratadas.';
    }
    return '⚠️ Este serviço <b>não possui reposição</b> automática.';
}

function cancelLine(svc) {
    if (svc?.cancel) return 'Cancelamento disponível enquanto o pedido permitir.';
    return null;
}

function buildServiceDescription(svc) {
    if (!svc) return '';

    const title = truncate(svc.name || serviceDisplayLabel(svc, { max: 120 }), 120);

    const profile = getServiceInputProfile(svc);
    const hints = SUBCATEGORY_HINTS[svc.subcategory] || DEFAULT_HINTS;
    const hintBullets = hints.map((h) => `• ${h}`).join('\n');
    const unit = pricingUnitLabel(svc);
    const detailExtras = buildServiceDetailExtras(svc);

    const flags = [];
    if (svc.refill) flags.push('Reposição');
    if (svc.cancel) flags.push('Cancelável');
    const flagLine = flags.length ? `\n<i>${flags.join(' · ')}</i>` : '';

    const targetReq =
        profile.targetMode === 'text'
            ? 'Informe os <b>dados pedidos</b> (ID, usuário, e-mail, etc.).'
            : 'Conta ou link <b>público</b> quando aplicável.';

    let body =
        `${categoryBreadcrumb(svc.platform, svc.subcategory)}\n\n` +
        `<b>${title}</b>\n\n` +
        `📌 <b>Informações</b>\n${hintBullets}\n\n` +
        `⏱ <b>Prazo médio</b>\n${deliveryTimeHint(svc)}\n\n` +
        `📋 <b>Requisitos</b>\n${targetReq}\n` +
        `Mín: <b>${svc.min_quantity}</b> · Máx: <b>${Number(svc.max_quantity).toLocaleString('pt-BR')}</b>\n\n` +
        `💰 <b>${formatMoney(svc.sale_price)}</b> <i>${unit}</i>` +
        flagLine +
        `\n\n🔒 <b>Garantias</b>\n${refillLine(svc)}`;

    const cancel = cancelLine(svc);
    if (cancel) body += `\n<i>${cancel}</i>`;

    if (detailExtras) {
        body += `\n\n${detailExtras}`;
    }

    return body;
}

module.exports = {
    buildServiceDescription,
    SUBCATEGORY_HINTS,
    deliveryTimeHint,
};
