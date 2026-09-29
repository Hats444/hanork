'use strict';

const WaDivulgacaoConfig = require('./waDivulgacaoConfig');

/** Número fictício — nunca use número real de cliente em exemplos. */
const PHONE_EXAMPLE_BR = '+55 11 99999-9999';
const PHONE_EXAMPLE_BR_DIGITS = '5511999999999';

const BRAND_TITLE = '𝗛𝗮𝗻𝗼𝗿𝗸 𝗗𝗶𝘃';

function brandTitle() {
    return WaDivulgacaoConfig.displayBrand || BRAND_TITLE;
}

function formatHeroIntro() {
    return (
        `📲 ${brandTitle()}\n\n` +
        `𝘛𝘳𝘢𝘯𝘴𝘧𝘰𝘳𝘮𝘦 𝘴𝘦𝘶 𝘞𝘩𝘢𝘵𝘴𝘈𝘱𝘱 𝘦𝘮 𝘶𝘮𝘢 𝘮𝘢𝘲𝘶𝘪𝘯𝘢 𝘢𝘶𝘵𝘰𝘮𝘢𝘵𝘪𝘤𝘢.\n\n` +
        `Controle, divulgação e gestão\n` +
        `direto pelo Telegram — 𝗿𝗮𝗽𝗶𝗱𝗼, 𝘀𝗶𝗺𝗽𝗹𝗲𝘀 e eficiente.`
    );
}

function formatFeaturesBlock() {
    return (
        `𝗢 𝗾𝘂𝗲 𝘃𝗼𝗰ê 𝗳𝗮𝘇:\n` +
        `• Disparos em massa com poucos toques\n` +
        `• Alcance ampliado (grupos + status)\n` +
        `• Postagens automáticas no status\n` +
        `• Controle total de grupos\n` +
        `• Envio rápido de mídias e textos\n` +
        `• Download de músicas do YouTube\n` +
        `• Grupos prontos por nicho\n` +
        `• Ativação automática após pagamento\n\n` +
        `𝘔𝘦𝘯𝘰𝘴 𝘦𝘴𝘧𝘰𝘳𝘤𝘰\n` +
        `𝗠𝗮𝗶𝘀 𝗿𝗲𝘀𝘂𝗹𝘁𝗮𝗱𝗼`
    );
}

function formatUserFooter(ctxOrUser) {
    const from = ctxOrUser?.from || ctxOrUser;
    const rawUser = from?.username ? String(from.username).replace(/^@/, '') : null;
    const displayUser = rawUser || from?.first_name || '—';
    const id = from?.id ?? ctxOrUser?.telegram_id ?? '—';
    const userLine = rawUser ? `@${displayUser}` : displayUser;
    return `👤 <b>Usuário:</b> ${userLine}\n🆔 <b>Seu ID:</b> <code>${id}</code>`;
}

function formatPreSalePitch(pricePerDay) {
    const day = Number(pricePerDay) || 4;
    return (
        `${formatHeroIntro()}\n\n` +
        `${formatFeaturesBlock()}\n\n` +
        `<i>Planos a partir de R$ ${day.toFixed(2).replace('.', ',')}/dia · PIX libera na hora.</i>`
    );
}

function formatPlansBlock(lines) {
    return `<b>Planos disponíveis:</b>\n${lines}`;
}

function formatPreSaleCta() {
    return `👇 <b>Clique nos botões abaixo para ver os planos disponíveis.</b>`;
}

function formatPreSalePanel(ctxOrUser, pricePerDay) {
    return `${formatPreSalePitch(pricePerDay)}\n\n${formatUserFooter(ctxOrUser)}\n\n${formatPreSaleCta()}`;
}

function formatPostSaleBenefits() {
    return (
        `𝗥𝗲𝗰𝘂𝗿𝘀𝗼𝘀 𝗱𝗼 𝘀𝗲𝘂 𝗽𝗹𝗮𝗻𝗼:\n` +
        `• Disparos em massa · grupos + status\n` +
        `• Campanhas automáticas com anti-ban\n` +
        `• Modelos, agendamento e histórico\n` +
        `• Painel completo no Telegram\n` +
        `• Sessão salva — reconecta sozinha`
    );
}

function formatActivationBenefits() {
    return (
        `${brandTitle()} — <b>plano ativo!</b>\n\n` +
        `${formatPostSaleBenefits()}\n\n` +
        `📱 Toque em <b>Conectar WhatsApp</b> e escolha <b>QR Code</b> ou <b>código</b>.`
    );
}

function formatNextStepsNotConnected() {
    return (
        `\n<b>🚀 Próximos passos:</b>\n` +
        `1. <b>Conectar WhatsApp</b> (QR ou código)\n` +
        `2. Abrir <b>Campanhas</b> e escolher um modelo\n` +
        `3. Disparar — o bot cuida do resto`
    );
}

function formatCartPitch(productName, price) {
    const priceStr = Number(price || 0).toFixed(2).replace('.', ',');
    return (
        `${brandTitle()}\n\n` +
        `✅ Plano <b>${productName}</b> no carrinho.\n` +
        `💰 <b>R$ ${priceStr}</b>\n\n` +
        `Após o PIX você recebe:\n` +
        `• Painel liberado na hora\n` +
        `• Conexão WhatsApp (QR ou código)\n` +
        `• Campanhas automáticas nos seus grupos\n\n` +
        `<i>Pagamento confirmado → ativação automática.</i>`
    );
}

function formatPlanProductDescription(days) {
    const d = Number(days) || 1;
    return (
        `Acesso ${d} dia${d > 1 ? 's' : ''} ao ${brandTitle()}.\n\n` +
        `• Disparos em massa · grupos + status\n` +
        `• Postagens automáticas e anti-ban\n` +
        `• Painel no Telegram · ativação após pagamento`
    );
}

function formatBenefitsList() {
    return formatFeaturesBlock();
}

function formatBenefitsCompact() {
    return (
        `• Disparos · grupos · status · anti-ban\n` +
        `• Modelos · agendar · histórico · painel TG`
    );
}

function phonePromptMessage() {
    return (
        '🔢 <b>Login por código</b>\n\n' +
        'Envie seu número com DDI (pode usar +, espaços ou traços).\n\n' +
        `🇧🇷 Exemplo: <code>${PHONE_EXAMPLE_BR}</code>\n` +
        `ou <code>${PHONE_EXAMPLE_BR_DIGITS}</code>\n\n` +
        '<i>O código de 8 dígitos aparece aqui — use <b>📋 Copiar</b>.</i>'
    );
}

function phoneInvalidExample() {
    return `❌ Envie só o número.\nExemplo: <code>${PHONE_EXAMPLE_BR}</code>`;
}

module.exports = {
    BRAND_TITLE,
    PHONE_EXAMPLE_BR,
    PHONE_EXAMPLE_BR_DIGITS,
    brandTitle,
    formatBenefitsList,
    formatBenefitsCompact,
    formatPreSalePitch,
    formatPreSalePanel,
    formatPlansBlock,
    formatPreSaleCta,
    formatPostSaleBenefits,
    formatActivationBenefits,
    formatNextStepsNotConnected,
    formatCartPitch,
    formatPlanProductDescription,
    formatUserFooter,
    phonePromptMessage,
    phoneInvalidExample,
};
