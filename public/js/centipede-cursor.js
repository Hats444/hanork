/**
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

    const lineWidth = (opts && opts.lineWidth) || 2;
    const legSpan = (opts && opts.legSpan) || 1;
    const hybridDragon = Boolean(opts && opts.hybridDragon);
    const boundsEl = (opts && opts.boundsEl) || null;

    function paintStyle() {
      ctx.strokeStyle = hybridDragon
        ? 'rgba(235, 242, 255, 0.92)'
        : 'rgba(220, 228, 240, 0.85)';
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = hybridDragon ? 'rgba(110, 123, 247, 0.25)' : 'transparent';
      ctx.shadowBlur = hybridDragon ? 6 : 0;
    }

    function measure() {
      if (boundsEl) {
        return { w: boundsEl.clientWidth, h: boundsEl.clientHeight };
      }
      return { w: window.innerWidth, h: window.innerHeight };
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const m = measure();
      canvas.width = Math.floor(m.w * dpr);
      canvas.height = Math.floor(m.h * dpr);
      canvas.style.width = m.w + 'px';
      canvas.style.height = m.h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintStyle();
    }

    var segmentCount = 0;
  class Segment {
    constructor(parent, size, angle, range, stiffness) {
      segmentCount++;
      this.isSegment = true;
      this.parent = parent; //Segment which this one is connected to
      if (typeof parent.children == "object") {
        parent.children.push(this);
      }
      this.children = []; //Segments connected to this segment
      this.size = size; //Distance from parent
      this.relAngle = angle; //Angle relative to parent
      this.defAngle = angle; //Default angle relative to parent
      this.absAngle = parent.absAngle + angle; //Angle relative to x-axis
      this.range = range; //Difference between maximum and minimum angles
      this.stiffness = stiffness; //How closely it conforms to default angle
      this.updateRelative(false, true);
    }
    updateRelative(iter, flex) {
      this.relAngle =
        this.relAngle -
        2 *
          Math.PI *
          Math.floor((this.relAngle - this.defAngle) / 2 / Math.PI + 1 / 2);
      if (flex) {
        //		this.relAngle=this.range/
        //				(1+Math.exp(-4*(this.relAngle-this.defAngle)/
        //				(this.stiffness*this.range)))
        //			  -this.range/2+this.defAngle;
        this.relAngle = Math.min(
          this.defAngle + this.range / 2,
          Math.max(
            this.defAngle - this.range / 2,
            (this.relAngle - this.defAngle) / this.stiffness + this.defAngle
          )
        );
      }
      this.absAngle = this.parent.absAngle + this.relAngle;
      this.x = this.parent.x + Math.cos(this.absAngle) * this.size; //Position
      this.y = this.parent.y + Math.sin(this.absAngle) * this.size; //Position
      if (iter) {
        for (var i = 0; i < this.children.length; i++) {
          this.children[i].updateRelative(iter, flex);
        }
      }
    }
    draw(iter) {
      ctx.beginPath();
      ctx.moveTo(this.parent.x, this.parent.y);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
      if (iter) {
        for (var i = 0; i < this.children.length; i++) {
          this.children[i].draw(true);
        }
      }
    }
    follow(iter) {
      var x = this.parent.x;
      var y = this.parent.y;
      var dist = ((this.x - x) ** 2 + (this.y - y) ** 2) ** 0.5;
      this.x = x + this.size * (this.x - x) / dist;
      this.y = y + this.size * (this.y - y) / dist;
      this.absAngle = Math.atan2(this.y - y, this.x - x);
      this.relAngle = this.absAngle - this.parent.absAngle;
      this.updateRelative(false, true);
      //this.draw();
      if (iter) {
        for (var i = 0; i < this.children.length; i++) {
          this.children[i].follow(true);
        }
      }
    }
  }
  class LimbSystem {
    constructor(end, length, speed, creature) {
      this.end = end;
      this.length = Math.max(1, length);
      this.creature = creature;
      this.speed = speed;
      creature.systems.push(this);
      this.nodes = [];
      var node = end;
      for (var i = 0; i < length; i++) {
        this.nodes.unshift(node);
        //node.stiffness=1;
        node = node.parent;
        if (!node.isSegment) {
          this.length = i + 1;
          break;
        }
      }
      this.hip = this.nodes[0].parent;
    }
    moveTo(x, y) {
      this.nodes[0].updateRelative(true, true);
      var dist = ((x - this.end.x) ** 2 + (y - this.end.y) ** 2) ** 0.5;
      var len = Math.max(0, dist - this.speed);
      for (var i = this.nodes.length - 1; i >= 0; i--) {
        var node = this.nodes[i];
        var ang = Math.atan2(node.y - y, node.x - x);
        node.x = x + len * Math.cos(ang);
        node.y = y + len * Math.sin(ang);
        x = node.x;
        y = node.y;
        len = node.size;
      }
      for (var i = 0; i < this.nodes.length; i++) {
        var node = this.nodes[i];
        node.absAngle = Math.atan2(
          node.y - node.parent.y,
          node.x - node.parent.x
        );
        node.relAngle = node.absAngle - node.parent.absAngle;
        for (var ii = 0; ii < node.children.length; ii++) {
          var childNode = node.children[ii];
          if (!this.nodes.includes(childNode)) {
            childNode.updateRelative(true, false);
          }
        }
      }
      //this.nodes[0].updateRelative(true,false)
    }
    update() {
      this.moveTo(Input.mouse.x, Input.mouse.y);
    }
  }
  class LegSystem extends LimbSystem {
    constructor(end, length, speed, creature) {
      super(end, length, speed, creature);
      this.goalX = end.x;
      this.goalY = end.y;
      this.step = 0; //0 stand still, 1 move forward,2 move towards foothold
      this.forwardness = 0;
  
      //For foot goal placement
      this.reach =
        0.9 *
        ((this.end.x - this.hip.x) ** 2 + (this.end.y - this.hip.y) ** 2) ** 0.5;
      var relAngle =
        this.creature.absAngle -
        Math.atan2(this.end.y - this.hip.y, this.end.x - this.hip.x);
      relAngle -= 2 * Math.PI * Math.floor(relAngle / 2 / Math.PI + 1 / 2);
      this.swing = -relAngle + (2 * (relAngle < 0) - 1) * Math.PI / 2;
      this.swingOffset = this.creature.absAngle - this.hip.absAngle;
      //this.swing*=(2*(relAngle>0)-1);
    }
    update(x, y) {
      this.moveTo(this.goalX, this.goalY);
      //this.nodes[0].follow(true,true)
      if (this.step == 0) {
        var dist =
          ((this.end.x - this.goalX) ** 2 + (this.end.y - this.goalY) ** 2) **
          0.5;
        if (dist > 1) {
          this.step = 1;
          //this.goalX=x;
          //this.goalY=y;
          this.goalX =
            this.hip.x +
            this.reach *
              Math.cos(this.swing + this.hip.absAngle + this.swingOffset) +
            (2 * Math.random() - 1) * this.reach / 2;
          this.goalY =
            this.hip.y +
            this.reach *
              Math.sin(this.swing + this.hip.absAngle + this.swingOffset) +
            (2 * Math.random() - 1) * this.reach / 2;
        }
      } else if (this.step == 1) {
        var theta =
          Math.atan2(this.end.y - this.hip.y, this.end.x - this.hip.x) -
          this.hip.absAngle;
        var dist =
          ((this.end.x - this.hip.x) ** 2 + (this.end.y - this.hip.y) ** 2) **
          0.5;
        var forwardness2 = dist * Math.cos(theta);
        var dF = this.forwardness - forwardness2;
        this.forwardness = forwardness2;
        if (dF * dF < 1) {
          this.step = 0;
          this.goalX = this.hip.x + (this.end.x - this.hip.x);
          this.goalY = this.hip.y + (this.end.y - this.hip.y);
        }
      }
      //	ctx.strokeStyle='blue';
      //	ctx.beginPath();
      //	ctx.moveTo(this.end.x,this.end.y);
      //	ctx.lineTo(this.hip.x+this.reach*Math.cos(this.swing+this.hip.absAngle+this.swingOffset),
      //				this.hip.y+this.reach*Math.sin(this.swing+this.hip.absAngle+this.swingOffset));
      //	ctx.stroke();
      //	ctx.strokeStyle='black';
    }
  }
  class Creature {
    constructor(
      x,
      y,
      angle,
      fAccel,
      fFric,
      fRes,
      fThresh,
      rAccel,
      rFric,
      rRes,
      rThresh
    ) {
      this.x = x; //Starting position
      this.y = y;
      this.absAngle = angle; //Staring angle
      this.fSpeed = 0; //Forward speed
      this.fAccel = fAccel; //Force when moving forward
      this.fFric = fFric; //Friction against forward motion
      this.fRes = fRes; //Resistance to motion
      this.fThresh = fThresh; //minimum distance to target to keep moving forward
      this.rSpeed = 0; //Rotational speed
      this.rAccel = rAccel; //Force when rotating
      this.rFric = rFric; //Friction against rotation
      this.rRes = rRes; //Resistance to rotation
      this.rThresh = rThresh; //Maximum angle difference before rotation
      this.children = [];
      this.systems = [];
    }
    follow(x, y) {
      var dist = ((this.x - x) ** 2 + (this.y - y) ** 2) ** 0.5;
      var angle = Math.atan2(y - this.y, x - this.x);
      //Update forward
      var accel = this.fAccel;
      if (this.systems.length > 0) {
        var sum = 0;
        for (var i = 0; i < this.systems.length; i++) {
          sum += this.systems[i].step == 0;
        }
        accel *= sum / this.systems.length;
      }
      this.fSpeed += accel * (dist > this.fThresh);
      this.fSpeed *= 1 - this.fRes;
      this.speed = Math.max(0, this.fSpeed - this.fFric);
      //Update rotation
      var dif = this.absAngle - angle;
      dif -= 2 * Math.PI * Math.floor(dif / (2 * Math.PI) + 1 / 2);
      if (Math.abs(dif) > this.rThresh && dist > this.fThresh) {
        this.rSpeed -= this.rAccel * (2 * (dif > 0) - 1);
      }
      this.rSpeed *= 1 - this.rRes;
      if (Math.abs(this.rSpeed) > this.rFric) {
        this.rSpeed -= this.rFric * (2 * (this.rSpeed > 0) - 1);
      } else {
        this.rSpeed = 0;
      }
  
      //Update position
      this.absAngle += this.rSpeed;
      this.absAngle -=
        2 * Math.PI * Math.floor(this.absAngle / (2 * Math.PI) + 1 / 2);
      this.x += this.speed * Math.cos(this.absAngle);
      this.y += this.speed * Math.sin(this.absAngle);
      this.absAngle += Math.PI;
      for (var i = 0; i < this.children.length; i++) {
        this.children[i].follow(true, true);
      }
      for (var i = 0; i < this.systems.length; i++) {
        this.systems[i].update(x, y);
      }
      this.absAngle -= Math.PI;
      if (this.hybridDragon) {
        this.drawSpineWings(this.children[0], 0);
      }
      this.draw(true);
    }
    drawSpineWings(node, depth) {
      if (!node || !node.isSegment) return;
      var s = this.scale || 1;
      if (depth > 1 && depth % 6 === 0) {
        ctx.save();
        ctx.translate(node.x, node.y);
        ctx.rotate(node.absAngle);
        for (var side = -1; side <= 1; side += 2) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(s * 7 * side, -s * 12, s * 15 * side, -s * 5);
          ctx.quadraticCurveTo(s * 9 * side, -s * 3, s * 3 * side, 0);
          ctx.stroke();
        }
        ctx.restore();
      }
      var next = node.children[0];
      if (next && next.isSegment) {
        this.drawSpineWings(next, depth + 1);
      }
    }
    draw(iter) {
      var s = this.scale || 1;
      var r = s * 8.6;
      var a = this.absAngle;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(a);

      // Pescoço curto — liga cabeça ao 1º segmento do tronco
      if (this.children.length > 0) {
        var neck = this.children[0];
        var dx = neck.x - this.x;
        var dy = neck.y - this.y;
        var lx = dx * Math.cos(-a) - dy * Math.sin(-a);
        var ly = dx * Math.sin(-a) + dy * Math.cos(-a);
        ctx.beginPath();
        ctx.moveTo(-r * 0.38, 0);
        ctx.lineTo(lx, ly);
        ctx.stroke();
      }

      // Crânio compacto (um pouco maior que o diâmetro do tronco ~s*4)
      ctx.beginPath();
      ctx.moveTo(r * 0.95, 0);
      ctx.quadraticCurveTo(r * 0.78, -r * 0.38, r * 0.42, -r * 0.52);
      ctx.quadraticCurveTo(r * 0.05, -r * 0.58, -r * 0.28, -r * 0.42);
      ctx.quadraticCurveTo(-r * 0.62, -r * 0.18, -r * 0.68, 0);
      ctx.quadraticCurveTo(-r * 0.62, r * 0.18, -r * 0.28, r * 0.42);
      ctx.quadraticCurveTo(r * 0.05, r * 0.58, r * 0.42, r * 0.52);
      ctx.quadraticCurveTo(r * 0.78, r * 0.38, r * 0.95, 0);
      ctx.closePath();
      ctx.stroke();

      // Chifres — maiores no híbrido dragão
      ctx.beginPath();
      if (this.hybridDragon) {
        ctx.moveTo(-r * 0.12, -r * 0.45);
        ctx.quadraticCurveTo(-r * 0.55, -r * 0.95, -r * 0.88, -r * 0.72);
        ctx.moveTo(-r * 0.12, r * 0.45);
        ctx.quadraticCurveTo(-r * 0.55, r * 0.95, -r * 0.88, r * 0.72);
        ctx.moveTo(r * 0.35, -r * 0.35);
        ctx.lineTo(r * 0.72, -r * 0.55);
        ctx.moveTo(r * 0.35, r * 0.35);
        ctx.lineTo(r * 0.72, r * 0.55);
      } else {
        ctx.moveTo(-r * 0.18, -r * 0.42);
        ctx.quadraticCurveTo(-r * 0.48, -r * 0.72, -r * 0.72, -r * 0.58);
        ctx.moveTo(-r * 0.18, r * 0.42);
        ctx.quadraticCurveTo(-r * 0.48, r * 0.72, -r * 0.72, r * 0.58);
      }
      ctx.stroke();

      // Órbitas
      ctx.beginPath();
      ctx.arc(r * 0.22, -r * 0.18, r * 0.12, 0, Math.PI * 2);
      ctx.arc(r * 0.22, r * 0.18, r * 0.12, 0, Math.PI * 2);
      ctx.stroke();

      // Focinho e mandíbulas
      ctx.beginPath();
      ctx.moveTo(r * 0.52, -r * 0.28);
      ctx.lineTo(r * 0.98, -r * 0.04);
      ctx.lineTo(r * 0.98, r * 0.04);
      ctx.lineTo(r * 0.52, r * 0.28);
      ctx.stroke();
      var t;
      for (t = 0; t < 4; t++) {
        var tx = r * 0.62 + t * r * 0.08;
        ctx.beginPath();
        ctx.moveTo(tx, -r * 0.08);
        ctx.lineTo(tx + r * 0.09, 0);
        ctx.moveTo(tx, r * 0.08);
        ctx.lineTo(tx + r * 0.09, 0);
        ctx.stroke();
      }

      // Placas do crânio (detalhe)
      ctx.beginPath();
      ctx.moveTo(-r * 0.08, -r * 0.28);
      ctx.lineTo(r * 0.12, -r * 0.22);
      ctx.moveTo(-r * 0.08, r * 0.28);
      ctx.lineTo(r * 0.12, r * 0.22);
      ctx.stroke();

      ctx.restore();
      if (iter) {
        for (var i = 0; i < this.children.length; i++) {
          this.children[i].draw(true);
        }
      }
    }
  }
  

    function buildLizard(size, legs, tail, spanMult) {
    var s = size;
    var legM = spanMult || 1;
    //(x,y,angle,fAccel,fFric,fRes,fThresh,rAccel,rFric,rRes,rThresh)
    var creature = new Creature(
      window.innerWidth / 2,
      window.innerHeight / 2,
      0,
      s * 10,
      s * 2,
      0.5,
      16,
      0.5,
      0.085,
      0.5,
      0.3
    );
    creature.scale = s;
    var spinal = creature;
    //(parent,size,angle,range,stiffness)
    // Pescoço curto — cabeça colada ao tronco
    var neckSegs = 3;
    var neckLen = s * 2.15;
    for (var i = 0; i < neckSegs; i++) {
      spinal = new Segment(spinal, neckLen, 0, 2.2, 1.2);
      if (i < 2) {
        for (var ii = -1; ii <= 1; ii += 2) {
          var node = new Segment(spinal, s * 1.85, ii * 1.571, 0.12, 2);
          node = new Segment(node, s * 0.08, -ii * 0.08, 0.1, 2);
        }
      }
    }
    //Torso and legs
    for (var i = 0; i < legs; i++) {
      if (i > 0) {
        //Vertebrae and ribs
        for (var ii = 0; ii < 6; ii++) {
          spinal = new Segment(spinal, s * 4, 0, 1.571, 1.5);
          for (var iii = -1; iii <= 1; iii += 2) {
            var node = new Segment(spinal, s * 3, iii * 1.571, 0.1, 1.5);
            for (var iv = 0; iv < 3; iv++) {
              node = new Segment(node, s * 3, -iii * 0.3, 0.1, 2);
            }
          }
        }
      }
      //Legs and shoulders
      for (var ii = -1; ii <= 1; ii += 2) {
        var node = new Segment(spinal, s * 12 * legM, ii * 0.785, 0, 8); //Hip
        node = new Segment(node, s * 16 * legM, -ii * 0.785, 6.28, 1); //Humerus
        node = new Segment(node, s * 16 * legM, ii * 1.571, 3.1415, 2); //Forearm
        for (
          var iii = 0;
          iii < 4;
          iii++ //fingers
        ) {
          new Segment(node, s * 4 * legM, (iii / 3 - 0.5) * 1.571, 0.1, 4);
        }
        new LegSystem(node, 3, s * 12 * legM, creature);
      }
    }
    //Tail
    for (var i = 0; i < tail; i++) {
      spinal = new Segment(spinal, s * 4, 0, 3.1415 * 2 / 3, 1.1);
      for (var ii = -1; ii <= 1; ii += 2) {
        var node = new Segment(spinal, s * 3, ii, 0.1, 2);
        for (var iii = 0; iii < 3; iii++) {
          node = new Segment(node, s * 3 * (tail - i) / tail, -ii * 0.1, 0.1, 2);
        }
      }
    }
    return creature;
  }


    const creatureScale = opts && opts.scale != null ? opts.scale : (8 / Math.sqrt(7));

    let lizard;
    try {
      lizard = buildLizard(creatureScale, 7, 18, legSpan);
      lizard.hybridDragon = hybridDragon;
      if (hybridDragon) {
        canvas.classList.add('mutant-centipede-dragon');
      }
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
