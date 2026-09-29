'use strict';

const os = require('os');
const { execSync } = require('child_process');

/** IPv4 privado (RFC1918) — Wi‑Fi / LAN doméstica. */
function isPrivateIPv4(ip) {
    if (!ip || ip.includes(':')) return false;
    const p = ip.split('.').map((x) => parseInt(x, 10));
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
    if (p[0] === 10) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    return false;
}

/** IP NAT interno do WSL/Hyper-V — celular na Wi‑Fi não alcança. */
function isWslOrHyperVNatIPv4(ip) {
    if (!isPrivateIPv4(ip)) return false;
    const p = ip.split('.').map(Number);
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    return false;
}

function isVirtualInterface(name) {
    return /^(lo|loopback|docker|veth|br-|vmware|vboxnet|npcap|vether|wsl|hyper-v|virtualbox|vethernet)/i.test(
        String(name || '')
    );
}

function familyIsIPv4(family) {
    return family === 'IPv4' || family === 4;
}

function uniqueIps(list) {
    const out = [];
    for (const ip of list || []) {
        const t = String(ip || '').trim();
        if (t && isPrivateIPv4(t) && !out.includes(t)) out.push(t);
    }
    return out;
}

/** Rede virtual WSL2 / Hyper-V (192.168.112.0/20) — celular na Wi‑Fi não alcança. */
function isWslVirtualLanIPv4(ip) {
    if (!isPrivateIPv4(ip)) return false;
    const p = ip.split('.').map(Number);
    if (p[0] === 192 && p[1] === 168 && p[2] >= 112 && p[2] <= 127) return true;
    return false;
}

function isVirtualWindowsAdapterName(name) {
    return /vEthernet|hyper-v|wsl|virtualbox|vmware|vethernet|bluetooth|loopback|conex[aã]o local\s*\*|local area connection\s*\*/i.test(
        String(name || '')
    );
}

function isWifiAdapterName(name) {
    return /wi-?fi|wireless|sem fio|wlan/i.test(String(name || ''));
}

/**
 * Parse ipconfig por adaptador — só interfaces conectadas com IPv4 real.
 * @returns {{ name: string, ips: string[], gateway: string|null, wifi: boolean, virtual: boolean }[]}
 */
function parseWindowsIpconfigAdapters(text) {
    const adapters = [];
    const lines = String(text || '').split(/\r?\n/);
    let cur = null;
    let blockLines = [];

    const flush = () => {
        if (!cur) return;
        const block = blockLines.join('\n');
        cur.disconnected = /desconectad|disconnected|media disconnected/i.test(block);
        for (const bl of blockLines) {
            const trimmed = bl.trim();
            const ipMatch = trimmed.match(/IPv4[^:\d]*[:\*]?\s*(\d+\.\d+\.\d+\.\d+)/i);
            if (ipMatch && isPrivateIPv4(ipMatch[1])) cur.ips.push(ipMatch[1]);
            const gwMatch = trimmed.match(/Gateway[^:]*:\s*(\d+\.\d+\.\d+\.\d+)/i);
            if (gwMatch && isPrivateIPv4(gwMatch[1])) cur.gateway = gwMatch[1];
        }
        adapters.push(cur);
        cur = null;
        blockLines = [];
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^[^\s].*:$/.test(trimmed) && !/configura/i.test(trimmed)) {
            flush();
            const name = trimmed.slice(0, -1).trim();
            cur = {
                name,
                ips: [],
                gateway: null,
                disconnected: false,
                wifi: isWifiAdapterName(name),
                virtual: isVirtualWindowsAdapterName(name),
            };
            continue;
        }
        if (cur) blockLines.push(line);
    }
    flush();
    return adapters;
}

function pickBestWindowsLanIps(adapters) {
    const connected = adapters.filter((a) => !a.disconnected && !a.virtual && a.ips.length);
    const scored = connected.map((a) => {
        let score = 0;
        if (a.wifi) score += 100;
        if (a.gateway) score += 50;
        if (/ethernet/i.test(a.name) && !a.wifi) score += 30;
        return { ...a, score };
    });
    scored.sort((a, b) => b.score - a.score);

    const ips = [];
    for (const a of scored) {
        for (const ip of a.ips) {
            if (!isWslVirtualLanIPv4(ip) && !isWslOrHyperVNatIPv4(ip) && !ips.includes(ip)) {
                ips.push(ip);
            }
        }
        if (a.wifi && ips.length) break;
    }
    if (!ips.length) {
        for (const a of scored) {
            for (const ip of a.ips) {
                if (!isWslVirtualLanIPv4(ip) && !isWslOrHyperVNatIPv4(ip) && !ips.includes(ip)) ips.push(ip);
            }
        }
    }
    return ips;
}

function filterPreferredLanIps(ips) {
    const list = uniqueIps(ips).filter(
        (ip) => !isWslVirtualLanIPv4(ip) && !isWslOrHyperVNatIPv4(ip)
    );
    return list;
}

/**
 * IPs Wi‑Fi/Ethernet do Windows — funciona quando o Node roda no WSL.
 * @returns {string[]}
 */
function getWindowsHostLanIPv4() {
    if (process.platform !== 'linux' && process.platform !== 'win32') return [];

    try {
        const out = execSync('ipconfig.exe', {
            encoding: 'utf8',
            timeout: 12000,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const adapters = parseWindowsIpconfigAdapters(out);
        const picked = pickBestWindowsLanIps(adapters);
        if (picked.length) return picked;

        const fallback = [];
        for (const m of out.matchAll(/IPv4[^:\d]*[:\*]?\s*(\d+\.\d+\.\d+\.\d+)/gi)) {
            const ip = m[1];
            if (isPrivateIPv4(ip) && !isWslVirtualLanIPv4(ip) && !isWslOrHyperVNatIPv4(ip)) {
                fallback.push(ip);
            }
        }
        return uniqueIps(fallback);
    } catch {
        return [];
    }
}

function getLanIPv4FromOsInterfaces() {
    const found = [];
    try {
        const ifaces = os.networkInterfaces();
        for (const [name, addrs] of Object.entries(ifaces)) {
            if (isVirtualInterface(name)) continue;
            for (const addr of addrs || []) {
                if (!familyIsIPv4(addr.family)) continue;
                if (addr.internal) continue;
                if (!isPrivateIPv4(addr.address)) continue;
                if (isWslEnvironment() && (isWslOrHyperVNatIPv4(addr.address) || isWslVirtualLanIPv4(addr.address))) {
                    continue;
                }
                if (!found.includes(addr.address)) found.push(addr.address);
            }
        }
    } catch {
        /* ignore */
    }
    return found;
}

let _lanCache = { ips: [], at: 0 };
const LAN_CACHE_MS = 60_000;

/**
 * IPs IPv4 da máquina na rede local (Wi‑Fi/Ethernet).
 * No WSL: prioriza IP do Windows via ipconfig (celular alcança).
 * @param {{ force?: boolean }} [opts]
 * @returns {string[]}
 */
function getLanIPv4Addresses(opts = {}) {
    const manual = (process.env.DASHBOARD_LAN_HOST || process.env.LAN_HOST || '').trim();
    const now = Date.now();
    if (!opts.force && _lanCache.ips.length && now - _lanCache.at < LAN_CACHE_MS) {
        if (manual && !_lanCache.ips.includes(manual)) {
            return uniqueIps([manual, ..._lanCache.ips]);
        }
        return [..._lanCache.ips];
    }

    const found = [];
    const wsl = isWslEnvironment();

    if (wsl || process.platform === 'win32') {
        for (const ip of getWindowsHostLanIPv4()) {
            if (!found.includes(ip)) found.push(ip);
        }
    }

    if (!wsl) {
        for (const ip of getLanIPv4FromOsInterfaces()) {
            if (!found.includes(ip)) found.push(ip);
        }
    }

    if (manual && !found.includes(manual)) found.unshift(manual);

    const preferred = filterPreferredLanIps(found);
    _lanCache = { ips: preferred, at: now };
    return preferred;
}

function refreshLanNetworkCache() {
    return getLanIPv4Addresses({ force: true });
}

function defaultPort() {
    return parseInt(process.env.PORT || '3000', 10);
}

/**
 * URLs do painel — localhost + LAN (mesmo Wi‑Fi).
 */
function getDashboardNetwork(port = defaultPort()) {
    const p = Number(port) || 3000;
    const localUrl = `http://localhost:${p}`;
    const localAltUrl = `http://127.0.0.1:${p}`;
    const lanIps = getLanIPv4Addresses();
    const lanUrls = lanIps.map((ip) => `http://${ip}:${p}`);
    const siteBase = (process.env.SITE_HANORK || '').replace(/\/$/, '');

    return {
        port: p,
        bind: '0.0.0.0',
        localUrl,
        localAltUrl,
        lanIps,
        lanUrls,
        primaryLanUrl: lanUrls[0] || null,
        primaryLanAdminUrl: lanUrls[0] ? `${lanUrls[0]}/admin` : null,
        adminLocalUrl: `${localUrl}/admin`,
        adminLanUrls: lanUrls.map((u) => `${u}/admin`),
        siteBase: siteBase || null,
        wslHint: isWslEnvironment(),
        mobileHint: buildMobileAccessHint(lanIps, p),
    };
}

function buildMobileAccessHint(lanIps, port) {
    if (lanIps.length) {
        return `No celular (mesmo Wi‑Fi): http://${lanIps[0]}:${port}/admin`;
    }
    if (isWslEnvironment()) {
        return 'IP Wi‑Fi não detectado — rode ipconfig no Windows ou defina DASHBOARD_LAN_HOST no .env';
    }
    return 'Defina DASHBOARD_LAN_HOST no .env se o IP não aparecer automaticamente';
}

function isWslEnvironment() {
    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
    try {
        if (os.release().toLowerCase().includes('microsoft')) return true;
    } catch {
        /* ignore */
    }
    return false;
}

function getWslInternalIPv4() {
    try {
        const out = execSync('hostname -I', { encoding: 'utf8', timeout: 3000 }).trim();
        const candidates = out.split(/\s+/).filter(isPrivateIPv4);
        const wslVirt = candidates.find(isWslVirtualLanIPv4);
        if (wslVirt) return wslVirt;
        const nat = candidates.find(isWslOrHyperVNatIPv4);
        if (nat) return nat;
    } catch {
        /* ignore */
    }
    for (const ip of getLanIPv4FromOsInterfaces()) {
        if (isWslVirtualLanIPv4(ip) || isWslOrHyperVNatIPv4(ip)) return ip;
    }
    return null;
}

function ensureWindowsFirewallRule(port = defaultPort()) {
    if (process.env.DASHBOARD_AUTO_FIREWALL === '0') return { ok: false, reason: 'disabled' };
    const ruleName = `Hanork Dashboard TCP ${port}`;
    try {
        const check = execSync(
            `powershell.exe -NoProfile -Command "Get-NetFirewallRule -DisplayName '${ruleName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Enabled"`,
            { encoding: 'utf8', timeout: 12000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
        );
        if (/True/i.test(check)) return { ok: true, reason: 'already_configured' };
    } catch {
        /* tenta criar */
    }
    try {
        execSync(
            `powershell.exe -NoProfile -Command "New-NetFirewallRule -DisplayName '${ruleName}' -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Profile Private,Domain -ErrorAction Stop"`,
            { encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
        );
        return { ok: true, reason: 'configured' };
    } catch (e) {
        return { ok: false, reason: 'firewall_failed', err: String(e?.message || e).slice(0, 160) };
    }
}

function ensureWslPortForward(port = defaultPort()) {
    if (!isWslEnvironment()) return { ok: false, reason: 'not_wsl' };
    if (process.env.DASHBOARD_AUTO_PORTPROXY === '0') return { ok: false, reason: 'disabled' };

    const wslIp = getWslInternalIPv4();
    if (!wslIp) return { ok: false, reason: 'no_wsl_ip' };

    ensureWindowsFirewallRule(port);

    try {
        const check = execSync(
            `powershell.exe -NoProfile -Command "netsh interface portproxy show v4tov4"`,
            { encoding: 'utf8', timeout: 12000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
        );
        if (check.includes(`0.0.0.0:${port}`) && check.includes(wslIp)) {
            return { ok: true, reason: 'already_configured', wslIp };
        }
        if (check.includes(`0.0.0.0:${port}`) && !check.includes(wslIp)) {
            execSync(
                `powershell.exe -NoProfile -Command "netsh interface portproxy delete v4tov4 listenport=${port} listenaddress=0.0.0.0"`,
                { encoding: 'utf8', timeout: 12000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
            );
        }
    } catch {
        /* tenta criar */
    }

    try {
        execSync(
            `powershell.exe -NoProfile -Command "netsh interface portproxy add v4tov4 listenport=${port} listenaddress=0.0.0.0 connectport=${port} connectaddress=${wslIp}"`,
            { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
        );
        return { ok: true, reason: 'configured', wslIp };
    } catch (e) {
        return { ok: false, reason: 'portproxy_failed', wslIp, err: String(e?.message || e).slice(0, 120) };
    }
}

function logWslMobileAccessHint(logger, port = defaultPort()) {
    if (!isWslEnvironment()) return;
    const wslIp = getWslInternalIPv4();
    const logInfo = logger?.info ? logger.info.bind(logger) : console.log;
    const logDbg = logger?.debug ? logger.debug.bind(logger) : logInfo;

    const fwd = ensureWslPortForward(port);
    if (fwd.ok && fwd.reason === 'configured') {
        logInfo(`[DASHBOARD] WSL portproxy OK — celular → 0.0.0.0:${port} → ${fwd.wslIp}`);
        return;
    }
    if (fwd.ok && fwd.reason === 'already_configured') {
        logDbg(`[DASHBOARD] WSL portproxy já ativo (${fwd.wslIp}:${port})`);
        return;
    }
    const logWarn = logger?.warn ? logger.warn.bind(logger) : console.warn;
    if (fwd.reason === 'portproxy_failed' || (!fwd.ok && wslIp)) {
        logWarn(
            `[DASHBOARD] Celular NÃO abre sem Admin no Windows — configure portproxy: ` +
                `netsh interface portproxy add v4tov4 listenport=${port} listenaddress=0.0.0.0 ` +
                `connectport=${port} connectaddress=${wslIp || fwd.wslIp}`
        );
        return;
    }
    if (wslIp) {
        logDbg(
            `[DASHBOARD] WSL portproxy manual (Admin): netsh interface portproxy add v4tov4 ` +
                `listenport=${port} listenaddress=0.0.0.0 connectport=${port} connectaddress=${wslIp}`
        );
    }
}

/** Base URL conforme o Host da requisição (localhost ou IP LAN). */
function resolveAccessFromRequest(req, port = defaultPort()) {
    const host = String(req?.headers?.host || '').trim();
    if (!host) return null;
    const hostname = host.split(':')[0];
    const isLocal =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        isPrivateIPv4(hostname);
    if (!isLocal && process.env.NODE_ENV === 'production' && !process.env.SITE_HANORK) {
        return null;
    }
    const proto =
        req.headers['x-forwarded-proto'] ||
        (req.secure ? 'https' : 'http');
    const base = `${proto}://${host}`.replace(/\/$/, '');
    return {
        accessUrl: base,
        adminUrl: `${base}/admin`,
        host: hostname,
        isLocalHost: hostname === 'localhost' || hostname === '127.0.0.1',
        isLan: isPrivateIPv4(hostname) && !isWslOrHyperVNatIPv4(hostname),
        isWslInternal: isWslOrHyperVNatIPv4(hostname),
    };
}

/** URLs de acesso ao /admin — local + LAN. */
function getAdminAccessUrls(port = defaultPort()) {
    const net = getDashboardNetwork(port);
    return {
        local: net.adminLocalUrl,
        localAlt: `${net.localAltUrl}/admin`,
        lan: net.adminLanUrls,
        primaryLan: net.primaryLanAdminUrl,
    };
}

/** Bloco HTML para login / páginas estáticas. */
function formatAdminAccessHtml(port = defaultPort()) {
    const u = getAdminAccessUrls(port);
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let html =
        `<p class="access-hint"><span class="access-lbl">PC:</span> ` +
        `<a href="${esc(u.local)}">${esc(u.local.replace(/^https?:\/\//, ''))}</a></p>`;
    if (u.lan.length) {
        for (const url of u.lan) {
            html +=
                `<p class="access-hint"><span class="access-lbl">Wi‑Fi:</span> ` +
                `<a href="${esc(url)}">${esc(url.replace(/^https?:\/\//, ''))}</a></p>`;
        }
    } else {
        html += `<p class="access-hint access-muted">Wi‑Fi: IP não detectado (defina DASHBOARD_LAN_HOST no .env)</p>`;
    }
    return html;
}

/** Texto HTML Telegram — local + LAN. */
function formatAdminAccessTelegram(port = defaultPort()) {
    refreshLanNetworkCache();
    const u = getAdminAccessUrls(port);
    const net = getDashboardNetwork(port);
    let out = `💻 <b>PC (local):</b>\n<code>${u.local}</code>`;
    if (u.localAlt !== u.local) out += `\n<code>${u.localAlt}</code>`;
    if (u.lan.length) {
        out += `\n\n📱 <b>Celular (mesmo Wi‑Fi):</b>\n${u.lan.map((url) => `<code>${url}</code>`).join('\n')}`;
        out += `\n\n<i>Toque em «Abrir no celular» abaixo — mesma rede Wi‑Fi do PC.</i>`;
    } else {
        out += `\n\n📱 <i>${net.mobileHint}</i>`;
    }
    if (net.wslHint && net.primaryLanAdminUrl) {
        out += `\n\n✅ <b>Use este no celular:</b>\n<code>${net.primaryLanAdminUrl}</code>`;
        out += `\n<i>Seu Wi‑Fi é 192.168.100.x — não use IP 192.168.11x/12x (rede virtual WSL).</i>`;
    } else if (net.wslHint) {
        out += `\n\n⚠️ <i>WSL: use o IP Wi‑Fi do Windows (não o 172.x nem 192.168.11x do Linux).</i>`;
    }
    return out;
}

function logDashboardUrls(logger, port = defaultPort()) {
    refreshLanNetworkCache();
    const log = logger?.info ? logger.info.bind(logger) : console.log;
    const net = getDashboardNetwork(port);
    log(`[DASHBOARD] Local:  ${net.adminLocalUrl}`);
    log(`[DASHBOARD] Local:  ${net.localAltUrl}/admin`);
    if (net.adminLanUrls.length) {
        for (const u of net.adminLanUrls) {
            log(`[DASHBOARD] Wi‑Fi:  ${u}`);
        }
    } else {
        log('[DASHBOARD] Wi‑Fi:  (nenhum IP LAN detectado — defina DASHBOARD_LAN_HOST no .env)');
    }
    if (net.wslHint) {
        log('[DASHBOARD] WSL: celular usa IP Wi‑Fi do Windows (detectado via ipconfig)');
    }
    if (process.platform === 'win32' || net.wslHint) {
        log(`[DASHBOARD] Firewall: se o celular não abrir, libere a porta ${net.port} TCP no Windows`);
    }
    logWslMobileAccessHint(logger, net.port);
    if (net.wslHint && net.primaryLanAdminUrl) {
        log(`[DASHBOARD] Celular: ${net.primaryLanAdminUrl} (mesma rede Wi‑Fi 192.168.100.x)`);
    }
    const fw = ensureWindowsFirewallRule(net.port);
    if (fw.ok && fw.reason === 'configured') {
        log(`[DASHBOARD] Firewall Windows: porta ${net.port} TCP liberada (rede privada)`);
    }
    return net;
}

function startLanNetworkRefresh(logger, intervalMs = 120_000) {
    const tick = () => {
        try {
            const before = _lanCache.ips.join(',');
            const ips = refreshLanNetworkCache();
            const after = ips.join(',');
            if (after !== before && ips.length) {
                const p = defaultPort();
                const log = logger?.info ? logger.info.bind(logger) : console.log;
                log(`[DASHBOARD] IP Wi‑Fi atualizado: ${ips.map((ip) => `http://${ip}:${p}/admin`).join(', ')}`);
            }
        } catch {
            /* ignore */
        }
    };
    tick();
    return setInterval(tick, intervalMs);
}

module.exports = {
    getLanIPv4Addresses,
    refreshLanNetworkCache,
    getDashboardNetwork,
    getAdminAccessUrls,
    formatAdminAccessHtml,
    formatAdminAccessTelegram,
    resolveAccessFromRequest,
    logDashboardUrls,
    startLanNetworkRefresh,
    ensureWslPortForward,
    ensureWindowsFirewallRule,
    isPrivateIPv4,
    isWslEnvironment,
    isWslOrHyperVNatIPv4,
    isWslVirtualLanIPv4,
};
