'use strict';

/**
 * Termos de Uso Hanork — linguagem amigável, paginada.
 * Adaptado dos termos originais; marca visível: Hanork / Hanork SMM.
 */

const PAGES = [
    {
        title: 'Aceitação dos termos',
        body:
            `Ao usar o <b>Hanork</b> e contratar nossos serviços de marketing digital, você concorda com estes termos.\n\n` +
            `Leia com atenção antes de comprar. A contratação implica aceitação integral.\n\n` +
            `Se não concordar com qualquer item, não utilize nossos serviços.`,
    },
    {
        title: 'Sobre os serviços',
        body:
            `O <b>Hanork SMM</b> oferece serviços de marketing digital para redes sociais.\n\n` +
            `• Destinados a maiores de 18 anos\n` +
            `• Você deve ter permissão para comprar em nome do perfil alvo\n` +
            `• O contratante é responsável por garantir essa autorização\n\n` +
            `<i>Não somos afiliados ao Instagram, Facebook, TikTok ou outras plataformas.</i>`,
    },
    {
        title: 'Garantias e reposições',
        body:
            `📌 <b>Perfil público</b> — quando exigido, o perfil deve estar público. Pedidos em perfil privado podem ser cancelados sem reembolso.\n\n` +
            `⚠️ <b>Sem garantia vitalícia</b> — fatores externos podem afetar a entrega.\n\n` +
            `🔄 <b>Reposição</b> — só quando o serviço contratado incluir refill. Serviços sem reposição não têm cobertura por queda.\n\n` +
            `📊 A qualidade pode variar; exemplos ilustrativos não são padrão garantido.`,
    },
    {
        title: 'Entregas',
        body:
            `• Após concluída, a entrega não pode ser removida da conta\n` +
            `• Pode haver entrega acima da quantidade solicitada (sem custo extra)\n` +
            `• Pagamentos aprovados entram em fila de execução — sem cancelamento após confirmação\n` +
            `• Prazo médio informado na descrição do serviço (geralmente até 3 dias úteis)\n` +
            `• Reembolso possível se a entrega ultrapassar 96h além do prazo médio, conforme regras\n\n` +
            `Cancelamento automático: link incorreto ou falha técnica comprovada.`,
    },
    {
        title: 'Comentários personalizados',
        body:
            `Comentários customizáveis devem ser usados de forma responsável.\n\n` +
            `<b>Proibido:</b> racismo, homofobia, difamação, discurso de ódio, conteúdo político, fofocas, religião, ataques ou insultos.\n\n` +
            `Você é o único responsável pelos textos enviados. O Hanork pode cooperar com autoridades em caso de investigação judicial.`,
    },
    {
        title: 'Preços',
        body:
            `• Cada serviço tem preço e condições específicas\n` +
            `• Valores podem mudar sem aviso prévio\n` +
            `• O preço na cotação pode diferir do preço no momento do pagamento\n\n` +
            `Consulte sempre o valor atualizado na tela do serviço antes de confirmar.`,
    },
    {
        title: 'Pagamentos',
        body:
            `• Pagamento antecipado via créditos na carteira Hanork\n` +
            `• Sem mensalidade; créditos não expiram\n` +
            `• Aceitamos Mercado Pago, PIX e outros métodos disponíveis no bot\n` +
            `• Disputas em gateways de pagamento podem resultar em suspensão da conta\n\n` +
            `Para reativação após disputa, será necessário encerrá-la a nosso favor.`,
    },
    {
        title: 'Reembolsos',
        body:
            `• Reembolso apenas quando o serviço não for prestado nas condições contratadas\n` +
            `• Sem reembolso por erro do usuário (link errado, perfil privado, etc.)\n` +
            `• Pedidos duplicados não geram estorno\n` +
            `• Serviço digital — não se aplica direito de arrependimento do CDC\n` +
            `• Saldo adicionado não pode ser revertido para conta bancária\n\n` +
            `Use seu saldo em pedidos dentro da plataforma Hanork.`,
    },
    {
        title: 'Serviços especiais',
        body:
            `📱 <b>Instagram — flag de seguidores</b>\n` +
            `Para serviços de seguidores, a flag de "contas suspeitas" deve estar <b>desativada</b>.\n\n` +
            `Se contratar serviço incompatível com o status do perfil, perde o direito a cancelamento ou reembolso.\n\n` +
            `Para contestar: envie gravação de tela (30–60s) em até 24h pelo suporte.`,
    },
    {
        title: 'Privacidade',
        body:
            `Garantimos sigilo dos seus pedidos no Hanork.\n\n` +
            `Em disputas públicas em plataformas externas, algumas informações podem ser usadas para comprovação (link, quantidade).\n\n` +
            `Recomendamos usar nosso canal de suporte para manter confidencialidade.`,
    },
    {
        title: 'Legislação',
        body:
            `Este contrato é regido pelas leis da República Federativa do Brasil.\n\n` +
            `Você concorda com a jurisdição exclusiva dos tribunais brasileiros.\n\n` +
            `<b>Hanork</b> © Todos os direitos reservados.\n\n` +
            `<i>Aviso: não oferecemos serviços de streaming (Spotify, Deezer, etc.). Nossos serviços usam divulgação real e interações humanas, sem violar termos das plataformas.</i>`,
    },
];

const TOTAL = PAGES.length;

function getPage(index) {
    const i = Math.max(0, Math.min(TOTAL - 1, Number(index) || 0));
    const page = PAGES[i];
    return {
        index: i,
        total: TOTAL,
        title: page.title,
        html:
            `📜 <b>Termos de Uso — Hanork</b>\n` +
            `<i>${i + 1} de ${TOTAL} · ${page.title}</i>\n\n` +
            page.body,
    };
}

function summaryBullets() {
    return (
        `📜 <b>Termos de Uso Hanork</b>\n\n` +
        `Principais regras:\n` +
        `• Perfil público quando exigido\n` +
        `• Sem garantia vitalícia\n` +
        `• Reposição só com refill contratado\n` +
        `• Pagamento aprovado = fila de execução\n` +
        `• Reembolso apenas quando aplicável\n` +
        `• Comentários: sem conteúdo ilegal ou ofensivo\n` +
        `• Você é responsável pelos links enviados\n\n` +
        `<i>Toque abaixo para ler o documento completo.</i>`
    );
}

module.exports = {
    PAGES,
    TOTAL,
    getPage,
    summaryBullets,
};
