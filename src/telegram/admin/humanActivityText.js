'use strict';

/**
 * Texto legível em PT para notificações admin — automático a partir do catálogo
 * (/help, painel /admin) e heurísticas de callback. Novos comandos no
 * botCommandsCatalog.js passam a aparecer sem mapeamento manual.
 */

const { CB, LEGACY_STATIC } = require('../callbacks/constants');
const {
  buildCommandLookup,
  getAllPanelButtons,
} = require('../commands/botCommandsCatalog');

let registryRef = null;
function getRegistry() {
  if (!registryRef) {
    try {
      registryRef = require('../../core/CallbackRegistry').registry;
    } catch {
      registryRef = null;
    }
  }
  return registryRef;
}

function safe(v, max = 80) {
  const s = String(v == null ? '' : v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function stripEmoji(s) {
  return String(s || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanizeSlug(s) {
  return String(s || '')
    .replace(/_/g, ' ')
    .replace(/:/g, ' ')
    .trim();
}

/** Converte descrição imperativa do catálogo para frase no passado */
function descToPastTense(desc) {
  let s = String(desc || '').split(/[—–·|]/)[0].trim();
  s = s.replace(/\([^)]*\)/g, '').trim();
  if (!s) return 'usou um comando';

  if (/^menu principal/i.test(s)) return 'abriu o menu principal';

  const rules = [
    [/^(abre|abrir)\s+/i, 'abriu '],
    [/^(lista|listar)\s+/i, 'viu '],
    [/^(ver|visualizar)\s+/i, 'viu '],
    [/^(baixar)\s+/i, 'buscou '],
    [/^(finalizar)\s+/i, 'foi finalizar '],
    [/^(gerar ou ver)\s+/i, 'consultou '],
    [/^(gerar)\s+/i, 'gerou '],
    [/^(aplicar)\s+/i, 'aplicou '],
    [/^(cadastrar)\s+/i, 'cadastrou '],
    [/^(criar)\s+/i, 'criou '],
    [/^(entra)\s+/i, 'entrou em '],
    [/^(entrar)\s+/i, 'entrou em '],
    [/^(marca)\s+/i, 'marcou '],
    [/^(marcar)\s+/i, 'marcou '],
    [/^(liga|ligar)\s+/i, 'ativou '],
    [/^(pausa|pausar)\s+/i, 'pausou '],
    [/^(disparar)\s+/i, 'disparou '],
    [/^(conectar)\s+/i, 'conectou '],
    [/^(alias de)\s+/i, 'usou '],
    [/^(pedir)\s+/i, 'pediu '],
    [/^(sair de)\s+/i, 'saiu de '],
    [/^(cancela|cancelar)\s+/i, 'cancelou '],
    [/^(igual ao)\s+/i, 'usou '],
    [/^(use)\s+/i, 'usou '],
    [/^(status)\s+/i, 'viu status de '],
    [/^(ajuda)\s+/i, 'viu ajuda sobre '],
    [/^(atualiza)\s+/i, 'atualizou '],
    [/^(remove)\s+/i, 'removeu '],
    [/^(reativar)\s+/i, 'reativou '],
    [/^(voltar)\s+/i, 'voltou '],
    [/^(painel de)\s+/i, 'abriu o painel de '],
    [/^(nova)\s+/i, 'registrou '],
  ];

  for (const [re, rep] of rules) {
    if (re.test(s)) {
      const out = s.replace(re, rep).trim();
      return out || 'interagiu';
    }
  }

  const lower = s.charAt(0).toLowerCase() + s.slice(1);
  if (/^(seus|seu|sua)\s/i.test(lower)) return `viu ${lower}`;
  return lower;
}

const CB_HUMAN = {
  [CB.MENU_HOME]: 'voltou ao menu principal',
  [CB.MENU_ACCOUNT]: 'abriu Minha conta',
  [CB.CATALOG_VIEW]: 'abriu o catálogo',
  [CB.CART_VIEW]: 'abriu o carrinho',
  [CB.CART_CLEAR]: 'limpou o carrinho',
  [CB.CHECKOUT_START]: 'iniciou o checkout',
  [CB.SEARCH_OPEN]: 'abriu a busca da loja',
  [CB.FLASH_SALES]: 'viu as ofertas relâmpago',
  [CB.HELP_OPEN]: 'abriu a ajuda',
  [CB.DOWNLOADS_OPEN]: 'abriu a central de downloads',
  [CB.USER_FAVORITES]: 'abriu os favoritos',
  [CB.USER_AFFILIATE]: 'abriu o painel de afiliado',
  [CB.USER_SHARE]: 'abriu o link de indicação',
  [CB.USER_COUPON]: 'aplicou ou viu cupom',
  [CB.USER_REVIEWS]: 'viu as avaliações',
  [CB.SUBSCRIPTION_VIEW]: 'viu o plano premium',
  [CB.ORDER_LIST]: 'viu os pedidos',
  [CB.ORDER_TRACK]: 'rastreou um pedido',
  [CB.ORDER_RESEND]: 'pediu reenvio de produto',
  [CB.NOOP]: 'tocou em um botão inativo',
};

const NS_VERBS = {
  menu: 'abriu o',
  cart: 'viu o',
  catalog: 'abriu o',
  checkout: 'iniciou',
  payment: 'pagou com',
  user: 'abriu',
  order: 'viu',
  search: 'abriu',
  help: 'viu',
  admin: 'usou',
  flash: 'viu',
  affiliate: 'abriu',
  product: 'abriu',
  prod: 'usou',
  play: 'usou',
};

const CALLBACK_PATTERNS = [
  [/^play:pick:/, () => 'escolheu uma música na lista'],
  [/^play:dl:/, () => 'pediu o download de uma música'],
  [/^play:scancel:/, () => 'cancelou a busca de música'],
  [/^play:cancel:/, () => 'cancelou o download da música'],
  [/^add_(\d+)$/, (m) => `adicionou o produto ${m[1]} ao carrinho`],
  [/^buy_(\d+)$/, (m) => `quis comprar o produto ${m[1]}`],
  [/^p_(\d+)$/, (m) => `abriu o produto ${m[1]}`],
  [/^payment:pix:(.+)$/, (m) => `escolheu pagar com PIX (pedido ${safe(m[1], 16)})`],
  [/^payment:card:(.+)$/, (m) => `escolheu pagar com cartão (pedido ${safe(m[1], 16)})`],
  [/^payment:check:(.+)$/, (m) => `verificou pagamento (pedido ${safe(m[1], 16)})`],
  [/^payment:aff:(.+)$/, (m) => `escolheu pagar com saldo de afiliado (pedido ${safe(m[1], 16)})`],
  [/^help_sec_(\w+)$/, (m) => `viu a ajuda: ${humanizeSlug(m[1])}`],
  [/^downloads:(\w+)$/, (m) => `viu downloads: ${humanizeSlug(m[1])}`],
  [/^a_cmd_(\w+)$/, (m) => `viu comandos admin: ${humanizeSlug(m[1])}`],
  [/^menu:(.+)$/, (m) => `abriu o menu «${safe(humanizeSlug(m[1]), 40)}»`],
  [/^cat_/, () => 'navegou no catálogo'],
  [/^cat_search$/, () => 'abriu a busca no catálogo'],
  [/^cat_hub$/, () => 'viu os formatos do catálogo'],
  [/^suporte_start$/, () => 'abriu atendimento Hanork'],
  [/^hanork:open$/, () => 'abriu atendimento Hanork'],
  [/^hanork:human$/, () => 'abriu assistente Hanork'],
  [/^hanork:ticket$/, () => 'pediu ticket humano'],
  [/^hanork:play_hint$/, () => 'viu dica de música no Hanork'],
  [/^prod_/, () => 'usou o painel de produtos'],
  [/^a_wa_/, (m, d) => `usou WhatsApp: ${safe(humanizeSlug(d.slice(2)), 36)}`],
  [/^a_/, (m, d) => `usou o painel admin: ${safe(humanizeSlug(d.slice(2)), 36)}`],
  [/^onb_/, () => 'passo do cadastro de loja (onboarding)'],
  [/^bcast_/, () => 'usou botões da divulgação em massa'],
  [/^sub_/, () => 'interagiu com plano premium'],
  [/^aff_/, () => 'interagiu com painel de afiliado'],
  [/^review_/, () => 'deixou ou viu avaliação'],
  [/^ticket_/, () => 'interagiu com suporte'],
  [/^flash_/, () => 'interagiu com oferta relâmpago'],
  [/^fav_/, () => 'usou favoritos'],
];

let commandLookupCache = null;
function getCommandLookup() {
  if (!commandLookupCache) commandLookupCache = buildCommandLookup();
  return commandLookupCache;
}

let panelCallbackCache = null;
function buildPanelCallbackIndex() {
  const map = new Map();
  const add = (cb, entry) => {
    if (!cb || map.has(cb)) return;
    map.set(cb, entry);
  };

  for (const p of getAllPanelButtons()) {
    add(p.cb, { desc: p.desc, label: stripEmoji(p.label) });
  }

  for (const [cb, text] of Object.entries(CB_HUMAN)) {
    add(cb, { desc: text, label: null });
  }

  for (const [legacy, canonical] of Object.entries(LEGACY_STATIC)) {
    if (map.has(canonical) && !map.has(legacy)) {
      map.set(legacy, map.get(canonical));
    }
  }

  return map;
}

function getPanelCallbackIndex() {
  if (!panelCallbackCache) panelCallbackCache = buildPanelCallbackIndex();
  return panelCallbackCache;
}

function matchCommandEntry(raw) {
  const text = String(raw || '').trim();
  if (!text) return { entry: null, args: '' };

  const parts = text.split(/\s+/);
  if (parts[0]?.includes('@')) {
    parts[0] = parts[0].slice(0, parts[0].indexOf('@'));
  }

  const lookup = getCommandLookup();
  for (let len = parts.length; len >= 1; len--) {
    const key = parts.slice(0, len).join(' ').toLowerCase();
    if (lookup.has(key)) {
      return { entry: lookup.get(key), args: parts.slice(len).join(' ').trim() };
    }
  }

  return { entry: null, args: parts.slice(1).join(' ').trim() };
}

function describeCommand(cmdText) {
  const raw = String(cmdText || '').trim();
  if (!raw) return 'usou um comando';

  const { entry, args } = matchCommandEntry(raw);

  if (entry) {
    const cmdKey = entry.cmd.toLowerCase();

    if (cmdKey === '/play' && args) {
      if (/youtube|youtu\.be|yt\.be/i.test(args)) {
        return 'pediu download de um link do YouTube';
      }
      return `buscou a música «${safe(args, 55)}»`;
    }

    if ((cmdKey === '/instagram' || cmdKey === '/ig') && args) {
      if (/instagram\.com|instagr\.am/i.test(args)) {
        return 'pediu download de um link do Instagram';
      }
      if (/^stories?\s/i.test(args)) {
        return `pediu stories do Instagram (${safe(args.replace(/^stories?\s+/i, ''), 40)})`;
      }
      if (/^highlights?\s/i.test(args)) {
        return `pediu destaques do Instagram (${safe(args.replace(/^highlights?\s+/i, ''), 40)})`;
      }
      return `pediu conteúdo do Instagram (${safe(args, 50)})`;
    }

    if (cmdKey === '/tiktok' && args) {
      if (/tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(args)) {
        return 'pediu download de um link do TikTok';
      }
      return `buscou no TikTok «${safe(args, 55)}»`;
    }

    let action = descToPastTense(entry.desc);
    if (args) {
      const hasPlaceholders = /\bID\b|COD|VALOR|URL|NOME|TELEGRAM|PRECO|HORAS|LIMITE|Assunto|HTML|ALVO|-100/i.test(
        entry.args || entry.desc
      );
      if (!hasPlaceholders || args.length < 120) {
        action = `${action} («${safe(args, 50)}»)`;
      }
    }
    return action;
  }

  const parts = raw.split(/\s+/);
  const head = parts[0];
  const rest = parts.slice(1).join(' ').trim();
  if (rest) return `usou ${safe(head, 24)} com «${safe(rest, 50)}»`;
  return `usou o comando ${safe(head, 32)}`;
}

function panelEntryToAction(panel) {
  const label = panel.label ? safe(stripEmoji(panel.label), 40) : null;
  if (label) return `abriu «${label}» no painel admin`;
  if (panel.desc) return descToPastTense(panel.desc);
  return 'tocou em um botão';
}

function fromPanelOrRegistry(data) {
  const d = String(data || '');
  const panel = getPanelCallbackIndex().get(d);
  if (panel) return panelEntryToAction(panel);

  const reg = getRegistry();
  if (reg?.resolve) {
    const { options } = reg.resolve(d);
    if (options?.description && options.description !== 'Sem descrição') {
      return descToPastTense(options.description);
    }
  }

  return null;
}

function describeByNamespace(data) {
  const parts = String(data).split(':');
  if (parts.length < 2) return null;

  const ns = parts[0];
  const action = parts[1];
  const param = parts.slice(2).join(':');
  const verb = NS_VERBS[ns] || 'interagiu com';
  const act = humanizeSlug(action);
  const suffix = param ? ` (${safe(param, 24)})` : '';
  return `${verb} ${act}${suffix}`.replace(/\s+/g, ' ').trim();
}

function describeCallback(data) {
  const d = String(data || '');
  if (!d) return 'tocou em um botão';

  const known = fromPanelOrRegistry(d);
  if (known) return known;

  for (const [re, fn] of CALLBACK_PATTERNS) {
    const m = d.match(re);
    if (m) return fn(m, d);
  }

  if (d.includes(':')) {
    const ns = describeByNamespace(d);
    if (ns) return ns;
  }

  if (/^[a-z][a-z0-9_]*$/i.test(d)) {
    return `interagiu com «${safe(humanizeSlug(d), 40)}»`;
  }

  return `tocou no botão (${safe(d, 48)})`;
}

function describeMessage(text, extra = {}) {
  const t = safe(String(text || '').trim(), 70);
  if (!t) return 'enviou uma mensagem';
  if (extra?.note === 'PV') return `escreveu no privado: «${t}»`;
  if (extra?.note === 'grupo') return `escreveu no grupo: «${t}»`;
  return `escreveu: «${t}»`;
}

function describeMedia(mediaType, caption, extra = {}) {
  const cap = safe(String(caption || '').trim(), 50);
  const types = {
    photo: 'enviou uma foto',
    document: 'enviou um arquivo',
    video: 'enviou um vídeo',
    voice: 'enviou um áudio de voz',
    audio: 'enviou um áudio',
    sticker: 'enviou um sticker',
    contact: 'compartilhou um contato',
    location: 'compartilhou localização',
  };
  let base = types[mediaType] || 'enviou uma mídia';
  if (cap) base = `${base} com legenda «${cap}»`;
  if (extra?.note === 'PV') return `${base} no privado`;
  return base;
}

function describeDomainEvent(eventName, payload = {}) {
  const e = String(eventName || '').toLowerCase();
  const u = payload?.userId || payload?._userId || payload?.telegramId || payload?.telegram_id;
  const order = payload?.orderId || payload?.order_id;
  const total =
    payload?.total != null && Number.isFinite(Number(payload.total))
      ? `R$ ${Number(payload.total).toFixed(2)}`
      : null;
  const product = payload?.productName || payload?.product_name;
  const method = payload?.method || payload?.paymentMethod;

  if (e.includes('order.paid') || e.includes('paid') || e.includes('payment.received')) {
    const bits = ['Pagamento confirmado'];
    if (order) bits.push(`pedido #${String(order).slice(-8)}`);
    if (total) bits.push(total);
    if (method) bits.push(String(method));
    if (u) bits.push(`cliente ${u}`);
    return bits.join(' · ');
  }
  if (e.includes('order.delivered')) {
    const bits = ['Produto entregue ao cliente'];
    if (order) bits.push(`#${String(order).slice(-8)}`);
    if (product) bits.push(`«${safe(product, 40)}»`);
    if (u) bits.push(`cliente ${u}`);
    return bits.join(' · ');
  }
  if (e.includes('order.created')) {
    const bits = ['Novo pedido criado'];
    if (order) bits.push(`#${String(order).slice(-8)}`);
    if (total) bits.push(total);
    if (u) bits.push(`cliente ${u}`);
    return bits.join(' · ');
  }
  if (e.includes('order.cancelled')) {
    return order ? `Pedido cancelado #${String(order).slice(-8)}` : 'Pedido cancelado';
  }
  if (e.includes('payment.failed')) return 'Falha no pagamento';
  if (e.includes('payment.refunded')) return 'Pagamento estornado';
  if (e.includes('user.registered') || e.includes('user.referred')) {
    return u ? `Novo usuário na loja (ID ${u})` : 'Novo usuário na loja';
  }
  if (e.includes('commission')) return u ? `Comissão de afiliado · cliente ${u}` : 'Comissão de afiliado';
  if (e.includes('cashback')) return u ? `Cashback · cliente ${u}` : 'Cashback';
  if (e.includes('broadcast')) return 'Ciclo de divulgação automática';
  if (e.includes('ticket')) return u ? `Ticket de suporte · cliente ${u}` : 'Ticket de suporte';
  if (e.includes('sale') || e.includes('venda')) {
    const bits = ['Nova venda'];
    if (order) bits.push(`#${String(order).slice(-8)}`);
    if (total) bits.push(total);
    if (u) bits.push(`cliente ${u}`);
    return bits.join(' · ');
  }
  if (e.includes('order')) {
    return order ? `Atualização no pedido #${String(order).slice(-8)}` : 'Atualização em pedido';
  }

  const label = safe(eventName, 36).replace(/[._]/g, ' ');
  return `Evento: ${label}${u ? ` · cliente ${u}` : ''}`;
}

/** Limpa caches (útil em testes ou após hot-reload do catálogo) */
function resetHumanActivityCaches() {
  commandLookupCache = null;
  panelCallbackCache = null;
}

module.exports = {
  safe,
  describeCommand,
  describeCallback,
  describeMessage,
  describeMedia,
  describeDomainEvent,
  resetHumanActivityCaches,
  descToPastTense,
  matchCommandEntry,
};
