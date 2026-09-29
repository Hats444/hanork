/**

 * Cursor Dragão — animação SVG (produto em produtos/dragon_preview/dragon/)

 */

(function (global) {

  "use strict";



  function drawHybridLegs(ctx, elems, sizeScale, frm, w, h) {

    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    ctx.save();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(160, 230, 180, 0.72)";

    ctx.lineWidth = 1.15 + sizeScale * 0.35;

    ctx.lineCap = "round";

    ctx.lineJoin = "round";



    const legAt = [5, 10, 15, 20, 25, 30, 35];

    legAt.forEach((i, idx) => {

      const ep = elems[i - 1];

      const e = elems[i];

      if (!ep || !e) return;

      const mx = (ep.x + e.x) / 2;

      const my = (ep.y + e.y) / 2;

      const a = Math.atan2(e.y - ep.y, e.x - ep.x);

      const side = idx % 2 === 0 ? 1 : -1;

      const s = sizeScale * 2.4;

      const wave = Math.sin(frm * 4 + idx) * 0.35;

      const j1x = mx + Math.cos(a + side * 1.2) * s * 3.2;

      const j1y = my + Math.sin(a + side * 1.2) * s * 3.2;

      const j2x = j1x + Math.cos(a + side * 0.5 + wave) * s * 4.5;

      const j2y = j1y + Math.sin(a + side * 0.5 + wave) * s * 4.5;

      const fx = j2x + Math.cos(a + side * 0.2) * s * 2.8;

      const fy = j2y + Math.sin(a + side * 0.2) * s * 2.8;

      ctx.beginPath();

      ctx.moveTo(mx, my);

      ctx.lineTo(j1x, j1y);

      ctx.lineTo(j2x, j2y);

      ctx.lineTo(fx, fy);

      ctx.stroke();

      for (let t = 0; t < 3; t++) {

        const tx = fx - Math.cos(a) * t * s * 0.9;

        const ty = fy - Math.sin(a) * t * s * 0.9;

        ctx.beginPath();

        ctx.moveTo(tx, ty);

        ctx.lineTo(tx + Math.cos(a + side * 0.8) * s, ty + Math.sin(a + side * 0.8) * s);

        ctx.stroke();

      }

    });

    ctx.restore();

  }



  function initDragonCursor(opts) {

    const screen = opts?.screenEl || document.getElementById("screen");

    if (!screen) return null;



    const getPointer = opts?.getPointer;

    const sizeScale = opts?.scale ?? 1;

    const boundsEl = opts?.boundsEl || null;

    const hybridCentipede = Boolean(opts?.hybridCentipede);

    const legsCanvas = opts?.legsCanvas || null;

    const legsCtx = legsCanvas ? legsCanvas.getContext("2d") : null;

    const xmlns = "http://www.w3.org/2000/svg";

    const xlinkns = "http://www.w3.org/1999/xlink";



    const measure = () => {

      if (boundsEl) {

        return { width: boundsEl.clientWidth, height: boundsEl.clientHeight };

      }

      return { width: window.innerWidth, height: window.innerHeight };

    };



    let width, height;

    const resize = () => {

      const m = measure();

      width = m.width;

      height = m.height;

      if (legsCanvas && boundsEl) {

        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        legsCanvas.width = Math.floor(width * dpr);

        legsCanvas.height = Math.floor(height * dpr);

        legsCanvas.style.width = width + "px";

        legsCanvas.style.height = height + "px";

      }

    };



    window.addEventListener("resize", resize, false);

    resize();



    const prepend = (use, i) => {

      const elem = document.createElementNS(xmlns, "use");

      elems[i].use = elem;

      elem.setAttributeNS(xlinkns, "xlink:href", "#" + use);

      screen.prepend(elem);

    };



    const N = 40;

    const elems = [];

    for (let i = 0; i < N; i++) elems[i] = { use: null, x: width / 2, y: 0 };

    const pointer = { x: width / 2, y: height / 2 };

    const radm = Math.min(pointer.x, pointer.y) - 20;

    let frm = Math.random();

    let rad = 0;



    for (let i = 1; i < N; i++) {

      if (i === 1) prepend("Cabeza", i);

      else if (hybridCentipede && (i === 8 || i === 14)) prepend("Espina", i);

      else if (i === 8 || i === 14) prepend("Aletas", i);

      else prepend("Espina", i);

    }



    if (hybridCentipede) {
      screen.setAttribute("class", "mutant-dragon-centipede-screen");
    }



    const onMove = (e) => {

      pointer.x = e.clientX;

      pointer.y = e.clientY;

      rad = 0;

    };

    if (!getPointer) {

      window.addEventListener("pointermove", onMove, false);

    }



    let raf = 0;

    let lastT = performance.now();

    let lastTx = width / 2;

    let lastTy = height / 2;

    const partnerMode = Boolean(getPointer);

    const headEase = partnerMode ? 6.5 : 10;

    const followStiff = partnerMode ? 5.2 : 4;

    const spacingK = 1.42;



    const run = (now) => {

      raf = requestAnimationFrame(run);

      const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);

      lastT = now;



      const target = getPointer ? getPointer() : pointer;

      const tvx = (target.x - lastTx) / dt;

      const tvy = (target.y - lastTy) / dt;

      lastTx = target.x;

      lastTy = target.y;

      const speed = Math.min(1, Math.hypot(tvx, tvy) / 900);



      let e = elems[0];

      const ax = (Math.cos(3 * frm) * rad * width) / height;

      const ay = (Math.sin(4 * frm) * rad * height) / width;

      const glide = partnerMode

        ? {

            x: Math.sin(frm * 2.1) * (2 + speed * 5),

            y: Math.cos(frm * 1.7) * (1.5 + speed * 4),

          }

        : { x: 0, y: 0 };

      const headK = 1 - Math.exp(-dt * headEase);

      e.x += (ax + target.x + glide.x - e.x) * headK;

      e.y += (ay + target.y + glide.y - e.y) * headK;



      const segK = 1 - Math.exp(-dt * followStiff * 3.2);

      for (let i = 1; i < N; i++) {

        e = elems[i];

        const ep = elems[i - 1];

        const a = Math.atan2(e.y - ep.y, e.x - ep.x);

        const s = ((162 + 4 * (1 - i)) / 50) * sizeScale;

        const linkLen = Math.max(

          2.4,

          ((100 - i) / 5) * sizeScale * spacingK + s * 2.4

        );

        const dist = Math.hypot(e.x - ep.x, e.y - ep.y) || 0.001;

        const stretch = Math.max(0, dist - linkLen * 1.35);

        const pull = stretch > 0 ? Math.min(1, stretch / (linkLen * 0.85)) * segK * 0.55 : 0;

        e.x += (ep.x - e.x + Math.cos(a) * linkLen) * segK + Math.cos(a) * stretch * pull;

        e.y += (ep.y - e.y + Math.sin(a) * linkLen) * segK + Math.sin(a) * stretch * pull;

        e.use.setAttributeNS(

          null,

          "transform",

          `translate(${(ep.x + e.x) / 2},${(ep.y + e.y) / 2}) rotate(${(180 / Math.PI) * a}) translate(0,0) scale(${s},${s})`

        );

      }



      if (hybridCentipede && legsCtx) {

        drawHybridLegs(legsCtx, elems, sizeScale, frm, width, height);

      }



      if (!getPointer) {

        if (rad < radm) rad++;

        frm += 0.003;

        if (rad > 60) {

          pointer.x += (width / 2 - pointer.x) * 0.05;

          pointer.y += (height / 2 - pointer.y) * 0.05;

        }

      } else {

        frm += 0.003 + speed * 0.004;

      }

    };



    requestAnimationFrame(run);



    return {

      destroy() {

        cancelAnimationFrame(raf);

        if (!getPointer) window.removeEventListener("pointermove", onMove, false);

        window.removeEventListener("resize", resize, false);

        while (screen.firstChild) screen.removeChild(screen.firstChild);

        if (legsCtx) legsCtx.clearRect(0, 0, legsCanvas.width, legsCanvas.height);

      },

    };

  }



  global.initDragonCursor = initDragonCursor;

})(typeof window !== "undefined" ? window : global);

