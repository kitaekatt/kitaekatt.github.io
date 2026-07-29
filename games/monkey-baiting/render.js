/* MONKEY BAITING — render.js
   Everything drawn, every frame, from current state (project rendering
   policy: one rAF loop, no manual redraws). Draws to a small internal buffer
   and scales up with imageSmoothingEnabled=false for the pixel-art look. */
(function (g) {
  'use strict';

  var R = {
    canvas: null, ctx: null, buf: null, b: null,
    W: 400, H: 225, data: null,
    particles: [],
    t: 0 // render frame counter (visual timing only)
  };

  var INK = '#1a1512';
  var CREAM = '#e8ddc0';
  var CHALK = '#e9e6da';
  var SLATE = '#23211c';
  var GOLD = '#C9A227';
  var BLOOD = '#6e1210';

  // deterministic pseudo-random for stable stage furniture
  function srand(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  R.init = function (canvas, data) {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d');
    R.data = data;
    R.W = data.tuning.internal_width;
    R.H = data.tuning.internal_height;
    R.buf = g.document.createElement('canvas');
    R.buf.width = R.W; R.buf.height = R.H;
    R.b = R.buf.getContext('2d');
  };

  R.resize = function (w, h) {
    R.canvas.width = w;
    R.canvas.height = h;
  };

  R.present = function (shakeX, shakeY) {
    var c = R.ctx, cw = R.canvas.width, ch = R.canvas.height;
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#0b0908';
    c.fillRect(0, 0, cw, ch);
    var scale = Math.min(cw / R.W, ch / R.H);
    var dw = Math.floor(R.W * scale), dh = Math.floor(R.H * scale);
    var dx = Math.floor((cw - dw) / 2 + (shakeX || 0) * scale);
    var dy = Math.floor((ch - dh) / 2 + (shakeY || 0) * scale);
    c.drawImage(R.buf, 0, 0, R.W, R.H, dx, dy, dw, dh);
  };

  // ---- text helpers --------------------------------------------------------

  function font(px, style) {
    return (style || '') + ' ' + px + 'px Georgia, "Times New Roman", serif';
  }
  function mono(px) { return px + 'px "Courier New", monospace'; }

  function text(b, str, x, y, f, color, align) {
    b.font = f; b.fillStyle = color; b.textAlign = align || 'left'; b.textBaseline = 'alphabetic';
    b.fillText(str, x, y);
  }

  function wrap(b, str, x, y, maxW, lineH, f, color, align) {
    b.font = f; b.fillStyle = color; b.textAlign = align || 'left';
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
      yy = wrapParas.one(b, paras[i], x, yy, maxW, lineH, f, color, align);
    }
    return yy;
  }
  wrapParas.one = wrap;

  // ---- particles -----------------------------------------------------------

  R.spawn = function (kind, x, y, n, dir) {
    for (var i = 0; i < n; i++) {
      var p = { kind: kind, x: x, y: y, life: 30 + Math.random() * 30, t: 0 };
      if (kind === 'blood') {
        p.vx = (dir || 1) * (0.4 + Math.random() * 1.6); p.vy = -1 - Math.random() * 1.6;
        p.g = 0.12; p.color = Math.random() < 0.5 ? BLOOD : '#8E1B12'; p.size = 1 + (Math.random() < 0.3 ? 1 : 0);
      } else if (kind === 'dust') {
        p.vx = (Math.random() - 0.5) * 1.2; p.vy = -0.3 - Math.random() * 0.5;
        p.g = 0.02; p.color = '#9a8a63'; p.size = 1; p.life = 20 + Math.random() * 15;
      } else if (kind === 'coin') {
        p.vx = (Math.random() - 0.5) * 2.4; p.vy = -1.5 - Math.random() * 2;
        p.g = 0.15; p.color = GOLD; p.size = 2; p.life = 50 + Math.random() * 40;
      } else if (kind === 'guinea_rain') {
        p.x = 40 + Math.random() * 320; p.y = -10 - Math.random() * 60;
        p.vx = (Math.random() - 0.5) * 0.4; p.vy = 1 + Math.random() * 1.5;
        p.g = 0.06; p.color = GOLD; p.size = 2; p.life = 140;
      } else if (kind === 'spark') {
        p.vx = (Math.random() - 0.5) * 3; p.vy = (Math.random() - 0.5) * 3;
        p.g = 0; p.color = CHALK; p.size = 1; p.life = 10;
      }
      R.particles.push(p);
    }
  };

  function stepParticles(b, floorY) {
    for (var i = R.particles.length - 1; i >= 0; i--) {
      var p = R.particles[i];
      p.t++; p.x += p.vx; p.vy += p.g; p.y += p.vy;
      if (p.y > floorY + 18 && p.kind !== 'guinea_rain') { p.y = floorY + 18; p.vy = 0; p.vx *= 0.6; }
      if (p.kind === 'guinea_rain' && p.y > floorY + 12) { p.vy = -p.vy * 0.3; p.y = floorY + 12; }
      if (p.t > p.life) { R.particles.splice(i, 1); continue; }
      b.globalAlpha = Math.max(0.15, 1 - p.t / p.life);
      b.fillStyle = p.color;
      b.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      b.globalAlpha = 1;
    }
  }

  // ---- stage ---------------------------------------------------------------

  var WEAR = [
    { dust: '#6b5c40', crowdGap: 12, stains: 2, gasHi: 1.0, lampOut: -1, bob: 1 },
    { dust: '#5d4e34', crowdGap: 7, stains: 6, gasHi: 1.0, lampOut: -1, bob: 1 },
    { dust: '#453823', crowdGap: 5, stains: 12, gasHi: 0.85, lampOut: -1, bob: 1.4 },
    { dust: '#57482f', crowdGap: 6, stains: 9, gasHi: 0.6, lampOut: 1, bob: 0.3 }
  ];

  function gasLevel(t, wear, gutter) {
    // slow 2-3s flicker cycle + hard dip when a finisher lands
    var base = WEAR[wear].gasHi;
    var fl = 0.85 + 0.15 * Math.sin(t * 0.045) * Math.sin(t * 0.011 + 2);
    var n = 0.94 + 0.06 * srand(Math.floor(t / 7));
    return Math.max(0.05, base * fl * n * (1 - (gutter || 0) * 0.85));
  }

  function drawStage(b, wear, gas, excitement, props) {
    var W = R.W, floorY = R.data.tuning.floor_y;
    var wearD = WEAR[wear];

    // cellar dark
    b.fillStyle = '#141110'; b.fillRect(0, 0, W, R.H);

    // upper background: barred cellar grate; Parliament lit beyond it
    b.fillStyle = '#0d0b0a'; b.fillRect(120, 0, 160, 26);
    b.fillStyle = '#c8b06a';
    for (var i = 0; i < 7; i++) {
      var wx = 132 + i * 20;
      b.globalAlpha = 0.55 + 0.25 * srand(i + 40);
      b.fillRect(wx, 5, 4, 6);
      b.fillRect(wx + 7, 8, 3, 4);
    }
    b.globalAlpha = 1;
    b.fillStyle = '#050404';
    for (i = 0; i < 9; i++) b.fillRect(122 + i * 18, 0, 4, 26);
    b.fillRect(120, 24, 160, 3);

    // gallery: tiered crowd, black silhouettes only — never a rendered face
    b.fillStyle = '#0c0a08';
    b.fillRect(0, 26, W, 68);
    var gap = wearD.crowdGap;
    for (var row = 0; row < 2; row++) {
      var cy = 62 + row * 20;
      for (var cx = 4 + row * 3; cx < W - 4; cx += gap) {
        var s = srand(cx * 7 + row * 131);
        if (wear === 3 && s > 0.82) continue;  // fight 4: the crowd has thinned
        var bob = Math.sin(R.t * 0.1 + cx) * excitement * wearD.bob;
        var hy = cy + s * 6 + bob;
        b.fillStyle = '#060504';
        b.fillRect(cx - 3, hy, 7, 14);               // shoulders
        b.fillRect(cx - 2, hy - 5, 5, 6);            // head
        if (s < 0.35) b.fillRect(cx - 2, hy - 11, 5, 7);        // tall beaver hat
        else if (s < 0.6) b.fillRect(cx - 3, hy - 7, 7, 3);     // rough cap
      }
    }
    // the rail — bows under two hundred men
    var sag = 2 + excitement * 3;
    b.strokeStyle = '#2e2418'; b.lineWidth = 3;
    b.beginPath(); b.moveTo(0, 96); b.quadraticCurveTo(W / 2, 96 + sag, W, 96); b.stroke();
    b.lineWidth = 1;

    // plank wall
    for (i = 0; i < W; i += 16) {
      var pv = 0.85 + 0.3 * srand(i);
      b.fillStyle = shade('#4a3826', pv * gas);
      b.fillRect(i, 98, 16, floorY - 14 - 98);
      b.fillStyle = 'rgba(0,0,0,0.35)';
      b.fillRect(i, 98, 1, floorY - 14 - 98);
    }
    b.fillStyle = 'rgba(0,0,0,0.4)'; b.fillRect(0, 98, W, 3);

    // gaslight jets along the wall
    for (i = 0; i < 4; i++) {
      var gx = 50 + i * 100;
      var out = (i === wearD.lampOut);
      b.fillStyle = '#221b14'; b.fillRect(gx - 2, 108, 4, 10);
      if (!out) {
        var fh = 5 + gas * 5 + 2 * srand(R.t + i * 17);
        b.fillStyle = '#e8c56a'; b.fillRect(gx - 1, 108 - fh, 3, fh);
        b.fillStyle = '#fdf3cf'; b.fillRect(gx, 108 - fh * 0.55, 1, fh * 0.55);
        b.globalAlpha = 0.07 * gas;
        b.fillStyle = '#ffdf90'; b.beginPath(); b.arc(gx, 104, 34, 0, 7); b.fill();
        b.globalAlpha = 1;
      }
    }

    // sawdust floor, darkening and clumping as the night goes on
    b.fillStyle = shade(wearD.dust, 0.5 + gas * 0.5);
    b.fillRect(0, floorY - 14, W, R.H - floorY + 14);
    for (i = 0; i < 26; i++) {
      b.fillStyle = 'rgba(0,0,0,' + (0.06 + 0.09 * srand(i * 3)) + ')';
      var px = srand(i) * W, pw = 6 + srand(i + 9) * 22;
      b.fillRect(px, floorY - 12 + srand(i + 5) * 30, pw, 2);
    }
    for (i = 0; i < wearD.stains; i++) {
      b.fillStyle = 'rgba(70,16,10,' + (0.25 + 0.3 * srand(i + 60)) + ')';
      var sx = 30 + srand(i + 20) * (W - 60);
      b.fillRect(sx, floorY - 6 + srand(i + 21) * 22, 8 + srand(i + 22) * 18, 3);
    }
    if (wear === 3) { // fresh sawdust laid over old
      b.fillStyle = 'rgba(154,138,99,0.25)';
      b.fillRect(60, floorY - 8, 280, 14);
    }

    // props
    if (props && props.barrel) drawBarrel(b, props.barrel.x, floorY, props.barrel.lid);

    // the iron stake, dead centre
    var cx0 = R.data.tuning.ring.center;
    b.fillStyle = '#3a3d40'; b.fillRect(cx0 - 2, floorY - 8, 4, 10);
    b.fillStyle = '#4A4E52'; b.fillRect(cx0 - 3, floorY - 9, 6, 3);
  }

  function drawBarrel(b, x, floorY, lidClosed) {
    b.fillStyle = '#4a3826'; b.fillRect(x - 12, floorY - 26, 24, 26);
    b.fillStyle = '#5d4a33'; b.fillRect(x - 10, floorY - 24, 20, 22);
    b.fillStyle = '#2e2418';
    b.fillRect(x - 12, floorY - 20, 24, 2); b.fillRect(x - 12, floorY - 9, 24, 2);
    if (lidClosed) { b.fillStyle = '#4a3826'; b.fillRect(x - 13, floorY - 29, 26, 4); }
  }

  function shade(hex, mult) {
    var r = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), bb = parseInt(hex.slice(5, 7), 16);
    mult = Math.max(0, Math.min(1.25, mult));
    return 'rgb(' + Math.round(r * mult) + ',' + Math.round(gg * mult) + ',' + Math.round(bb * mult) + ')';
  }

  // ---- chain (drawn as a physical object every frame, never slack) ----------

  function drawChain(b, x0, y0, x1, y1, sagAmt, rattle) {
    var links = 14;
    b.fillStyle = '#4A4E52';
    for (var i = 0; i <= links; i++) {
      var t = i / links;
      var x = x0 + (x1 - x0) * t;
      var y = y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * sagAmt;
      if (rattle) y += (srand(i + R.t) - 0.5) * 2;
      b.fillRect(Math.round(x), Math.round(y), 2, 2);
      if (i % 2) { b.fillStyle = '#33373a'; b.fillRect(Math.round(x) + 1, Math.round(y) + 1, 1, 1); b.fillStyle = '#4A4E52'; }
    }
  }

  // ---- fighters ------------------------------------------------------------

  R.drawFighter = function (b, f, floorY) {
    var Sprites = g.MB.Sprites;
    var pose = g.MB.Logic.poseOf(f);
    var grid = Sprites.frameFor(f.id, pose);
    var sc = Sprites.SHEETS[f.id].scale;
    var w = grid[0].length * sc, h = grid.length * sc;
    var feetX = Math.round(f.x), feetY = Math.round(floorY - f.y);

    // shadow
    b.fillStyle = 'rgba(0,0,0,0.35)';
    b.fillRect(feetX - Math.round(w * 0.3), floorY - 1, Math.round(w * 0.6), 3);

    var x0 = feetX - Math.round(w / 2);
    var y0 = feetY - h;
    var mirror = f.facing < 0;
    var pal = f.def.palette;
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row[mirror ? row.length - 1 - c : c];
        if (ch === '.') continue;
        b.fillStyle = Sprites.colorFor(f.id, ch, pal);
        b.fillRect(x0 + c * sc, y0 + r * sc, sc, sc);
      }
    }
    // fresh-hit flash
    if (f.state === 'stun' && f.t < 4 && !f.blockStun) {
      b.globalAlpha = 0.45; b.fillStyle = '#fff2e0';
      b.fillRect(x0, y0, w, h); b.globalAlpha = 1;
    }
    return { x: x0, y: y0, w: w, h: h };
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
    b.fillStyle = SLATE; b.fillRect(x, 7, w, 30);
    b.strokeStyle = '#3a362e'; b.strokeRect(x + 0.5, 7.5, w - 1, 29);
    if (flipped) { // THE CROSS: the slate turned face-in
      b.fillStyle = '#1b1915'; b.fillRect(x + 2, 9, w - 4, 26);
      text(b, 'X', x + w / 2, 28, font(14, 'bold'), '#57524a', 'center');
      b.restore();
      return;
    }
    text(b, name, x + 4, 16, font(8, 'bold'), CHALK);
    // chalk health bar — damage wipes chalk off
    var bw = w - 8;
    b.fillStyle = 'rgba(233,230,218,0.15)'; b.fillRect(x + 4, 20, bw, 6);
    var fw = Math.max(0, Math.round(bw * hpPct));
    b.fillStyle = CHALK;
    for (var i = 0; i < fw; i += 2) {
      var hh = 5 + (srand(i + x) > 0.7 ? 1 : 0);
      b.fillRect(x + 4 + (alignRight ? bw - i - 2 : i), 20, 2, hh);
    }
    text(b, odds(hpPct), alignRight ? x + w - 4 : x + 4, 34, mono(7), '#bdb8a8', alignRight ? 'right' : 'left');
    // guineas stacked on the drum-head: round wins
    for (i = 0; i < rounds; i++) {
      b.fillStyle = GOLD;
      b.beginPath(); b.arc(alignRight ? x + 8 + i * 8 : x + w - 8 - i * 8, 32, 2.6, 0, 7); b.fill();
      b.fillStyle = '#ffe9a0';
      b.fillRect((alignRight ? x + 8 + i * 8 : x + w - 8 - i * 8) - 1, 31, 1, 1);
    }
    b.restore();
  }

  function drawWatch(b, frac) {
    // a pocket watch held open by a disembodied gloved hand
    b.fillStyle = '#0e0c0a'; b.fillRect(192, 0, 16, 8);           // glove at screen top
    b.fillRect(196, 6, 8, 6);
    b.fillStyle = '#b8a96a'; b.beginPath(); b.arc(200, 20, 11, 0, 7); b.fill();
    b.fillStyle = '#efe8d2'; b.beginPath(); b.arc(200, 20, 9, 0, 7); b.fill();
    b.strokeStyle = INK;
    var ang = -Math.PI / 2 + (1 - frac) * Math.PI * 2;
    b.beginPath(); b.moveTo(200, 20);
    b.lineTo(200 + Math.cos(ang) * 7, 20 + Math.sin(ang) * 7); b.stroke();
    b.fillStyle = INK; b.fillRect(199, 19, 2, 2);
  }

  function drawChainMeter(b, fill) {
    // the finisher meter is the chain: taut link by link as it fills
    var n = 12, x0 = 148, x1 = 252, y = 40;
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      var filled = t <= fill;
      var sag = filled ? 0 : Math.sin(Math.PI * t) * 4;
      b.fillStyle = filled ? '#8f969c' : '#43474b';
      b.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y + sag), 3, 2);
    }
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
    text(b, '' + Math.ceil(match.timer / match.tuning.logic_hz), 200, 40, mono(8), '#bdb8a8', 'center');
    var w = match.st.rounds.wins_to_take_match;
    if (p.roundsWon === w - 1) {
      var th = match.st.finisher.health_threshold;
      var fill = Math.min(1, (1 - o.hp / o.def.max_health) / (1 - th));
      drawChainMeter(b, fill);
    }
  };

  // ---- match scene ----------------------------------------------------------

  R.drawMatch = function (game) {
    var b = R.b, match = game.match;
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
      // the barrel waits in his own corner
      var bx = brockF.side === 0 ? R.data.tuning.ring.left + 14 : R.data.tuning.ring.right - 14;
      props.barrel = { x: bx, lid: false };
    }
    if (match.phase === 'finisher' && match.opp.id === 'brock' && match.player.id === 'jacco') {
      var prog = 1 - match.phaseT / match.st.finisher.cinematic_frames;
      props.barrel = { x: R.data.tuning.ring.right - 14 - prog * 100, lid: prog > 0.7 };
    }
    drawStage(b, wear, gas, excitement, props);

    // hazards under fighters: rats and crowd-hands / coins
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
        var handY = floorY - holder.y - holder.def.hurtbox.h + 2;
        var yanking = holder.state === 'attack' && holder.move && holder.move.type === 'chain_yank';
        drawChain(b, holder.x - holder.facing * 10, handY, cf.x - cf.facing * 6, collarY,
          yanking || taut ? 0 : 5, rattle || yanking);
      }
    }

    // fighters (victim first so the finisher actor overlaps)
    R.drawFighter(b, match.opp, floorY);
    R.drawFighter(b, match.player, floorY);

    stepParticles(b, floorY - 14);

    // gas-level dark wash
    b.fillStyle = 'rgba(8,6,4,' + (0.45 * (1 - gas)) + ')';
    b.fillRect(0, 0, R.W, R.H);

    R.drawHUD(b, match);

    // intro / round cards / announcements
    if (match.phase === 'intro') {
      if (match.round === 1) {
        wrap(b, R.data.script.shared.prefight_ritual, R.W / 2, 150, 300, 10, font(8, 'italic'), '#b8ae96', 'center');
      }
      card(b, game.fx.roundText || '', 100);
    }
    if (game.fx.announce && game.fx.announce.t > 0) {
      card(b, game.fx.announce.text, 100);
    }
    if (match.finisherWindow) {
      var blink = Math.floor(R.t / 8) % 2 === 0;
      if (blink) card(b, game.fx.finisherPrompt, 96, '#c93a1c');
    }
    if (match.phase === 'finisher') drawFinisherCinematic(b, game, match, floorY);
    if (match.cross) {
      text(b, 'THE ODDS HAVE TURNED', R.W / 2, 60, font(9, 'bold'), '#c93a1c', 'center');
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
          var ry = floorY - 3 - srand(r * 7) * 9;
          b.fillStyle = '#3A3A3C';
          b.fillRect(rx, ry, 4, 2);
          b.fillRect(rx - 2, ry + 1, 2, 1); // tail
        }
      } else if (h.kind === 'coins') {
        // the gallery surges; hands come down into the ring
        b.fillStyle = 'rgba(6,5,4,0.9)';
        for (var k = 0; k < 4; k++) {
          var hx = h.x + (k + 0.5) * (h.w / 4);
          var hl = 26 + Math.sin(R.t * 0.2 + k + h.x) * 6;
          b.fillRect(hx - 2, floorY - 14 - hl, 4, hl);
          b.fillRect(hx - 4, floorY - 18 - hl, 8, 6);
        }
        if (R.t % 5 === 0) R.spawn('coin', h.x + srand(R.t) * h.w, floorY - 30, 1);
      } else if (h.kind === 'thrown') {
        b.fillStyle = '#2c3a2c';
        b.fillRect(h.x - 2, floorY - 14 + h.y, 4, 7);
      }
    }
  }

  function drawFinisherCinematic(b, game, match, floorY) {
    var prog = 1 - match.phaseT / match.st.finisher.cinematic_frames;
    var o = match.opp;
    b.fillStyle = 'rgba(5,4,3,' + (0.25 + prog * 0.2) + ')';
    b.fillRect(0, 0, R.W, R.H);
    if (match.player.id !== 'jacco') {
      // generic finisher presentation (no new assets): gutter, dust, the name
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
      b.fillStyle = 'rgba(110,18,16,' + Math.min(0.5, prog * 0.7) + ')';
      b.fillRect(o.x - 16, floorY - 4, 32 + prog * 30, 4);
      if (prog > 0.5 && R.t % 9 === 0) R.spawn('blood', match.player.x + 6, floorY - 20, 1, 1);
    } else if (o.id === 'aistrop') {
      // THE HUNDRED GUINEAS — the purse bursts; it rains guineas on both of them
      if (prog > 0.35 && R.t % 2 === 0) R.spawn('guinea_rain', 0, 0, 2);
    }
    if (prog > 0.1 && prog < 0.9) {
      text(b, game.fx.finisherName || '', R.W / 2, 200, font(11, 'bold'), '#c93a1c', 'center');
    }
  }

  function card(b, str, y, color) {
    if (!str) return;
    b.save();
    b.translate(R.W / 2, y);
    b.rotate(-0.008);
    b.font = font(15, 'bold'); b.textAlign = 'center';
    b.fillStyle = 'rgba(10,8,6,0.75)';
    var w = b.measureText(str).width + 24;
    b.fillRect(-w / 2, -14, w, 22);
    b.fillStyle = color || CREAM;
    b.fillText(str, 0, 3);
    b.restore();
  }

  // ---- screens ---------------------------------------------------------------

  R.drawTitle = function (game) {
    var b = R.b;
    var gas = gasLevel(R.t, 0, 0);
    b.fillStyle = '#141110'; b.fillRect(0, 0, R.W, R.H);
    // poster: cream paper, heavy black slab serif, printed crooked
    b.save();
    b.translate(R.W / 2, 112);
    b.rotate(0.014);
    b.fillStyle = '#0a0806'; b.fillRect(-152, -100, 308, 208);
    b.fillStyle = shade('#e8ddc0', 0.75 + gas * 0.3);
    b.fillRect(-150, -102, 304, 206);
    text(b, R.data.script.shared.title, 0, -74, font(26, 'bold'), INK, 'center');
    text(b, '~ ' + R.data.script.shared.tagline + ' ~', 0, -60, font(9, 'italic'), '#4a3826', 'center');
    var y = -42;
    var poster = R.data.script.shared.poster;
    for (var i = 0; i < poster.length; i++) {
      var big = i === 1 || i === 3;
      text(b, poster[i], 0, y, font(big ? 11 : 8, 'bold'), INK, 'center');
      y += big ? 16 : 12;
    }
    b.strokeStyle = '#4a3826'; b.beginPath(); b.moveTo(-100, y - 4); b.lineTo(100, y - 4); b.stroke();
    text(b, R.data.script.shared.poster_footnote, 0, y + 8, font(7, 'italic'), '#4a3826', 'center');
    text(b, 'PRESS ANY KEY  —  OR TAP', 0, y + 26, font(9, 'bold'), '#7a2214', 'center');
    b.restore();
    // barker line, cycling
    var barker = R.data.script.shared.barker;
    var line = barker[Math.floor(R.t / 300) % barker.length];
    wrap(b, line, R.W / 2, 216, 360, 9, font(8, 'italic'), '#b8ae96', 'center');
    // controls hint
    text(b, 'MOVE arrows/WASD   LIGHT J/X   HEAVY K/C   SPECIAL L/V   BLOCK S/Z', R.W / 2, 8, mono(6.5), '#6f6a5c', 'center');
    text(b, game.version, R.W - 4, 222, mono(7), '#57524a', 'right');
  };

  R.drawCrawl = function (game) {
    var b = R.b;
    b.fillStyle = '#0c0a08'; b.fillRect(0, 0, R.W, R.H);
    var y = R.H - (game.screenT * 0.25);
    wrapParas(b, R.data.script.campaigns[game.campaignId].opening_crawl,
      R.W / 2, y, 300, 12, font(9), CREAM, 'center');
    text(b, '(tap to continue)', R.W / 2, 219, font(7, 'italic'), '#57524a', 'center');
    return y; // game uses this to know when the crawl is done
  };

  R.drawDialogue = function (game) {
    var b = R.b, d = game.dialogue;
    b.fillStyle = '#100d0b'; b.fillRect(0, 0, R.W, R.H);
    var gas = gasLevel(R.t, game.fightIndex, 0);
    b.fillStyle = 'rgba(232,197,106,' + (0.03 * gas) + ')'; b.fillRect(0, 0, R.W, R.H);

    text(b, d.billing, R.W / 2, 16, font(9, 'bold'), CREAM, 'center');

    // MK-style portrait vs portrait: sprites large, facing in
    mkPortrait(b, game.campaignId, 70, 150, false);
    mkPortrait(b, d.opponent, R.W - 70, 150, true);
    text(b, R.data.script.shared.names[game.campaignId], 70, 166, font(8, 'bold'), CHALK, 'center');
    text(b, R.data.script.shared.names[d.opponent], R.W - 70, 166, font(8, 'bold'), CHALK, 'center');

    var line = d.lines[d.idx];
    var speakerX = line.who === game.campaignId ? 70 : R.W - 70;
    b.fillStyle = '#e0d8c0'; b.fillRect(speakerX - 30, 170, 60, 2);

    b.fillStyle = 'rgba(10,8,6,0.9)'; b.fillRect(20, 176, R.W - 40, 40);
    b.strokeStyle = '#3a362e'; b.strokeRect(20.5, 176.5, R.W - 41, 39);
    text(b, R.data.script.shared.names[line.who] + ':', 28, 188, font(8, 'bold'), '#c9a227');
    wrap(b, line.text, 28, 198, R.W - 56, 9, font(8), CREAM);
    if (Math.floor(R.t / 20) % 2 === 0) text(b, '>', R.W - 30, 210, font(9, 'bold'), '#c9a227');
  };

  function mkPortrait(b, id, cx, feetY, mirror) {
    var Sprites = g.MB.Sprites;
    var pose = (Math.floor(R.t / 26) % 2) ? 'idle2' : 'idle1';
    if (id === 'billy' && Math.floor(R.t / 14) % 4 === 0) pose = 'idle2'; // the twitch
    var grid = Sprites.frameFor(id, pose);
    var sc = id === 'aistrop' ? 3 : 4;
    var w = grid[0].length * sc, h = grid.length * sc;
    var pal = R.data.characters[id].palette;
    var x0 = Math.round(cx - w / 2), y0 = feetY - h;
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row[mirror ? row.length - 1 - c : c];
        if (ch === '.') continue;
        b.fillStyle = Sprites.colorFor(id, ch, pal);
        b.fillRect(x0 + c * sc, y0 + r * sc, sc, sc);
      }
    }
  }

  R.drawSelect = function (game) {
    var b = R.b;
    var gas = gasLevel(R.t, 0, 0);
    b.fillStyle = '#141110'; b.fillRect(0, 0, R.W, R.H);
    text(b, 'TONIGHT\'S BILL — CHOOSE WHO GOES DOWN THE STAIR', R.W / 2, 22,
      font(11, 'bold'), CREAM, 'center');
    text(b, '"Come down, come down! The peer and the pickpocket, one shilling the same!"',
      R.W / 2, 34, font(7, 'italic'), '#7a7264', 'center');

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
      // poster paper panel
      b.fillStyle = '#0a0806'; b.fillRect(px - 2, 48, panelW + 4, 118);
      b.fillStyle = shade('#e8ddc0', (sel ? 0.9 : 0.55) + gas * 0.15);
      b.fillRect(px, 46, panelW, 118);
      if (sel) { b.strokeStyle = '#7a2214'; b.lineWidth = 2; b.strokeRect(px + 1, 47, panelW - 2, 116); b.lineWidth = 1; }
      // idle sprite as portrait (existing frames only)
      var psc = id === 'aistrop' ? 2 : 3;
      mkPortraitScaled(b, id, px + panelW / 2, 140, false, psc, sel);
      text(b, game.data.script.shared.names[id], px + panelW / 2, 154, font(7, 'bold'), INK, 'center');
      if (!cam.available) {
        b.fillStyle = 'rgba(20,17,16,0.72)'; b.fillRect(px, 46, panelW, 118);
        text(b, 'NOT ON', px + panelW / 2, 100, font(8, 'bold'), '#b8ae96', 'center');
        text(b, "TONIGHT'S BILL", px + panelW / 2, 110, font(8, 'bold'), '#b8ae96', 'center');
      }
      b.restore();
    }
    var selId = ids[game.selIndex];
    text(b, game.data.script.campaigns[selId].select_line, R.W / 2, 186,
      font(9, 'bold'), '#c9a227', 'center');
    text(b, 'LEFT / RIGHT to choose — LIGHT to stake', R.W / 2, 204, font(8), '#7a7264', 'center');
    text(b, game.version, R.W - 4, 222, mono(7), '#57524a', 'right');
  };

  function mkPortraitScaled(b, id, cx, feetY, mirror, sc, animate) {
    var Sprites = g.MB.Sprites;
    var pose = animate && (Math.floor(R.t / 26) % 2) ? 'idle2' : 'idle1';
    if (animate && id === 'billy' && Math.floor(R.t / 14) % 4 === 0) pose = 'idle2';
    var grid = Sprites.frameFor(id, pose);
    var w = grid[0].length * sc, h = grid.length * sc;
    var pal = R.data.characters[id].palette;
    var x0 = Math.round(cx - w / 2), y0 = feetY - h;
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      for (var c = 0; c < row.length; c++) {
        var ch = row[mirror ? row.length - 1 - c : c];
        if (ch === '.') continue;
        b.fillStyle = Sprites.colorFor(id, ch, pal);
        b.fillRect(x0 + c * sc, y0 + r * sc, sc, sc);
      }
    }
  }

  R.drawCard = function (game) {
    // generic full-screen text card: victory quotes, interstitials, endings, note
    var b = R.b, cardSpec = game.card;
    b.fillStyle = '#0c0a08'; b.fillRect(0, 0, R.W, R.H);
    var y = 40;
    if (cardSpec.poster) {
      // a campaign bill: cream paper, slab serif, printed crooked
      b.save();
      b.translate(R.W / 2, 110); b.rotate(0.012); b.translate(-R.W / 2, -110);
      b.fillStyle = '#0a0806'; b.fillRect(R.W / 2 - 152, 40, 308, 148);
      b.fillStyle = shade('#e8ddc0', 0.9);
      b.fillRect(R.W / 2 - 150, 38, 304, 146);
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
      y = wrapParas(b, cardSpec.body, R.W / 2, y, 320, 11, font(cardSpec.small ? 8 : 9, cardSpec.italic ? 'italic' : ''), CREAM, 'center');
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
    var b = R.b, cd = game.continueDisplay;
    b.fillStyle = '#0c0a08'; b.fillRect(0, 0, R.W, R.H);
    var n = cd.n === undefined ? 0 : cd.n;
    // style furniture, existing drawing vocabulary only
    if (cd.style === 'countdown' || cd.style === 'house' || cd.style === 'purse') {
      // the stakeholder, and his money
      mkPortrait(b, 'aistrop', R.W / 2 + 90, 190, true);
      for (var i = 0; i < Math.min(12, n); i++) {
        b.fillStyle = GOLD;
        b.beginPath();
        b.arc(R.W / 2 + 60 + (i % 6) * 9, 176 - Math.floor(i / 6) * 7, 3, 0, 7);
        b.fill();
      }
    } else if (cd.style === 'tally') {
      // the open barrel, lid up like a mouth waiting
      drawBarrel(b, R.W / 2 + 90, 195, false);
      b.fillStyle = CHALK; // chalk tally strokes
      for (var t2 = 0; t2 < Math.min(24, n); t2++) {
        var gx = R.W / 2 + 46 + (t2 % 12) * 7;
        var gy = 120 + Math.floor(t2 / 12) * 16;
        if ((t2 + 1) % 5 === 0) { b.fillRect(gx - 30, gy + 4, 32, 2); }
        else b.fillRect(gx, gy, 2, 12);
      }
    } else if (cd.style === 'wipe') {
      // the odds slate, wiped back to nought
      b.fillStyle = SLATE; b.fillRect(R.W / 2 + 40, 110, 100, 60);
      b.strokeStyle = '#3a362e'; b.strokeRect(R.W / 2 + 40.5, 110.5, 99, 59);
      text(b, String(n), R.W / 2 + 90, 150, font(24, 'bold'),
        n === 0 ? '#57524a' : CHALK, 'center');
    }
    text(b, cd.heading, R.W / 2 - 60, 80, font(cd.heading.length > 14 ? 13 : 20, 'bold'), CREAM, 'center');
    if (cd.style !== 'wipe') {
      text(b, String(n), R.W / 2 - 60, 118, font(26, 'bold'),
        (cd.style === 'countdown' && n <= 3) ? '#c93a1c' : CHALK, 'center');
    }
    text(b, cd.note, R.W / 2 - 60, 134, font(7, 'italic'), '#7a7264', 'center');
    text(b, 'LIGHT — stakes down, go again', R.W / 2 - 60, 168, font(8, 'bold'), '#c9a227', 'center');
    text(b, 'BLOCK — walk away', R.W / 2 - 60, 182, font(8, 'bold'), '#7a7264', 'center');
    stepParticles(b, 200);
    return n;
  };

  R.frame = function (game) {
    R.t++;
    var b = R.b;
    b.textBaseline = 'alphabetic';
    switch (game.mode) {
      case 'title': R.drawTitle(game); break;
      case 'select': R.drawSelect(game); break;
      case 'crawl': R.drawCrawl(game); break;
      case 'prefight': R.drawDialogue(game); break;
      case 'match': R.drawMatch(game); break;
      case 'card': R.drawCard(game); break;
      case 'continue': R.drawContinue(game); break;
      default:
        b.fillStyle = '#100d0b'; b.fillRect(0, 0, R.W, R.H);
    }
    var sh = 0, sv = 0;
    if (game.match && game.match.shake > 0 && game.mode === 'match') {
      sh = (Math.random() - 0.5) * game.match.shake;
      sv = (Math.random() - 0.5) * game.match.shake * 0.6;
    }
    R.present(sh, sv);
  };

  g.MB = g.MB || {};
  g.MB.Render = R;
})(typeof window !== 'undefined' ? window : globalThis);
