'use strict';

/**
 * Validação central de variáveis de segurança no boot.
 * Em produção com SECURITY_STRICT !== 'false', falhas críticas encerram o processo.
 */
const logger = require('./logger');

function isProd() {
    return process.env.NODE_ENV === 'production';
}

function isStrict() {
    if (process.env.SECURITY_STRICT === 'false') return false;
    if (process.env.SECURITY_STRICT === 'true') return true;
    return isProd();
}

function dashboardEnabled() {
    return !!(
        (process.env.DASHBOARD_PASS_HASH || '').trim() ||
        (process.env.DASHBOARD_PASS || '').trim()
    );
}

function jwtConfigured() {
    const s = (process.env.DASHBOARD_JWT_SECRET || process.env.JWT_SECRET || '').trim();
    return s.length >= 16;
}

function envTruthy(name) {
    const v = process.env[name];
    if (v == null || v === '') return false;
    return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

function zeroDivuEnabled() {
    return envTruthy('ZERO_DIVU_ENABLED');
}

function ipcAuthRequired() {
    return envTruthy('ZERO_IPC_AUTH_REQUIRED');
}

function dashboardTenantEnforce() {
    return envTruthy('DASHBOARD_TENANT_ENFORCE');
}

function validateSecurityEnv() {
    const errors = [];
    const warnings = [];

    if (isProd()) {
        if (!(process.env.MP_WEBHOOK_SECRET || '').trim()) {
            errors.push('MP_WEBHOOK_SECRET é obrigatório em produção (webhook Mercado Pago)');
        }
        if (process.env.MP_ALLOW_UNSIGNED_WEBHOOK === 'true') {
            warnings.push('MP_ALLOW_UNSIGNED_WEBHOOK=true — desative em produção real');
        }
        if (process.env.MP_SKIP_IP_CHECK === 'true') {
            warnings.push('MP_SKIP_IP_CHECK=true — use só em testes controlados');
        }
        if (dashboardEnabled()) {
            if ((process.env.DASHBOARD_PASS || '').trim() && !(process.env.DASHBOARD_PASS_HASH || '').trim()) {
                errors.push('Use DASHBOARD_PASS_HASH em produção (remova DASHBOARD_PASS)');
            }
            if (!jwtConfigured()) {
                errors.push('DASHBOARD_JWT_SECRET (mín. 16 caracteres) obrigatório com painel ativo');
            }
            if (!dashboardTenantEnforce()) {
                errors.push('DASHBOARD_TENANT_ENFORCE=1 obrigatório em produção com painel ativo (bloqueio IDOR)');
            }
        }
        const encKey = (process.env.ENCRYPTION_KEY || '').trim();
        if (!encKey || encKey.length < 32) {
            errors.push('ENCRYPTION_KEY (mín. 32 caracteres) obrigatório em produção para tokens no banco');
        }
        if (zeroDivuEnabled()) {
            if (!ipcAuthRequired()) {
                errors.push('ZERO_IPC_AUTH_REQUIRED=1 obrigatório em produção com ZERO_DIVU_ENABLED');
            }
            if (!(process.env.ZERO_IPC_TOKEN || '').trim()) {
                errors.push('ZERO_IPC_TOKEN obrigatório em produção com Zero Divu ativo');
            }
        }
        try {
            const localAiPolicy = require('./localAiPolicy');
            if (localAiPolicy.isWsl()) {
                const { total } = localAiPolicy.memStatsMb();
                const minMb = Number(process.env.OLLAMA_MIN_TOTAL_RAM_MB) || 6144;
                if (total < minMb && localAiPolicy.isLocalAiEnvEnabled()) {
                    errors.push(
                        `USE_LOCAL_AI deve ser false no WSL com ${total}MB RAM (mín. ${minMb}MB para IA local)`
                    );
                }
            }
        } catch { /* ignore */ }
    } else {
        if (isProd() === false && !(process.env.ENCRYPTION_KEY || '').trim()) {
            warnings.push('ENCRYPTION_KEY não definido — tokens no SQLite ficam em texto claro (ok em dev)');
        }
    }

    if (isStrict() && errors.length) {
        const msg = '[SECURITY] Boot bloqueado:\n' + errors.map((e) => `  • ${e}`).join('\n');
        try {
            require('../logging/terminalMirror').appendBootFatal(
                msg.replace(/\n/g, ' ') + ' — ou SECURITY_STRICT=false só em teste local'
            );
        } catch { /* pre-logger */ }
        console.error(msg);
        console.error('[SECURITY] Corrija o .env ou defina SECURITY_STRICT=false apenas em teste local.');
        process.exit(1);
    }

    for (const w of warnings) {
        if (typeof logger?.warn === 'function') logger.warn(`[SECURITY] ${w}`);
        else console.warn(`[SECURITY] ${w}`);
    }
    for (const e of errors) {
        if (typeof logger?.warn === 'function') logger.warn(`[SECURITY] ${e} (modo não estrito)`);
        else console.warn(`[SECURITY] ${e}`);
    }

    return { errors, warnings, strict: isStrict() };
}

module.exports = {
    isProd,
    isStrict,
    validateSecurityEnv,
    dashboardEnabled,
    jwtConfigured,
    zeroDivuEnabled,
    ipcAuthRequired,
    dashboardTenantEnforce,
};
