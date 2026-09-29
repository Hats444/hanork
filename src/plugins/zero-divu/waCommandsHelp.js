'use strict';

const { isZeroDivuEnabled } = require('./config');

/**
 * Catálogo de comandos /wa_* — fonte única para /help, /admin →  Comandos e painel  WhatsApp.
 */

const INTRO_LINES = [
  {
    text:
      ' <b>Onde usar:</b> só no <b>PV</b> com o bot (admin). Atalho: <code>/admin</code> → <b> WhatsApp</b>',
  },
  {
    text:
      ' <b>Pré-requisito:</b> <code>node src/bot.js</code> (sobe Telegram + WhatsApp juntos com ZERO_DIVU_ENABLED=true)',
  },
  { text: '<b>Formas:</b> botões do painel WhatsApp <i>ou</i> digitar os comandos <code>/wa_*</code> · <code>/wa_help</code>' },
];

const WA_COMMAND_GROUPS = [
  {
    key: 'conn',
    title: ' Conexão',
    items: [
      { cmd: '/wa_status', desc: 'Status: conectado, telefone, grupos X/MAX, filas, último post' },
      { cmd: '/wa_conectar', desc: 'Login por QR — imagem chega no Telegram (botão  Conectar QR)' },
      { cmd: '/wa_novo_qr', desc: 'Renova o QR se expirou' },
      { cmd: '/wa_pair', args: ' 5511999999999', desc: 'Login por código 8 dígitos (alternativa ao QR)' },
      { cmd: '/wa_desconectar', args: ' sim', desc: 'Logout + limpa sessão Baileys (confirme com sim)' },
    ],
  },
  {
    key: 'ops',
    title: '▶ Operação',
    items: [
      { cmd: '/wa_ligar', desc: 'Retoma postagens automáticas de status nos grupos' },
      { cmd: '/wa_retomar', desc: 'Alias de /wa_ligar' },
      { cmd: '/wa_pausar', desc: 'Pausa postagens automáticas' },
      { cmd: '/wa_postar', desc: 'Força ciclo (promo Hanork na fila primeiro, senão status normal)' },
      { cmd: '/wa_postar_campanha', args: ' hanork', desc: 'Post manual da rotação de produtos Hanork' },
      { cmd: '/wa_sync', desc: 'Re-sincroniza grupos do WhatsApp → registro local' },
      { text: 'Status = só <b>Status do grupo</b> (foto+texto), nunca chat' },
    ],
  },
  {
    key: 'limit',
    title: ' Limites e perfil',
    items: [
      { cmd: '/wa_preset_prod', desc: 'Preset produção: safe, auto-join ON, post ao entrar ON, anti-spam' },
      { cmd: '/wa_limites', desc: 'Limites ativos, filas join/promo, campanha hanork' },
      { cmd: '/wa_status_stats', args: ' [ID]', desc: 'Posts/dia por grupo, cooldown 12h, hashes dedup 24h' },
      { cmd: '/wa_min_membros', args: ' 50', desc: 'Só ficar em grupos com pelo menos N membros (auto-sair)' },
      { cmd: '/wa_auto_join', args: ' on', desc: 'Permite/impede entrar em grupos automaticamente' },
      { cmd: '/wa_auto_post_entrar', args: ' on', desc: 'Post automático logo ao entrar em grupo' },
      { cmd: '/wa_max_joins_h', args: ' 2', desc: 'Limite de entradas em grupos por hora (anti-ban)' },
      { cmd: '/wa_max', args: ' 40', desc: 'Máximo de grupos ativos (persiste; não some ao trocar perfil)' },
      {
        cmd: '/wa_perfil',
        args: ' safe',
        desc: 'Perfil manual (desliga auto): safe | balanced | aggressive',
      },
      {
        cmd: '/wa_auto',
        args: ' on',
        desc: 'Perfil automático por risco de spam (on | off | status)',
      },
      { cmd: '/wa_delay', args: ' post 15000', desc: 'Intervalo mínimo entre posts (ms)' },
      { cmd: '/wa_delay', args: ' join 60000', desc: 'Delay entre entradas em grupos (ms)' },
    ],
  },
  {
    key: 'grupos',
    title: ' Grupos',
    items: [
      { cmd: '/wa_grupos', desc: 'Lista grupos ativos (nome, score, ID)' },
      { cmd: '/wa_grupo', args: ' SAIR ID', desc: 'Sai de um grupo (ID completo ou curto)' },
      { cmd: '/wa_grupos_invalidos', desc: 'Grupos rejeitados + motivo' },
    ],
  },
  {
    key: 'content',
    title: ' Conteúdo (textos e mídia)',
    items: [
      { cmd: '/wa_campanhas', desc: 'Produtos Hanork no Status (catálogo sincronizado)' },
      { cmd: '/wa_texto', args: ' hanork', desc: 'Textos dos produtos no catálogo' },
      { cmd: '/wa_midia', args: ' hanork', desc: 'Fotos auto-prod-* geradas do catálogo' },
      { cmd: '/wa_sync_catalog', desc: 'Força sync catálogo → WhatsApp' },
      { cmd: '/wa_reload_config', desc: 'Recarrega mensagens.json sem reiniciar o Zero' },
      {
        text: '<i>Campanha Zero e mídias legadas foram desativadas — só produtos cadastrados.</i>',
      },
    ],
  },
  {
    key: 'loja',
    title: ' Integração Hanork',
    items: [
      {
        text:
          'Divulgação auto Hanork → enfileira o <b>mesmo produto</b> no WA Status (~8–14 min depois, anti-rajada)',
      },
      { cmd: '/wa_sync_catalog', desc: 'Força sync catálogo produtos Hanork → campanha hanork no WA' },
      { cmd: '/wa_campanha_hanork', args: ' on', desc: 'Inclui campanha hanork na rotação WA' },
      { cmd: '/wa_campanha_hanork', args: ' off', desc: 'Exclui campanha hanork da rotação' },
      { cmd: '/wa_auto_sync', args: ' on', desc: 'Sync automático catálogo Hanork → WA após divulgação' },
      { cmd: '/wa_auto_sync', args: ' off', desc: 'Desliga sync automático de catálogo' },
      { cmd: '/wa_promo_fila', desc: 'Fila de promos de produto (Broadcast / auto Hanork)' },
      { text: 'Broadcast admin: Produto →  WhatsApp Status ou  TG+WA (WA com delay)' },
    ],
  },
  {
    key: 'logs',
    title: ' Logs e auditoria',
    items: [
      { cmd: '/wa_logs', args: ' on', desc: 'Espelha eventos resumidos WA neste PV' },
      { cmd: '/wa_logs', args: ' off', desc: 'Desliga espelhamento no Telegram' },
      { cmd: '/wa_logs', args: ' nivel warn', desc: 'Só avisos (limite join, cap, desconectado)' },
      { cmd: '/wa_audit', desc: 'Últimos comandos admin WA (SQLite wa_admin_audit)' },
      { text: 'Painel: botão <b> Logs WA</b> — resumo da última hora' },
    ],
  },
];

const WA_PANEL_BUTTONS = [
  { label: ' Status', cb: 'a_wa_status', desc: 'Conexão, grupos, filas — /wa_status' },
  { label: ' Conectar QR', cb: 'a_wa_connect', desc: 'QR no Telegram — /wa_conectar' },
  { label: '⏸ Pausar / ▶ Ligar', cb: 'a_wa_pause', desc: 'Alterna postagens — /wa_pausar /wa_ligar' },
  { label: ' Postar agora', cb: 'a_wa_post', desc: 'Promo ou ciclo status — /wa_postar' },
  { label: ' Fila promo', cb: 'a_wa_promo_fila', desc: 'Produtos agendados — /wa_promo_fila' },
  { label: ' Processar promo', cb: 'a_wa_process_promo', desc: 'Próximo promo da fila (não posta status se vazia)' },
  { label: ' Sync grupos', cb: 'a_wa_sync_groups', desc: 'Lista WA → registro — /wa_sync' },
  { label: ' Grupos', cb: 'a_wa_groups', desc: 'Ativos — /wa_grupos' },
  { label: ' Limites', cb: 'a_wa_limits', desc: 'Resumo — /wa_limites' },
  { label: ' Stats status', cb: 'a_wa_status_stats', desc: 'Posts/dia e hashes — /wa_status_stats' },
  { label: ' Preset PROD', cb: 'a_wa_preset_prod', desc: 'Config anti-ban — /wa_preset_prod' },
  { label: ' Hanork ON/OFF', cb: 'a_wa_hanork_toggle', desc: 'Rotação de produtos Hanork no Status' },
  { label: ' Campanhas', cb: 'a_wa_campaigns', desc: 'Produtos sincronizados do catálogo' },
  { label: ' Sync catálogo', cb: 'a_wa_sync_catalog', desc: 'Produtos Hanork → WA — /wa_sync_catalog' },
  { label: ' Pairing', cb: 'a_wa_pair_help', desc: 'Login por código — /wa_pair' },
  { label: ' Logs WA', cb: 'a_wa_logs', desc: 'Última hora — /wa_logs on' },
  { label: ' Auto-join', cb: 'a_wa_autojoin_toggle', desc: 'Entrar em grupos automaticamente — /wa_auto_join' },
  { label: ' Post entrar', cb: 'a_wa_autopost_toggle', desc: 'Post ao entrar no grupo — /wa_auto_post_entrar' },
  { label: ' Min 50', cb: 'a_wa_min50', desc: 'Mínimo de membros — /wa_min_membros 50' },
  { label: 'Joins/h 2', cb: 'a_wa_joins2', desc: 'Entradas por hora — /wa_max_joins_h 2' },
  { label: ' Balanced', cb: 'a_wa_perfil_balanced', desc: 'Perfil balanced + 3 joins/h — /wa_perfil balanced' },
  { label: 'Joins/h 3', cb: 'a_wa_joins3', desc: 'Entradas por hora — /wa_max_joins_h 3' },
  { label: ' Comandos WA', cb: 'a_wa_help', desc: 'Guia completo /wa_*' },
];

function line(item) {
  if (item.text) return `• ${item.text}`;
  return `• <code>${item.cmd}${item.args || ''}</code> — ${item.desc}`;
}

function buildGroupBlock(group) {
  let out = `\n<i>${group.title}</i>\n`;
  for (const item of group.items) out += `${line(item)}\n`;
  return out;
}

function groupsForSection(section) {
  if (section === 'all') return WA_COMMAND_GROUPS;
  return WA_COMMAND_GROUPS.filter((g) => g.key === section);
}

function buildWaHelpText(section = 'all') {
  let out =
    '<b> WhatsApp — Zero Divu</b>\n' +
    '<i>Controle o bot de status nos grupos WA pelo Telegram.</i>\n';
  for (const l of INTRO_LINES) out += `${line(l)}\n`;
  if (section === 'all') {
    out += '\n<b> Painel (botões)</b>\n';
    for (const p of WA_PANEL_BUTTONS) {
      out += `• <b>${p.label}</b> — ${p.desc}\n`;
    }
  }
  for (const g of groupsForSection(section)) out += buildGroupBlock(g);
  if (section === 'all') {
    out +=
      '\n<b> Dica:</b> <code>/admin</code> → <b> WhatsApp</b> → <b> Comandos WA</b>\n' +
      '<i>Seção também em</i> <code>/help</code> → <b> WhatsApp</b>';
  }
  return out.trimEnd();
}

function buildWaHelpParts(section = 'all') {
  const { packBlocksIntoMessages } = require('../../telegram/htmlMessages');
  if (section !== 'all') {
    return packBlocksIntoMessages([buildWaHelpText(section)]);
  }
  let intro =
    '<b> WhatsApp — Zero Divu</b>\n' +
    '<i>Controle o bot de status nos grupos WA pelo Telegram.</i>\n';
  for (const l of INTRO_LINES) intro += `${line(l)}\n`;
  intro += '\n<b> Painel (botões)</b>\n';
  for (const p of WA_PANEL_BUTTONS) {
    intro += `• <b>${p.label}</b> — ${p.desc}\n`;
  }
  intro +=
    '\n<b> Atalho:</b> <code>/admin</code> → <b> WhatsApp</b> → <b> Comandos WA</b>\n';
  const blocks = [intro.trimEnd()];
  for (const g of WA_COMMAND_GROUPS) blocks.push(buildGroupBlock(g));
  return packBlocksIntoMessages(blocks);
}

function getWaHelpSectionDef() {
  return {
    title: ' WhatsApp (Zero Divu) — comandos /wa_*',
    lines: INTRO_LINES,
    groups: WA_COMMAND_GROUPS,
    panelButtons: WA_PANEL_BUTTONS,
  };
}

function getWaHelpKeyboard(Markup, section = 'all') {
  const mark = (key, label) =>
    section === key ? `• ${label.replace(/^[^\s]+\s/, '')}` : label;

  return Markup.inlineKeyboard([
    [
      { text: mark('conn', ' Conexão'), callback_data: 'a_wa_help_conn' },
      { text: mark('ops', '▶ Operação'), callback_data: 'a_wa_help_ops' },
    ],
    [
      { text: mark('limit', ' Limites'), callback_data: 'a_wa_help_limit' },
      { text: mark('grupos', ' Grupos'), callback_data: 'a_wa_help_grupos' },
    ],
    [
      { text: mark('content', ' Conteúdo'), callback_data: 'a_wa_help_content' },
      { text: mark('loja', ' Loja'), callback_data: 'a_wa_help_loja' },
    ],
    [
      { text: mark('logs', ' Logs'), callback_data: 'a_wa_help_logs' },
      { text: section === 'all' ? '• Tudo' : ' Tudo', callback_data: 'a_wa_help_all' },
    ],
    [{ text: 'Painel WhatsApp', callback_data: 'a_wa_menu' }],
  ]);
}

function getWaMenuHint() {
  return '\n\n<i>Comandos:</i> botão Ajuda ou <code>/wa_help</code>';
}

function isWaPluginEnabled() {
  return isZeroDivuEnabled();
}

/** Lista plana para botCommandsCatalog */
const WA_COMMANDS_FLAT = WA_COMMAND_GROUPS.flatMap((g) => g.items.filter((i) => i.cmd));

module.exports = {
  INTRO_LINES,
  WA_COMMAND_GROUPS,
  WA_PANEL_BUTTONS,
  WA_COMMANDS_FLAT,
  buildWaHelpText,
  buildWaHelpParts,
  getWaHelpSectionDef,
  getWaHelpKeyboard,
  getWaMenuHint,
  isWaPluginEnabled,
  groupsForSection,
};
