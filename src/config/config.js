/**
 * Configuração compartilhada (módulos fora do bot.js)
 */
const path = require('path');
const { getZerotwoApiKey } = require('./zerotwoEnv');
const { resolveZerotwoApiBase } = require('./zerotwoEndpoints');
const { preferResolvableMediaPath } = require('../utils/wslMediaPath');

function defaultCommunityLink() {
    try {
        return require('./salesReferenceChannel').getSalesRefChannelUrl();
    } catch {
        return 'https://t.me/hanorkinfos';
    }
}

const CONFIG = {
    TOKEN_TELEGRAM: process.env.TOKEN_TELEGRAM,
    TOKEN_MP: process.env.TOKEN_MP,
    ID_DONO: (process.env.ID_DONO || '').split(',').map(id => parseInt(id.trim(), 10)).filter(Boolean),
    SITE_HANORK: process.env.SITE_HANORK || 'https://hanork.com',
    LINKGP: process.env.LINKGP || process.env.SALES_REF_CHANNEL_LINK || defaultCommunityLink(),
    CONTATO_ESPECIALISTA: process.env.CONTATO_ESPECIALISTA || 'https://t.me/hanorkoff',
    MIND7: process.env.MIND7 || 'https://mind-7.org',
    WORK: process.env.WORK || 'https://app.workconsultoria.com',
    API_KEY_ZEROTWO: getZerotwoApiKey(),
    ZEROTWO_API: resolveZerotwoApiBase(process.env),
    GEMINI_KEY: process.env.GEMINI_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    CAMINHO_PRODUTOS: process.env.PRODUCTS_PATH || path.join(__dirname, '../../produtos'),
    CAMINHO_FOTOS: preferResolvableMediaPath(
        process.env.CAMINHO_FOTOS,
        path.join(__dirname, '../../fotos')
    ),
    CAMINHO_INFOS: preferResolvableMediaPath(
        process.env.CAMINHO_INFOS,
        path.join(__dirname, '../../infos')
    ),
    GRUPO_ID: process.env.GRUPO_ID ? parseInt(process.env.GRUPO_ID, 10) : null,
    BOT_USERNAME: process.env.BOT_USERNAME || 'hanork_bot',
};

function syncRuntimeLinks({ linkGp, contact, grupoId } = {}) {
    if (linkGp) CONFIG.LINKGP = linkGp;
    if (contact) CONFIG.CONTATO_ESPECIALISTA = contact;
    if (grupoId != null && grupoId !== '') {
        const id = parseInt(grupoId, 10);
        CONFIG.GRUPO_ID = Number.isNaN(id) ? CONFIG.GRUPO_ID : id;
    }
}

module.exports = { CONFIG, syncRuntimeLinks };
