'use strict';

/**
 * Criptografia AES-256-GCM para segredos em repouso (token_mp, token_telegram).
 * Valores sem prefixo enc:v1: são tratados como texto legado (migração gradual).
 */
const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
    const raw = (process.env.ENCRYPTION_KEY || '').trim();
    if (!raw || raw.length < 16) return null;
    return crypto.scryptSync(raw, 'hanork-v1', 32);
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plain) {
    if (plain == null || plain === '') return plain;
    const str = String(plain);
    if (isEncrypted(str)) return str;
    const key = getKey();
    if (!key) return str;
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const enc = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, tag, enc]);
    return PREFIX + payload.toString('base64url');
}

function decrypt(stored) {
    if (stored == null || stored === '') return stored;
    const str = String(stored);
    if (!isEncrypted(str)) return str;
    const key = getKey();
    if (!key) {
        throw new Error('ENCRYPTION_KEY ausente — não é possível ler token criptografado');
    }
    const buf = Buffer.from(str.slice(PREFIX.length), 'base64url');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const data = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function encryptField(value) {
    return encrypt(value);
}

function decryptField(value) {
    try {
        return decrypt(value);
    } catch (e) {
        return null;
    }
}

module.exports = {
    PREFIX,
    isEncrypted,
    encrypt,
    decrypt,
    encryptField,
    decryptField,
    hasEncryptionKey: () => !!getKey(),
};
