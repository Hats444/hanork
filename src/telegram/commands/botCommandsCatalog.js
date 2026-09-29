'use strict';

/**
 * Catálogo único de comandos e atalhos do bot.
 * Fonte da verdade para /help, /comandos, painel admin (📖 Comandos)
 * e notificações admin (humanActivityText — novos comandos entram automaticamente).
 */

const USER_COMMANDS = [
    { cmd: '/start', desc: 'Menu principal — cadastro, boas-vindas e links diretos para comprar um produto' },
    { cmd: '/help', desc: 'Guia completo de comandos em arquivo JSON, organizado por categorias' },
    { cmd: '/comandos', desc: 'Mesmo conteúdo do /help — referência rápida de tudo que o bot oferece' },
    { cmd: '/catalogo', desc: 'Abre o catálogo com botões por produto — ideal para navegar visualmente' },
    { cmd: '/buscar', args: ' TERMO', desc: 'Busca SMM + Números SMS — ex.: /buscar seguidores instagram · /buscar whatsapp brasil' },
    { cmd: '/numeros', args: ' [app país]', desc: 'Números SMS — ex.: /numeros whatsapp brasil · /numeros telegram portugal' },
    { cmd: '/cat', desc: 'Catálogo paginado com filtros por formato, busca e ordenação por preço' },
    { cmd: '/carrinho', desc: 'Exibe itens adicionados, quantidades e valor total antes do checkout' },
    { cmd: '/cupom', args: ' CODIGO', desc: 'Aplica cupom de desconto ao carrinho (ex.: /cupom BEM10)' },
    { cmd: '/checkout', desc: 'Finaliza a compra e gera PIX ou link de cartão via Mercado Pago' },
    { cmd: '/pix', args: ' ID_PEDIDO', desc: 'Consulta ou gera novamente o PIX de um pedido pendente' },
    { cmd: '/cancelar', desc: 'Encerra modos ativos (suporte, cadastro de e-mail, assistente, etc.)' },
    { cmd: '/email', desc: 'Cadastra e valida seu e-mail com código — entrega e avisos de produtos' },
    { cmd: '/gmail', desc: 'Atalho para /email — funciona com Gmail ou qualquer provedor' },
    { cmd: '/meusdados', desc: 'Resumo da conta: cadastro, pedidos, pontos, cashback e afiliado' },
    { cmd: '/favoritos', desc: 'Lista produtos marcados como favoritos para comprar depois com um toque' },
    { cmd: '/rastrear', args: ' ID', desc: 'Acompanha status dos pedidos — informe o ID ou veja os recentes' },
    { cmd: '/reenviar', desc: 'Solicita novo envio de produto já pago (limite de 24h após entrega)' },
    { cmd: '/flashsales', desc: 'Ofertas relâmpago ativas — preços e prazos limitados' },
    { cmd: '/afiliado', desc: 'Painel de indicações: link pessoal, comissões e histórico' },
    { cmd: '/saldo', desc: 'Saldo disponível de comissões do programa de afiliados' },
    { cmd: '/rendimentos', desc: 'Detalha ganhos acumulados e solicita saque de afiliado' },
    { cmd: '/compartilhar', desc: 'Gera link de indicação para convidar amigos à loja' },
    { cmd: '/pontos', desc: 'Pontos de fidelidade acumulados e nível da conta' },
    { cmd: '/cashback', desc: 'Saldo de cashback disponível para usar em compras' },
    { cmd: '/assinatura', desc: 'Planos premium recorrentes e benefícios exclusivos' },
    { cmd: '/hanork', desc: 'Assistente inteligente — peça em linguagem natural (loja, downloads, dúvidas)' },
    { cmd: '/suporte', desc: 'Central de atendimento Hanork — IA da loja e ticket humano opcional' },
    { cmd: '/gpt', desc: 'Assistente da loja — tira dúvidas sobre produtos, PIX, entrega e pedidos' },
    { cmd: '/ia', desc: 'Atalho do assistente — mesmo recurso do /gpt e /hanork' },
    { cmd: '/tickets', desc: 'Lista tickets de suporte abertos com a equipe' },
    { cmd: '/tour', desc: 'Tour guiado em 3 passos — ideal na primeira visita à loja' },
    { cmd: '/play', args: ' NOME ou URL', desc: 'Busca e envia música (nome ou link YouTube — somente áudio)' },
    { cmd: '/youtube', args: ' URL', desc: 'Baixa vídeo do YouTube — watch, Shorts ou transmissão ao vivo' },
    { cmd: '/yt', args: ' URL', desc: 'Atalho do /youtube para links de vídeo' },
    { cmd: '/tiktok', args: ' @USER ou URL', desc: 'Download de TikTok por @usuário, busca ou link direto' },
    { cmd: '/instagram', args: ' URL ou @USER', desc: 'Instagram — posts, reels, stories e destaques' },
    { cmd: '/ig', args: ' …', desc: 'Atalho do /instagram' },
    { cmd: '/downloads', desc: 'Central de downloads — música, YouTube, TikTok e Instagram em um painel' },
];

const PRODUCT_ADMIN_COMMANDS = [
    { cmd: '/gerenciarprodutos', desc: 'Painel completo — criar, editar, pausar e listar produtos do catálogo' },
    { cmd: '/addproduto', desc: 'Assistente passo a passo para cadastrar um novo produto digital' },
    { cmd: '/produto', args: ' ID', desc: 'Ficha detalhada de um produto (preço, estoque, arquivo e status)' },
    { cmd: '/listprodutos', desc: 'Lista todos os produtos com ID, preço e situação no catálogo' },
    { cmd: '/editproduto', args: ' ID', desc: 'Abre painel interativo para alterar campos do produto' },
    { cmd: '/editproduto', args: ' ID preco 29.90', desc: 'Atalho rápido — edita nome, descrição, estoque ou foto direto no comando' },
    { cmd: '/removeproduto', args: ' ID', desc: 'Pausa o produto no catálogo (com confirmação — não apaga do banco)' },
    { cmd: '/reativarproduto', args: ' ID', desc: 'Volta um produto pausado a aparecer para os clientes' },
];

const ADMIN_COMMANDS = [
    { cmd: '/admin', desc: 'Painel administrativo com botões — vendas, produtos, divulgação e sistema' },
    { cmd: '/help', desc: 'Referência completa: comandos de cliente, admin, grupos e canais' },
    { cmd: '/comandos', desc: 'Equivalente ao /help — envia o guia em JSON' },
    ...PRODUCT_ADMIN_COMMANDS,
    { cmd: '/addcupom', args: ' COD p|f VALOR', desc: 'Cria cupom percentual (p) ou valor fixo (f) com limite de usos' },
    { cmd: '/flashsale', args: ' ID PRECO HORAS [LIMITE]', desc: 'Publica oferta relâmpago com preço, duração e limite de vendas' },
    { cmd: '/relatorio', desc: 'Resumo financeiro — receita, despesas e indicadores do período' },
    { cmd: '/carrinhos', desc: 'Carrinhos abertos no momento — útil para recuperar vendas abandonadas' },
    { cmd: '/usuarios', args: ' [página]', desc: 'Lista clientes cadastrados com paginação' },
    { cmd: '/userinfo', args: ' TELEGRAM_ID', desc: 'Perfil completo do cliente — pedidos, saldo e status de ban' },
    { cmd: '/reembolso', args: ' ID_PEDIDO', desc: 'Marca pedido como reembolsado e atualiza o histórico' },
    { cmd: '/backup', desc: 'Gera backup manual imediato do banco SQLite da loja' },
    { cmd: '/broadcast_email', args: ' Assunto | HTML', desc: 'Dispara e-mail em massa para clientes com e-mail verificado' },
    { cmd: '/restock', desc: 'Processa fila de avisos — clientes que pediram alerta de reposição' },
    { cmd: '/entrar', args: ' ALVO', desc: 'Entra em grupo ou canal: link +, @username, t.me/… ou ID numérico' },
    { cmd: '/conectar', desc: 'Conecta conta Telegram via QR (necessário para links privados +)' },
    { cmd: '/ponte', desc: 'Sinônimo de /conectar — autenticação MTProto por QR code' },
    { cmd: '/cancelar', desc: 'Cancela modos admin ativos (broadcast, wizard de produto, etc.)' },
];

const GROUP_COMMANDS = [
    { cmd: '/id', desc: 'No grupo: ID e link do chat. No privado: seus dados de usuário Telegram' },
    { cmd: '/atualizarlink', args: ' URL', desc: 'Admin: atualiza link de convite (legado; menu usa canal de referências)' },
    { cmd: '/grupo', desc: 'Ajuda e comandos de configuração de grupos (somente administradores)' },
    { cmd: '/grupo vip', desc: 'Define este chat para boas-vindas automáticas (comunidade legada)' },
    { cmd: '/grupo suporte', desc: 'Marca este chat como canal oficial de suporte da loja' },
    { cmd: '/grupo info', desc: 'Exibe status e permissões deste grupo no sistema Hanork' },
    { cmd: '/grupo ativar', desc: 'Habilita divulgação automática de produtos neste grupo' },
    { cmd: '/grupo desativar', desc: 'Pausa temporariamente posts automáticos neste grupo' },
    { cmd: '/grupo limpar', args: ' vip|suporte', desc: 'Remove a flag VIP ou suporte deste chat' },
    { cmd: '/grupo config', desc: 'Painel de configuração — cooldown, modo admin e sincronização' },
    { cmd: '/grupo sync', desc: 'Atualiza permissões do bot em todos os grupos cadastrados' },
    { cmd: '/grupo cooldown', args: ' on|off', desc: 'Ativa intervalo mínimo entre publicações no mesmo chat' },
    { cmd: '/grupo todos', desc: 'Envia divulgação manual para todos os grupos ativos' },
    { cmd: '/grupo admin', desc: 'Divulga apenas em grupos onde o bot é administrador' },
];

const CHANNEL_COMMANDS = [
    { cmd: '/canal', desc: 'Guia de canais de divulgação — cadastro e permissões (admin)' },
    { cmd: '/canal lista', desc: 'Lista canais registrados com ID e status de publicação' },
    { cmd: '/canal add', args: ' -100…', desc: 'Cadastra canal pelo ID — bot precisa poder publicar' },
    { cmd: '/canal sync', desc: 'Verifica e atualiza permissões de postagem em canais' },
    { cmd: '/canal info', args: ' ID', desc: 'Detalhes e status de um canal específico pelo ID' },
];

const DIVULGACAO_HELP = [
    { text: '<b>Privado (PV)</b>: mensagens para quem deu /start; ideal para ofertas personalizadas' },
    { text: '<b>Grupos</b>: bot presente no chat; configure em Admin → Grupos ou /grupo' },
    { text: '<b>Canais</b>: exige bot admin com permissão de publicar; cadastre em Admin → Canais ou /canal' },
    { text: '<b>Automático</b>: rotaciona produtos em PV, grupos e canais (padrão 2h, AUTO_BROADCAST_INTERVAL_MS)' },
    { text: '<b>Manual</b>: Admin → Broadcast: texto livre, IA ou produto específico (Telegram + WhatsApp)' },
];

function getDivulgacaoHelpLines() {
    const lines = [...DIVULGACAO_HELP];
    if (loadWaHelpModule()) {
        lines.push({
            text:
                'WhatsApp Zero Divu: status nos grupos WA via /admin → WhatsApp Zero Divu (guia em /help)',
        });
    }
    return lines;
}

const SAAS_COMMANDS = [
    { cmd: '/registrar_loja', desc: 'Cadastra uma nova loja no ecossistema multi-tenant Hanork' },
    { cmd: '/admin_loja', desc: 'Painel de gestão da sua loja — produtos, plano e configurações' },
    { cmd: '/planos', desc: 'Compare planos SaaS, limites e benefícios de cada tier' },
    { cmd: '/admin_saas', desc: 'Administração global da plataforma — todas as lojas' },
];

function loadWaHelpModule() {
  try {
    const { isZeroDivuEnabled } = require('../plugins/zero-divu/config');
    if (!isZeroDivuEnabled()) return null;
    return require('../plugins/zero-divu/waCommandsHelp');
  } catch {
    return null;
  }
}

function getWaAdminPanelGroup() {
    const wa = loadWaHelpModule();
    if (!wa) return null;
    return {
        title: 'WhatsApp Zero Divu',
        items: [
            { label: 'Painel WhatsApp', cb: 'a_wa_menu', desc: 'Status, QR, pausar, postar (/admin → WhatsApp Zero Divu)' },
            ...wa.WA_PANEL_BUTTONS.filter((p) => p.cb !== 'a_wa_help').map((p) => ({
                label: p.label,
                cb: p.cb,
                desc: p.desc,
            })),
            { label: 'Comandos /wa_*', cb: 'a_wa_help', desc: 'Guia completo ou /help → WhatsApp' },
        ],
    };
}

/** Atalhos do painel /admin — agrupados por área */
const ADMIN_PANEL_GROUPS = [
    {
        title: 'Loja e vendas',
        items: [
            { label: 'Estatísticas da loja', cb: 'a_stats', desc: 'Visão geral: usuários, pedidos, receita e taxa de conversão' },
            { label: 'Financeiro e caixa', cb: 'a_finance', desc: 'Entradas, saídas, saldo e movimentação financeira' },
            { label: 'Pedidos e pagamentos', cb: 'a_orders', desc: 'Pedidos pendentes, pagos e opção de entrega manual' },
            { label: 'Carrinhos ativos', cb: 'a_carts', desc: 'Carrinhos em aberto: identifique clientes perto de comprar' },
        ],
    },
    {
        title: 'Catálogo e promoções',
        items: [
            { label: 'Gerenciar produtos', cb: 'prod_menu_back', desc: 'Hub de produtos: criar, editar e pausar (/gerenciarprodutos)' },
            { label: 'Novo produto', cb: 'prod_create', desc: 'Assistente guiado de cadastro (/addproduto)' },
            { label: 'Listar produtos', cb: 'prod_list_all', desc: 'Todos os produtos com ID e preço (/listprodutos)' },
            { label: 'Ver ou pausar', cb: 'a_prods', desc: 'Lista rápida com toggle ativar/pausar no catálogo' },
            { label: 'Ofertas relâmpago', cb: 'a_flash', desc: 'Flash sales: criar, monitorar e encerrar (/flashsale)' },
            { label: 'Cupons de desconto', cb: 'a_cupons', desc: 'Cupons ativos e criação rápida (/addcupom)' },
            { label: 'Alertas de restock', cb: 'a_restock', desc: 'Clientes aguardando aviso quando produto voltar' },
        ],
    },
    {
        title: 'Divulgação e alcance',
        items: [
            { label: 'Alcance e destinos', cb: 'a_destinos', desc: 'Onde a loja divulga: privado, grupos, canais e WhatsApp' },
            { label: 'Broadcast em massa', cb: 'a_bcast', desc: 'Envio manual: texto, IA, produto ou campanha multicanal' },
            { label: 'Usuários cadastrados', cb: 'a_users', desc: 'Base de clientes paginada (/usuarios)' },
            { label: 'Grupos vinculados', cb: 'a_grupos', desc: 'Grupos cadastrados, VIP e suporte (/grupo config)' },
            { label: 'Canais vinculados', cb: 'a_canais', desc: 'Canais de divulgação e permissões (/canal add)' },
            { label: 'E-mail marketing', cb: 'a_email', desc: 'Configuração SMTP e campanhas /broadcast_email' },
        ],
    },
    {
        title: 'Clientes e suporte',
        items: [
            { label: 'Programa de afiliados', cb: 'a_afiliados', desc: 'Comissões pendentes, saques e desempenho do programa' },
            { label: 'Tickets de suporte', cb: 'a_tickets', desc: 'Chamados de suporte abertos com clientes' },
            { label: 'Avaliações de clientes', cb: 'a_reviews', desc: 'Feedback pós-compra e reputação dos produtos' },
            { label: 'Sorteios e prêmios', cb: 'a_giveaways', desc: 'Criar sorteios, definir prêmios e sortear ganhadores' },
        ],
    },
    {
        title: 'Downloads',
        items: [
            { label: 'Central de downloads', cb: 'downloads:open', desc: 'Hub de mídia: /play, YouTube, TikTok e Instagram' },
        ],
    },
    {
        title: 'Sistema',
        items: [
            { label: 'Anti-spam e moderação', cb: 'a_spam', desc: 'Bans, advertências e regras de proteção contra abuso' },
            { label: 'Backup de dados', cb: 'a_backup', desc: 'Backups do banco: agendados e manual (/backup)' },
            { label: 'Gráficos e relatórios', cb: 'a_chart', desc: 'Gráfico de vendas dos últimos 7 dias' },
            { label: 'Dashboard web', cb: 'a_dashboard', desc: 'Painel web em /admin: métricas, ops e multi-loja SaaS' },
            { label: 'Modo manutenção', cb: 'a_maint', desc: 'Bloqueia clientes; admin continua acessando' },
            { label: 'Limpar caches', cb: 'a_clear', desc: 'Limpa caches Redis e estado temporário da aplicação' },
            { label: 'Ver como cliente', cb: 'home_user', desc: 'Visualiza a loja como cliente para testar o fluxo de compra' },
            { label: 'Lista de comandos', cb: 'a_comandos', desc: 'Guia completo de comandos e atalhos do painel' },
        ],
    },
];

const HELP_SECTIONS = {
    user: { title: 'Cliente: compras e conta no privado', items: USER_COMMANDS },
    admin: { title: 'Administração: gestão da loja', items: ADMIN_COMMANDS },
    produtos: { title: 'Produtos: catálogo e estoque', items: PRODUCT_ADMIN_COMMANDS },
    grupos: { title: 'Grupos: divulgação e configuração', items: GROUP_COMMANDS },
    canais: { title: 'Canais: publicação e alcance', items: CHANNEL_COMMANDS },
    divulgacao: { title: 'Divulgação: como a loja alcança clientes', items: null, lines: DIVULGACAO_HELP, linesFn: getDivulgacaoHelpLines },
    painel: { title: 'Painel /admin: botões e atalhos', panels: ADMIN_PANEL_GROUPS },
    saas: { title: 'SaaS: multi-loja e planos', items: SAAS_COMMANDS },
};

function getPainelPanels() {
    const waGroup = getWaAdminPanelGroup();
    if (!waGroup) return ADMIN_PANEL_GROUPS;
    const copy = [...ADMIN_PANEL_GROUPS];
    copy.splice(3, 0, waGroup);
    return copy;
}

function getWhatsappHelpSection() {
    const wa = loadWaHelpModule();
    if (!wa) return null;
    return wa.getHelpSectionDef();
}

function buildSection(key) {
    let sec = HELP_SECTIONS[key];
    if (key === 'painel') {
        sec = { ...sec, panels: getPainelPanels() };
    }
    if (key === 'whatsapp') {
        sec = getWhatsappHelpSection();
        if (!sec) return '';
    }
    if (!sec) return '';
    let out = `\n<b>${sec.title}</b>\n`;
    if (sec.lines || sec.linesFn) {
        const lines = sec.linesFn ? sec.linesFn() : sec.lines;
        for (const l of lines) out += line(l) + '\n';
    }
    if (sec.panelButtons?.length) {
        out += '\n<b>Painel (botões em /admin → WhatsApp)</b>\n';
        for (const p of sec.panelButtons) {
            out += `<b>${p.label}</b>: ${p.desc}\n`;
        }
    }
    if (sec.groups) {
        for (const group of sec.groups) {
            out += `\n<i>${group.title}</i>\n`;
            for (const item of group.items) out += line(item) + '\n';
        }
    } else if (sec.panels) {
        for (const group of sec.panels) {
            out += `\n<i>${group.title}</i>\n`;
            for (const p of group.items) out += line(p) + '\n';
        }
    } else if (sec.items) {
        for (const item of sec.items) out += line(item) + '\n';
    }
    if (key === 'whatsapp') {
        out +=
            '\n<b>Atalho:</b> <code>/admin</code> → <b>WhatsApp Zero Divu</b> → <b>Ajuda WA</b>\n';
    }
    return out;
}

function line(item) {
    if (item.cb) {
        return `<b>${item.label}</b>: ${item.desc}`;
    }
    if (item.text) {
        return item.text;
    }
    return `<code>${item.cmd}${item.args || ''}</code>: ${item.desc}`;
}

function adminFooterExtra() {
    if (!loadWaHelpModule()) return '';
    return '\n<b>WhatsApp:</b> <code>/admin</code> → WhatsApp Zero Divu (seção WhatsApp no /help)\n';
}

function buildHelpText(isAdmin, section = 'all') {
    const header =
        '<b>Central de Comandos Hanork</b>\n' +
        '<i>Referência oficial: comandos com</i> <code>/</code> <i>e atalhos do menu e do painel</i> <code>/admin</code>';

    const footerUser =
        '\n<i>Precisa de ajuda personalizada? Use</i> <code>/suporte</code> <i>ou o botão Ajuda no menu principal.</i>';
    const footerAdmin =
        '\n<b>Atalho rápido:</b> <code>/admin</code> → <b>Lista de comandos</b> <i>para filtrar por seção</i>\n' +
        '<i>Grupos e canais:</i> <code>/grupo</code> | <code>/canal</code>' +
        adminFooterExtra();

    const sections = {
        user: () => header + buildSection('user') + footerUser,
        admin: () => header + buildSection('admin') + footerAdmin,
        produtos: () => header + buildSection('produtos') + footerAdmin,
        grupos: () => header + buildSection('grupos') + footerAdmin,
        canais: () => header + buildSection('canais') + footerAdmin,
        divulgacao: () => header + buildSection('divulgacao') + footerAdmin,
        painel: () =>
            header +
            '\n<i>Abra</i> <code>/admin</code> <i>e use os botões (resumo por área):</i>' +
            buildSection('painel') +
            footerAdmin,
        saas: () => header + buildSection('saas') + footerAdmin,
        whatsapp: () => header + buildSection('whatsapp') + footerAdmin,
    };

    if (sections[section]) return sections[section]();

    let body = header + buildSection('user');
    if (isAdmin) {
        body += buildSection('admin');
        body += buildSection('produtos');
        body += buildSection('divulgacao');
        body += buildSection('grupos');
        body += buildSection('canais');
        body += buildSection('painel');
        if (getWhatsappHelpSection()) body += buildSection('whatsapp');
        body += buildSection('saas');
        body += footerAdmin;
    } else {
        body += footerUser;
    }
    return body;
}

/** Texto curto no topo do guia admin (painel 📖 Comandos) */
function buildAdminCommandsIntro() {
    const waLine = loadWaHelpModule()
        ? `\n<b>WhatsApp Zero Divu:</b> <code>/admin</code> → WhatsApp Zero Divu | seção WhatsApp no <code>/help</code>\n`
        : '';
    return (
        '<b>Guia do Administrador</b>\n\n' +
        `<b>Três formas de operar a loja:</b>\n` +
        `1. <b>Painel visual</b> — <code>/admin</code> e toque nos botões organizados por área\n` +
        `2. <b>Comandos diretos</b> — digite <code>/comando</code> (lista completa abaixo)\n` +
        `3. <b>Grupos e canais</b> — configure divulgação com <code>/grupo</code> e <code>/canal</code> no chat certo\n\n` +
        `<b>Produtos (essencial):</b> <code>/gerenciarprodutos</code> | <code>/addproduto</code> | <code>/editproduto ID</code> | <code>/removeproduto ID</code>\n` +
        waLine +
        `\n<i>Use os botões desta tela para baixar o JSON filtrado por categoria.</i>\n`
    );
}

const HELP_JSON_SECTION_ORDER = [
    'user',
    'admin',
    'produtos',
    'divulgacao',
    'grupos',
    'canais',
    'painel',
    'whatsapp',
    'saas',
];

const HELP_JSON_SECTION_LABELS = {
    all: 'Todas as categorias',
    user: 'Cliente',
    admin: 'Admin',
    produtos: 'Produtos',
    divulgacao: 'Divulgação',
    grupos: 'Grupos',
    canais: 'Canais',
    painel: 'Painel /admin',
    whatsapp: 'WhatsApp',
    saas: 'SaaS',
};

function splitSectionTitle(raw) {
    const m = String(raw || '').match(/^(\S+)\s+(.+)$/);
    if (m) return { emoji: m[1], title: m[2] };
    return { emoji: null, title: String(raw || '') };
}

function itemToJsonEntry(item) {
    if (item.cmd) {
        return {
            type: 'command',
            command: item.cmd,
            args: item.args?.trim() || null,
            usage: `${item.cmd}${item.args || ''}`.trim(),
            description: item.desc,
        };
    }
    if (item.cb) {
        return {
            type: 'button',
            label: item.label,
            callback: item.cb,
            description: item.desc,
        };
    }
    if (item.text) {
        return { type: 'note', text: item.text };
    }
    return item;
}

function resolveHelpSection(key) {
    if (key === 'painel') {
        return { ...HELP_SECTIONS.painel, panels: getPainelPanels() };
    }
    if (key === 'whatsapp') {
        return getWhatsappHelpSection();
    }
    if (key === 'divulgacao') {
        return { ...HELP_SECTIONS.divulgacao, lines: getDivulgacaoHelpLines() };
    }
    return HELP_SECTIONS[key] || null;
}

function categoryFromSection(key) {
    const sec = resolveHelpSection(key);
    if (!sec) return null;

    const { emoji, title } = splitSectionTitle(sec.title);
    const category = {
        id: key,
        emoji,
        title,
    };

    if (sec.items?.length) {
        category.commands = sec.items.map(itemToJsonEntry);
    }
    if (sec.lines?.length) {
        category.notes = sec.lines.map((l) => itemToJsonEntry(l));
    }
    if (sec.groups?.length) {
        category.command_groups = sec.groups.map((g) => ({
            id: g.key || null,
            title: g.title,
            items: (g.items || []).map(itemToJsonEntry),
        }));
    }
    if (sec.panelButtons?.length) {
        category.panel_buttons = sec.panelButtons.map(itemToJsonEntry);
    }
    if (sec.panels?.length) {
        category.panel_groups = sec.panels.map((g) => ({
            title: g.title,
            items: (g.items || []).map(itemToJsonEntry),
        }));
    }

    return category;
}

function buildHelpJson(isAdmin, section = 'all') {
    const keys =
        section === 'all'
            ? HELP_JSON_SECTION_ORDER.filter((k) => {
                  if (!isAdmin && k !== 'user') return false;
                  if (k === 'whatsapp' && !getWhatsappHelpSection()) return false;
                  return true;
              })
            : [section];

    const categories = keys.map(categoryFromSection).filter(Boolean);

    const hints = isAdmin
        ? [
              'Atalho: /admin → Lista de comandos',
              'Grupos/canais: /grupo | /canal',
              'Filtre por categoria com os botões abaixo do arquivo JSON',
          ]
        : ['Dúvidas sobre compra ou entrega: /suporte ou botão Ajuda no menu'];

    if (loadWaHelpModule() && isAdmin) {
        hints.push('WhatsApp: /admin → WhatsApp Zero Divu');
    }

    return {
        meta: {
            bot: 'Hanork',
            title: 'Comandos do bot',
            format: 'hanork-help/v1',
            section,
            section_label: HELP_JSON_SECTION_LABELS[section] || section,
            scope: isAdmin ? 'admin' : 'cliente',
            generated_at: new Date().toISOString(),
            total_categories: categories.length,
        },
        categories,
        links: {
            suporte: '/suporte',
            menu: '/start',
            help: '/help',
            admin: isAdmin ? '/admin' : null,
            canal_referencias: (() => {
                try {
                    return require('../../config/salesReferenceChannel').getSalesRefChannelUrl();
                } catch {
                    return process.env.SALES_REF_CHANNEL_LINK || process.env.LINKGP || null;
                }
            })(),
            grupo_vip: null,
        },
        hints,
    };
}

function getHelpJsonFilename(section = 'all') {
    return section === 'all' ? 'hanork-comandos.json' : `hanork-comandos-${section}.json`;
}

function buildHelpJsonCaption(isAdmin, section = 'all', adminPanel = false) {
    const label = HELP_JSON_SECTION_LABELS[section] || section;
    let out =
        `<b>Comandos Hanork</b>\n` +
        `<i>Seção: ${label}</i>\n\n` +
        `Arquivo JSON com descrição detalhada de cada comando e botão.\n` +
        `<i>Toque nos filtros abaixo para ver só uma categoria.</i>`;

    if (adminPanel) {
        out += `\n\n<i>Guia admin · filtre por categoria abaixo</i>`;
    } else if (!isAdmin) {
        out += `\n\n<i>Dúvidas?</i> /suporte`;
    }

    return out;
}

const {
    TELEGRAM_HTML_CHUNK,
    packLinesIntoMessages,
    packBlocksIntoMessages,
} = require('../htmlMessages');

/**
 * Partes prontas para /help e /comandos — uma seção por bloco quando possível.
 */
function buildHelpParts(isAdmin, section = 'all') {
    const header =
        '<b>Central de Comandos Hanork</b>\n' +
        '<i>Referência oficial: comandos com</i> <code>/</code> <i>e atalhos do menu e do painel</i> <code>/admin</code>';
    const footerUser =
        '\n<i>Precisa de ajuda personalizada? Use</i> <code>/suporte</code> <i>ou o botão Ajuda no menu principal.</i>';
    const footerAdmin =
        '\n<b>Atalho admin:</b> <code>/admin</code> → <b>Lista de comandos</b> (seções abaixo)\n' +
        '<i>Grupos/canais:</i> <code>/grupo</code> | <code>/canal</code>' +
        adminFooterExtra();

    if (section !== 'all') {
        return packLinesIntoMessages(buildHelpText(isAdmin, section).split('\n'));
    }

    const blocks = [header + buildSection('user')];
    if (isAdmin) {
        blocks.push(
            buildSection('admin'),
            buildSection('produtos'),
            buildSection('divulgacao'),
            buildSection('grupos'),
            buildSection('canais'),
            buildSection('painel')
        );
        if (getWhatsappHelpSection()) blocks.push(buildSection('whatsapp'));
        blocks.push(buildSection('saas'), footerAdmin);
    } else {
        blocks[0] += footerUser;
    }
    return packBlocksIntoMessages(blocks);
}

/** Compat — preferir buildHelpParts */
function splitForTelegram(text, maxLen = TELEGRAM_HTML_CHUNK) {
    return packLinesIntoMessages(String(text || '').split('\n'), maxLen);
}

function getHelpKeyboard(isAdmin, section = 'all') {
    const { Markup } = require('telegraf');
    const rows = [[{ text: 'Cliente', callback_data: 'help_sec_user' }]];
    if (isAdmin) {
        rows.push(
            [{ text: 'Admin', callback_data: 'help_sec_admin' }],
            [{ text: 'Produtos', callback_data: 'help_sec_produtos' }],
            [{ text: 'Divulgação', callback_data: 'help_sec_divulgacao' }],
            [{ text: 'Painel /admin', callback_data: 'help_sec_painel' }],
            [{ text: 'Grupos', callback_data: 'help_sec_grupos' }],
            [{ text: 'Canais', callback_data: 'help_sec_canais' }]
        );
        if (loadWaHelpModule()) {
            rows.push([{ text: 'WhatsApp', callback_data: 'help_sec_whatsapp' }]);
        }
        rows.push(
            [{ text: 'SaaS', callback_data: 'help_sec_saas' }],
            [{ text: 'Ver tudo', callback_data: 'help_sec_all' }]
        );
    }
    rows.push([{ text: 'Menu principal', callback_data: 'menu:home' }]);
    return Markup.inlineKeyboard(rows);
}

function getAdminCommandsKeyboard(section = 'all') {
    const { Markup } = require('telegraf');
    const mark = (key, label) => (section === key ? `[${label}]` : label);
    const rows = [
        [{ text: mark('user', 'Cliente'), callback_data: 'a_cmd_user' }],
        [{ text: mark('admin', 'Admin'), callback_data: 'a_cmd_admin' }],
        [{ text: mark('produtos', 'Produtos'), callback_data: 'a_cmd_produtos' }],
        [{ text: mark('divulgacao', 'Divulgação'), callback_data: 'a_cmd_divulgacao' }],
        [{ text: mark('grupos', 'Grupos'), callback_data: 'a_cmd_grupos' }],
        [{ text: mark('canais', 'Canais'), callback_data: 'a_cmd_canais' }],
        [{ text: mark('painel', 'Painel'), callback_data: 'a_cmd_painel' }],
        [{ text: mark('saas', 'SaaS'), callback_data: 'a_cmd_saas' }],
    ];
    if (loadWaHelpModule()) {
        rows.push([
            {
                text: mark('whatsapp', 'WhatsApp'),
                callback_data: 'a_cmd_whatsapp',
            },
        ]);
    }
    rows.push(
        [{ text: mark('all', 'Ver tudo'), callback_data: 'a_cmd_all' }],
        [{ text: 'Voltar admin', callback_data: 'a_menu' }]
    );
    return Markup.inlineKeyboard(rows);
}

/** Lista plana para compatibilidade */
const ADMIN_PANEL_BUTTONS = ADMIN_PANEL_GROUPS.flatMap((g) => g.items);

/** Todas as entradas de comando — fonte para notificações admin e /help */
function getAllCommandEntries() {
    const wa = loadWaHelpModule();
    const waCmds = wa?.WA_COMMANDS_FLAT || [];
    return [
        ...USER_COMMANDS,
        ...ADMIN_COMMANDS,
        ...GROUP_COMMANDS,
        ...CHANNEL_COMMANDS,
        ...SAAS_COMMANDS,
        ...waCmds,
    ];
}

/** Mapa cmd → entrada (comandos multi-palavra, ex. /grupo vip) */
function buildCommandLookup() {
    const map = new Map();
    for (const entry of getAllCommandEntries()) {
        const key = entry.cmd.trim().toLowerCase();
        if (!map.has(key)) map.set(key, entry);
    }
    return map;
}

/** Botões do painel /admin (+ WhatsApp quando plugin ativo) */
function getAllPanelButtons() {
    return getPainelPanels().flatMap((g) => g.items);
}

module.exports = {
    USER_COMMANDS,
    PRODUCT_ADMIN_COMMANDS,
    ADMIN_COMMANDS,
    GROUP_COMMANDS,
    CHANNEL_COMMANDS,
    SAAS_COMMANDS,
    ADMIN_PANEL_BUTTONS,
    ADMIN_PANEL_GROUPS,
    buildHelpText,
    buildHelpParts,
    buildHelpJson,
    getHelpJsonFilename,
    buildHelpJsonCaption,
    buildAdminCommandsIntro,
    packLinesIntoMessages,
    packBlocksIntoMessages,
    splitForTelegram,
    TELEGRAM_HTML_CHUNK,
    getHelpKeyboard,
    getAdminCommandsKeyboard,
    getAllCommandEntries,
    buildCommandLookup,
    getAllPanelButtons,
};
