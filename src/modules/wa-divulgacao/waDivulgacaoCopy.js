'use strict';

const WaDivulgacaoConfig = require('./waDivulgacaoConfig');

/** Número fictício — nunca use número real de cliente em exemplos. */
const PHONE_EXAMPLE_BR = '+55 11 99999-9999';
const PHONE_EXAMPLE_BR_DIGITS = '5511999999999';

const BRAND_TITLE = 'Hanork Div';

function brandTitle() {
    return WaDivulgacaoConfig.displayBrand || BRAND_TITLE;
}

function formatHeroIntro() {
    return (
        `<b>${brandTitle()}</b>\n\n` +
        `Transforme seu WhatsApp em uma máquina automática.\n\n` +
        `Controle, divulgação e gestão\n` +
        `direto pelo Telegram — rápido, simples e eficiente.`
    );
}

function formatFeaturesBlock() {
    return (
        `<b>O que você faz:</b>\n` +
        `Disparos em massa com poucos toques\n` +
        `Alcance ampliado (grupos e status)\n` +
        `Postagens automáticas no status\n` +
        `Controle total de grupos\n` +
        `Envio rápido de mídias e textos\n` +
        `Download de músicas do YouTube\n` +
        `Grupos prontos por nicho\n` +
        `Ativação automática após pagamento\n\n` +
        `Menos esforço\n` +
        `Mais resultado`
    );
}

function formatUserFooter(ctxOrUser) {
    const from = ctxOrUser?.from || ctxOrUser;
    const rawUser = from?.username ? String(from.username).replace(/^@/, '') : null;
    const displayUser = rawUser || from?.first_name || '—';
    const id = from?.id ?? ctxOrUser?.telegram_id ?? '—';
    const userLine = rawUser ? `@${displayUser}` : displayUser;
    return `<b>Usuário:</b> ${userLine}\n<b>Seu ID:</b> <code>${id}</code>`;
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
    return `<b>Clique nos botões abaixo para ver os planos disponíveis.</b>`;
}

function formatPreSalePanel(ctxOrUser, pricePerDay) {
    return `${formatPreSalePitch(pricePerDay)}\n\n${formatUserFooter(ctxOrUser)}\n\n${formatPreSaleCta()}`;
}

function formatPostSaleBenefits() {
    return (
        `<b>Recursos do seu plano:</b>\n` +
        `Disparos em massa · grupos e status\n` +
        `Campanhas automáticas com anti-ban\n` +
        `Modelos, agendamento e histórico\n` +
        `Painel completo no Telegram\n` +
        `Sessão salva — reconecta sozinha`
    );
}

function formatActivationBenefits() {
    return (
        `${brandTitle()} — <b>plano ativo!</b>\n\n` +
        `${formatPostSaleBenefits()}\n\n` +
        `Toque em <b>Conectar WhatsApp</b> e escolha <b>QR Code</b> ou <b>código</b>.\n` +
        `<i>O bot mostra o passo a passo de onde ir no app.</i>`
    );
}

function formatNextStepsNotConnected() {
    return (
        `\n<b>Próximos passos:</b>\n` +
        `1. <b>Conectar WhatsApp</b> (QR ou código)\n` +
        `2. Abrir <b>Campanhas</b> e escolher um modelo\n` +
        `3. Disparar — o bot cuida do resto`
    );
}

function formatCartPitch(productName, price) {
    const priceStr = Number(price || 0).toFixed(2).replace('.', ',');
    return (
        `${brandTitle()}\n\n` +
        `Plano <b>${productName}</b> no carrinho.\n` +
        `<b>R$ ${priceStr}</b>\n\n` +
        `Após o PIX você recebe:\n` +
        `Painel liberado na hora\n` +
        `Conexão WhatsApp (QR ou código)\n` +
        `Campanhas automáticas nos seus grupos\n\n` +
        `<i>Pagamento confirmado → ativação automática.</i>`
    );
}

function formatPlanProductDescription(days) {
    const d = Number(days) || 1;
    return (
        `Acesso ${d} dia${d > 1 ? 's' : ''} ao ${brandTitle()}.\n\n` +
        `Disparos em massa · grupos e status\n` +
        `Postagens automáticas e anti-ban\n` +
        `Painel no Telegram · ativação após pagamento`
    );
}

function formatBenefitsList() {
    return formatFeaturesBlock();
}

function formatBenefitsCompact() {
    return (
        `Disparos · grupos · status · anti-ban\n` +
        `Modelos · agendar · histórico · painel TG`
    );
}

function phonePromptMessage() {
    return (
        '<b>Login por código</b>\n\n' +
        '<b>Passo 1 — Envie seu número aqui</b>\n' +
        'Com DDI do país (pode usar +, espaços ou traços).\n\n' +
        `Exemplo: <code>${PHONE_EXAMPLE_BR}</code>\n` +
        `ou <code>${PHONE_EXAMPLE_BR_DIGITS}</code>\n\n` +
        '<b>Passo 2 — No celular (quando o código aparecer)</b>\n' +
        '1. Abra o <b>WhatsApp</b>\n' +
        '2. <b>Aparelhos conectados</b>\n' +
        '   · Android: menu <b>⋮</b> (canto superior)\n' +
        '   · iPhone: aba <b>Ajustes</b> (inferior)\n' +
        '3. <b>Conectar aparelho</b> → <b>Conectar com número de telefone</b>\n' +
        '4. Digite o <b>mesmo número</b> e cole o código de 8 dígitos\n\n' +
        '<i>Use <b>Copiar código</b> quando aparecer. Válido ~1 min.</i>'
    );
}

function connectChoiceMessage() {
    return (
        '<b>Conectar seu WhatsApp</b>\n\n' +
        'Escolha um método abaixo:\n\n' +
        '<b>QR Code</b> — mais rápido\n' +
        '1. Abra o WhatsApp no celular\n' +
        '2. Vá em <b>Aparelhos conectados</b>\n' +
        '   · Android: menu <b>⋮</b> → Aparelhos conectados\n' +
        '   · iPhone: <b>Ajustes</b> → Aparelhos conectados\n' +
        '3. <b>Conectar aparelho</b> → escaneie o QR desta conversa\n\n' +
        '<b>Código</b> — se não conseguir escanear\n' +
        '1. Toque em <b>Código</b> e envie seu número com DDI\n' +
        '2. Copie o código de 8 dígitos que aparecer aqui\n' +
        '3. No WhatsApp: Aparelhos conectados → <b>Conectar com número</b>\n' +
        '4. Cole o código no celular\n\n' +
        '<i>Use o número do chip principal. A sessão fica salva e reconecta sozinha.</i>'
    );
}

function qrTutorialMessage() {
    return (
        '<b>Conectar por QR Code</b>\n\n' +
        '<b>No celular:</b>\n' +
        '1. Abra o <b>WhatsApp</b>\n' +
        '2. <b>Aparelhos conectados</b>\n' +
        '   · Android: menu <b>⋮</b> (canto superior direito)\n' +
        '   · iPhone: aba <b>Ajustes</b> (barra inferior)\n' +
        '3. Toque em <b>Conectar aparelho</b>\n' +
        '4. Aponte a câmera para o <b>QR Code</b> desta conversa\n\n' +
        '<i>O QR renova automaticamente se expirar.\n' +
        'Não consegue escanear? Use <b>Código</b>.</i>'
    );
}

function qrWaitingMessage() {
    return (
        `${qrTutorialMessage()}\n\n` +
        '<b>Gerando QR…</b> A imagem chega em instantes abaixo.'
    );
}

function qrAwaitingScanMessage() {
    return (
        `${qrTutorialMessage()}\n\n` +
        '<b>Aguardando leitura do QR…</b>\n' +
        'Expirou? Toque em <b>Atualizar QR</b>.'
    );
}

function pairGeneratingMessage() {
    return (
        '<b>Gerando código…</b>\n\n' +
        '<b>Abra o WhatsApp AGORA:</b>\n' +
        'Aparelhos conectados → Conectar aparelho → <b>Conectar com número</b>\n\n' +
        '<i>O código chega em segundos e vale ~1 minuto.</i>'
    );
}

function pairCodeTutorialMessage(formattedCode, phoneDisplay) {
    const code = String(formattedCode || '').trim() || '????-????';
    const phoneLine = phoneDisplay ? `Número: <code>${phoneDisplay}</code>\n\n` : '';
    return (
        '<b>Conectar por código — Hanork Div</b>\n\n' +
        `Código: <b>${code}</b>\n` +
        phoneLine +
        '<b>No celular (app WhatsApp):</b>\n' +
        '1. <b>Aparelhos conectados</b>\n' +
        '   · Android: menu <b>⋮</b> → Aparelhos conectados\n' +
        '   · iPhone: <b>Ajustes</b> → Aparelhos conectados\n' +
        '2. <b>Conectar aparelho</b>\n' +
        '3. <b>Conectar com número de telefone</b>\n' +
        '4. Digite o <b>mesmo número</b> enviado aqui\n' +
        '5. Toque em <b>Copiar código</b> abaixo e cole no WhatsApp\n\n' +
        '<i>⚡ Válido ~60s — abra o WhatsApp <b>antes</b> e cole logo. Expirou? <b>Novo código</b>.</i>'
    );
}

function pairInProgressMessage() {
    return (
        '<b>Pareamento em andamento</b>\n\n' +
        '<b>No celular:</b> WhatsApp → Aparelhos conectados → Conectar aparelho → ' +
        '<b>Conectar com número</b> → cole o código.\n\n' +
        'Aguarde o código de 8 dígitos ou use <b>Novo código</b>.'
    );
}

function pairSlowMessage() {
    return (
        '<b>Código demorando mais que o normal</b>\n\n' +
        'O WhatsApp às vezes leva até <b>2 minutos</b> (números fora do BR são mais comuns).\n\n' +
        '<b>Confira no celular:</b>\n' +
        'Aparelhos conectados → Conectar aparelho → <b>Conectar com número</b> → ' +
        'digite o <b>mesmo número</b> enviado aqui.\n\n' +
        'Se não aparecer código em 1 min, use <b>Novo código</b> ou <b>QR Code</b>.'
    );
}

function phoneInvalidExample() {
    return `Envie só o número.\nExemplo: <code>${PHONE_EXAMPLE_BR}</code>`;
}

/** Nunca expor "worker offline" ao assinante — linguagem de produto. */
function workerPreparingMessage() {
    return (
        '<b>Preparando seu WhatsApp…</b>\n\n' +
        'Seu painel está ativo — o serviço sobe em segundos.\n' +
        'Aguarde ~15s e toque em <b>Tentar de novo</b>.\n\n' +
        '<i>Seu plano continua válido; isso não desconecta seu número.</i>'
    );
}

function workerSyncingMessage() {
    return (
        '<b>🟡 Sincronizando dados do WhatsApp…</b>\n\n' +
        'Seu número está vinculado — estamos atualizando grupos e status.\n' +
        'Aguarde alguns segundos e tente de novo.\n\n' +
        '<i>Se estiver pareando por código, confira o WhatsApp no celular (pode levar até 2 min).</i>\n' +
        '<i>Seu plano continua ativo; isso não desconecta seu número.</i>'
    );
}

function workerOfflineSubscriberMessage(minutes = 2) {
    return (
        '<b>Seu Hanork Div precisa de atenção</b>\n\n' +
        `Há ~${minutes} min sem conexão com o servidor de divulgação.\n` +
        'Toque em <b>Reconectar</b> ou <b>Conectar WA</b>.\n\n' +
        '<i>Campanhas e grupos voltam assim que a sessão estiver pronta.</i>'
    );
}

function waNotConnectedMessage() {
    return (
        '<b>WhatsApp não conectado</b>\n\n' +
        'Conecte seu WhatsApp para usar campanhas e grupos.\n' +
        'A sessão fica salva — reconecta sozinha depois.'
    );
}

function waIpcBusyMessage() {
    return (
        '<b>WhatsApp ocupado</b>\n\n' +
        'Um envio ou sincronização está em andamento.\n' +
        'Aguarde ~30s e tente de novo.'
    );
}

function waIpcRetryMessage() {
    return (
        '<b>Não foi possível concluir agora</b>\n\n' +
        'Abra <b>Conectar WhatsApp</b> no painel ou toque em <b>Tentar de novo</b>.\n\n' +
        '<i>Seu plano continua ativo.</i>'
    );
}

function isSubscriberIpcTimeout(ack) {
    if (!ack || ack.ok) return false;
    const raw = String(ack.message || ack.error || '').toLowerCase();
    const err = String(ack.error || '').toLowerCase();
    return err === 'timeout' || /ipc_timeout|sem resposta|etimedout|timed out/.test(raw);
}

function isSubscriberIpcNotConnected(ack) {
    if (!ack || ack.ok) return false;
    const raw = String(ack.message || ack.error || '').toLowerCase();
    const err = String(ack.error || '').toLowerCase();
    return err === 'not_connected' || /não conectado|nao conectado|not connected/.test(raw);
}

function isSubscriberIpcSyncingError(ack) {
    if (!ack || ack.ok) return false;
    if (isSubscriberIpcTimeout(ack) || isSubscriberIpcNotConnected(ack)) return false;
    const raw = String(ack.message || ack.error || '').toLowerCase();
    const err = String(ack.error || '').toLowerCase();
    return (
        err === 'syncing' ||
        /handler_error|enotfound|econnrefused|offline|worker/.test(raw)
    );
}

/** Nunca expor "worker offline", timeout IPC ou stack ao assinante. */
function sanitizeSubscriberIpcAck(ack, opts = {}) {
    if (!ack || ack.ok) return ack;
    const raw = String(ack.message || ack.error || '').toLowerCase();
    const err = String(ack.error || '').toLowerCase();
    const hasSession = Boolean(opts.hasSession);

    if (isSubscriberIpcTimeout(ack)) {
        return {
            ...ack,
            message: hasSession ? workerSyncingMessage() : pairGeneratingMessage(),
            error: 'timeout',
        };
    }
    if (err === 'busy' || /busy|blast|disparo.*andamento|já em andamento|ja em andamento/.test(raw)) {
        return { ...ack, message: waIpcBusyMessage(), error: 'busy' };
    }
    if (isSubscriberIpcNotConnected(ack)) {
        return {
            ...ack,
            message: hasSession ? workerSyncingMessage() : waNotConnectedMessage(),
            error: hasSession ? 'syncing' : 'not_connected',
        };
    }
    if (hasSession && isSubscriberIpcSyncingError(ack)) {
        return { ...ack, message: workerSyncingMessage(), error: 'syncing' };
    }
    if (isSubscriberIpcSyncingError(ack)) {
        return {
            ...ack,
            message: hasSession ? workerSyncingMessage() : pairGeneratingMessage(),
            error: 'syncing',
        };
    }
    if (/offline|worker/i.test(String(ack.message || ack.error || ''))) {
        return {
            ...ack,
            message: hasSession ? workerSyncingMessage() : pairGeneratingMessage(),
            error: 'syncing',
        };
    }
    if (isGenericAckMessage(ack.message || ack.error)) {
        return {
            ...ack,
            message: hasSession ? workerSyncingMessage() : pairGeneratingMessage(),
            error: hasSession ? 'syncing' : 'generic',
        };
    }
    return ack;
}

function campaignStartFailureMessage(ack) {
    const sanitized = sanitizeSubscriberIpcAck(ack || {});
    if (sanitized.ok) return waNotConnectedMessage();
    if (ack?.error === 'busy') return waIpcBusyMessage();
    if (sanitized.error === 'syncing') return sanitized.message;
    const msg = String(sanitized.message || '').trim();
    if (/^<b>(Preparando|Sincronizando|WhatsApp|Não foi possível)/i.test(msg)) return msg;
    return `<b>Erro:</b> ${msg || 'Não foi possível iniciar o disparo.'}`;
}

function campaignDoneDetailedMessage({
    sent = 0,
    total = 0,
    failed = 0,
    skipped = 0,
    scheduled = false,
    detail = null,
} = {}) {
    const t = Math.max(0, Number(total) || 0);
    const s = Math.min(Math.max(0, Number(sent) || 0), t || Number(sent) || 0);
    const f = Math.max(0, Number(failed) || 0);
    const sk = Math.max(0, Number(skipped) || 0);
    const denom = t || s + f + sk || '?';
    const lines = [
        scheduled ? '<i>Agendada</i>\n' : '',
        `<b>${s} de ${denom} grupos</b> com envio confirmado`,
    ].filter(Boolean);
    if (f > 0) {
        lines.push(`<b>Falhas:</b> ${f} <i>(sem permissão, erro de envio após tentativas)</i>`);
    }
    if (sk > 0) {
        lines.push(`<b>Pulados:</b> ${sk} <i>(outro WA no mesmo grupo, só-admins, etc.)</i>`);
    }
    if (detail) {
        lines.push(`<i>${detail}</i>`);
    }
    if (t > 0 && s + f + sk < t) {
        lines.push(`<i>${t - s - f - sk} grupo(s) ainda em processamento — veja Monitoramento.</i>`);
    }
    return lines.join('\n');
}

function planExpiredMessage() {
    return (
        `<b>${brandTitle()} — plano encerrado</b>\n\n` +
        'Seu período de acesso terminou.\n' +
        'Renove um plano para continuar usando campanhas e o painel.\n\n' +
        '<i>Seu WhatsApp pode continuar conectado no celular — renove para voltar a disparar.</i>'
    );
}

function renewalReminderMessage(hoursLeft) {
    const h = Number(hoursLeft);
    if (h <= 2) {
        return (
            `<b>${brandTitle()} — vence hoje</b>\n\n` +
            'Seu plano termina em breve.\n' +
            'Renove agora para manter campanhas, agendamentos e o painel.\n\n' +
            '<i>Após o vencimento, novos disparos ficam bloqueados até renovar.</i>'
        );
    }
    if (h <= 26) {
        return (
            `<b>${brandTitle()} — renovação em 24h</b>\n\n` +
            'Seu plano vence amanhã.\n' +
            'Renove antes do prazo para não interromper campanhas e agendamentos.\n\n' +
            '<i>Toque em <b>Ver planos</b> abaixo para renovar.</i>'
        );
    }
    return (
        `<b>${brandTitle()} — renovação em 48h</b>\n\n` +
        'Seu plano vence em cerca de 2 dias.\n' +
        'Renove com antecedência para manter campanhas e o painel ativos.\n\n' +
        '<i>Toque em <b>Ver planos</b> abaixo para renovar.</i>'
    );
}

function panelStaleDataHint() {
    return '\n\n<i>Atualizando dados em segundo plano…</i>';
}

/** Rótulo curto de status WA — painel Sessões e hubs. */
function formatSessionStatusLabel(connected, hasSavedSession = false) {
    if (connected) return '🟢 Conectado';
    if (hasSavedSession) return '🟡 Reconectando…';
    return '🔴 Desconectado';
}

/** Linha WhatsApp no painel home — usa `resolveConnectionForPanel().connected`, não só `state.connected`. */
function formatWaConnectionPanelLine(connected, connectionState = null, hasSavedSession = false) {
    if (connected) {
        return (
            ' <b>WhatsApp:</b> conectado' +
            (connectionState?.phone ? ` · <code>${connectionState.phone}</code>` : '') +
            '\n'
        );
    }
    if (connectionState?.phone || hasSavedSession) {
        const phone = connectionState?.phone ? ` · <code>${connectionState.phone}</code>` : '';
        return (
            ' <b>WhatsApp:</b> sincronizando' +
            phone +
            '\n' +
            '<i>Sessão salva — reconectando automaticamente.</i>\n'
        );
    }
    return ' <b>WhatsApp:</b> não conectado\n';
}

const GENERIC_ACK_ERRORS = new Set([
    'bad-request',
    'bad request',
    'error',
    'unknown',
    'timeout',
    'internal error',
    'erro',
    'erro.',
]);

function isGenericAckMessage(raw) {
    const msg = String(raw || '').trim();
    if (!msg) return true;
    const low = msg.toLowerCase();
    return GENERIC_ACK_ERRORS.has(low) || /^erro\.?$/i.test(msg);
}

/** Substitui fallbacks genéricos (` Erro.`, bad-request) nos handlers `wadv:*`. */
function formatPanelErrorMessage(result, fallback = 'Não foi possível concluir agora. Tente em instantes.') {
    const msg = String(result?.message || result?.error || '').trim();
    if (!msg || isGenericAckMessage(msg)) return fallback;
    if (/^<b>|^⏳|^⚠|^❌|^🟢|^🔴|^🟡|^ℹ/i.test(msg)) return msg;
    return `⚠️ ${msg.replace(/^[⚠️❌]\s*/, '')}`;
}

function campaignSessionExpiredMessage() {
    return '⏱ <b>Sessão expirada</b>\n\nAbra <b> Campanhas</b> + comece novamente.';
}

function moduleDisabledMessage() {
    return (
        ` <b>${brandTitle()}</b>\n\n` +
        'Estamos em manutenção — o painel Divulgação WhatsApp está temporariamente indisponível.\n\n' +
        '<i>Seu plano continua válido; avisaremos quando voltar.</i>'
    );
}

function connectMethodPromptMessage() {
    return 'Escolha o método:';
}

function autoHubMessage(extraLine = '') {
    return (
        ' <b>Automações</b>\n\n' +
        'Agende campanhas para repetir divulgações nos horários que você escolher.\n\n' +
        '<b>Campanhas agendadas</b> — veja + gerencie disparos futuros\n' +
        '<b>Nova campanha</b> — crie + agende um envio\n\n' +
        '<i>Repetição contínua em loop ainda não está disponível — está no roadmap.</i>\n' +
        '<i>Para disparar agora, use Nova campanha no painel.</i>' +
        (extraLine || '')
    );
}

function utilsHubMessage() {
    return (
        ' <b>Utilitários Hanork</b>\n\n' +
        'Ferramentas já disponíveis no bot — o plano Div cobre só a divulgação WhatsApp.\n\n' +
        '<b>Downloads</b> — YouTube, TikTok, Instagram (link ou busca)\n' +
        '<b>Números SMS</b> — Virtuo para verificação WhatsApp/Telegram\n\n' +
        '<i>Use os botões abaixo ou volte ao menu principal do Hanork.</i>'
    );
}

function groupsHubMessage() {
    return (
        ' <b>Gerenciamento de grupos</b>\n\n' +
        'Sincronize seus grupos do WhatsApp ou entre em novos via link de convite.'
    );
}

function monitoringHubMessage(activeLine = '') {
    return (
        ' <b>Monitoramento</b>\n\n' +
        'Acompanhe estatísticas, histórico de campanhas + agendamentos.\n' +
        '<i>Com campanha ativa: não dispare de novo até o envio terminar.</i>' +
        activeLine
    );
}

function statusWizardIntroMessage(startMessage) {
    return (
        ` <b>Publicar no Status</b>\n\n` +
        `${startMessage}\n\n` +
        '<i>Atalho: modo <b> Só Status</b> já selecionado após o conteúdo.</i>'
    );
}

function sessionHubMessage(statusLabel, phoneHtml) {
    return (
        ' <b>Sessões WhatsApp</b>\n\n' +
        `<b>Status:</b> ${statusLabel}\n` +
        `<b>Número:</b> ${phoneHtml}\n\n` +
        '<i>Conecte via QR ou código. A sessão fica salva no seu worker isolado.</i>'
    );
}

function stubSectionMessage(title, body) {
    return `<b>${title}</b>\n\n${body}\n\n<i> Em breve — chega nas próximas atualizações.</i>`;
}

/** Guia completo para assinantes e visitantes do painel Div. */
function formatUserGuideMessage({ hasActiveSub = false } = {}) {
    const subLine = hasActiveSub
        ? '<i>Plano ativo — tudo abaixo já é seu.</i>'
        : '<i>Sem plano ainda? Toque em <b>Ver planos</b> no fim — o PIX libera na hora.</i>';

    return (
        `📖 <b>Guia ${brandTitle()}</b>\n` +
        `${subLine}\n\n` +
        `<b>O que é?</b>\n` +
        `Você conecta <b>seu WhatsApp</b> aqui no Telegram e dispara campanhas nos seus grupos — status, menção de pagamento ou texto com menções — sem ficar copiando manualmente em cada grupo.\n\n` +
        `<b>O que você ganha com a assinatura</b>\n` +
        `• Painel completo no Telegram (campanhas, grupos, histórico)\n` +
        `• Worker exclusivo — sua sessão WA isolada e salva\n` +
        `• Disparo em massa com proteção anti-ban\n` +
        `• Modelos de texto, listas de grupos e agendamento\n` +
        `• Monitoramento ao vivo do envio\n` +
        `• Auto-entrar em grupos por link — você liga/desliga e define limites\n` +
        `• Tudo salvo no banco — campanha e rascunho continuam após reinício do bot\n` +
        `• Reconexão automática se o WA cair\n\n` +
        `<b>Como usar — 5 passos</b>\n` +
        `1️⃣ <b>Conectar WhatsApp</b> — QR ou código de pareamento\n` +
        `2️⃣ <b>Campanhas → Nova</b> — envie texto (e foto/vídeo se for Status)\n` +
        `3️⃣ Escolha o <b>modo</b> e marque os <b>grupos</b> (ou Todos)\n` +
        `4️⃣ Defina <b>quantos envios por grupo</b> (1× a 10×) + intervalo\n` +
        `5️⃣ <b>Disparar</b> agora ou <b>agendar</b>\n\n` +
        `<b>Modos de divulgação</b>\n` +
        `• <b>Status</b> — publica no Status do WA em cada grupo (pode repetir até 10×)\n` +
        `• <b>Pagamento</b> — mensagem de pagamento no chat do grupo\n` +
        `• <b>Status + Pagamento</b> — os dois no mesmo grupo, por rodada\n` +
        `• <b>Menções</b> — texto personalizado com @ no grupo\n\n` +
        `<b>Limites importantes</b>\n` +
        `• <b>1 campanha por vez</b> — aguarde terminar antes de disparar de novo\n` +
        `• Até <b>10 envios por grupo</b> · pausa: <b>sem pausa</b> ou <b>15s</b> entre grupos\n` +
        `• Lista até <b>500 grupos</b> syncados; o disparo usa os marcados ou todos\n` +
        `• Campanhas grandes com 15s podem levar <b>dezenas de minutos</b> — normal\n` +
        `• Grupos <b>só-admins</b> podem falhar no Status\n` +
        `• Horário opcional em <b>Configurações</b> (Brasília)\n\n` +
        `<b>Dicas que funcionam</b>\n` +
        `✅ Primeiro teste: poucos grupos + sem pausa\n` +
        `✅ Muitos grupos: use <b>15s</b> para proteger a conta\n` +
        `✅ Acompanhe em <b>Ver progresso</b> — não clique Disparar de novo\n` +
        `✅ WA desconectou? <b>Sessões → Reconectar</b>\n` +
        `✅ Lista vazia? <b>Grupos → Sincronizar</b>\n\n` +
        `<i>Dúvidas? Fale com o suporte pelo menu principal.</i>`
    );
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
    connectChoiceMessage,
    qrTutorialMessage,
    qrWaitingMessage,
    qrAwaitingScanMessage,
    pairGeneratingMessage,
    pairCodeTutorialMessage,
    pairInProgressMessage,
    pairSlowMessage,
    workerPreparingMessage,
    workerSyncingMessage,
    workerOfflineSubscriberMessage,
    waNotConnectedMessage,
    waIpcBusyMessage,
    waIpcRetryMessage,
    sanitizeSubscriberIpcAck,
    isSubscriberIpcTimeout,
    isSubscriberIpcNotConnected,
    isSubscriberIpcSyncingError,
    campaignStartFailureMessage,
    campaignDoneDetailedMessage,
    planExpiredMessage,
    renewalReminderMessage,
    panelStaleDataHint,
    formatSessionStatusLabel,
    formatWaConnectionPanelLine,
    isGenericAckMessage,
    formatPanelErrorMessage,
    campaignSessionExpiredMessage,
    moduleDisabledMessage,
    connectMethodPromptMessage,
    autoHubMessage,
    utilsHubMessage,
    groupsHubMessage,
    monitoringHubMessage,
    statusWizardIntroMessage,
    sessionHubMessage,
    stubSectionMessage,
    formatUserGuideMessage,
};
