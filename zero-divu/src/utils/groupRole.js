'use strict';

const { jidNormalizedUser } = require('@kurtucoben/baileys/lib/WABinary');

function sameJid(a, b) {
  if (!a || !b) return false;
  try {
    return jidNormalizedUser(a) === jidNormalizedUser(b);
  } catch {
    return String(a).split(':')[0] === String(b).split(':')[0];
  }
}

/** Papel do bot no grupo (só leitura — não bloqueia envio) */
exports.getBotRole = async (sock, groupId) => {
  const me = sock?.user?.id;
  const out = { isAdmin: null, isSuperAdmin: null, announce: null, size: null };
  if (!me || !groupId || typeof sock.groupMetadata !== 'function') return out;

  try {
    const meta = await sock.groupMetadata(groupId);
    out.announce = meta.announce ?? null;
    out.size = meta.size || meta.participants?.length || null;
    const p = (meta.participants || []).find((x) => sameJid(x.id, me));
    if (p) {
      out.isAdmin = Boolean(p.admin);
      out.isSuperAdmin = p.admin === 'superadmin';
    } else {
      out.isAdmin = false;
    }
  } catch {
    /* opcional */
  }
  return out;
};

exports.describeRole = (role) => {
  if (role?.isAdmin === true) return 'admin';
  if (role?.isAdmin === false) return 'membro';
  return 'desconhecido';
};

/** Grupo “só admins” no chat e bot não é admin */
exports.isAnnounceOnlyMember = (role) =>
  role?.announce === true && role?.isAdmin === false;

exports.sameJid = sameJid;

module.exports = exports;
