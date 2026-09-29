'use strict';

const fs = require('fs-extra');
const path = require('path');
const pathResolver = require('../utils/pathResolver');
const mediaFinder = require('../utils/mediaFinder');
const { IPC_DIR, FILES, ensureDir } = require('./paths');

const MSG_PATH = path.join(__dirname, '../config/mensagens.json');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm']);
const AUDIO_EXT = new Set(['.mp3', '.ogg', '.m4a', '.wav', '.opus']);

const policy = require('../config/campaignPolicy');

function normalizeCampaignId(id) {
  const cid = String(id || '').trim().toLowerCase();
  if (policy.blockManualCampaignEdit(cid)) {
    return { blocked: true, id: cid };
  }
  return { blocked: false, id: cid };
}

function loadRaw() {
  return fs.readJsonSync(MSG_PATH);
}

function saveRaw(data) {
  fs.ensureDirSync(path.dirname(MSG_PATH));
  fs.writeJsonSync(MSG_PATH, data, { spaces: 2 });
}

function getCampaignRef(data, campaignId) {
  const cid = normalizeCampaignId(campaignId);
  if (!data.campanhas?.[cid]) return null;
  return { data, cid, camp: data.campanhas[cid] };
}

function mediaHint(campaignId) {
  return normalizeCampaignId(campaignId) === 'hanork' ? 'hanork' : 'zero';
}

function typeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (VIDEO_EXT.has(e)) return 'video';
  if (AUDIO_EXT.has(e)) return 'audio';
  return 'image';
}

function safeFilename(name) {
  return String(name || 'media')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

function mediaDirFor(campaignId, type = 'image') {
  const base = pathResolver.getMediaDir();
  const cid = normalizeCampaignId(campaignId);
  if (type === 'video') return path.join(base, 'videos');
  if (type === 'audio') return path.join(base, 'audios');
  if (cid === 'hanork') return path.join(base, 'hanork');
  return path.join(base, 'imagens');
}

function findMediaFile(campaignId, filename) {
  const hint = mediaHint(campaignId);
  const target = safeFilename(filename).toLowerCase();
  for (const type of ['image', 'video', 'audio']) {
    for (const f of mediaFinder.listMedia(type, hint)) {
      if (path.basename(f).toLowerCase() === target) return f;
    }
  }
  return null;
}

exports.listCampaigns = () => {
  const data = loadRaw();
  const order =
    Array.isArray(data.ordem) && data.ordem.length
      ? data.ordem
      : Object.keys(data.campanhas || {});
  return order
    .map((id) => {
      if (!policy.isCampaignAllowed(id)) return null;
      const c = data.campanhas?.[id];
      if (!c) return null;
      return {
        id,
        link: c.link || null,
        imagem: c.imagem || id,
        variacoes: (c.variacoes || []).length,
        catalogOnly: id === 'hanork' && policy.isHanorkCatalogMode(),
      };
    })
    .filter(Boolean);
};

exports.getTexts = (campaignId) => {
  const ref = getCampaignRef(loadRaw(), campaignId);
  if (!ref) return { ok: false, error: 'campaign_not_found' };
  return {
    ok: true,
    campaign: ref.cid,
    link: ref.camp.link || null,
    variacoes: ref.camp.variacoes || [],
  };
};

exports.setTexts = (campaignId, opts = {}) => {
  const norm = normalizeCampaignId(campaignId);
  if (norm.blocked) {
    return { ok: false, error: 'campaign_disabled', message: 'Campanha Zero desativada — use sync do catálogo Hanork.' };
  }
  const data = loadRaw();
  const ref = getCampaignRef(data, norm.id);
  if (!ref) return { ok: false, error: 'campaign_not_found' };

  const { text, tipo, variacoes, mode } = opts;

  if (Array.isArray(variacoes) && variacoes.length) {
    ref.camp.variacoes = variacoes
      .map((v) => ({
        tipo: String(v.tipo || 'custom').slice(0, 40),
        texto: String(v.texto || v.text || '').trim(),
      }))
      .filter((v) => v.texto);
  } else if (text) {
    const body = String(text).trim();
    if (!body) return { ok: false, error: 'empty_text' };
    const tipoName = String(tipo || 'custom').slice(0, 40);
    const list = ref.camp.variacoes || [];

    if (mode === 'replace_all') {
      ref.camp.variacoes = [{ tipo: tipoName, texto: body }];
    } else {
      const idx = list.findIndex((v) => v.tipo === tipoName);
      if (idx >= 0) list[idx].texto = body;
      else list.push({ tipo: tipoName, texto: body });
      ref.camp.variacoes = list;
    }
  } else {
    return { ok: false, error: 'empty_payload' };
  }

  saveRaw(data);
  return {
    ok: true,
    campaign: ref.cid,
    count: ref.camp.variacoes.length,
  };
};

exports.listMedia = (campaignId) => {
  const cid = normalizeCampaignId(campaignId);
  if (!cid) return { ok: false, error: 'campaign_required' };
  const hint = mediaHint(cid);
  const files = [];
  for (const type of ['image', 'video', 'audio']) {
    for (const f of mediaFinder.listMedia(type, hint)) {
      files.push({
        name: path.basename(f),
        type,
        size: fs.statSync(f).size,
      });
    }
  }
  return { ok: true, campaign: cid, files };
};

exports.saveMedia = async (opts = {}) => {
  const norm = normalizeCampaignId(opts.campaign);
  if (norm.blocked) {
    return { ok: false, error: 'campaign_disabled', message: 'Mídia Zero desativada — fotos vêm dos produtos Hanork.' };
  }
  const cid = norm.id;
  if (!cid) return { ok: false, error: 'campaign_required' };

  let buffer = null;
  let filename = safeFilename(opts.filename || opts.name || 'upload.jpg');

  if (opts.stagingName) {
    ensureDir();
    const inbox = path.join(IPC_DIR, 'inbox');
    fs.ensureDirSync(inbox);
    const src = path.join(inbox, safeFilename(opts.stagingName));
    if (!fs.existsSync(src)) return { ok: false, error: 'staging_not_found' };
    buffer = await fs.readFile(src);
    if (!opts.filename) filename = safeFilename(path.basename(src));
    await fs.remove(src).catch(() => {});
  } else if (opts.base64) {
    buffer = Buffer.from(String(opts.base64), 'base64');
  } else {
    return { ok: false, error: 'no_payload' };
  }

  if (!buffer?.length) return { ok: false, error: 'empty_file' };
  if (buffer.length > 20 * 1024 * 1024) {
    return { ok: false, error: 'file_too_large', message: 'Máximo 20 MB' };
  }

  const ext = path.extname(filename) || extFromMime(opts.mimeType) || '.jpg';
  if (!path.extname(filename)) filename += ext;
  const type = typeFromExt(path.extname(filename));
  const dir = mediaDirFor(cid, type);
  fs.ensureDirSync(dir);
  const dest = path.join(dir, safeFilename(path.basename(filename)));

  await fs.writeFile(dest, buffer);
  return {
    ok: true,
    campaign: cid,
    filename: path.basename(dest),
    type,
    path: dest,
    bytes: buffer.length,
  };
};

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  if (m.includes('video')) return '.mp4';
  if (m.includes('audio')) return '.mp3';
  return '.jpg';
}

exports.removeMedia = (opts = {}) => {
  const cid = normalizeCampaignId(opts.campaign);
  const name = safeFilename(opts.filename || opts.name);
  if (!cid || !name) return { ok: false, error: 'invalid_args' };

  const found = findMediaFile(cid, name);
  if (!found) return { ok: false, error: 'not_found' };

  fs.removeSync(found);
  return { ok: true, campaign: cid, filename: path.basename(found) };
};

exports.reloadConfig = () => {
  const data = loadRaw();
  try {
    require('../services/rotacao').invalidateMessageCache?.();
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    campaigns: Object.keys(data.campanhas || {}).length,
    reloadedAt: new Date().toISOString(),
  };
};

exports.getInboxDir = () => {
  ensureDir();
  const inbox = path.join(IPC_DIR, 'inbox');
  fs.ensureDirSync(inbox);
  return inbox;
};
