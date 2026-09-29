const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../produtos/centopeia_preview/centopeia/script.js'),
  'utf8'
);
const start = src.indexOf('var segmentCount');
const end = src.indexOf('//Initializes and animates');
let classes = src.slice(start, end);

const headDraw = `draw(iter) {
      var r = (this.scale || 1) * 7;
      var a = this.absAngle;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(a);

      // Crânio esquelético (só traço — combina com o corpo)
      ctx.beginPath();
      ctx.moveTo(r * 1.05, 0);
      ctx.lineTo(r * 0.72, -r * 0.22);
      ctx.lineTo(r * 0.38, -r * 0.58);
      ctx.lineTo(-r * 0.12, -r * 0.52);
      ctx.lineTo(-r * 0.48, -r * 0.28);
      ctx.lineTo(-r * 0.58, 0);
      ctx.lineTo(-r * 0.48, r * 0.28);
      ctx.lineTo(-r * 0.12, r * 0.52);
      ctx.lineTo(r * 0.38, r * 0.58);
      ctx.lineTo(r * 0.62, r * 0.38);
      ctx.lineTo(r * 0.78, r * 0.12);
      ctx.closePath();
      ctx.stroke();

      // Chifres curvos (medieval / demônio esqueleto)
      ctx.beginPath();
      ctx.moveTo(r * 0.2, -r * 0.48);
      ctx.bezierCurveTo(-r * 0.15, -r * 0.95, -r * 0.55, -r * 1.15, -r * 0.82, -r * 0.88);
      ctx.moveTo(r * 0.05, -r * 0.52);
      ctx.bezierCurveTo(-r * 0.25, -r * 0.78, -r * 0.62, -r * 0.82, -r * 0.75, -r * 0.62);
      ctx.moveTo(r * 0.2, r * 0.48);
      ctx.bezierCurveTo(-r * 0.15, r * 0.95, -r * 0.55, r * 1.15, -r * 0.82, r * 0.88);
      ctx.moveTo(r * 0.05, r * 0.52);
      ctx.bezierCurveTo(-r * 0.25, r * 0.78, -r * 0.62, r * 0.82, -r * 0.75, r * 0.62);
      ctx.stroke();

      // Órbitas oculares vazias
      ctx.beginPath();
      ctx.arc(r * 0.28, -r * 0.2, r * 0.14, 0, Math.PI * 2);
      ctx.arc(r * 0.28, r * 0.2, r * 0.14, 0, Math.PI * 2);
      ctx.stroke();

      // Nariz / osso nasal
      ctx.beginPath();
      ctx.moveTo(r * 0.88, 0);
      ctx.lineTo(r * 0.62, -r * 0.12);
      ctx.moveTo(r * 0.88, 0);
      ctx.lineTo(r * 0.62, r * 0.12);
      ctx.stroke();

      // Mandíbula e dentes em V
      ctx.beginPath();
      ctx.moveTo(r * 0.55, -r * 0.32);
      ctx.lineTo(r * 0.92, -r * 0.06);
      ctx.lineTo(r * 0.92, r * 0.06);
      ctx.lineTo(r * 0.55, r * 0.32);
      ctx.stroke();
      var t;
      for (t = 0; t < 5; t++) {
        var tx = r * 0.58 + t * r * 0.09;
        ctx.beginPath();
        ctx.moveTo(tx, -r * 0.1);
        ctx.lineTo(tx + r * 0.1, 0);
        ctx.moveTo(tx, r * 0.1);
        ctx.lineTo(tx + r * 0.1, 0);
        ctx.stroke();
      }

      // Costelas do crânio (detalhe ósseo)
      ctx.beginPath();
      ctx.moveTo(-r * 0.05, -r * 0.35);
      ctx.lineTo(r * 0.18, -r * 0.28);
      ctx.moveTo(-r * 0.05, r * 0.35);
      ctx.lineTo(r * 0.18, r * 0.28);
      ctx.moveTo(-r * 0.22, 0);
      ctx.lineTo(r * 0.05, 0);
      ctx.stroke();

      ctx.restore();
      if (iter) {
        for (var i = 0; i < this.children.length; i++) {
          this.children[i].draw(true);
        }
      }
    }`;

classes = classes.replace(
  /draw\(iter\) \{\s*var r = 4;[\s\S]*?if \(iter\) \{\s*for \(var i = 0; i < this\.children\.length; i\+\+\) \{\s*this\.children\[i\]\.draw\(true\);\s*\}\s*\}\s*\}/,
  headDraw
);
const lizardStart = src.indexOf('function setupLizard');
const lizardEnd = src.indexOf('    setInterval(function()', lizardStart);
let setup = src.slice(lizardStart, lizardEnd);
setup = setup
  .replace(/function setupLizard/g, 'function buildLizard')
  .replace(/critter = new Creature/g, 'var creature = new Creature')
  .replace(/var spinal = critter/g, 'var spinal = creature')
  .replace(/new LegSystem\(node, 3, s \* 12, critter, 4\)/g, 'new LegSystem(node, 3, s * 12, creature)')
  .replace('var spinal = creature;', 'creature.scale = s;\n    var spinal = creature;');
setup += '    return creature;\n  }\n';

const out = `/**
 * Centopeia — cursor parceiro do dragão (produto centopeia_preview)
 */
(function (global) {
  'use strict';

  function initCentipedeCursor(opts) {
    const canvas = opts && opts.canvasEl;
    if (!canvas) return null;
    const getPointer = opts.getPointer || function () {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    };

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    function paintStyle() {
      ctx.strokeStyle = '#e9d5ff';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(168, 85, 247, 0.65)';
      ctx.shadowBlur = 8;
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintStyle();
    }

    ${classes}

    ${setup}

    const creatureScale = opts && opts.scale != null ? opts.scale : (8 / Math.sqrt(7));

    let lizard;
    try {
      lizard = buildLizard(creatureScale, 7, 18);
    } catch (err) {
      console.error('[centipede-cursor] build failed', err);
      return null;
    }

    window.addEventListener('resize', resize, false);
    resize();

    let raf = 0;
    function tick() {
      raf = requestAnimationFrame(tick);
      const p = getPointer();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      paintStyle();
      lizard.follow(p.x, p.y);
    }
    tick();

    return {
      destroy: function () {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize, false);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
    };
  }

  global.initCentipedeCursor = initCentipedeCursor;
})(typeof window !== 'undefined' ? window : global);
`;

const dest = path.join(__dirname, '../public/js/centipede-cursor.js');
fs.writeFileSync(dest, out);
console.log('OK', dest, out.length, 'bytes');
