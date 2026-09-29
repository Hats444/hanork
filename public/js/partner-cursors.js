/**
 * Enxame: dragão, centopeia + 2 híbridos — seguem o cursor; patrulham quando ocioso.
 */
(function (global) {
  "use strict";

  const CENTIPEDE_BASE = 8 / Math.sqrt(7);
  const DRAGON_MULT = 0.34;
  const SIZE_RATIO = (CENTIPEDE_BASE * 1.077) / DRAGON_MULT;

  /** Seta padrão do SO ~24–32px; usamos 28 como referência. */
  const CURSOR_REF_PX = 28;
  const DEFAULT_MAX_CURSOR_FRACTION = 0.1;
  /** Largura aprox. da cabeça (px) ≈ k × visualScale */
  const DRAGON_HEAD_PX_PER_VISUAL = 45;
  const CENTIPEDE_HEAD_PX_PER_VISUAL = 56;

  function visualScaleForCursorFraction(fraction) {
    const f = fraction ?? DEFAULT_MAX_CURSOR_FRACTION;
    const maxPx = CURSOR_REF_PX * f;
    return Math.min(maxPx / DRAGON_HEAD_PX_PER_VISUAL, maxPx / CENTIPEDE_HEAD_PX_PER_VISUAL);
  }

  function resolvePairScales(visual) {
    const v = visual ?? 0.68;
    const dragonScale = v * DRAGON_MULT;
    const centipedeScale = dragonScale * SIZE_RATIO;
    return { dragonScale, centipedeScale, visual: v };
  }

  const IDLE_MS = 1400;
  const PAD = 28;
  const ARRIVE_DIST = 42;

  const FOLLOW_OFFSETS = [
    { id: "dragon", ox: -1, oy: 0 },
    { id: "centipede", ox: 1, oy: 0 },
    { id: "dragonCentipede", ox: -0.65, oy: -0.75 },
    { id: "centipedeDragon", ox: 0.65, oy: 0.75 },
  ];

  function initCreatureSwarm(opts) {
    const maxCursorFraction =
      opts?.maxCursorFraction ??
      (opts?.visualScale == null && opts?.partnerSize == null
        ? DEFAULT_MAX_CURSOR_FRACTION
        : null);
    const visualScale =
      opts?.visualScale ??
      (maxCursorFraction != null
        ? visualScaleForCursorFraction(maxCursorFraction)
        : opts?.partnerSize != null
          ? opts.partnerSize / CENTIPEDE_BASE
          : visualScaleForCursorFraction(DEFAULT_MAX_CURSOR_FRACTION));
    const { dragonScale, centipedeScale, visual } = resolvePairScales(visualScale);
    const travelK = Math.max(0.12, visual / 0.68);
    const gap = opts?.gap ?? Math.max(16, Math.round(88 * travelK));
    const half = gap / 2;
    const pad = Math.max(6, Math.round(PAD * travelK));
    const arriveDist = Math.max(8, Math.round(ARRIVE_DIST * travelK));
    const boundsEl = opts?.boundsEl || null;
    const alwaysWander = opts?.alwaysWander === true;

    function getBounds() {
      if (!boundsEl) {
        return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      }
      const r = boundsEl.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }

    function toLocal(clientX, clientY) {
      const b = getBounds();
      return { x: clientX - b.left, y: clientY - b.top };
    }

    const b0 = getBounds();
    const mouse = { x: b0.width / 2, y: b0.height / 2 };

    function makeAgent(id) {
      const p = {
        x: pad + Math.random() * Math.max(80, b0.width - pad * 2),
        y: pad + Math.random() * Math.max(60, b0.height - pad * 2),
      };
      return {
        id,
        x: p.x,
        y: p.y,
        targetX: p.x,
        targetY: p.y,
        phase: Math.random() * Math.PI * 2,
        speed: 2.1 + Math.random() * 1.6,
      };
    }

    const creatures = [
      { id: "dragon", pos: { x: 0, y: 0 }, agent: makeAgent("dragon") },
      { id: "centipede", pos: { x: 0, y: 0 }, agent: makeAgent("centipede") },
      { id: "dragonCentipede", pos: { x: 0, y: 0 }, agent: makeAgent("dragonCentipede") },
      { id: "centipedeDragon", pos: { x: 0, y: 0 }, agent: makeAgent("centipedeDragon") },
    ];

    creatures.forEach((c) => {
      const off = FOLLOW_OFFSETS.find((o) => o.id === c.id);
      c.pos.x = mouse.x + (off?.ox ?? 0) * half;
      c.pos.y = mouse.y + (off?.oy ?? 0) * half;
      c.agent.x = c.pos.x;
      c.agent.y = c.pos.y;
    });

    let lastMove = Date.now();
    let mouseInside = true;
    let wandering = false;
    let patrolUntil = 0;
    let raf = 0;
    let instances = [];

    function randY(h) {
      return pad + Math.random() * Math.max(60, h - pad * 2);
    }

    function pickPointAnywhere() {
      const b = getBounds();
      return {
        x: pad + Math.random() * Math.max(80, b.width - pad * 2),
        y: randY(b.height),
      };
    }

    function pickSoloTarget(agent) {
      const p = pickPointAnywhere();
      agent.targetX = p.x;
      agent.targetY = p.y;
    }

    function clampAgent(agent) {
      const b = getBounds();
      agent.x = Math.max(pad, Math.min(b.width - pad, agent.x));
      agent.y = Math.max(pad, Math.min(b.height - pad, agent.y));
    }

    function refreshAllTargets() {
      creatures.forEach((c) => pickSoloTarget(c.agent));
    }

    function enterPatrol() {
      patrolUntil = Date.now() + 4000 + Math.random() * 6000;
      refreshAllTargets();
    }

    function tickAgent(agent, pos) {
      agent.phase += 0.028;
      const dx = agent.targetX - agent.x;
      const dy = agent.targetY - agent.y;
      const dist = Math.hypot(dx, dy) || 1;

      if (dist < arriveDist) {
        pickSoloTarget(agent);
      }

      const ease = Math.min(1, dist / 140);
      const spd = agent.speed * (0.35 + 0.65 * ease);
      const nx = dx / dist;
      const ny = dy / dist;
      const wobble = Math.sin(agent.phase * 1.15) * (1.8 + ease * 2.2);

      agent.x += nx * spd - ny * wobble * 0.4;
      agent.y += ny * spd + nx * wobble * 0.4;
      clampAgent(agent);

      const follow = 0.1 + ease * 0.06;
      pos.x += (agent.x - pos.x) * follow;
      pos.y += (agent.y - pos.y) * follow;
    }

    function updatePatrol() {
      if (Date.now() > patrolUntil) enterPatrol();
      creatures.forEach((c) => tickAgent(c.agent, c.pos));
    }

    function shouldWander() {
      if (alwaysWander) return true;
      if (!mouseInside) return true;
      return Date.now() - lastMove > IDLE_MS;
    }

    function updateFollowCursor() {
      const mouseEase = 0.22;
      creatures.forEach((c) => {
        const off = FOLLOW_OFFSETS.find((o) => o.id === c.id);
        const tx = mouse.x + (off?.ox ?? 0) * half;
        const ty = mouse.y + (off?.oy ?? 0) * half;
        c.pos.x += (tx - c.pos.x) * mouseEase;
        c.pos.y += (ty - c.pos.y) * mouseEase;
      });
    }

    function startWander() {
      if (wandering) return;
      wandering = true;
      creatures.forEach((c) => {
        c.agent.x = c.pos.x;
        c.agent.y = c.pos.y;
      });
      enterPatrol();
    }

    function updatePosition() {
      if (shouldWander()) {
        if (!wandering) startWander();
        updatePatrol();
      } else {
        wandering = false;
        updateFollowCursor();
      }
    }

    function onPointerMove(e) {
      const b = getBounds();
      const local = toLocal(e.clientX, e.clientY);
      mouse.x = local.x;
      mouse.y = local.y;
      lastMove = Date.now();
      mouseInside =
        e.clientX >= b.left &&
        e.clientY >= b.top &&
        e.clientX <= b.left + b.width &&
        e.clientY <= b.top + b.height;
    }

    function onPointerLeave() {
      mouseInside = false;
    }

    function onPointerEnter() {
      mouseInside = true;
      lastMove = Date.now();
    }

    function onBlur() {
      mouseInside = false;
    }

    function onFocus() {
      mouseInside = true;
      lastMove = Date.now();
    }

    window.addEventListener("pointermove", onPointerMove, false);
    window.addEventListener("pointerleave", onPointerLeave, false);
    window.addEventListener("pointerenter", onPointerEnter, false);
    window.addEventListener("blur", onBlur, false);
    window.addEventListener("focus", onFocus, false);
    document.addEventListener("mouseleave", onPointerLeave, false);
    document.addEventListener("mouseenter", onPointerEnter, false);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      updatePosition();
    };
    loop();

    const getPtr = (id) => () => {
      const c = creatures.find((x) => x.id === id);
      return c ? { x: c.pos.x, y: c.pos.y } : { x: 0, y: 0 };
    };

    if (opts?.dragonScreen && typeof global.initDragonCursor === "function") {
      instances.push(
        global.initDragonCursor({
          screenEl: opts.dragonScreen,
          getPointer: getPtr("dragon"),
          scale: dragonScale,
          boundsEl,
        })
      );
    }

    if (opts?.dragonHybridScreen && typeof global.initDragonCursor === "function") {
      instances.push(
        global.initDragonCursor({
          screenEl: opts.dragonHybridScreen,
          getPointer: getPtr("dragonCentipede"),
          scale: dragonScale,
          boundsEl,
          hybridCentipede: true,
          legsCanvas: opts.dragonCentipedeLegsCanvas,
        })
      );
    }

    const centLine = Math.max(0.35, centipedeScale * 0.42);

    if (opts?.centipedeCanvas && typeof global.initCentipedeCursor === "function") {
      instances.push(
        global.initCentipedeCursor({
          canvasEl: opts.centipedeCanvas,
          getPointer: getPtr("centipede"),
          scale: centipedeScale,
          lineWidth: centLine,
          legSpan: 0.9,
          boundsEl,
        })
      );
    }

    if (opts?.centipedeDragonCanvas && typeof global.initCentipedeCursor === "function") {
      instances.push(
        global.initCentipedeCursor({
          canvasEl: opts.centipedeDragonCanvas,
          getPointer: getPtr("centipedeDragon"),
          scale: centipedeScale,
          lineWidth: centLine,
          legSpan: 0.9,
          boundsEl,
          hybridDragon: true,
        })
      );
    }

    return {
      destroy() {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onPointerMove, false);
        window.removeEventListener("pointerleave", onPointerLeave, false);
        window.removeEventListener("pointerenter", onPointerEnter, false);
        window.removeEventListener("blur", onBlur, false);
        window.removeEventListener("focus", onFocus, false);
        document.removeEventListener("mouseleave", onPointerLeave, false);
        document.removeEventListener("mouseenter", onPointerEnter, false);
        instances.forEach((i) => i?.destroy?.());
        instances = [];
      },
    };
  }

  function initPartnerCursors(opts) {
    return initCreatureSwarm(opts);
  }

  global.initCreatureSwarm = initCreatureSwarm;
  global.initPartnerCursors = initPartnerCursors;
  global.resolveCreatureScales = resolvePairScales;
  global.visualScaleForCursorFraction = visualScaleForCursorFraction;
})(typeof window !== "undefined" ? window : global);
