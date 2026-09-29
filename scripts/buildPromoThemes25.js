'use strict';

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '../src/data');
const HERO = { hanork: 'hanork_01.jpg', smm: 'ssm_01.jpg', virtuo: 'virtuo_01.jpg' };

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
}

function saveJson(name, data) {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function withHero(themes, hero) {
  return themes.map((t, i) => ({
    ...t,
    image_file: hero,
    slot: i + 1,
  }));
}

const hanorkExtra = [
  {
    id: 'carteira-hanork',
    headline: 'Carteira Hanork: crédito reutilizável quando PIX ou API falha',
    tgBody:
      'Falha no gateway, timeout do provedor SMM ou indisponibilidade momentânea da API Virtuo não precisam travar a operação.\n\n' +
      'A Carteira Hanork credita automaticamente o valor pago quando a entrega não conclui. O cliente usa o saldo em nova tentativa ou em outro produto do catálogo, sem abrir ticket manual para cada caso.\n\n' +
      'Você reduz chargeback informal, mantém confiança e evita reembolso manual repetido. Tudo registrado no histórico do pedido e visível no painel /admin.',
    waBody:
      'HANORK PRO — Carteira integrada\n\n' +
      'Se PIX, SMM ou números Virtuo falharem após pagamento, o valor vira crédito reutilizável na loja.\n\n' +
      'Menos estorno manual, mais confiança do cliente e operação contínua.',
  },
  {
    id: 'multi-admin',
    headline: 'Dois admins no Telegram com logs separados por bot',
    tgBody:
      'Operação com sócio ou equipe exige controle de acesso.\n\n' +
      'O Hanork PRO suporta múltiplos IDs de administrador no painel /admin. Notificações de atividade podem ir para um bot dedicado, enquanto alertas de novo membro chegam pelo bot principal — sem misturar flood de log com conversão.\n\n' +
      'Ideal para quem escala suporte e vendas mantendo visibilidade do que acontece na loja em tempo real.',
    waBody:
      'HANORK PRO — Multi-admin\n\n' +
      'Dois ou mais admins no /admin. Logs de operação e alertas de novo cliente configuráveis.\n\n' +
      'Escala equipe sem perder controle da loja.',
  },
  {
    id: 'wa-blast-fix',
    headline: 'Blast WhatsApp corrigido: 1 post por grupo, sem rajada',
    tgBody:
      'Divulgação em massa no WhatsApp exige disciplina anti-ban.\n\n' +
      'O módulo Zero Divu do Hanork usa lock global, cooldown por grupo e pausa do scheduler durante blast personalizado. Cada grupo recebe no máximo um post por sessão, com delay entre grupos.\n\n' +
      'Combine textos profissionais (25 variantes Hanork) com foto principal pareada e rotação automática nos Status — sem repetir 6 posts na mesma hora.',
    waBody:
      'HANORK PRO + WhatsApp\n\n' +
      'Blast com 1 post/grupo, cooldown e fila inteligente.\n\n' +
      '25 textos Hanork + foto principal. Divulgação que respeita o grupo.',
  },
  {
    id: 'restock-flash',
    headline: 'Restock, flash sale e fila de espera no mesmo fluxo',
    tgBody:
      'Produto esgotado não precisa significar venda perdida.\n\n' +
      'Configure alerta de restock, oferta relâmpago com timer e mensagem automática quando o estoque volta. O cliente que clicou em avise-me recebe push no privado.\n\n' +
      'Flash sale com preço promocional visível, contagem regressiva e checkout imediato — tudo integrado ao carrinho e ao PIX automático.',
    waBody:
      'HANORK PRO — Restock + Flash\n\n' +
      'Avise-me quando voltar, oferta relâmpago com timer e checkout PIX.\n\n' +
      'Recupere vendas de produto esgotado.',
  },
  {
    id: 'referencias-gate',
    headline: 'Canal de referências como portão de entrada qualificado',
    tgBody:
      'Tráfego frio no bot pode gerar curiosos sem intenção de compra.\n\n' +
      'O gate de canal de referências exige membership antes de abrir catálogo ou checkout. Quem entra já passou por um filtro de comunidade.\n\n' +
      'Combine com afiliados, cupom exclusivo e broadcast segmentado para converter audiência aquecida em receita recorrente.',
    waBody:
      'HANORK PRO — Gate de referências\n\n' +
      'Exija canal antes do catálogo. Tráfego mais qualificado e menos spam no PV.\n\n' +
      'Integrado a afiliados e cupons.',
  },
];

const smmExtra = [
  {
    id: 'smm-launch-21',
    headline: 'Twitter / X: seguidores e engajamento inicial',
    tgBody:
      'Perfil novo no X precisa de sinais de movimento para ganhar alcance orgânico.\n\n' +
      'No Hanork você contrata seguidores e interações informando o @ do perfil. Preço visível antes do pagamento, entrega automática após confirmação PIX ou cartão.\n\n' +
      'Use como impulso em lançamentos, threads comerciais ou vitrine de autoridade — sempre com acompanhamento no privado do bot.',
    waBody:
      'SMM Twitter/X no Hanork\n\n' +
      'Seguidores e engajamento pelo @hanork_bot.\n\n' +
      'PIX ou cartão. Status do pedido no PV.',
  },
  {
    id: 'smm-launch-22',
    headline: 'Facebook: curtidas e seguidores para página',
    tgBody:
      'Página com poucos likes passa menos confiança em anúncios e orgânico.\n\n' +
      'Catálogo SMM do Hanork inclui serviços para Facebook: curtidas em posts, seguidores de página e visualizações quando disponíveis.\n\n' +
      'Fluxo simples: link da página, quantidade, pagamento. Sem painel externo obscuro. Suporte via /suporte.',
    waBody:
      'Facebook SMM\n\n' +
      'Curtidas e seguidores de página no Hanork.\n\n' +
      'Link + quantidade + PIX ou cartão.',
  },
  {
    id: 'smm-launch-23',
    headline: 'Spotify: plays e seguidores para artista',
    tgBody:
      'Lançamento musical precisa de tração nas primeiras 48 horas.\n\n' +
      'Contrate plays e seguidores para perfil ou faixa no Spotify pelo catálogo SMM do Hanork. Informe o link oficial, escolha o pacote e pague com PIX ou Mercado Pago.\n\n' +
      'Pedido rastreável no privado. Ideal para singles, playlists comerciais e testes de audiência.',
    waBody:
      'Spotify no Hanork\n\n' +
      'Plays e seguidores para artista.\n\n' +
      'Entrega automática após pagamento confirmado.',
  },
  {
    id: 'smm-launch-24',
    headline: 'Kick e Twitch: viewers para live',
    tgBody:
      'Live com sala vazia afasta novos espectadores.\n\n' +
      'Impulsione viewers simultâneos na Kick ou Twitch informando o link da transmissão. Catálogo curado, preço antes de pagar, entrega após confirmação.\n\n' +
      'Combine com divulgação no Telegram e WhatsApp para maximizar presença no horário do evento.',
    waBody:
      'Kick/Twitch viewers\n\n' +
      'Impulsione live pelo @hanork_bot.\n\n' +
      'PIX, cartão e acompanhamento no PV.',
  },
  {
    id: 'smm-launch-25',
    headline: 'Pacotes combinados: Instagram + TikTok + Telegram',
    tgBody:
      'Campanha multicanal exige presença coerente em várias redes.\n\n' +
      'Monte pedidos separados no Hanork para Instagram, TikTok, YouTube e membros Telegram — cada um com link, quantidade e pagamento independente, mas no mesmo bot.\n\n' +
      'Histórico unificado, suporte /suporte e 25 textos de divulgação rotativos para promover o catálogo SMM nos grupos.',
    waBody:
      'SMM multicanal Hanork\n\n' +
      'Instagram, TikTok, YouTube e Telegram no mesmo bot.\n\n' +
      '25 textos de divulgação + PIX ou cartão.',
  },
];

function buildVirtuoThemes() {
  const topics = [
    ['telegram-sms', 'Telegram', 'criar conta ou recuperar acesso sem usar seu chip pessoal'],
    ['whatsapp-sms', 'WhatsApp', 'validar número novo ou conta secundária com SMS real'],
    ['instagram-sms', 'Instagram', 'confirmar cadastro ou login com número descartável'],
    ['google-sms', 'Google / Gmail', 'verificação em duas etapas ou conta nova'],
    ['discord-sms', 'Discord', 'ativar conta ou trocar número vinculado'],
    ['tiktok-sms', 'TikTok', 'registrar perfil comercial sem expor linha principal'],
    ['facebook-sms', 'Facebook / Meta', 'confirmar identidade ou página com SMS'],
    ['twitter-sms', 'Twitter / X', 'validar perfil ou recuperar acesso'],
    ['paypal-sms', 'PayPal', 'confirmação de segurança em conta de pagamentos'],
    ['uber-sms', 'Uber / 99', 'cadastro de motorista ou passageiro com número temporário'],
    ['ifood-sms', 'iFood / delivery', 'criar conta promocional ou cupom novo usuário'],
    ['binance-sms', 'Binance / exchanges', '2FA ou cadastro em exchange com número dedicado'],
    ['steam-sms', 'Steam / games', 'verificação de conta gamer sem chip físico'],
    ['amazon-sms', 'Amazon', 'confirmar pedido ou conta marketplace'],
    ['linkedin-sms', 'LinkedIn', 'perfil profissional ou recrutamento com SMS'],
    ['snapchat-sms', 'Snapchat', 'registro rápido para campanhas'],
    ['netflix-sms', 'Streaming', 'trial ou conta compartilhada com verificação SMS'],
    ['nubank-sms', 'Bancos digitais', 'cadastro em fintech com número Virtuo (quando permitido)'],
    ['shopify-sms', 'Shopify / lojas', 'validar loja ou checkout internacional'],
    ['airbnb-sms', 'Airbnb / viagens', 'confirmar reserva ou anfitrião'],
    ['signal-sms', 'Signal / privacidade', 'número alternativo para apps focados em privacidade'],
    ['microsoft-sms', 'Microsoft / Outlook', 'conta corporativa ou pessoal com SMS'],
    ['apple-sms', 'Apple ID', 'verificação em dispositivo ou iCloud'],
    ['multi-pais', 'Multi-país', 'escolha país do número: BR, EUA, UK e outros disponíveis'],
    ['virtuo-checkout', 'Checkout Hanork', 'PIX ou cartão, código SMS entregue no privado após pagamento'],
  ];

  return topics.map(([id, platform, useCase], i) => ({
    id,
    headline: `Número SMS ${platform}: ${useCase}`,
    tgBody:
      `Precisa de número virtual para ${platform}?\n\n` +
      `No Hanork você compra números SMS (Virtuo) direto no bot: escolha o país, selecione o serviço ${platform}, pague com PIX ou cartão e receba o código no privado assim que o provedor liberar.\n\n` +
      `Sem chip físico, sem expor sua linha principal. Histórico de pedidos, suporte com /suporte e crédito na carteira se a ativação falhar após pagamento confirmado.\n\n` +
      `Ideal para: ${useCase}.`,
    waBody:
      `NÚMEROS SMS — ${platform.toUpperCase()}\n\n` +
      `${useCase}.\n\n` +
      `Compre no @hanork_bot: país + serviço + PIX ou cartão.\n` +
      `Código entregue no privado. Suporte: /suporte`,
    image_file: HERO.virtuo,
    slot: i + 1,
  }));
}

const hanork = withHero([...loadJson('hanorkPromoThemes.json'), ...hanorkExtra].slice(0, 25), HERO.hanork);
const smm = withHero([...loadJson('smmPromoThemes.json'), ...smmExtra].slice(0, 25), HERO.smm);
const virtuo = buildVirtuoThemes();

saveJson('hanorkPromoThemes.json', hanork);
saveJson('smmPromoThemes.json', smm);
saveJson('virtuoPromoThemes.json', virtuo);

console.log('OK themes:', { hanork: hanork.length, smm: smm.length, virtuo: virtuo.length });
