'use strict';

const os = require('os');
const { connect: dbConnect } = require('../../config/database-sqlite');
const OpsMetricsStore = require('./OpsMetricsStore');

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function fmtMoney(n) {
    return `R$ ${Number(n || 0).toFixed(2)}`;
}

function fmtTs(ts) {
    if (!ts) return '—';
    try {
        return new Date(ts).toLocaleString('pt-BR', { hour12: false });
    } catch {
        return '—';
    }
}

function readKv(db, key) {
    try {
        return db.prepare('SELECT value FROM kv_store WHERE key=?').get(key)?.value ?? null;
    } catch {
        return null;
    }
}

async function fetchWaBundle(opts = {}) {
    const fast = opts.fast === true;
    try {
        const { isZeroDivuEnabled } = require('../../plugins/zero-divu/config');
        if (!isZeroDivuEnabled()) return { enabled: false };
        const { getZeroDivuClient } = require('../../plugins/zero-divu/ZeroDivuClient');
        const client = getZeroDivuClient();
        const online = client.isWorkerLikelyOnline();
        const state = client.readState();
        const ipcDir = client.ipcDir;

        const statusFromState = (st) => {
            if (!st) return null;
            return {
                connected: Boolean(st.connected || st.waConnected),
                phone: st.phone || null,
                profile: st.profile || null,
                activeGroups: st.activeGroups,
                maxGroupsEffective: st.maxGroupsEffective ?? st.maxGroups,
                promoQueue: st.promoQueue,
                joinQueue: st.joinQueue,
                postsPaused: st.postsPaused,
                riskPause: st.riskPause,
                riskPauseMin: st.riskPauseMin,
                postsZero24h: st.postsZero24h,
                postsHanork24h: st.postsHanork24h,
            };
        };

        if (fast && !online) {
            return {
                enabled: true,
                online: false,
                state,
                status: statusFromState(state),
                limits: null,
                divulgacao: null,
                stats: null,
                ipcDir,
                fromCache: true,
            };
        }

        const timeout = fast
            ? Math.min(3500, client.commandTimeoutMs || 3500)
            : Math.min(client.commandTimeoutMs || 12000, 15000);

        const withTimeout = (p) =>
            Promise.race([
                p,
                new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), timeout)),
            ]);

        const [statusAck, limitsAck, divAck, statsAck] = await Promise.all([
            withTimeout(client.sendCommand('wa.get_status', {})),
            withTimeout(client.sendCommand('wa.get_limits', {})),
            withTimeout(client.sendCommand('wa.get_divulgacao_ops', {})),
            withTimeout(client.sendCommand('wa.get_status_stats', {})),
        ]);

        return {
            enabled: true,
            online,
            state,
            status: statusAck?.ok ? statusAck.result : statusFromState(state),
            limits: limitsAck?.ok ? limitsAck.result : null,
            divulgacao: divAck?.ok ? divAck.result : null,
            stats: statsAck?.ok ? statsAck.result : null,
            ipcDir,
        };
    } catch (e) {
        return { enabled: true, error: e.message };
    }
}

function tgGroupStats(db) {
    try {
        const total = db.prepare('SELECT COUNT(*) as c FROM telegram_groups').get()?.c || 0;
        const botPromo = db
            .prepare(
                "SELECT COUNT(*) as c FROM telegram_groups WHERE broadcast_enabled=1 AND type IN ('group','supergroup')"
            )
            .get()?.c || 0;
        const bridge = db
            .prepare('SELECT COUNT(*) as c FROM telegram_groups WHERE promo_via_bridge=1')
            .get()?.c || 0;
        const channels = db
            .prepare("SELECT COUNT(*) as c FROM telegram_groups WHERE type='channel' AND broadcast_enabled=1")
            .get()?.c || 0;
        return { total, botPromo, bridge, channels };
    } catch {
        return { total: 0, botPromo: 0, bridge: 0, channels: 0 };
    }
}

function financeBlock(db, date) {
    const startOfDay = new Date(`${date}T00:00:00`);
    const endOfDay = new Date(`${date}T23:59:59.999`);
    const inicioMes = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1).toISOString();

    const day = db
        .prepare(
            "SELECT COUNT(*) as c, COALESCE(SUM(total),0) as t FROM orders WHERE status IN ('PAID','DELIVERED') AND created_at >= ? AND created_at <= ?"
        )
        .get(startOfDay.toISOString(), endOfDay.toISOString());
    const month = db
        .prepare(
            "SELECT COUNT(*) as c, COALESCE(SUM(total),0) as t FROM orders WHERE status IN ('PAID','DELIVERED') AND created_at >= ?"
        )
        .get(inicioMes);
    const pending = db
        .prepare("SELECT COUNT(*) as c, COALESCE(SUM(total),0) as t FROM orders WHERE status='WAITING_PAYMENT'")
        .get();
    const users = db.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0;
    const products = db.prepare('SELECT COUNT(*) as c FROM products').get()?.c || 0;

    return { day, month, pending, users, products };
}

function autoBroadcastBlock(db) {
    let summary = null;
    try {
        const raw = readKv(db, 'auto_broadcast:last_summary');
        summary = raw ? JSON.parse(raw) : null;
    } catch {
        summary = null;
    }
    const enabled = readKv(db, 'auto_broadcast:enabled');
    const count = readKv(db, 'auto_broadcast:count');
    const lastSent = readKv(db, 'auto_broadcast:last_sent');
    return { summary, enabled: enabled !== '0', count: parseInt(count || '0', 10), lastSent: parseInt(lastSent || '0', 10) };
}

function countermeasuresBlock(recent) {
    const lines = [];
    for (const e of recent) {
        if (!e.countermeasure) continue;
        lines.push(`• [${e.channel}] ${esc(e.countermeasure)} — ${esc(e.detail || e.kind)}`);
        if (lines.length >= 8) break;
    }
    return lines;
}

function alertsBlock(recent, waEvents) {
    const lines = [];
    for (const e of recent) {
        if (e.kind === 'fail' || e.kind === 'skip' || e.kind === 'retry') {
            lines.push(`• TG ${esc(e.kind)}: ${esc(e.target || '—')} — ${esc(e.detail)}`);
        }
        if (lines.length >= 10) break;
    }
    for (const e of waEvents) {
        if (lines.length >= 15) break;
        const tail = e.countermeasure ? ` → ${e.countermeasure}` : '';
        lines.push(`• WA ${esc(e.kind || 'event')}: ${esc(e.detail || e.target || '')}${esc(tail)}`);
    }
    return lines;
}

/**
 * Relatório operacional completo (HTML Telegram).
 */
async function buildHanorkOpsReport({ date, prisma, botUsername }) {
    const db = dbConnect();
    const wa = await fetchWaBundle();
    const ab = autoBroadcastBlock(db);
    const fin = financeBlock(db, date);
    const tg = tgGroupStats(db);
    const counters = OpsMetricsStore.getCounters(db);
    const recent = OpsMetricsStore.getRecent(db, 30);
    const waEvents = OpsMetricsStore.readWaOpsEvents(wa.ipcDir, 20);

    const lines = [];
    lines.push(`<b>📊 Relatório Hanork — ${esc(date)}</b>`);
    lines.push(`<i>${esc(new Date().toLocaleString('pt-BR', { hour12: false }))} · @${esc(botUsername || 'bot')}</i>`);
    lines.push('');

    lines.push('<b>💰 Financeiro</b>');
    lines.push(`Hoje: ${fmtMoney(fin.day.t)} (${fin.day.c} vendas)`);
    lines.push(`Mês: ${fmtMoney(fin.month.t)} (${fin.month.c} vendas)`);
    lines.push(`Pendentes: ${fin.pending.c} — ${fmtMoney(fin.pending.t)}`);
    lines.push(`Usuários: ${fin.users} · Produtos: ${fin.products}`);
    lines.push('');

    lines.push('<b>📣 Telegram — divulgação</b>');
    try {
        const BroadcastAdaptiveThrottle = require('../BroadcastAdaptiveThrottle');
        BroadcastAdaptiveThrottle.bindDb(() => db);
        lines.push(`Throttle: ${BroadcastAdaptiveThrottle.statusLine()}`);
    } catch {
        /* ignore */
    }
    lines.push(`Grupos ativos: ${tg.botPromo}/${tg.total} · Ponte: ${tg.bridge} · Canais: ${tg.channels}`);
    if (ab.summary) {
        const s = ab.summary;
        lines.push(`AutoBroadcast: ${ab.enabled ? 'ON' : 'OFF'} · ciclo #${ab.count}`);
        lines.push(
            `Último: PV ${s.users?.sent ?? 0} env / ${s.users?.edited ?? 0} edit · GP ${s.groups?.sent ?? 0} · CH ${s.channels?.sent ?? 0}`
        );
        if (s.bridgePromo) {
            const b = s.bridgePromo;
            lines.push(`Ponte MTProto: ${b.sent}/${b.total} OK · falhas ${b.failed} · RL ${b.rateLimited || 0}`);
        }
        if (s.productName) lines.push(`Produto: ${esc(s.productName)}`);
    } else {
        lines.push(`AutoBroadcast: ${ab.enabled ? 'ON' : 'OFF'} · sem ciclo recente`);
    }
    if (ab.lastSent) lines.push(`Último auto: ${fmtTs(ab.lastSent)}`);
    lines.push('');

    lines.push('<b>📱 WhatsApp — divulgação</b>');
    if (!wa.enabled) {
        lines.push('Zero Divu: OFF');
    } else if (!wa.online) {
        lines.push('Worker: offline ou sem resposta');
        if (wa.state?.phone) lines.push(`Último tel: ${esc(wa.state.phone)}`);
    } else {
        const st = wa.status || wa.state || {};
        lines.push(`Conectado: ${st.connected ? 'sim' : 'não'} · ${esc(st.phone || '—')}`);
        lines.push(
            `Grupos ativos: ${st.activeGroups ?? '?'}/${st.maxGroupsEffective ?? st.maxGroups ?? '?'} · perfil ${esc(st.profile || wa.limits?.profile || '—')}`
        );
        if (st.postsZero24h != null || st.postsHanork24h != null) {
            lines.push(`Posts 24h: zero ${st.postsZero24h ?? 0} · Hanork ${st.postsHanork24h ?? 0}`);
        }
        if (wa.limits) {
            const L = wa.limits;
            lines.push(
                `Fila promo: ${L.promoQueue ?? st.promoQueue ?? 0} · join ${L.joinQueue ?? st.joinQueue ?? 0} · pausado ${L.postsPaused || st.postsPaused ? 'sim' : 'não'}`
            );
            if (L.riskPause || st.riskPause) {
                lines.push(`Anti-ban: ${esc(L.riskPause || st.riskPause)} ~${L.riskPauseMin ?? st.riskPauseMin ?? '?'} min`);
            }
            if (st.antiBanWait) lines.push(`Espera anti-ban: ${esc(st.antiBanWait)}`);
        }
        if (wa.divulgacao) {
            const d = wa.divulgacao;
            lines.push(
                `Divulgação: prontos ${d.due} · recentes ${d.recent} · grace ${d.grace} · bloqueados ${d.blocked}`
            );
            if (d.promoQueuePending != null) {
                lines.push(`Fila Hanork: ${d.promoQueuePending} pendente(s)${d.promoQueueProcessing ? ' · processando' : ''}`);
            }
            if (d.antiBan?.hardPaused) {
                lines.push(`⚠️ Pausa hard ~${d.antiBan.remainingMin} min (risco ${d.antiBan.riskScore ?? '?'})`);
            }
            if (Array.isArray(d.blockedSample) && d.blockedSample.length) {
                lines.push('<b>Bloqueios WA (amostra):</b>');
                for (const b of d.blockedSample.slice(0, 8)) {
                    lines.push(`  · ${esc(b.subject || b.id)} — ${esc(b.reason)}`);
                }
            }
        }
        if (wa.stats?.totals) {
            const t = wa.stats.totals;
            lines.push(
                `Status/grupo: ok ${t.canPost ?? '?'} · cooldown ${t.onCooldown ?? '?'} · limite ${t.atLimit ?? '?'}`
            );
        }
    }
    lines.push('');

    const cm = countermeasuresBlock(recent);
    if (cm.length) {
        lines.push('<b>🛡 Contramedidas aplicadas</b>');
        lines.push(...cm);
        lines.push('');
    }

    const alerts = alertsBlock(recent, waEvents);
    if (alerts.length) {
        lines.push('<b>⚠️ Alertas recentes</b>');
        lines.push(...alerts);
        lines.push('');
    }

    const counterKeys = Object.entries(counters).filter(([k]) => k !== '_updatedAt');
    if (counterKeys.length) {
        lines.push('<b>📈 Contadores (24h acumulado)</b>');
        for (const [k, v] of counterKeys.slice(0, 12)) {
            lines.push(`  ${esc(k)}: ${v}`);
        }
        lines.push('');
    }

    lines.push('<b>🖥 Host</b>');
    const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    lines.push(`Node ${esc(process.version)} · uptime ${Math.floor(os.uptime() / 60)} min · RAM ${rssMb} MB`);
    lines.push('');
    lines.push('<i>Relatório automático · foto menu rotativa</i>');

    return lines.join('\n');
}

function compactAlerts(recent, waEvents, max = 2) {
    const lines = [];
    for (const e of recent) {
        if (e.kind !== 'fail' && e.kind !== 'skip' && e.kind !== 'retry') continue;
        lines.push(`• TG ${esc(e.kind)}: ${esc((e.detail || e.target || '').slice(0, 48))}`);
        if (lines.length >= max) return lines;
    }
    for (const e of waEvents) {
        if (lines.length >= max) break;
        lines.push(`• WA: ${esc((e.detail || e.target || e.kind || '').slice(0, 48))}`);
    }
    return lines;
}

/**
 * Relatório resumido — cabe na legenda da foto menu (≤ ~900 chars).
 */
async function buildHanorkOpsReportCompact({
    date,
    botUsername,
    label = '2h',
    extra = {},
}) {
    const db = dbConnect();
    const wa = await fetchWaBundle();
    const ab = autoBroadcastBlock(db);
    const fin = financeBlock(db, date);
    const tg = tgGroupStats(db);
    const recent = OpsMetricsStore.getRecent(db, 12);
    const waEvents = OpsMetricsStore.readWaOpsEvents(wa.ipcDir, 6);

    const nowStr = new Date().toLocaleString('pt-BR', { hour12: false });
    const lines = [];

    lines.push(`<b>📊 Hanork — ${esc(label)}</b>`);
    lines.push(`<i>${esc(nowStr)} · @${esc(botUsername || 'bot')}</i>`);
    lines.push('');

    lines.push(
        `<b>💰</b> Hoje <b>${fmtMoney(fin.day.t)}</b> (${fin.day.c}) · Mês ${fmtMoney(fin.month.t)} (${fin.month.c})`
    );
    if (extra.revenue != null && extra.orders != null) {
        lines.push(`<i>Pedidos entregues hoje: ${extra.orders} · ${fmtMoney(extra.revenue)}</i>`);
    }
    lines.push(
        `👥 ${fin.users} usuários · ${fin.products} produtos` +
            (fin.pending.c ? ` · ⏳ ${fin.pending.c} pendente(s)` : '')
    );
    lines.push('');

    let throttle = '';
    try {
        const BroadcastAdaptiveThrottle = require('../BroadcastAdaptiveThrottle');
        BroadcastAdaptiveThrottle.bindDb(() => db);
        const lim = BroadcastAdaptiveThrottle.getLimits();
        throttle = ` · risco ${lim.riskScore}/100`;
    } catch {
        /* ignore */
    }

    lines.push(`<b>📣 Telegram</b>`);
    lines.push(
        `Auto <b>${ab.enabled ? 'ON' : 'OFF'}</b> · ciclo #${ab.count}${throttle}`
    );
    lines.push(`Grupos ${tg.botPromo}/${tg.total} · Ponte ${tg.bridge} · Canais ${tg.channels}`);
    if (ab.summary) {
        const s = ab.summary;
        const u = s.users || {};
        const g = s.groups || {};
        const c = s.channels || {};
        lines.push(
            `Último: PV ✏️${u.edited || 0}/📤${u.sent || 0} · GP ${(g.sent || 0) + (g.edited || 0)} · CH ${(c.sent || 0) + (c.edited || 0)}`
        );
        if (s.productName) lines.push(`Produto: <i>${esc(String(s.productName).slice(0, 40))}</i>`);
    } else if (ab.lastSent) {
        lines.push(`Último auto: ${fmtTs(ab.lastSent)}`);
    }
    lines.push('');

    lines.push(`<b>📱 WhatsApp</b>`);
    if (!wa.enabled) {
        lines.push('Zero Divu <b>OFF</b>');
    } else if (!wa.online) {
        lines.push('Worker <b>offline</b>');
    } else {
        const st = wa.status || wa.state || {};
        const prof = esc(st.profile || wa.limits?.profile || '—');
        const risk = st.riskScore ?? wa.divulgacao?.antiBan?.riskScore;
        const riskTxt = risk != null ? ` · risco ${risk}/100` : '';
        lines.push(
            `${st.connected ? '🟢' : '🔴'} ${esc(st.phone || '—')} · <i>${prof}</i>${riskTxt}`
        );
        const ag = st.activeGroups ?? wa.stats?.totals?.canPost ?? '?';
        const mx = st.maxGroupsEffective ?? st.maxGroups ?? '?';
        const queue = wa.limits?.promoQueue ?? st.promoQueue ?? 0;
        lines.push(`Grupos ${ag}/${mx} · fila ${queue}`);
        if (wa.divulgacao?.antiBan?.hardPaused) {
            lines.push(`⚠️ Pausa anti-ban ~${wa.divulgacao.antiBan.remainingMin} min`);
        }
    }

    const alerts = compactAlerts(recent, waEvents, 2);
    if (alerts.length) {
        lines.push('');
        lines.push('<b>⚠️ Alertas</b>');
        lines.push(...alerts);
    }

    try {
        const gw = require('../../core/hanorkGateway').getStats();
        if (gw.total >= 10) {
            const reg = Math.round((gw.registryRate || 0) * 100);
            const leg = Math.round((gw.legacyRate || 0) * 100);
            const ready = gw.legacyOffReady ? ' · legacy OK p/ off' : '';
            lines.push('');
            lines.push(`<b>🔀 Gateway</b> registry ${reg}% · legacy ${leg}%${ready}`);
        }
    } catch {
        /* gateway off */
    }

    try {
        const GptProviderPool = require('../GptProviderPool');
        const health = GptProviderPool.getProviderHealthReport?.();
        if (health?.providers?.length) {
            const top = health.providers
                .filter((p) => p.success + p.fail >= 1)
                .slice(0, 2)
                .map((p) => `${p.id} ${Math.round((p.healthScore || 0) * 100)}%`)
                .join(' · ');
            if (top) {
                lines.push(`<b>🤖 IA</b> ${top}`);
            }
        }
    } catch {
        /* ai core off */
    }

    const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const hostBits = [];
    if (extra.uptimeH != null) hostBits.push(`bot ${extra.uptimeH}h${extra.uptimeM || 0}m`);
    hostBits.push(`${rssMb} MB RAM`);
    if (extra.errorCount != null) hostBits.push(`${extra.errorCount} erros`);
    lines.push('');
    lines.push(`<i>🖥 ${hostBits.join(' · ')}</i>`);

    let out = lines.join('\n');
    if (out.length > 900) {
        out = `${out.slice(0, 880)}\n<i>…</i>`;
    }
    return out;
}

module.exports = { buildHanorkOpsReport, buildHanorkOpsReportCompact, fetchWaBundle };
