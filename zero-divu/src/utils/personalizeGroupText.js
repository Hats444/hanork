'use strict';

const groupValidator = require('../services/groupValidator');

/**
 * Substitui {grupo} pelo nome do grupo (assunto WA).
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} gid
 * @param {string} text
 */
async function personalizeGroupText(sock, gid, text) {
    const base = String(text || '');
    if (!/\{grupo\}/i.test(base)) return base;

    let name = '';
    try {
        const active = groupValidator.loadActiveGroups();
        const row = active[gid];
        if (row?.subject) name = String(row.subject).trim();
    } catch {
        /* ignore */
    }

    if (!name && sock?.groupMetadata) {
        try {
            const meta = await sock.groupMetadata(gid);
            name = String(meta?.subject || '').trim();
        } catch {
            /* ignore */
        }
    }

    return base.replace(/\{grupo\}/gi, name || 'grupo');
}

module.exports = { personalizeGroupText };
