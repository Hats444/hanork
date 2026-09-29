'use strict';

const fs = require('fs-extra');
const path = require('path');
const cfg = require('../config/divulgacao');
const mediaFinder = require('../utils/mediaFinder');

const msgPath = path.join(__dirname, '../config/mensagens.json');
const store = require('../utils/debouncedStore');
const hanorkStoreLink = require('../config/hanorkStoreLink');
const ROTATION_FILE = 'rotationState.json';
const MAX_MEDIA_HISTORY = 48;

function defaultCampaignState() {
  return { variacao: 0, media: 0, mediaHistory: [] };
}

function defaultState() {
  return { campanhaIdx: 0, lastCampaignId: null, campaigns: {} };
}

function migrateLegacyState(s) {
  if (s.campaigns) return s;
  return {
    campanhaIdx: 0,
    campaigns: {
      zero: {
        variacao: Number(s.variacao) || 0,
        media: Number(s.media) || 0,
        mediaHistory: s.mediaHistory || [],
      },
      hanork: defaultCampaignState(),
    },
  };
}

function loadState() {
  return migrateLegacyState(store.load(ROTATION_FILE, defaultState()));
}

function campaignState(id) {
  if (!index.campaigns[id]) index.campaigns[id] = defaultCampaignState();
  return index.campaigns[id];
}

let index = loadState();

function saveIndex() {
  store.setCritical(ROTATION_FILE, {
    campanhaIdx: index.campanhaIdx || 0,
    lastCampaignId: index.lastCampaignId || null,
    campaigns: index.campaigns || {},
  });
}

/** IPC / admin — mensagens.json já é lido do disco a cada ciclo; hook para futuro cache */
exports.invalidateMessageCache = () => true;

function mediaCooldownMs() {
  return cfg.MEDIA_COOLDOWN_MS ?? 6 * 60 * 60 * 1000;
}

function historyKey(campaignId, filePath) {
  return `${campaignId}:${path.basename(filePath)}`;
}

function isOnCooldown(campaignId, filePath) {
  const key = historyKey(campaignId, filePath);
  const st = campaignState(campaignId);
  const entry = (st.mediaHistory || []).find((h) => h.key === key);
  if (!entry?.at) return false;
  return Date.now() - new Date(entry.at).getTime() < mediaCooldownMs();
}

function recordMediaUse(filePath, campaignId) {
  if (!filePath || !campaignId) return;
  const st = campaignState(campaignId);
  const key = historyKey(campaignId, filePath);
  const history = [...(st.mediaHistory || []), { key, at: new Date().toISOString() }];
  st.mediaHistory = history.slice(-MAX_MEDIA_HISTORY);
  saveIndex();
}

function loadMessages() {
  try {
    return fs.readJsonSync(msgPath);
  } catch {
    return { campanhas: {}, ordem: [] };
  }
}

function listCampaigns() {
  const m = loadMessages();
  const policy = require('../config/campaignPolicy');
  if (m.campanhas && Object.keys(m.campanhas).length) {
    const order = Array.isArray(m.ordem) && m.ordem.length ? m.ordem : Object.keys(m.campanhas);
    let result = order
      .map((id) => {
        const c = m.campanhas[id];
        const camp = {
          id,
          imagem: c?.imagem || id,
          link: c?.link,
          variacoes: Array.isArray(c?.variacoes) ? c.variacoes : [],
        };
        try {
          return require('./hanorkAutoOverlay').applyHanorkAutoOverlay(camp);
        } catch {
          return camp.variacoes.length ? camp : null;
        }
      })
      .filter(Boolean);

    result = result.filter((c) => policy.isCampaignAllowed(c.id));
    result = result.filter((c) => (c.variacoes?.length || 0) > 0);

    try {
      if (!require('../ipc/runtimeSettings').isHanorkCampaignEnabled()) {
        result = result.filter((c) => c.id !== 'hanork');
      }
    } catch {
      /* IPC opcional */
    }
    return result;
  }

  if (m.variacoes?.length && policy.isZeroCampaignEnabled()) {
    const hint = m.imagem ?? m.midia ?? 'zero';
    return [{ id: 'legacy', imagem: hint, link: m.link, variacoes: m.variacoes }];
  }

  return [];
}

function nextCampaignIdFromLast(lastId, campaigns) {
  const ids = campaigns.map((c) => c.id);
  if (!ids.length) return null;
  if (campaigns.length === 1) return ids[0];
  if (lastId && ids.includes(lastId)) {
    const pos = ids.indexOf(lastId);
    return ids[(pos + 1) % ids.length];
  }
  const pick = ids[(index.campanhaIdx || 0) % ids.length];
  index.campanhaIdx = (index.campanhaIdx || 0) + 1;
  return pick;
}

function nextCampaign(opts = {}) {
  const campaigns = listCampaigns();
  if (!campaigns.length) return null;

  let lastId = index.lastCampaignId;
  if (opts.groupId) {
    try {
      const g = require('./groupValidator').loadActiveGroups()[opts.groupId];
      if (g?.lastStatusCampaign) lastId = g.lastStatusCampaign;
    } catch {
      /* ignore */
    }
  }

  const pickId = nextCampaignIdFromLast(lastId, campaigns);
  if (!pickId) return campaigns[0];

  index.lastCampaignId = pickId;
  saveIndex();
  return campaigns.find((c) => c.id === pickId) || campaigns[0];
}

function nextVariacaoFor(camp) {
  const st = campaignState(camp.id);
  const list = camp.variacoes || [];
  if (!list.length) return null;

  if (camp.id === 'hanork' || camp._hanorkAutoSync) {
    try {
      const sorted = require('./statusContentGuard').sortProductsByRecency(list);
      const pick = sorted[0] || list[st.variacao % list.length];
      const idx = list.indexOf(pick);
      st.variacao = idx >= 0 ? idx + 1 : st.variacao + 1;
      saveIndex();
      return pick;
    } catch {
      /* fallback round-robin */
    }
  }

  const item = list[st.variacao % list.length];
  st.variacao++;
  saveIndex();
  return item;
}

function extractProductId(variacao) {
  if (variacao?.productId != null) return variacao.productId;
  const m = String(variacao?.tipo || '').match(/^prod-(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function buildCaption(texto, link, productId, productName) {
  const { ensureProductBuyLink } = require('../utils/waPromoLink');
  const { sanitizeWaCaption } = require('../utils/statusCaptionSanitizer');
  const pid = productId ?? null;
  const finalLink =
    link || (pid != null ? hanorkStoreLink.getProductLink(pid) : null);
  let caption = ensureProductBuyLink(texto, pid, { link: finalLink || undefined });
  caption = sanitizeWaCaption(caption, { productName });
  return caption;
}

function buildChatCaption(textoChat, texto, link, productId, productName) {
  const { resolveChatCaption } = require('../utils/chatCaption');
  const pid = productId ?? null;
  const finalLink =
    link || (pid != null ? hanorkStoreLink.getProductLink(pid) : null);
  return resolveChatCaption({
    chatText: textoChat,
    statusText: texto,
    productId: pid,
    productName,
    link: finalLink || undefined,
  });
}

function resolveStatusLink(camp, variacao) {
  const raw = camp?.link || loadMessages().link;
  const hanorkManaged = process.env.HANORK_ZERO_WORKER === '1';

  if (variacao?.productId) {
    return hanorkStoreLink.getProductLink(variacao.productId);
  }

  const tipo = String(variacao?.tipo || '');
  const prodMatch = tipo.match(/^prod-(\d+)$/i);
  if (prodMatch) {
    return hanorkStoreLink.getProductLink(Number(prodMatch[1]));
  }

  if (hanorkManaged || hanorkStoreLink.isLegacyWaContact(raw)) {
    return hanorkStoreLink.getHanorkStoreLink('catalogo');
  }

  return raw || hanorkStoreLink.getHanorkStoreLink('catalogo');
}

function isAutoMediaHint(hint) {
  if (!hint) return true;
  const h = String(hint).toLowerCase();
  return h === 'auto' || h === 'alternar' || h === 'alternate';
}

function mediaHintFor(camp) {
  const hint = camp.imagem || camp.id;
  if (camp.id === 'hanork' || camp._hanorkAutoSync) return 'hanork';
  return isAutoMediaHint(hint) ? 'hanork' : String(hint).toLowerCase();
}

/** Escolhe mídia só da pasta da campanha (zero → imagens/, hanork → hanork/) */
function pickMediaFile(type, mediaHint, campaignId) {
  const hint = mediaHint || 'zero';
  const direct = mediaFinder.findMedia(type, hint);
  if (direct && !isOnCooldown(campaignId, direct)) return direct;

  const files = mediaFinder.listMedia(type, hint);
  if (!files.length) return null;

  const st = campaignState(campaignId);
  const now = Date.now();
  const scored = files.map((file) => {
    const key = historyKey(campaignId, file);
    const entry = (st.mediaHistory || []).find((h) => h.key === key);
    const age = entry?.at ? now - new Date(entry.at).getTime() : Infinity;
    const onCooldown = age < mediaCooldownMs();
    return { file, score: onCooldown ? -1 : age, onCooldown };
  });

  const available = scored.filter((s) => !s.onCooldown).sort((a, b) => b.score - a.score);
  if (available.length) return available[0].file;

  return scored.sort((a, b) => b.score - a.score)[0]?.file || files[0];
}

function nextMediaType(camp) {
  const hint = mediaHintFor(camp);
  const types = mediaFinder.getAvailableStatusTypes(hint);
  if (!types.length) return 'text';
  if (types.length === 1) return types[0];

  // Produção: se existe foto/vídeo, preferir mídia ao invés de cair em texto.
  if (cfg.FORCE_STATUS_MEDIA === true) {
    if (types.includes('image')) return 'image';
    if (types.includes('video')) return 'video';
    if (types.includes('audio')) return 'audio';
  }

  const st = campaignState(camp.id);
  const type = types[st.media % types.length];
  st.media++;
  saveIndex();
  return type;
}

function mediaLabel(type) {
  if (type === 'image') return 'foto';
  if (type === 'video') return 'vídeo';
  if (type === 'audio') return 'áudio';
  return 'texto';
}

function buildStatusPost(camp, opts = {}) {
  if (camp._hanorkDynamicPromo) {
    try {
      const bridge = require('./hanorkPromoBridge');
      const picked = bridge.pickNextWaPost({
        productName: camp.variacoes?.[0]?.productName,
      });
      if (picked?.texto) {
        const v = {
          ...picked,
          _pickedPhotoFile: picked.photoFile,
          _pickedPhotoPath: picked.photoPath,
        };
        const link = hanorkStoreLink.getProductLink(
          picked.productId || Number(process.env.HANORK_PRODUCT_ID || 1)
        );
        const type = picked.photoPath && fs.existsSync(picked.photoPath) ? 'image' : 'text';
        const file = type === 'image' ? picked.photoPath : null;
        if (file) recordMediaUse(file, camp.id);
        return {
          type,
          file: file || undefined,
          mimetype: file ? mediaFinder.guessMime(file) : undefined,
          caption: buildCaption(v.texto, link, v.productId, v.productName),
          chatCaption: buildChatCaption(v.textoChat, v.texto, link, v.productId, v.productName),
          productId: v.productId,
          productName: v.productName,
          tipo: v.tipo,
          campanha: camp.id,
          mediaLabel: mediaLabel(type),
        };
      }
    } catch (e) {
      try {
        require('../utils/logger').warn?.('[rotacao] hanork dynamic promo:', e.message);
      } catch {
        /* ignore */
      }
    }
  }

  const v = nextVariacaoFor(camp);
  const hint = mediaHintFor(camp);
  let type = nextMediaType(camp);
  let file = type === 'text' ? null : pickMediaFile(type, hint, camp.id);
  let productBoundImage = false;

  try {
    const hanorkOverlay = require('./hanorkAutoOverlay');
    const productImage = hanorkOverlay.resolveVariacaoImage(camp, v);
    if (productImage) {
      type = 'image';
      file = productImage;
      productBoundImage =
        hanorkOverlay.isProductBoundImage(productImage) ||
        hanorkOverlay.isAutoSyncProduct(v);
    } else if (camp._hanorkAutoSync && hanorkOverlay.isAutoSyncProduct(v)) {
      const menuPath = require('./menuPhotoFallback').nextMenuPhotoPath();
      if (menuPath) {
        type = 'image';
        file = menuPath;
        productBoundImage = true;
      } else {
        type = 'text';
        file = null;
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const patternGuard = require('./patternGuard');
    const mediaKey = file ? path.basename(file) : type;
    if (
      !productBoundImage &&
      patternGuard.shouldRotateMedia(`${camp.id}:${mediaKey}`)
    ) {
      const types = mediaFinder.getAvailableStatusTypes(hint).filter((t) => t !== type);
      if (types.length) {
        const st = campaignState(camp.id);
        type = types[st.media % types.length];
        st.media++;
        saveIndex();
        file = pickMediaFile(type, hint, camp.id);
      }
    }
  } catch {
    /* ignore */
  }

  if (file) recordMediaUse(file, camp.id);

  const link = resolveStatusLink(camp, v);
  const productId = extractProductId(v);
  if (v) {
    return {
      type,
      file: file || undefined,
      mimetype: file ? mediaFinder.guessMime(file) : undefined,
      caption: buildCaption(v.texto, link, productId, v.productName),
      chatCaption: buildChatCaption(v.textoChat, v.texto, link, productId, v.productName),
      productId,
      productName: v.productName,
      tipo: v.tipo,
      campanha: camp.id,
      mediaLabel: mediaLabel(type),
    };
  }

  return null;
}

exports.nextText = () => {
  const camp = nextCampaign();
  if (!camp) return 'Divulgação automática';
  const v = nextVariacaoFor(camp);
  return buildCaption(v?.texto, resolveStatusLink(camp, v), extractProductId(v), v?.productName);
};

exports.nextStatusPost = (opts = {}) => {
  const camp = nextCampaign(opts);
  if (!camp) {
    return { skip: true, reason: 'no_catalog', type: 'text', mediaLabel: 'texto' };
  }
  const post = buildStatusPost(camp, opts);
  if (!post) {
    return { skip: true, reason: 'empty_post', type: 'text', mediaLabel: 'texto' };
  }
  post._campaignId = camp.id;
  return post;
};

exports.nextStatusPostForCampaign = (campaignId) => {
  const camps = listCampaigns();
  const camp = camps.find((c) => c.id === String(campaignId || '').toLowerCase());
  if (!camp) return null;
  return buildStatusPost(camp);
};

exports.resetRotation = () => {
  index = defaultState();
  saveIndex();
};

exports.purgeCampaign = (campaignId) => {
  const id = String(campaignId || '').toLowerCase();
  if (index.campaigns?.[id]) {
    delete index.campaigns[id];
    if (index.lastCampaignId === id) index.lastCampaignId = null;
    saveIndex();
  }
};

exports.recordMediaUse = recordMediaUse;

exports.peekVariacoes = () => {
  const camps = listCampaigns();
  return camps.reduce((n, c) => n + (c.variacoes?.length || 0), 0);
};

exports.peekMediaTypes = () => {
  const zero = mediaFinder.getAvailableStatusTypes('zero');
  const hanork = mediaFinder.getAvailableStatusTypes('hanork');
  return [...new Set([...zero, ...hanork])];
};

exports.listCampaigns = listCampaigns;

module.exports = exports;
