'use strict';

/** Painel ops — consome /api/ops/summary com cache + stale-while-revalidate. */
(function (global) {
  let _opsCache = null;
  let _opsCacheTs = 0;
  let _opsInflight = null;

  const FETCH_TIMEOUT_MS = 8000;
  const CACHE_FRESH_MS = 5000;
  const CACHE_STALE_MS = 90000;

  const esc = (global.HanorkAdminUtils && global.HanorkAdminUtils.esc)
    || ((s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

  function fmtMoney(n) {
    return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
  }

  function fmtTs(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('pt-BR', { hour12: false });
    } catch {
      return '—';
    }
  }

  function pill(label, value, cls) {
    return `<div class="ops-pill ${cls || ''}"><div class="lbl">${esc(label)}</div><div class="val">${esc(value)}</div></div>`;
  }

  function row(k, v) {
    return `<div class="ops-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
  }

  function card(title, inner) {
    return `<div class="ops-card"><h3>${esc(title)}</h3>${inner}</div>`;
  }

  function pageLoading(el, msg) {
    if (el) {
      el.innerHTML = `<div class="page-load-msg"><span class="page-load-spin"></span> ${esc(msg || 'Carregando…')}</div>`;
    }
  }

  function pageError(el, err) {
    if (el) {
      el.innerHTML = `<div class="page-load-msg page-load-err">⚠ ${esc(err?.message || String(err))}<br><small style="opacity:.7">Tente Atualizar ou verifique se o bot está rodando.</small></div>`;
    }
  }

  function cacheAge() {
    return _opsCache ? Date.now() - _opsCacheTs : Infinity;
  }

  function hasStaleCache() {
    return _opsCache != null && cacheAge() < CACHE_STALE_MS;
  }

  function isCacheFresh() {
    return _opsCache != null && cacheAge() < CACHE_FRESH_MS;
  }

  async function fetchJson(url, opts = {}) {
    const ctrl = new AbortController();
    const ms = opts.timeout || FETCH_TIMEOUT_MS;
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { credentials: 'include', signal: ctrl.signal, ...opts });
      if (r.status === 401) {
        location.href = '/admin/login?expired=1';
        throw new Error('Sessão expirada');
      }
      if (!r.ok) {
        let detail = '';
        try {
          const j = await r.json();
          detail = j.error ? `: ${j.error}` : '';
        } catch { /* ignore */ }
        throw new Error(`HTTP ${r.status}${detail}`);
      }
      return r.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Timeout — servidor demorou demais');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  function opsUrl(opts = {}) {
    if (opts.force) return '/api/ops/summary?nocache=1';
    return '/api/ops/summary';
  }

  function requestOpsFromNetwork(opts = {}) {
    if (_opsInflight && !opts.force) return _opsInflight;
    _opsInflight = fetchJson(opsUrl(opts), opts)
      .then((data) => {
        _opsCache = data;
        _opsCacheTs = Date.now();
        return data;
      })
      .finally(() => {
        _opsInflight = null;
      });
    return _opsInflight;
  }

  async function fetchOps(opts = {}) {
    const force = opts.force === true;

    if (!force && isCacheFresh()) return _opsCache;

    if (!force && hasStaleCache()) {
      requestOpsFromNetwork({ silent: true }).catch(() => {});
      return _opsCache;
    }

    try {
      return await requestOpsFromNetwork(opts);
    } catch (e) {
      if (_opsCache && opts.allowStale !== false) return _opsCache;
      throw e;
    }
  }

  function prefetchOps() {
    if (isCacheFresh() || _opsInflight) return;
    requestOpsFromNetwork({ silent: true }).catch(() => {});
  }

  async function runPage(el, renderFn, loadingMsg, opts = {}) {
    const force = opts.force === true;
    const stale = hasStaleCache();

    if (stale && !force) {
      try {
        await renderFn(_opsCache);
      } catch (e) {
        if (!opts.silent && el) pageError(el, e);
        throw e;
      }
      if (isCacheFresh()) return;
    } else if (!opts.silent && el) {
      pageLoading(el, loadingMsg);
    }

    try {
      const d = await fetchOps(opts);
      if (!stale || force || !isCacheFresh()) {
        await renderFn(d);
      }
    } catch (e) {
      if (!opts.silent && el) pageError(el, e);
      throw e;
    }
  }

  function renderOpsStrip(el, d) {
    if (!el || !d) return;
    const wa = d.whatsapp || {};
    const st = wa.status || wa.state || {};
    const tg = d.telegram?.groups || {};
    const h = d.host || {};
    const waOn = wa.enabled && wa.online && (st.connected || wa.online);
    el.innerHTML =
      pill('Bot TG', d.bot?.username ? '@' + d.bot.username : '—', 'ok') +
      pill('WhatsApp', waOn ? 'Online' : wa.enabled ? 'Offline' : 'OFF', waOn ? 'ok' : 'bad') +
      pill('Grupos TG', `${tg.targets ?? 0}/${tg.total ?? 0}`, '') +
      pill('Ponte MT', String(tg.bridgeTargets ?? 0), '') +
      pill('GP WA', `${st.activeGroups ?? '?'}/${st.maxGroupsEffective ?? '?'}`, '') +
      pill('Anti-ban', d.whatsapp?.divulgacao?.antiBan?.hardPaused ? `~${d.whatsapp.divulgacao.antiBan.remainingMin}m` : 'OK', d.whatsapp?.divulgacao?.antiBan?.hardPaused ? 'warn' : 'ok') +
      pill('RAM', `${h.ramMb ?? '?'} MB`, '') +
      pill('Uptime', `${h.uptimeMin ?? '?'} min`, '');
  }

  function renderEventsFeed(el, events, limit) {
    if (!el) return;
    const list = events || [];
    if (!list.length) {
      el.innerHTML = '<div style="color:var(--text-muted);font-size:.78rem">Nenhum evento recente</div>';
      return;
    }
    el.innerHTML = list.slice(0, limit || 30).map((e) => {
      const ch = esc(e.channel || 'system');
      const cls = [ch, e.kind === 'fail' ? 'fail' : ''].filter(Boolean).join(' ');
      return `<div class="ops-event ${cls}"><div class="meta">${ch} · ${esc(e.kind || 'info')} · ${fmtTs(e.at || e.ts)}</div>`
        + `<div>${esc(e.target || '')} ${e.detail ? '— ' + esc(e.detail) : ''}</div>`
        + (e.countermeasure ? `<div class="cm">🛡 ${esc(e.countermeasure)}</div>` : '')
        + '</div>';
    }).join('');
  }

  function renderQueues(el, queues) {
    if (!el) return;
    const qs = queues || [];
    if (!qs.length) {
      el.innerHTML = row('Filas', 'indisponível');
      return;
    }
    const maxW = Math.max(...qs.map((q) => q.waiting || 0), 1);
    el.innerHTML = qs.map((q) => {
      const w = q.waiting || 0;
      const pct = Math.min(100, Math.round((w / maxW) * 100));
      return `<div class="queue-bar"><span class="name">${esc(q.name)}</span>`
        + `<div class="track"><div class="fill" style="width:${pct}%"></div></div>`
        + `<span class="v">${w}w · ${q.active || 0}a · ${q.failed || 0}f</span></div>`;
    }).join('');
  }

  async function loadOpsHub(opts = {}) {
    const hub = document.getElementById('ops-hub-body');
    if (!hub) return;
    await runPage(hub, async (d) => {
      renderOpsStrip(document.getElementById('ops-strip'), d);
      const ab = d.telegram?.autoBroadcast || {};
      const s = ab.summary || {};
      const wa = d.whatsapp || {};
      const st = wa.status || wa.state || {};
      const div = wa.divulgacao || {};
      const ord = d.orders || {};

      hub.innerHTML =
        '<div class="ops-grid">' +
        card('Sistema', row('Saúde', d.health?.healthy ? '✓ OK' : '⚠ Degradado') +
          row('Node', d.host?.node) + row('Plataforma', d.host?.platform) +
          row('Load', (d.host?.loadAvg || []).join(' / ')) +
          row('Tickets abertos', d.ticketsOpen ?? 0)) +
        card('Pedidos / Entrega', row('Aguardando pagamento', ord.waitingPayment ?? '—') +
          row('Pagos sem entrega', ord.pendingDelivery ?? '—') +
          row('Travados PAID', ord.stuckPaid ?? '—') +
          row('Travados DELIVERING', ord.stuckDelivering ?? '—')) +
        card('AutoBroadcast TG', row('Status', ab.enabled ? 'ON' : 'OFF') +
          row('Ciclos', ab.count ?? 0) +
          row('Último', ab.lastSent ? fmtTs(ab.lastSent) : '—') +
          (s.users ? row('PV', `${s.users.sent}/${s.users.total} env`) : '') +
          (s.groups ? row('Grupos', `${s.groups.sent} env`) : '') +
          (s.bridgePromo ? row('Ponte', `${s.bridgePromo.sent}/${s.bridgePromo.total}`) : '')) +
        card('WhatsApp live', row('Conectado', st.connected ? 'sim' : 'não') +
          row('Telefone', st.phone || '—') +
          row('Grupos', `${st.activeGroups ?? '?'}/${st.maxGroupsEffective ?? '?'}`) +
          row('Posts 24h', `zero ${st.postsZero24h ?? 0} · Hanork ${st.postsHanork24h ?? 0}`) +
          row('Fila promo', st.promoQueue ?? div.promoQueuePending ?? 0) +
          row('Divulgação', `prontos ${div.due ?? '?'} · bloq ${div.blocked ?? '?'}`)) +
        card('Filas Bull', '<div id="ops-queues-inner"></div>') +
        card('IA / Gateway', row('Fila IA', d.ai?.queue ?? '—') +
          row('IA ativas', d.ai?.active ?? '—') +
          row('429 IA', d.ai?.metrics?.rateLimited ?? '—') +
          row('Callbacks', d.callbacks ? `${d.callbacks.dispatched} ok / ${d.callbacks.errors} err` : '—') +
          row('Gateway legacy', d.gateway?.legacyTotal ?? '—')) +
        '</div>' +
        '<div class="g2"><div class="card"><div class="card-t">Alertas recentes</div><div class="ops-feed" id="ops-alerts-feed"></div></div>' +
        '<div class="card"><div class="card-t">Contramedidas</div><div class="ops-feed" id="ops-cm-feed"></div></div></div>';

      renderQueues(document.getElementById('ops-queues-inner'), d.queues);
      renderEventsFeed(document.getElementById('ops-alerts-feed'), d.events?.alerts, 20);
      renderEventsFeed(document.getElementById('ops-cm-feed'), d.events?.countermeasures, 15);
    }, 'Carregando ops…', opts);
  }

  async function loadOpsTelegram(opts = {}) {
    const el = document.getElementById('ops-tg-body');
    if (!el) return;
    await runPage(el, async (d) => {
      const g = d.telegram?.groups || {};
      const ab = d.telegram?.autoBroadcast || {};
      const s = ab.summary || {};
      const counters = d.telegram?.opsCounters || {};

      let counterHtml = '';
      for (const [k, v] of Object.entries(counters).slice(0, 16)) {
        counterHtml += row(k, v);
      }

      el.innerHTML =
        '<div class="ops-grid">' +
        card('Grupos & canais', row('Total ativos', g.total) + row('Bot admin', g.admin) +
          row('Alvos divulgação', g.targets) + row('Canais', g.channels) +
          row('Canais admin', g.channelsAdmin) + row('Broadcast ON', g.broadcastOn)) +
        card('Ponte MTProto', row('Cadastrados', g.bridgePromo) + row('Alvos ativos', g.bridgeTargets) +
          row('Total alvos', g.allTargets)) +
        card('Último ciclo AutoBroadcast', (s.productName ? row('Produto', s.productName) : '') +
          (s.users ? row('PV enviados', s.users.sent) + row('PV editados', s.users.edited) + row('PV bloq', s.users.blocked || 0) : '') +
          (s.groups ? row('GP enviados', s.groups.sent) + row('GP falhas', s.groups.failed || 0) : '') +
          (s.channels ? row('Canais', s.channels.sent) : '') +
          (s.bridgePromo ? row('Ponte OK', `${s.bridgePromo.sent}/${s.bridgePromo.total}`) + row('Ponte falhas', s.bridgePromo.failed || 0) : row('Ciclo', 'sem dados'))) +
        card('Contadores ops TG', counterHtml || row('—', 'sem dados')) +
        '</div>' +
        '<div class="card"><div class="card-t">Eventos Telegram</div><div class="ops-feed" id="ops-tg-events"></div></div>';

      renderEventsFeed(document.getElementById('ops-tg-events'), d.events?.tgRecent, 35);
    }, 'Carregando Telegram…', opts);
  }

  async function loadOpsWhatsApp(opts = {}) {
    const el = document.getElementById('ops-wa-body');
    if (!el) return;
    await runPage(el, async (d) => {
      const wa = d.whatsapp || {};
      const st = wa.status || wa.state || {};
      const lim = wa.limits || {};
      const div = wa.divulgacao || {};
      const stats = wa.stats || {};

      let blocked = '';
      (div.blockedSample || []).slice(0, 12).forEach((b) => {
        blocked += row(b.subject || b.id, b.reason);
      });

      el.innerHTML =
        '<div class="ops-grid">' +
        card('Conexão', row('Zero Divu', wa.enabled ? 'habilitado' : 'OFF') +
          row('Worker', wa.online ? 'online' : 'offline') +
          row('Conectado', st.connected ? 'sim' : 'não') +
          row('Telefone', st.phone || '—') +
          row('Perfil', st.profile || lim.profile || '—')) +
        card('Limites & filas', row('Grupos', `${st.activeGroups ?? '?'}/${st.maxGroupsEffective ?? lim.maxGroups ?? '?'}`) +
          row('Fila promo', lim.promoQueue ?? st.promoQueue ?? 0) +
          row('Fila join', lim.joinQueue ?? st.joinQueue ?? 0) +
          row('Posts pausados', lim.postsPaused || st.postsPaused ? 'sim' : 'não') +
          (lim.riskPause || st.riskPause ? row('Anti-ban', `${lim.riskPause || st.riskPause} ~${lim.riskPauseMin ?? st.riskPauseMin}m`) : '') +
          row('Spam risk', lim.spamRiskScore ?? st.spamRiskScore ?? '—')) +
        card('Divulgação', row('Prontos', div.due ?? '—') + row('Recentes', div.recent ?? '—') +
          row('Grace', div.grace ?? '—') + row('Bloqueados', div.blocked ?? '—') +
          (div.antiBan?.hardPaused ? row('Pausa hard', `~${div.antiBan.remainingMin} min`) : row('Anti-ban', 'OK'))) +
        card('Posts 24h', row('Zero Divu', st.postsZero24h ?? '—') + row('Hanork promo', st.postsHanork24h ?? '—') +
          row('Hanork sync', st.hanorkAutoSyncCount ?? '—')) +
        (stats.totals ? card('Status por grupo', row('Podem postar', stats.totals.canPost) +
          row('Cooldown', stats.totals.onCooldown) + row('Limite diário', stats.totals.atLimit)) : '') +
        '</div>' +
        (blocked ? `<div class="card"><div class="card-t">Bloqueios (amostra)</div>${blocked}</div>` : '') +
        '<div class="card"><div class="card-t">Eventos WhatsApp</div><div class="ops-feed" id="ops-wa-events"></div></div>';

      renderEventsFeed(document.getElementById('ops-wa-events'), d.events?.waRecent, 35);
    }, 'Carregando WhatsApp…', opts);
  }

  async function loadOpsSistema(opts = {}) {
    const el = document.getElementById('ops-sys-body');
    if (!el) return;
    await runPage(el, async (d) => {
      const svc = d.health?.services || {};
      const mem = d.health?.memory || {};

      function svcRow(name, s) {
        if (!s) return row(name, '—');
        const dot = s.healthy ? '<span class="status-dot on"></span>' : '<span class="status-dot off"></span>';
        return `<div class="ops-row"><span class="k">${dot}${esc(name)}</span><span class="v">${esc(s.type || (s.healthy ? 'OK' : s.error || 'fail'))}</span></div>`;
      }

      el.innerHTML =
        '<div class="ops-grid">' +
        card('Serviços', svcRow('Database', svc.database) + svcRow('Cache', svc.cache) +
          svcRow('Session', svc.session) + svcRow('Queue', svc.queue)) +
        card('Memória', row('RSS', mem.rss || `${d.host?.ramMb} MB`) + row('Heap', mem.heapUsed || `${d.host?.heapMb} MB`)) +
        card('Polling / Bot', row('409 conflicts', d.polling?.conflicts409Total ?? '—') +
          row('Polling ativo', d.polling?.pollingActive ? 'sim' : 'não')) +
        card('CRM', d.crm ? row('Segmentos', Object.keys(d.crm.segments || d.crm).length) : row('CRM', '—')) +
        '</div>' +
        '<div class="card"><div class="card-t">Filas de processamento</div><div id="ops-sys-queues" style="padding:8px 0"></div></div>';

      renderQueues(document.getElementById('ops-sys-queues'), d.queues);
    }, 'Carregando sistema…', opts);
  }

  async function loadStandalone(el, fn, loadingMsg, opts = {}) {
    if (!opts.silent && el) pageLoading(el, loadingMsg);
    try {
      await fn(el);
    } catch (e) {
      if (!opts.silent && el) pageError(el, e);
      throw e;
    }
  }

  async function loadOpsGrupos(opts = {}) {
    const el = document.getElementById('ops-grp-body');
    if (!el) return;
    await loadStandalone(el, async (box) => {
      const groups = await fetchJson('/api/v1/groups');
      if (!Array.isArray(groups) || !groups.length) {
        box.innerHTML = '<div class="page-load-msg">Nenhum grupo com bot admin</div>';
        return;
      }
      box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Título</th><th>Chat ID</th><th>Tipo</th><th>Membros</th><th>Broadcast</th></tr></thead><tbody>'
        + groups.map((g) => `<tr><td>${esc(g.title || '—')}</td><td><code>${g.chat_id}</code></td><td>${esc(g.type)}</td><td>${g.member_count ?? '—'}</td><td>${g.broadcast_enabled !== 0 ? '✓' : '—'}</td></tr>`).join('')
        + '</tbody></table></div>';
    }, 'Carregando grupos…', opts);
  }

  async function loadOpsCrm(opts = {}) {
    const el = document.getElementById('ops-crm-body');
    if (!el) return;
    await loadStandalone(el, async (box) => {
      const stats = await fetchJson('/api/v1/crm/stats');
      box.innerHTML =
        '<div class="ops-grid">' +
        card('Base de clientes', row('Total usuários', stats.total_users ?? '—') +
          row('Compradores', stats.compradores ?? '—') +
          row('Recorrentes', stats.recorrentes ?? '—') +
          row('VIPs (R$200+)', stats.vips ?? '—')) +
        card('Engajamento', row('Inativos 30d', stats.inativos_30d ?? '—') +
          row('Premium ativo', stats.premium ?? '—')) +
        '</div>';
    }, 'Carregando CRM…', opts);
  }

  async function refreshOpsStripOnly(opts = {}) {
    try {
      const d = await fetchOps({ allowStale: true, ...opts });
      renderOpsStrip(document.getElementById('ops-strip'), d);
    } catch { /* ignore */ }
  }

  const OPS_PAGE_LOADERS = {
    operacoes: loadOpsHub,
    telegram: loadOpsTelegram,
    whatsapp: loadOpsWhatsApp,
    grupos: loadOpsGrupos,
    sistema: loadOpsSistema,
    crm: loadOpsCrm,
  };

  function refreshOpsPage(page, opts = {}) {
    const fn = OPS_PAGE_LOADERS[page];
    return fn ? fn(opts) : Promise.resolve();
  }

  if (typeof document !== 'undefined') {
    const bootPrefetch = () => prefetchOps();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootPrefetch);
    } else {
      bootPrefetch();
    }
  }

  global.HanorkOpsPanel = {
    loadOpsHub,
    loadOpsTelegram,
    loadOpsWhatsApp,
    loadOpsSistema,
    loadOpsGrupos,
    loadOpsCrm,
    refreshOpsStripOnly,
    refreshOpsPage,
    fetchOps,
    prefetchOps,
  };
})(window);
