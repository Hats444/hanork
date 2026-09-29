'use strict';

const SBM = require('./supplierBalanceMonitor');
const { formatMoney: formatSmmMoney } = require('../modules/smm/utils/smmTextFormat');
const SmmConfig = require('../modules/smm/smmConfig');
const ProviderManager = require('../modules/smm/providers/ProviderManager');
const { getProvider } = require('../modules/smm/providers/providerRegistry');

function isVirtuoEnabledSafe() {
    try {
        return require('../modules/virtuo/virtuoEnabled').isVirtuoEnabled();
    } catch {
        return false;
    }
}

async function fetchVirtuoRow() {
    if (!isVirtuoEnabledSafe()) return null;
    const VirtuoBalanceService = require('../modules/virtuo/services/virtuoBalanceService');
    const VirtuoConfig = require('../modules/virtuo/virtuoConfig');
    if (!VirtuoConfig.apiKey) {
        return {
            providerId: 'virtuo',
            label: 'Virtuo SMS',
            ok: false,
            error: 'API key não configurada',
            fingerprint: '—',
        };
    }
    const snap = await VirtuoBalanceService.fetchVirtuoBalance();
    return {
        providerId: 'virtuo',
        label: 'Virtuo SMS',
        ok: snap.ok,
        balance: snap.balance,
        currency: snap.currency || 'BRL',
        error: snap.error,
        fingerprint: snap.fingerprint || '—',
    };
}

async function fetchSmmRows() {
    if (ProviderManager.isDualProviderEnabled()) {
        return ProviderManager.fetchAllBalances();
    }
    const provider = getProvider();
    if (!provider?.getBalance) {
        return [{ providerId: 'smm', label: 'SMM', ok: false, error: 'no_balance_api', fingerprint: '—' }];
    }
    try {
        const raw = await provider.getBalance();
        if (!raw || raw.error === true || (typeof raw.error === 'string' && raw.error)) {
            return [{
                providerId: provider.name || 'smm',
                label: 'SMM',
                ok: false,
                error: String(raw?.message || raw?.error || 'balance_unavailable'),
                fingerprint: provider.keyFingerprint?.() || '—',
            }];
        }
        const balance = Number(raw.balance ?? raw);
        if (!Number.isFinite(balance)) {
            return [{ providerId: provider.name || 'smm', label: 'SMM', ok: false, error: 'balance_invalid', fingerprint: '—' }];
        }
        return [{
            providerId: provider.name || 'smm',
            label: String(provider.name || 'SMM').toUpperCase(),
            ok: true,
            balance,
            currency: raw.currency || 'BRL',
            fingerprint: provider.keyFingerprint?.() || '—',
        }];
    } catch (e) {
        return [{ providerId: provider.name || 'smm', label: 'SMM', ok: false, error: e.message, fingerprint: '—' }];
    }
}

/** Todas as linhas: SSM + UP (+ Virtuo SMS se ativo). */
async function fetchAllSupplierRows() {
    const [smmRows, virtuoRow] = await Promise.all([fetchSmmRows(), fetchVirtuoRow()]);
    const rows = [...(smmRows || [])];
    if (virtuoRow) rows.push(virtuoRow);
    return rows;
}

function formatRowLine(row) {
    const emoji = row.ok
        ? SBM.levelEmoji(
              SBM.classifyBalance(row.balance, {
                  warn:
                      row.providerId === 'virtuo'
                          ? require('../modules/virtuo/virtuoConfig').balanceWarn
                          : SmmConfig.balanceWarnThreshold,
                  critical:
                      row.providerId === 'virtuo'
                          ? require('../modules/virtuo/virtuoConfig').balanceCritical
                          : SmmConfig.balanceCriticalThreshold,
              }).level
          )
        : '⚪';
    const amount = row.ok
        ? `<b>${formatSmmMoney(row.balance)}</b> ${row.currency || 'BRL'}`
        : `<i>${String(row.error || 'indisponível').slice(0, 80)}</i>`;
    return `${emoji} [${row.label}] ${amount} · key ${row.fingerprint}`;
}

function buildAllSuppliersHtml(rows, opts = {}) {
    const lines = (rows || []).map(formatRowLine);
    const smmWarn = SmmConfig.balanceWarnThreshold;
    const smmCrit = SmmConfig.balanceCriticalThreshold;
    let body =
        `💰 <b>Saldo Hanork — fornecedores</b>\n\n` +
        `${lines.join('\n')}\n\n` +
        `<b>SMM</b> · aviso &lt; ${formatSmmMoney(smmWarn)} · crítico &lt; ${formatSmmMoney(smmCrit)}`;

    if (isVirtuoEnabledSafe()) {
        const VirtuoConfig = require('../modules/virtuo/virtuoConfig');
        body +=
            `\n<b>Virtuo SMS</b> · aviso &lt; ${formatSmmMoney(VirtuoConfig.balanceWarn)} · crítico &lt; ${formatSmmMoney(VirtuoConfig.balanceCritical)}`;
    }

    if (opts.orderRef) body += `\n\n📋 Pedido bloqueado: <b>${opts.orderRef}</b>`;
    if (opts.detail) body += `\n⚙️ <i>${String(opts.detail).slice(0, 160)}</i>`;
    if (opts.showOkHint) body += `\n\n<i>Toque em «Atualizar saldo» se algum provedor falhou (ETIMEDOUT).</i>`;
    return body;
}

async function fetchUnifiedSupplierSnapshot() {
    const rows = await fetchAllSupplierRows();
    const smmOk = rows.filter((r) => r.providerId !== 'virtuo' && r.ok);
    const primary = smmOk[0] || rows.find((r) => r.providerId !== 'virtuo');
    const level = primary?.ok
        ? SBM.classifyBalance(primary.balance, {
              warn: SmmConfig.balanceWarnThreshold,
              critical: SmmConfig.balanceCriticalThreshold,
          }).level
        : SBM.LEVEL.WARNING;

    return {
        ok: rows.some((r) => r.ok),
        rows,
        balance: primary?.balance,
        currency: primary?.currency || 'BRL',
        level,
        provider: primary?.providerId,
        fingerprint: primary?.fingerprint,
        dualSnapshot: rows.filter((r) => r.providerId !== 'virtuo'),
        virtuoRow: rows.find((r) => r.providerId === 'virtuo') || null,
    };
}

module.exports = {
    fetchAllSupplierRows,
    fetchUnifiedSupplierSnapshot,
    buildAllSuppliersHtml,
    formatRowLine,
};
