/**
 * AuthService — autenticação JWT para dashboard/API
 * Senhas com bcrypt, tokens com expiração configurável
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const logger = require('../../config/logger');
const { isProd, dashboardEnabled } = require('../../config/securityEnv');

function resolveJwtSecret() {
    const fromEnv = (process.env.DASHBOARD_JWT_SECRET || process.env.JWT_SECRET || '').trim();
    if (fromEnv.length >= 16) return fromEnv;
    if (isProd() && dashboardEnabled()) {
        console.error('[AUTH] DASHBOARD_JWT_SECRET (mín. 16 caracteres) obrigatório em produção com painel ativo.');
        process.exit(1);
    }
    const gen = crypto.randomBytes(48).toString('hex');
    logger.warn('[AUTH] Defina DASHBOARD_JWT_SECRET ou JWT_SECRET no .env (mín. 16 caracteres). Usando chave temporária.');
    return gen;
}

const JWT_SECRET = resolveJwtSecret();

const JWT_EXPIRES = process.env.DASHBOARD_JWT_EXPIRES || '8h';
const BCRYPT_ROUNDS = 12;

class AuthService {
    constructor() {
        // Sessões ativas em memória (complementa JWT para revogação imediata)
        this._sessions = new Map(); // token -> { userId, expiresAt }
        // Tentativas de login por IP (brute-force protection)
        this._loginAttempts = new Map(); // ip -> { count, lockedUntil }
        setInterval(() => this._cleanup(), 300000); // limpeza a cada 5min
    }

    // ── Senha ──────────────────────────────────────────────────────────────────

    async hashPassword(plain) {
        return bcrypt.hash(plain, BCRYPT_ROUNDS);
    }

    async verifyPassword(plain, hash) {
        return bcrypt.compare(plain, hash);
    }

    // ── Token JWT ──────────────────────────────────────────────────────────────

    signToken(payload) {
        return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    }

    verifyToken(token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            // Checar se sessão não foi revogada
            if (!this._sessions.has(token)) return null;
            return decoded;
        } catch {
            return null;
        }
    }

    createSession(payload) {
        const token = this.signToken(payload);
        const decoded = jwt.decode(token);
        this._sessions.set(token, { userId: payload.id, expiresAt: decoded.exp * 1000 });
        return token;
    }

    revokeSession(token) {
        this._sessions.delete(token);
    }

    revokeAllSessions(userId) {
        for (const [token, session] of this._sessions) {
            if (session.userId === userId) this._sessions.delete(token);
        }
    }

    // ── Brute-force protection ─────────────────────────────────────────────────

    checkLoginAttempts(ip) {
        const now = Date.now();
        const entry = this._loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
        if (entry.lockedUntil > now) {
            return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
        }
        return { allowed: true };
    }

    recordFailedLogin(ip) {
        const entry = this._loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
        entry.count++;
        if (entry.count >= 5) {
            const lockMins = Math.min(entry.count * 2, 60); // até 60min
            entry.lockedUntil = Date.now() + lockMins * 60000;
            logger.warn(`[AUTH] Brute-force detectado: IP ${ip} bloqueado por ${lockMins}min`);
        }
        this._loginAttempts.set(ip, entry);
    }

    recordSuccessLogin(ip) {
        this._loginAttempts.delete(ip);
    }

    // ── Limpeza ────────────────────────────────────────────────────────────────

    _cleanup() {
        const now = Date.now();
        for (const [token, session] of this._sessions) {
            if (session.expiresAt < now) this._sessions.delete(token);
        }
        for (const [ip, entry] of this._loginAttempts) {
            if (entry.lockedUntil < now && entry.count < 5) this._loginAttempts.delete(ip);
        }
    }

    getActiveSessions() {
        return this._sessions.size;
    }
}

module.exports = new AuthService();
