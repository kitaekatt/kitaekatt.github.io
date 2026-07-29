/* MONKEY BAITING — render.js
   Native-resolution vector renderer (the 400x225 pixel buffer is retired).
   Everything is drawn every frame from current state (project rendering
   policy: one rAF loop, no manual redraws).

   Pipeline: logic keeps its 400x225 LOGICAL coordinate space; the display
   canvas backing store is css-size x devicePixelRatio, and each frame draws
   under a single scale transform (letterboxed). Shapes and text therefore
   rasterize as crisp vectors at native resolution — text readability is the
   acceptance criterion; the look is modern cartoony period illustration.
   Static stage layers are cached to offscreen canvases per (wear, scale). */
(function (g) {
  'use strict';

  var R = {
    canvas: null, ctx: null,
    W: 400, H: 225, data: null, dpr: 1,
    view: { s: 1, dx: 0, dy: 0 },
    particles: [],
    stageCache: {},          // key: wear|scale -> offscreen canvas
    t: 0                     // render frame counter (visual timing only)
  };

  var INK = '#1a1512';
  var CREAM = '#e8ddc0';
  var CHALK = '#e9e6da';
  var SLATE = '#23211c';
  var GOLD = '#C9A227';
  var BLOOD = '#7e1512';

  function srand(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  R.init = function (canvas, data) {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d');
    R.data = data;
    R.W = data.tuning.internal_width;
    R.H = data.tuning.internal_height;
  };

  R.resize = function (w, h) {
    R.dpr = (g.devicePixelRatio || 1);
    R.canvas.width = Math.max(1, Math.round(w * R.dpr));
    R.canvas.height = Math.max(1, Math.round(h * R.dpr));
    if (R.canvas.style) {
      R.canvas.style.width = w + 'px';
      R.canvas.style.height = h + 'px';
    }
    R.stageCache = {};
  };

  // ---- text helpers (drawn under the world transform: native-res glyphs) ----

  function font(px, style) {
    return (style || '') + ' ' + px + 'px Georgia, "Times New Roman", serif';
  }
  function mono(px) { return px + 'px "Courier New", monospace'; }

  function text(b, str, x, y, f, color, align) {
    b.font = f; b.fillStyle = color; b.textAlign = align || 'left'; b.textBaseline = 'alphabetic';
    b.fillText(String(str), x, y);
  }

  function wrap(b, str, x, y, maxW, lineH, f, color, align) {
    b.font = f; b.fillStyle = color; b.textAlign = align || 'left'; b.textBaseline = 'alphabetic';
    var words = String(str).split(/\s+/), line = '', yy = y;
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (b.measureText(test).width > maxW && line) {
        b.fillText(line, x, yy); yy += lineH; line = words[i];
      } else line = test;
    }
    if (line) b.fillText(line, x, yy);
    return yy + lineH;
  }

  function wrapParas(b, textStr, x, y, maxW, lineH, f, color, align) {
    var paras = String(textStr).split('\n');
    var yy = y;
    for (var i = 0; i < paras.length; i++) {
      if (paras[i].trim() === '') { yy += lineH * 0.7; continue; }
      yy = wrap(b, paras[i], x, yy, maxW, lineH, f, color, align);
    }
    return yy;
  }

  // ---- small vector helpers -------------------------------------------------

  function rr(b, x, y, w, h, r) {
    b.beginPath();
    b.moveTo(x + r, y);
    b.arcTo(x + w, y, x + w, y + h, r);
    b.arcTo(x + w, y + h, x, y + h, r);
    b.arcTo(x, y + h, x, y, r);
    b.arcTo(x, y, x + w, y, r);
    b.closePath();
  }

  function dot(b, color, x, y, r) {
    b.beginPath(); b.arc(x, y, r, 0, Math.PI * 2);
    b.fillStyle = color; b.fill();
  }

  function shade(hex, mult) { return g.MB.Chars.shade(hex, mult); }

  // ---- particles (smooth, cartoony) ----------------------------------------

  R.spawn = function (kind, x, y, n, dir) {
    for (var i = 0; i < n; i++) {
      var p = { kind: kind, x: x, y: y, life: 30 + Math.random() * 30, t: 0 };
      if (kind === 'blood') {
        p.vx = (dir || 1) * (0.4 + Math.random() * 1.8); p.vy = -1.2 - Math.random() * 1.8;
        p.g = 0.14; p.color = Math.random() < 0.5 ? BLOOD : '#9E1B12'; p.size = 1.1 + Math.random() * 1.2;
      } else if (kind === 'dust') {
        p.vx = (Math.random() - 0.5) * 1.2; p.vy = -0.3 - Math.random() * 0.5;
        p.g = 0.015; p.color = 'rgba(154,138,99,0.7)'; p.size = 1.6 + Math.random() * 1.6; p.life = 22 + Math.random() * 16;
        p.grow = 0.06;
      } else if (kind === 'coin') {
        p.vx = (Math.random() - 0.5) * 2.4; p.vy = -1.6 - Math.random() * 2;
        p.g = 0.16; p.color = GOLD; p.size = 1.8; p.life = 55 + Math.random() * 40; p.spin = Math.random() * 6;
      } else if (kind === 'guinea_rain') {
        p.x = 40 + Math.random() * 320; p.y = -10 - Math.random() * 60;
        p.vx = (Math.random() - 0.5) * 0.4; p.vy = 1 + Math.random() * 1.6;
        p.g = 0.06; p.color = GOLD; p.size = 1.9; p.life = 150; p.kind = 'coin'; p.spin = Math.random() * 6;
      } else if (kind === 'spark') {
        p.vx = (Math.random() - 0.5) * 3; p.vy = (Math.random() - 0.5) * 3;
        p.g = 0; p.color = '#f5efd8'; p.size = 1.4; p.life = 11;
      }
      R.particles.push(p);
    }
  };

  function stepParticles(b, floorY) {
    for (var i = R.particles.length - 1; i >= 0; i--) {
      var p = R.particles[i];
      p.t++; p.x += p.vx; p.vy += p.g; p.y += p.vy;
      if (p.grow) p.size += p.grow;
      if (p.y > floorY + 18) {
        if (p.kind === 'coin') { p.vy = -Math.abs(p.vy) * 0.35; p.y = floorY + 18; }
        else { p.y = floorY + 18; p.vy = 0; p.vx *= 0.6; }
      }
      if (p.t > p.life) { R.particles.splice(i, 1); continue; }
      var a = Math.max(0.12, 1 - p.t / p.life);
      b.globalAlpha = a;
      if (p.kind === 'coin') {
        var sq = Math.abs(Math.sin((p.spin || 0) + p.t * 0.3));
        b.beginPath(); b.ellipse(p.x, p.y, p.size, p.size * (0.35 + 0.65 * sq), 0, 0, Math.PI * 2);
        b.fillStyle = p.color; b.fill();
        b.globalAlpha = a * 0.8;
        dot(b, '#ffe9a0', p.x - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.3);
      } else if (p.kind === 'blood') {
        b.beginPath();
        b.ellipse(p.x, p.y, p.size * 0.7, p.size, Math.atan2(p.vy, p.vx) + Math.PI / 2, 0, Math.PI * 2);
        b.fillStyle = p.color; b.fill();
      } else {
        dot(b, p.color, p.x, p.y, p.size);
      }
      b.globalAlpha = 1;
    }
  }

  // ---- stage ---------------------------------------------------------------

  var WEAR = [
    { dust: '#6b5c40', crowdGap: 13, stains: 2, gasHi: 1.0, lampOut: -1, bob: 1 },
    { dust: '#5d4e34', crowdGap: 8, stains: 6, gasHi: 1.0, lampOut: -1, bob: 1 },
    { dust: '#453823', crowdGap: 6, stains: 12, gasHi: 0.85, lampOut: -1, bob: 1.4 },
    { dust: '#57482f', crowdGap: 7, stains: 9, gasHi: 0.6, lampOut: 1, bob: 0.3 }
  ];

  function gasLevel(t, wear, gutter) {
    var base = WEAR[wear].gasHi;
    var fl = 0.85 + 0.15 * Math.sin(t * 0.045) * Math.sin(t * 0.011 + 2);
    var n = 0.94 + 0.06 * srand(Math.floor(t / 7));
    return Math.max(0.05, base * fl * n * (1 - (gutter || 0) * 0.85));
  }

  // static layers, cached per (wear, scale): background, grate, wall, floor
  function stageLayer(wear) {
    var s = R.view.s;
    var key = wear + '|' + Math.round(s * 50);
    if (R.stageCache[key]) return R.stageCache[key];
    var cv = g.document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(R.W * s));
    cv.height = Math.max(1, Math.ceil(R.H * s));
    var b = cv.getContext('2d');
    b.setTransform(s, 0, 0, s, 0, 0);
    var W = R.W, floorY = R.data.tuning.floor_y;
    var wearD = WEAR[wear];

    // cellar dark, warm gradient
    var bg = b.createLinearGradient(0, 0, 0, R.H);
    bg.addColorStop(0, '#0c0a09'); bg.addColorStop(0.55, '#171210'); bg.addColorStop(1, '#1d1712');
    b.fillStyle = bg; b.fillRect(0, 0, W, R.H);

    // the barred cellar grate; Parliament lit beyond it
    rr(b, 118, -8, 164, 36, 8);
    b.fillStyle = '#080606'; b.fill();
    b.fillStyle = '#c8b06a';
    for (var i = 0; i < 7; i++) {
      var wx = 132 + i * 20;
      b.globalAlpha = 0.5 + 0.3 * srand(i + 40);
      rr(b, wx, 4, 5, 8, 1.5); b.fill();
      rr(b, wx + 8, 7, 4, 5, 1.2); b.fill();
    }
    b.globalAlpha = 1;
    b.fillStyle = '#050404';
    for (i = 0; i < 9; i++) { rr(b, 122 + i * 18, -4, 5, 30, 2); b.fill(); }
    b.fillStyle = '#0a0807'; b.fillRect(114, 24, 172, 4);

    // gallery band (crowd drawn live over it)
    b.fillStyle = '#0d0b09'; b.fillRect(0, 26, W, 70);

    // plank wall, gentle vertical gradient
    var wallTop = 98, wallBot = floorY - 12;
    var wg = b.createLinearGradient(0, wallTop, 0, wallBot);
    wg.addColorStop(0, '#3d2f20'); wg.addColorStop(1, '#54402b');
    b.fillStyle = wg; b.fillRect(0, wallTop, W, wallBot - wallTop);
    for (i = 0; i < W; i += 22) {
      b.fillStyle = 'rgba(0,0,0,' + (0.12 + 0.12 * srand(i)) + ')';
      b.fillRect(i, wallTop, 2, wallBot - wallTop);
      if (srand(i * 3) > 0.72) { // a knot in the boards
        b.beginPath(); b.ellipse(i + 11, wallTop + 14 + srand(i * 7) * 46, 2.4, 3.2, 0.3, 0, Math.PI * 2);
        b.fillStyle = 'rgba(20,12,6,0.5)'; b.fill();
      }
    }
    b.fillStyle = 'rgba(0,0,0,0.45)'; b.fillRect(0, wallTop, W, 3);

    // sawdust floor
    var fg = b.createLinearGradient(0, wallBot, 0, R.H);
    fg.addColorStop(0, shade(wearD.dust, 1.06));
    fg.addColorStop(0.4, wearD.dust);
    fg.addColorStop(1, shade(wearD.dust, 0.62));
    b.fillStyle = fg; b.fillRect(0, wallBot, W, R.H - wallBot);
    for (i = 0; i < 24; i++) { // soft clumps
      b.beginPath();
      b.ellipse(srand(i) * W, wallBot + 6 + srand(i + 5) * 32, 7 + srand(i + 9) * 14, 2.2, 0, 0, Math.PI * 2);
      b.fillStyle = 'rgba(0,0,0,' + (0.05 + 0.08 * srand(i * 3)) + ')'; b.fill();
    }
    for (i = 0; i < wearD.stains; i++) { // the night's stains
      b.beginPath();
      b.ellipse(30 + srand(i + 20) * (W - 60), wallBot + 8 + srand(i + 21) * 24,
        5 + srand(i + 22) * 10, 2 + srand(i + 24) * 1.6, 0, 0, Math.PI * 2);
      b.fillStyle = 'rgba(88,20,12,' + (0.25 + 0.3 * srand(i + 60)) + ')'; b.fill();
    }
    if (wear === 3) { // fresh sawdust laid over old
      b.beginPath(); b.ellipse(200, floorY + 4, 150, 12, 0, 0, Math.PI * 2);
      b.fillStyle = 'rgba(154,138,99,0.22)'; b.fill();
    }

    R.stageCache[key] = cv;
    return cv;
  }

  function drawStage(b, wear, gas, excitement, props) {
    var W = R.W, floorY = R.data.tuning.floor_y;
    var wearD = WEAR[wear];

    // cached static layers
    var layer = stageLayer(wear);
    b.save();
    b.setTransform(1, 0, 0, 1, R.view.dx, R.view.dy);
    b.drawImage(layer, 0, 0);
    b.restore();

    // crowd: tiered black silhouettes — never a rendered face
    var gap = wearD.crowdGap;
    for (var row = 0; row < 2; row++) {
      var cy = 62 + row * 20;
      for (var cx = 4 + row * 4; cx < W - 4; cx += gap) {
        var sd = srand(cx * 7 + row * 131);
        if (wear === 3 && sd > 0.82) continue; // fight 4: the crowd has thinned
        var bob = Math.sin(R.t * 0.1 + cx) * excitement * wearD.bob;
        var hy = cy + sd * 6 + bob;
        b.fillStyle = row ? '#0a0806' : '#060504';
        rr(b, cx - 4, hy - 1, 9, 16, 3); b.fill();               // shoulders
        dot(b, b.fillStyle, cx, hy - 4, 3.2);                     // head
        if (sd < 0.35) { rr(b, cx - 2.6, hy - 13, 5.2, 8, 1); b.fill(); b.fillRect(cx - 4, hy - 6.4, 8, 1.6); } // beaver hat
        else if (sd < 0.6) { rr(b, cx - 3.4, hy - 8.4, 6.8, 3, 1.4); b.fill(); }                                // rough cap
      }
    }
    // the rail — bows under two hundred men
    var sag = 2 + excitement * 3.5;
    b.strokeStyle = '#33271a'; b.lineWidth = 3.4; b.lineCap = 'round';
    b.beginPath(); b.moveTo(0, 96); b.quadraticCurveTo(W / 2, 96 + sag, W, 96); b.stroke();
    b.strokeStyle = 'rgba(0,0,0,0.5)'; b.lineWidth = 1.2;
    b.beginPath(); b.moveTo(0, 97.6); b.quadraticCurveTo(W / 2, 97.6 + sag, W, 97.6); b.stroke();
    b.lineWidth = 1;

    // gaslight jets with soft glow
    for (var i = 0; i < 4; i++) {
      var gx = 50 + i * 100;
      var out = (i === wearD.lampOut);
      b.fillStyle = '#241c14'; rr(b, gx - 2.4, 108, 4.8, 11, 1.6); b.fill();
      if (!out) {
        var fh = 5 + gas * 5 + 2 * srand(R.t + i * 17);
        var glow = b.createRadialGradient(gx, 106, 2, gx, 106, 40);
        glow.addColorStop(0, 'rgba(255,214,130,' + (0.22 * gas) + ')');
        glow.addColorStop(1, 'rgba(255,214,130,0)');
        b.fillStyle = glow; b.fillRect(gx - 42, 64, 84, 84);
        b.beginPath(); // teardrop flame
        b.moveTo(gx, 108 - fh);
        b.quadraticCurveTo(gx + 2.6, 108 - fh * 0.4, gx, 108.5);
        b.quadraticCurveTo(gx - 2.6, 108 - fh * 0.4, gx, 108 - fh);
        b.fillStyle = '#f0c96e'; b.fill();
        b.beginPath();
        b.moveTo(gx, 108 - fh * 0.55);
        b.quadraticCurveTo(gx + 1.2, 108 - fh * 0.2, gx, 108.4);
        b.quadraticCurveTo(gx - 1.2, 108 - fh * 0.2, gx, 108 - fh * 0.55);
        b.fillStyle = '#fdf3cf'; b.fill();
      }
    }

    // props
    if (props && props.barrel) drawBarrel(b, props.barrel.x, floorY, props.barrel.lid);

    // the iron stake, dead centre
    var cx0 = R.data.tuning.ring.center;
    b.fillStyle = '#3a3d40'; rr(b, cx0 - 2, floorY - 9, 4, 10, 1.4); b.fill();
    b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
    b.fillStyle = '#4A4E52'; rr(b, cx0 - 3.4, floorY - 10.4, 6.8, 3, 1.2); b.fill();
  }

  function drawBarrel(b, x, floorY, lidClosed) {
    b.beginPath();
    b.moveTo(x - 12, floorY - 26);
    b.quadraticCurveTo(x - 15, floorY - 13, x - 12, floorY);
    b.lineTo(x + 12, floorY);
    b.quadraticCurveTo(x + 15, floorY - 13, x + 12, floorY - 26);
    b.closePath();
    b.fillStyle = '#5d4a33'; b.fill();
    b.lineWidth = 1.6; b.strokeStyle = INK; b.stroke();
    b.strokeStyle = '#2e2418'; b.lineWidth = 2.2;
    b.beginPath(); b.moveTo(x - 13.6, floorY - 19); b.lineTo(x + 13.6, floorY - 19); b.stroke();
    b.beginPath(); b.moveTo(x - 13.8, floorY - 8); b.lineTo(x + 13.8, floorY - 8); b.stroke();
    if (lidClosed) {
      b.beginPath(); b.ellipse(x, floorY - 27, 14, 3, 0, 0, Math.PI * 2);
      b.fillStyle = '#4a3826'; b.fill(); b.lineWidth = 1.4; b.strokeStyle = INK; b.stroke();
    } else {
      b.beginPath(); b.ellipse(x, floorY - 26, 12, 2.6, 0, 0, Math.PI * 2);
      b.fillStyle = '#241a10'; b.fill(); b.lineWidth = 1.2; b.strokeStyle = INK; b.stroke();
    }
  }

  // ---- chain (a physical object every frame, never slack) -------------------

  function drawChain(b, x0, y0, x1, y1, sagAmt, rattle) {
    var links = 24;
    var ang = Math.atan2(y1 - y0, x1 - x0);
    for (var i = 0; i <= links; i++) {
      var t = i / links;
      var x = x0 + (x1 - x0) * t;
      var y = y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * sagAmt;
      if (rattle) y += (srand(i + R.t) - 0.5) * 1.4;
      b.beginPath();
      b.ellipse(x, y, 1.7, 1.05, ang + (i % 2 ? 0 : Math.PI / 2), 0, Math.PI * 2);
      b.fillStyle = i % 2 ? '#565b60' : '#41454a';
      b.fill();
      b.lineWidth = 0.7; b.strokeStyle = INK; b.stroke();
    }
    b.lineWidth = 1;
  }

  // ---- fighters -------------------------------------------------------------

  function specOf(f) {
    var pose = 'idle', phase = null, p = 0;
    switch (f.state) {
      case 'walk': pose = 'walk'; break;
      case 'jump': pose = 'jump'; break;
      case 'block': pose = 'block'; break;
      case 'stun': pose = f.blockStun ? 'block' : 'hit'; break;
      case 'grabbed': pose = 'hit'; break;
      case 'dazed': pose = 'dazed'; break;
      case 'ko': pose = 'hit'; break;
      case 'down': case 'finish_victim': pose = 'down'; break;
      case 'grab_hold': pose = 'grab_hold'; break;
      case 'finish': pose = 'special'; phase = 'act'; p = 0.4; break;
      case 'attack': {
        pose = f.moveKey === 'stakes_down' ? 'special' : (f.moveKey || 'idle');
        var m = f.move;
        if (m) {
          var su = m.startup_frames, act = m.active_frames;
          if (f.t < su) { phase = 'wind'; p = f.t / Math.max(1, su); }
          else if (f.t < su + act) { phase = 'act'; p = (f.t - su) / Math.max(1, act); }
          else { phase = 'rec'; p = (f.t - su - act) / Math.max(1, m.recovery_frames); }
        }
        break;
      }
    }
    return { pose: pose, phase: phase, p: p, t: f.t, rt: R.t, ripple: f.ripple, airborne: f.y > 0.01 };
  }

  R.drawFighter = function (b, f, floorY) {
    var Chars = g.MB.Chars;
    var w = Chars.WIDTHS[f.id], h = Chars.HEIGHTS[f.id];
    // soft shadow
    b.beginPath();
    b.ellipse(f.x, floorY + 2, w * 0.42, 2.6, 0, 0, Math.PI * 2);
    b.fillStyle = 'rgba(0,0,0,0.35)'; b.fill();

    b.save();
    b.translate(f.x, floorY - f.y);
    b.scale(f.facing, 1);
    Chars.draw(b, f.id, specOf(f), f.def.palette);
    b.restore();

    // fresh-hit flash: an expanding impact ring
    if (f.state === 'stun' && f.t < 5 && !f.blockStun) {
      b.beginPath();
      b.arc(f.x, floorY - f.y - h * 0.55, 4 + f.t * 3, 0, Math.PI * 2);
      b.strokeStyle = 'rgba(245,239,216,' + (0.7 - f.t * 0.13) + ')';
      b.lineWidth = Math.max(0.6, 2.2 - f.t * 0.3);
      b.stroke();
      b.lineWidth = 1;
    }
  };

  // ---- HUD: chalk betting slates, guineas, the watch, the chain meter -------

  function odds(pct, lying) {
    if (lying) pct = 1 - pct;
    if (pct > 0.75) return '2/1 ON';
    if (pct > 0.5) return 'EVENS';
    if (pct > 0.25) return '3/1 AGST';
    return '5/1 AGST';
  }

  function drawSlate(b, x, w, name, hpPct, rounds, alignRight, flipped) {
    b.save();
    b.translate(x + w / 2, 20);
    b.rotate(alignRight ? 0.012 : -0.012);
    b.translate(-(x + w / 2), -20);
    rr(b, x, 7, w, 30, 3);
    b.fillStyle = SLATE; b.fill();
    b.lineWidth = 1.4; b.strokeStyle = '#3f3a30'; b.stroke();
    if (flipped) { // THE CROSS: the slate turned face-in
      rr(b, x + 2, 9, w - 4, 26, 2); b.fillStyle = '#1b1915'; b.fill();
      text(b, 'X', x + w / 2, 28, font(14, 'bold'), '#57524a', 'center');
      b.restore();
      return;
    }
    text(b, name, x + 5, 17, font(8, 'bold'), CHALK);
    // chalk health bar — damage wipes chalk off
    var bw = w - 10;
    rr(b, x + 5, 20, bw, 6, 2); b.fillStyle = 'rgba(233,230,218,0.14)'; b.fill();
    var fw = Math.max(0, bw * hpPct);
    if (fw > 0.5) {
      b.save();
      rr(b, alignRight ? x + 5 + bw - fw : x + 5, 20, fw, 6, 2);
      b.clip();
      b.fillStyle = CHALK;
      b.fillRect(x + 4, 20, bw + 2, 6);
      b.globalAlpha = 0.25; // chalk grain
      for (var i = 0; i < bw; i += 3) {
        b.fillStyle = srand(i + x) > 0.5 ? '#fff' : '#b9b4a4';
        b.fillRect(x + 5 + i, 20 + srand(i * 3) * 4, 1.6, 2);
      }
      b.globalAlpha = 1;
      b.restore();
    }
    text(b, odds(hpPct), alignRight ? x + w - 5 : x + 5, 34.5, mono(7), '#c5c0b0', alignRight ? 'right' : 'left');
    // guineas stacked on the drum-head: round wins
    for (i = 0; i < rounds; i++) {
      var gx = alignRight ? x + 10 + i * 9 : x + w - 10 - i * 9;
      dot(b, GOLD, gx, 31.6, 3);
      b.lineWidth = 0.8; b.strokeStyle = INK; b.stroke();
      dot(b, '#ffe9a0', gx - 1, 30.7, 0.9);
    }
    b.restore();
  }

  function drawWatch(b, frac) {
    // a pocket watch held open by a disembodied gloved hand
    b.fillStyle = '#0e0c0a';
    rr(b, 191, -2, 18, 9, 3); b.fill();
    rr(b, 195, 5, 10, 7, 3); b.fill();
    dot(b, '#b8a96a', 200, 21, 11.5);
    b.lineWidth = 1.4; b.strokeStyle = INK; b.stroke();
    dot(b, '#efe8d2', 200, 21, 9.4);
    b.lineWidth = 1; b.strokeStyle = '#8f855e'; b.stroke();
    var ang = -Math.PI / 2 + (1 - frac) * Math.PI * 2;
    b.strokeStyle = INK; b.lineWidth = 1.6; b.lineCap = 'round';
    b.beginPath(); b.moveTo(200, 21);
    b.lineTo(200 + Math.cos(ang) * 7, 21 + Math.sin(ang) * 7); b.stroke();
    dot(b, INK, 200, 21, 1.2);
    b.lineWidth = 1;
  }

  function drawChainMeter(b, fill) {
    // the finisher meter is the chain: taut link by link as it fills
    var n = 12, x0 = 148, x1 = 252, y = 42;
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      var filled = t <= fill;
      var sag = filled ? 0 : Math.sin(Math.PI * t) * 4;
      b.beginPath();
      b.ellipse(x0 + (x1 - x0) * t, y + sag, 2.1, 1.3, i % 2 ? 0 : Math.PI / 2, 0, Math.PI * 2);
      b.fillStyle = filled ? '#9aa1a8' : '#43474b';
      b.fill();
      b.lineWidth = 0.7; b.strokeStyle = INK; b.stroke();
    }
    b.lineWidth = 1;
  }

  R.drawHUD = function (b, match) {
    var p = match.player, o = match.opp;
    var lying = !!match.cross; // the only time the HUD lies to the player
    var pName = lying ? o.def.name : p.def.name;
    var oName = lying ? p.def.name : o.def.name;
    var pPct = Math.max(0, (lying ? o.hp / o.def.max_health : p.hp / p.def.max_health));
    var oPct = Math.max(0, (lying ? p.hp / p.def.max_health : o.hp / o.def.max_health));
    drawSlate(b, 8, 130, pName, pPct, p.roundsWon, false, false);
    drawSlate(b, R.W - 138, 130, oName, oPct, o.roundsWon, true, lying);
    drawWatch(b, Math.max(0, match.timer / (match.st.rounds.time_seconds * match.tuning.logic_hz)));
    text(b, '' + Math.ceil(match.timer / match.tuning.logic_hz), 200, 40, mono(8), '#c5c0b0', 'center');
    var w = match.st.rounds.wins_to_take_match;
    if (p.roundsWon === w - 1) {
      var th = match.st.finisher.health_threshold;
      var fill = Math.min(1, (1 - o.hp / o.def.max_health) / (1 - th));
      drawChainMeter(b, fill);
    }
  };

  // ---- match scene ----------------------------------------------------------

  R.drawMatch = function (game) {
    var b = R.ctx, match = game.match;
    var floorY = R.data.tuning.floor_y;
    var wear = match.fight.stage_wear;
    var excitement = Math.min(1, 0.2 + (1 - Math.min(match.player.hp / match.player.def.max_health,
      match.opp.hp / match.opp.def.max_health)) * 0.9);
    if (wear === 3) excitement *= 0.25; // crowd gone half-silent
    var gutter = game.fx.gutter > 0 ? 1 : 0;
    var gas = gasLevel(R.t, wear, gutter);

    var props = {};
    var brockF = match.player.id === 'brock' ? match.player :
      match.opp.id === 'brock' ? match.opp : null;
    if (brockF) {
      var bx = brockF.side === 0 ? R.data.tuning.ring.left + 14 : R.data.tuning.ring.right - 14;
      props.barrel = { x: bx, lid: false };
    }
    if (match.phase === 'finisher' && match.opp.id === 'brock' && match.player.id === 'jacco') {
      var prog0 = 1 - match.phaseT / match.st.finisher.cinematic_frames;
      props.barrel = { x: R.data.tuning.ring.right - 14 - prog0 * 100, lid: prog0 > 0.7 };
    }
    drawStage(b, wear, gas, excitement, props);

    drawHazards(b, match, floorY);

    // the chain, every frame, never slack — wired from the fight's chain record
    var cf = match.chainedFighter;
    if (cf) {
      var collarY = floorY - cf.y - Math.min(14, cf.def.hurtbox.h * 0.7);
      var rattle = cf.state === 'jump' || cf.state === 'stun' || Math.abs(cf.vx) > 1;
      var taut = cf.state === 'attack' && cf.move && cf.move.type === 'grab';
      if (cf.tethered) {
        var stake = R.data.tuning.ring.center;
        drawChain(b, stake, floorY - 6, cf.x - cf.facing * 6, collarY,
          taut ? 0 : 3 + 2 * Math.sin(R.t * 0.05), rattle);
      } else if (match.chainHolder && match.chainHolder.state !== 'down') {
        var holder = match.chainHolder;
        var handY = floorY - holder.y - holder.def.hurtbox.h + 8;
        var yanking = holder.state === 'attack' && holder.move && holder.move.type === 'chain_yank';
        drawChain(b, holder.x - holder.facing * 10, handY, cf.x - cf.facing * 6, collarY,
          yanking || taut ? 0 : 5, rattle || yanking);
      }
    }

    R.drawFighter(b, match.opp, floorY);
    R.drawFighter(b, match.player, floorY);

    stepParticles(b, floorY - 14);

    // gas-level dark wash
    b.fillStyle = 'rgba(8,6,4,' + (0.45 * (1 - gas)) + ')';
    b.fillRect(-4, -4, R.W + 8, R.H + 8);

    R.drawHUD(b, match);

    if (match.phase === 'intro') {
      if (match.round === 1) {
        wrap(b, R.data.script.shared.prefight_ritual, R.W / 2, 150, 300, 10, font(8, 'italic'), '#c0b69c', 'center');
      }
      card(b, game.fx.roundText || '', 100);
    }
    if (game.fx.announce && game.fx.announce.t > 0) {
      card(b, game.fx.announce.text, 100);
    }
    if (match.finisherWindow) {
      var blink = Math.floor(R.t / 8) % 2 === 0;
      if (blink) card(b, game.fx.finisherPrompt, 96, '#d8492a');
    }
    if (match.phase === 'finisher') drawFinisherCinematic(b, game, match, floorY);
    if (match.cross) {
      text(b, 'THE ODDS HAVE TURNED', R.W / 2, 60, font(9, 'bold'), '#d8492a', 'center');
    }
  };

  function drawHazards(b, match, floorY) {
    for (var i = 0; i < match.hazards.length; i++) {
      var h = match.hazards[i];
      if (h.kind === 'rats') {
        // the sawdust boils — rats pour across the pit floor
        for (var r = 0; r < 26; r++) {
          var sp = 2 + srand(r) * 2.5;
          var rx = (h.t * sp + srand(r * 3) * R.W * 2) % (R.W + 30) - 15;
          var ry = floorY - 2 - srand(r * 7) * 9;
          var scurry = Math.sin(h.t * 0.5 + r) * 0.8;
          b.beginPath();
          b.ellipse(rx, ry + scurry * 0.3, 3.4, 1.7, scurry * 0.1, 0, Math.PI * 2);
          b.fillStyle = '#33333a'; b.fill();
          dot(b, '#33333a', rx + 3.2, ry - 0.8 + scurry * 0.3, 1.2);
          b.strokeStyle = '#33333a'; b.lineWidth = 0.8;
          b.beginPath(); b.moveTo(rx - 3, ry); b.quadraticCurveTo(rx - 6, ry - 1 + scurry, rx - 8, ry); b.stroke();
          b.lineWidth = 1;
        }
      } else if (h.kind === 'coins') {
        // the gallery surges; hands come down into the ring
        for (var k = 0; k < 4; k++) {
          var hx = h.x + (k + 0.5) * (h.w / 4);
          var hl = 26 + Math.sin(R.t * 0.2 + k + h.x) * 6;
          b.fillStyle = 'rgba(8,6,5,0.92)';
          rr(b, hx - 2.4, floorY - 14 - hl, 4.8, hl, 2); b.fill();
          dot(b, 'rgba(8,6,5,0.92)', hx, floorY - 14 - hl, 4);
        }
        if (R.t % 5 === 0) R.spawn('coin', h.x + srand(R.t) * h.w, floorY - 30, 1);
      } else if (h.kind === 'thrown') {
        b.save();
        b.translate(h.x, floorY - 14 + h.y);
        b.rotate(h.t * 0.2);
        rr(b, -2, -4, 4, 8, 1.6);
        b.fillStyle = '#2c3a2c'; b.fill();
        b.lineWidth = 1; b.strokeStyle = INK; b.stroke();
        b.restore();
      }
    }
  }

  function drawFinisherCinematic(b, game, match, floorY) {
    var prog = 1 - match.phaseT / match.st.finisher.cinematic_frames;
    var o = match.opp;
    b.fillStyle = 'rgba(5,4,3,' + (0.25 + prog * 0.2) + ')';
    b.fillRect(-4, -4, R.W + 8, R.H + 8);
    if (match.player.id !== 'jacco') {
      // generic finisher presentation: gutter, dust, the name
      if (prog > 0.2 && prog < 0.8 && R.t % 6 === 0) {
        R.spawn('dust', o.x, floorY - 6, 1);
        R.spawn('blood', o.x, floorY - o.def.hurtbox.h * 0.6, 1, match.player.facing);
      }
    } else if (o.id === 'brock') {
      // LET HIM SLEEP IN IT — walked back, tipped in, lid closed
      if (prog > 0.3 && prog < 0.75 && R.t % 4 === 0) R.spawn('dust', o.x, floorY - 6, 1);
    } else if (o.id === 'billy') {
      // COUNT HIM OUT — the crowd counts the seconds out of habit
      var count = Math.min(10, 1 + Math.floor(prog * 12));
      if (prog < 0.85) {
        text(b, String(count) + '...', R.W / 2, 70, font(16, 'bold'), CREAM, 'center');
      } // silence at the number
    } else if (o.id === 'puss') {
      // THE CAROTID — the screen stays on it a beat too long
      b.beginPath();
      b.ellipse(o.x + prog * 10, floorY - 1, 16 + prog * 18, 3, 0, 0, Math.PI * 2);
      b.fillStyle = 'rgba(110,18,16,' + Math.min(0.55, prog * 0.7) + ')'; b.fill();
      if (prog > 0.5 && R.t % 9 === 0) R.spawn('blood', match.player.x + 6, floorY - 20, 1, 1);
    } else if (o.id === 'aistrop') {
      // THE HUNDRED GUINEAS — the purse bursts; it rains guineas on both of them
      if (prog > 0.35 && R.t % 2 === 0) R.spawn('guinea_rain', 0, 0, 2);
    }
    if (prog > 0.1 && prog < 0.9) {
      text(b, game.fx.finisherName || '', R.W / 2, 200, font(11, 'bold'), '#d8492a', 'center');
    }
  }

  function card(b, str, y, color) {
    if (!str) return;
    b.save();
    b.translate(R.W / 2, y);
    b.rotate(-0.008);
    b.font = font(15, 'bold'); b.textAlign = 'center'; b.textBaseline = 'alphabetic';
    var w = b.measureText(str).width + 26;
    rr(b, -w / 2, -15, w, 23, 4);
    b.fillStyle = 'rgba(10,8,6,0.8)'; b.fill();
    b.lineWidth = 1.2; b.strokeStyle = 'rgba(232,221,192,0.25)'; b.stroke();
    b.fillStyle = color || CREAM;
    b.fillText(str, 0, 3);
    b.restore();
    b.lineWidth = 1;
  }

  // ---- screens ---------------------------------------------------------------

  R.drawTitle = function (game) {
    var b = R.ctx;
    var gas = gasLevel(R.t, 0, 0);
    var bg = b.createLinearGradient(0, 0, 0, R.H);
    bg.addColorStop(0, '#0c0a09'); bg.addColorStop(1, '#1b1511');
    b.fillStyle = bg; b.fillRect(-4, -4, R.W + 8, R.H + 8);
    // poster: cream paper, heavy black slab serif, printed crooked
    b.save();
    b.translate(R.W / 2, 112);
    b.rotate(0.014);
    rr(b, -152, -100, 308, 208, 2); b.fillStyle = 'rgba(0,0,0,0.6)'; b.fill();
    rr(b, -150, -102, 304, 206, 2);
    b.fillStyle = shade('#e8ddc0', 0.78 + gas * 0.26); b.fill();
    b.lineWidth = 1; b.strokeStyle = '#b3a682'; b.stroke();
    text(b, R.data.script.shared.title, 0, -74, font(26, 'bold'), INK, 'center');
    text(b, '~ ' + R.data.script.shared.tagline + ' ~', 0, -60, font(9, 'italic'), '#4a3826', 'center');
    var y = -42;
    var poster = R.data.script.shared.poster;
    for (var i = 0; i < poster.length; i++) {
      var big = i === 1 || i === 3;
      text(b, poster[i], 0, y, font(big ? 11 : 8, 'bold'), INK, 'center');
      y += big ? 16 : 12;
    }
    b.strokeStyle = '#4a3826'; b.lineWidth = 1;
    b.beginPath(); b.moveTo(-100, y - 4); b.lineTo(100, y - 4); b.stroke();
    text(b, R.data.script.shared.poster_footnote, 0, y + 8, font(7, 'italic'), '#4a3826', 'center');
    text(b, 'PRESS ANY KEY  —  OR TAP', 0, y + 26, font(9, 'bold'), '#7a2214', 'center');
    b.restore();
    // barker line, cycling
    var barker = R.data.script.shared.barker;
    var line = barker[Math.floor(R.t / 300) % barker.length];
    wrap(b, line, R.W / 2, 216, 360, 9, font(8, 'italic'), '#b8ae96', 'center');
    text(b, 'MOVE arrows/WASD   LIGHT J/X   HEAVY K/C   SPECIAL L/V   BLOCK S/Z', R.W / 2, 8, mono(6.5), '#7c766a', 'center');
    text(b, game.version, R.W - 4, 222, mono(7), '#57524a', 'right');
  };

  R.drawCrawl = function (game) {
    var b = R.ctx;
    b.fillStyle = '#0c0a08'; b.fillRect(-4, -4, R.W + 8, R.H + 8);
    var y = R.H - (game.screenT * 0.25);
    wrapParas(b, R.data.script.campaigns[game.campaignId].opening_crawl,
      R.W / 2, y, 300, 12.5, font(9), CREAM, 'center');
    text(b, '(tap to continue)', R.W / 2, 219, font(7, 'italic'), '#57524a', 'center');
    return y;
  };

  // portraits are sized to fit a box (w,h), scale derived per character
  function portrait(b, id, cx, feetY, mirror, box, animate) {
    var Chars = g.MB.Chars;
    var scale = Math.min(box.w / Chars.WIDTHS[id], box.h / Chars.HEIGHTS[id]);
    var pal = R.data.characters[id].palette;
    b.save();
    b.translate(cx, feetY);
    b.scale((mirror ? -1 : 1) * scale, scale);
    g.MB.Chars.draw(b, id, {
      pose: 'idle', phase: null, p: 0,
      t: animate ? R.t : 0, rt: animate ? R.t : 40,
      ripple: false, airborne: false
    }, pal);
    b.restore();
  }

  R.drawDialogue = function (game) {
    var b = R.ctx, d = game.dialogue;
    b.fillStyle = '#100d0b'; b.fillRect(-4, -4, R.W + 8, R.H + 8);
    var gas = gasLevel(R.t, game.fightIndex, 0);
    b.fillStyle = 'rgba(232,197,106,' + (0.035 * gas) + ')'; b.fillRect(0, 0, R.W, R.H);

    text(b, d.billing, R.W / 2, 16, font(9, 'bold'), CREAM, 'center');

    // MK-style portrait vs portrait
    var pbox = { w: 108, h: 122 };
    portrait(b, game.campaignId, 70, 152, false, pbox, true);
    portrait(b, d.opponent, R.W - 70, 152, true, pbox, true);
    text(b, R.data.script.shared.names[game.campaignId], 70, 166, font(8, 'bold'), CHALK, 'center');
    text(b, R.data.script.shared.names[d.opponent], R.W - 70, 166, font(8, 'bold'), CHALK, 'center');

    var line = d.lines[d.idx];
    var speakerX = line.who === game.campaignId ? 70 : R.W - 70;
    b.fillStyle = '#e0d8c0'; b.fillRect(speakerX - 30, 170, 60, 2);

    rr(b, 20, 176, R.W - 40, 42, 4);
    b.fillStyle = 'rgba(10,8,6,0.92)'; b.fill();
    b.lineWidth = 1.2; b.strokeStyle = '#3f3a30'; b.stroke();
    text(b, R.data.script.shared.names[line.who] + ':', 28, 188, font(8, 'bold'), '#c9a227');
    wrap(b, line.text, 28, 199, R.W - 56, 9.5, font(8.5), CREAM);
    if (Math.floor(R.t / 20) % 2 === 0) text(b, '>', R.W - 30, 212, font(9, 'bold'), '#c9a227');
  };

  R.drawSelect = function (game) {
    var b = R.ctx;
    var gas = gasLevel(R.t, 0, 0);
    var bg = b.createLinearGradient(0, 0, 0, R.H);
    bg.addColorStop(0, '#0c0a09'); bg.addColorStop(1, '#1b1511');
    b.fillStyle = bg; b.fillRect(-4, -4, R.W + 8, R.H + 8);
    text(b, "TONIGHT'S BILL — CHOOSE WHO GOES DOWN THE STAIR", R.W / 2, 22,
      font(11, 'bold'), CREAM, 'center');
    text(b, '"Come down, come down! The peer and the pickpocket, one shilling the same!"',
      R.W / 2, 34, font(7, 'italic'), '#7c766a', 'center');

    var ids = game.data.characterIds;
    var panelW = 70, gap = 6;
    var total = ids.length * panelW + (ids.length - 1) * gap;
    var x0 = (R.W - total) / 2;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var cam = game.data.script.campaigns[id];
      var px = x0 + i * (panelW + gap);
      var sel = i === game.selIndex;
      b.save();
      b.translate(px + panelW / 2, 105);
      b.rotate((i % 2 ? 1 : -1) * 0.01);
      b.translate(-(px + panelW / 2), -105);
      rr(b, px - 2, 48, panelW + 4, 118, 2); b.fillStyle = 'rgba(0,0,0,0.6)'; b.fill();
      rr(b, px, 46, panelW, 118, 2);
      b.fillStyle = shade('#e8ddc0', (sel ? 0.92 : 0.55) + gas * 0.12); b.fill();
      if (sel) { b.lineWidth = 2.2; b.strokeStyle = '#7a2214'; b.stroke(); b.lineWidth = 1; }
      portrait(b, id, px + panelW / 2, 142, false, { w: panelW - 12, h: 86 }, sel);
      text(b, game.data.script.shared.names[id], px + panelW / 2, 156, font(6.2, 'bold'), INK, 'center');
      if (!cam.available) {
        rr(b, px, 46, panelW, 118, 2); b.fillStyle = 'rgba(20,17,16,0.74)'; b.fill();
        text(b, 'NOT ON', px + panelW / 2, 100, font(8, 'bold'), '#b8ae96', 'center');
        text(b, "TONIGHT'S BILL", px + panelW / 2, 110, font(8, 'bold'), '#b8ae96', 'center');
      }
      b.restore();
    }
    var selId = ids[game.selIndex];
    text(b, game.data.script.campaigns[selId].select_line, R.W / 2, 186,
      font(9, 'bold'), '#c9a227', 'center');
    text(b, 'LEFT / RIGHT to choose — LIGHT to stake', R.W / 2, 204, font(8), '#7c766a', 'center');
    text(b, game.version, R.W - 4, 222, mono(7), '#57524a', 'right');
  };

  R.drawCard = function (game) {
    // generic full-screen text card: bills, victory quotes, interstitials, endings
    var b = R.ctx, cardSpec = game.card;
    b.fillStyle = '#0c0a08'; b.fillRect(-4, -4, R.W + 8, R.H + 8);
    var y = 40;
    if (cardSpec.poster) {
      b.save();
      b.translate(R.W / 2, 110); b.rotate(0.012); b.translate(-R.W / 2, -110);
      rr(b, R.W / 2 - 152, 40, 308, 148, 2); b.fillStyle = 'rgba(0,0,0,0.6)'; b.fill();
      rr(b, R.W / 2 - 150, 38, 304, 146, 2);
      b.fillStyle = shade('#e8ddc0', 0.92); b.fill();
      b.lineWidth = 1; b.strokeStyle = '#b3a682'; b.stroke();
      var py = 66;
      for (var i = 0; i < cardSpec.poster.length; i++) {
        var big = i === 1;
        text(b, cardSpec.poster[i], R.W / 2, py, font(big ? 11 : 8.5, 'bold'), INK, 'center');
        py += big ? 20 : 16;
      }
      b.strokeStyle = '#4a3826'; b.beginPath();
      b.moveTo(R.W / 2 - 100, py); b.lineTo(R.W / 2 + 100, py); b.stroke();
      text(b, cardSpec.posterFootnote, R.W / 2, py + 12, font(7, 'italic'), '#4a3826', 'center');
      b.restore();
    }
    if (cardSpec.heading) {
      text(b, cardSpec.heading, R.W / 2, y, font(12, 'bold'), cardSpec.headingColor || '#c9a227', 'center');
      y += 22;
    }
    if (cardSpec.body) {
      y = wrapParas(b, cardSpec.body, R.W / 2, y, 322, 11.5,
        font(cardSpec.small ? 8.5 : 9, cardSpec.italic ? 'italic' : ''), CREAM, 'center');
    }
    if (cardSpec.finalCard && game.screenT > 60) {
      var showSecond = cardSpec.finalCard2 && game.screenT > 200;
      text(b, showSecond ? cardSpec.finalCard2 : cardSpec.finalCard,
        R.W / 2, Math.min(y + 20, 205), font(13, 'bold'), CHALK, 'center');
    }
    if (game.screenT > 40 && Math.floor(R.t / 24) % 2 === 0) {
      text(b, '(tap)', R.W / 2, 220, font(7, 'italic'), '#57524a', 'center');
    }
    stepParticles(b, 200);
  };

  R.drawContinue = function (game) {
    var b = R.ctx, cd = game.continueDisplay;
    b.fillStyle = '#0c0a08'; b.fillRect(-4, -4, R.W + 8, R.H + 8);
    var n = cd.n === undefined ? 0 : cd.n;
    if (cd.style === 'countdown' || cd.style === 'house' || cd.style === 'purse') {
      // the stakeholder, and his money
      portrait(b, 'aistrop', R.W / 2 + 90, 195, true, { w: 80, h: 112 }, true);
      for (var i = 0; i < Math.min(12, n); i++) {
        dot(b, GOLD, R.W / 2 + 58 + (i % 6) * 9, 178 - Math.floor(i / 6) * 8, 3);
        b.lineWidth = 0.8; b.strokeStyle = INK; b.stroke();
      }
      b.lineWidth = 1;
    } else if (cd.style === 'tally') {
      // the open barrel, lid up like a mouth waiting
      drawBarrel(b, R.W / 2 + 90, 196, false);
      b.fillStyle = CHALK;
      for (var t2 = 0; t2 < Math.min(24, n); t2++) {
        var gx = R.W / 2 + 46 + (t2 % 12) * 7;
        var gy = 120 + Math.floor(t2 / 12) * 16;
        if ((t2 + 1) % 5 === 0) { b.fillRect(gx - 30, gy + 4, 32, 2); }
        else b.fillRect(gx, gy, 2, 12);
      }
    } else if (cd.style === 'wipe') {
      // the odds slate, wiped back to nought
      rr(b, R.W / 2 + 40, 110, 100, 60, 4);
      b.fillStyle = SLATE; b.fill();
      b.lineWidth = 1.4; b.strokeStyle = '#3f3a30'; b.stroke();
      text(b, String(n), R.W / 2 + 90, 150, font(24, 'bold'),
        n === 0 ? '#57524a' : CHALK, 'center');
      b.lineWidth = 1;
    }
    text(b, cd.heading, R.W / 2 - 60, 80, font(cd.heading.length > 14 ? 13 : 20, 'bold'), CREAM, 'center');
    if (cd.style !== 'wipe') {
      text(b, String(n), R.W / 2 - 60, 118, font(26, 'bold'),
        (cd.style === 'countdown' && n <= 3) ? '#d8492a' : CHALK, 'center');
    }
    text(b, cd.note, R.W / 2 - 60, 134, font(7, 'italic'), '#7c766a', 'center');
    text(b, 'LIGHT — stakes down, go again', R.W / 2 - 60, 168, font(8, 'bold'), '#c9a227', 'center');
    text(b, 'BLOCK — walk away', R.W / 2 - 60, 182, font(8, 'bold'), '#7c766a', 'center');
    stepParticles(b, 200);
    return n;
  };

  // ---- frame -----------------------------------------------------------------

  R.frame = function (game) {
    R.t++;
    var c = R.ctx;
    var cw = R.canvas.width, ch = R.canvas.height;

    // letterbox: fill the whole backing store, then set the world transform
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#080606';
    c.fillRect(0, 0, cw, ch);
    var s = Math.min(cw / R.W, ch / R.H);
    var dx = (cw - R.W * s) / 2, dy = (ch - R.H * s) / 2;
    if (game.match && game.match.shake > 0 && game.mode === 'match') {
      dx += (Math.random() - 0.5) * game.match.shake * s * 0.5;
      dy += (Math.random() - 0.5) * game.match.shake * 0.3 * s;
    }
    R.view = { s: s, dx: dx, dy: dy };
    c.setTransform(s, 0, 0, s, dx, dy);

    switch (game.mode) {
      case 'title': R.drawTitle(game); break;
      case 'select': R.drawSelect(game); break;
      case 'crawl': R.drawCrawl(game); break;
      case 'prefight': R.drawDialogue(game); break;
      case 'match': R.drawMatch(game); break;
      case 'card': R.drawCard(game); break;
      case 'continue': R.drawContinue(game); break;
      default:
        c.fillStyle = '#100d0b'; c.fillRect(0, 0, R.W, R.H);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  };

  g.MB = g.MB || {};
  g.MB.Render = R;
})(typeof window !== 'undefined' ? window : globalThis);
