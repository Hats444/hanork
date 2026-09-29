/**
 * authMiddleware — protege rotas de dashboard e API
 */
const AuthService = require('./AuthService');

function extractToken(req) {
    const auth = req.headers['authorization'];
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    if (req.cookies?.dashboard_token) return req.cookies.dashboard_token;
    return null;
}

function requireAuth(req, res, next) {
    const token = extractToken(req);
    if (!token) {
        if (req.accepts('html')) return res.redirect('/admin/login');
        return res.status(401).json({ error: 'Não autorizado. Faça login em /admin/login' });
    }
    const decoded = AuthService.verifyToken(token);
    if (!decoded) {
        if (req.accepts('html')) return res.redirect('/admin/login?expired=1');
        return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
    req.admin = decoded;
    next();
}

module.exports = { requireAuth, extractToken };
