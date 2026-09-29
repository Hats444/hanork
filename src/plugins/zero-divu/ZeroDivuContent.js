'use strict';

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { getZeroDivuClient } = require('./ZeroDivuClient');

class ZeroDivuContentService {
  constructor() {
    /** @type {Map<number, { campaign: string, mode?: string }>} */
    this._pendingText = new Map();
    /** @type {Map<number, string>} */
    this._pendingMedia = new Map();
  }

  beginTextSet(uid, campaign, mode = 'replace_all') {
    this._pendingText.set(Number(uid), { campaign: String(campaign).toLowerCase(), mode });
  }

  beginMediaUpload(uid, campaign) {
    this._pendingMedia.set(Number(uid), String(campaign).toLowerCase());
  }

  cancel(uid) {
    this._pendingText.delete(Number(uid));
    this._pendingMedia.delete(Number(uid));
  }

  isAwaiting(uid) {
    const n = Number(uid);
    return this._pendingText.has(n) || this._pendingMedia.has(n);
  }

  getPendingMediaCampaign(uid) {
    return this._pendingMedia.get(Number(uid)) || null;
  }

  async tryHandlePendingText(ctx, client, Msg) {
    const nuid = Number(ctx.from?.id);
    const pending = this._pendingText.get(nuid);
    if (!pending || !ctx.message?.text) return false;
    if (ctx.message.text.startsWith('/')) return false;

    const text = ctx.message.text.trim();
    if (!text) {
      await Msg.reply(ctx, ' Texto vazio — envie o novo bloco ou /cancelar');
      return true;
    }

    this._pendingText.delete(nuid);
    const ack = await client.sendCommand(
      'wa.set_text',
      {
        campaign: pending.campaign,
        text,
        mode: pending.mode || 'replace_all',
        tipo: 'telegram',
      },
      nuid
    );

    if (!ack.ok) {
      await Msg.reply(ctx, ` ${ack.message || ack.error}`, { parse_mode: 'HTML' });
      return true;
    }
    const r = ack.result?.result || ack.result || {};
    await Msg.reply(
      ctx,
      ` Textos da campanha <code>${pending.campaign}</code> atualizados (<b>${r.count ?? 1}</b> variação(ões)).\n` +
        'Próximo status já usará o novo texto.',
      { parse_mode: 'HTML' }
    );
    return true;
  }

  parseMediaCaption(caption) {
    if (!caption) return null;
    const m = caption.match(/(?:\/wa_midia|wa_midia)\s+(\w+)/i);
    return m?.[1]?.toLowerCase() || null;
  }

  async uploadFromTelegram(ctx, client, Msg, { fileId, filename, mimeType, campaign }) {
    const nuid = Number(ctx.from?.id);
    const camp = campaign || this._pendingMedia.get(nuid);
    if (!camp) return false;

    try {
      const file = await ctx.telegram.getFile(fileId);
      const remotePath = file.file_path;
      if (!remotePath) throw new Error('Telegram não retornou file_path');

      const token = process.env.TOKEN_TELEGRAM;
      if (!token) throw new Error('TOKEN_TELEGRAM não configurado');

      const url = `https://api.telegram.org/file/bot${token}/${remotePath}`;
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        maxContentLength: 20 * 1024 * 1024,
        maxBodyLength: 20 * 1024 * 1024,
        timeout: 120000,
      });
      const buffer = Buffer.from(res.data);
      if (buffer.length > 20 * 1024 * 1024) {
        throw new Error('Arquivo grande demais (máx 20 MB)');
      }

      client.ensureDir();
      const inbox = path.join(client.ipcDir, 'inbox');
      fs.ensureDirSync(inbox);
      const stagingName = `${Date.now()}-${filename.replace(/[/\\?%*:|"<>]/g, '-')}`;
      await fs.writeFile(path.join(inbox, stagingName), buffer);

      const ack = await client.sendCommand(
        'wa.save_media',
        { campaign: camp, stagingName, filename, mimeType },
        nuid
      );

      this._pendingMedia.delete(nuid);

      if (!ack.ok) {
        await Msg.reply(ctx, ` ${ack.message || ack.error}`, { parse_mode: 'HTML' });
        return true;
      }
      const r = ack.result?.result || ack.result || {};
      await Msg.reply(
        ctx,
        ` Mídia salva · campanha <code>${camp}</code>\n <code>${r.filename}</code> (${Math.round((r.bytes || 0) / 1024)} KB)`,
        { parse_mode: 'HTML' }
      );
      return true;
    } catch (e) {
      await Msg.reply(ctx, ` Upload: ${e.message}`, { parse_mode: 'HTML' });
      return true;
    }
  }
}

let singleton = null;

function getZeroDivuContentService() {
  if (!singleton) singleton = new ZeroDivuContentService();
  return singleton;
}

module.exports = { ZeroDivuContentService, getZeroDivuContentService };
