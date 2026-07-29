/* MONKEY BAITING — chars.js
   Procedural vector fighters (replaces the retired pixel-sprite sheets).
   Modern cartoony: rounded shapes, bold ink outlines, flat colours with
   simple two-tone shading. Colours come from each character's YAML palette
   (validated against REQUIRED_PALETTE — no silent fallbacks). Poses are
   driven by the same logic state windows as before; drawing is in a local
   space with the feet at (0,0) and +x = the direction the fighter faces.

   spec = {
     pose:  'idle'|'walk'|'jump'|'block'|'hit'|'down'|'dazed'|
            'light'|'heavy'|'special'|'grab_hold'|'finish',
     phase: null|'wind'|'act'|'rec',   // attack window
     p:     0..1 progress within the current phase,
     t:     frames in state, rt: render frames (ambient motion),
     ripple: bool (jacco's tell), airborne: bool
   } */
(function (g) {
  'use strict';

  var INK = '#1a1512';

  // ---- helpers -------------------------------------------------------------

  function shade(hex, mult) {
    var r = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    mult = Math.max(0, Math.min(1.6, mult));
    return 'rgb(' + Math.min(255, Math.round(r * mult)) + ',' + Math.min(255, Math.round(gg * mult)) + ',' + Math.min(255, Math.round(b * mult)) + ')';
  }

  function outlined(c, fill) {
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = 1.7;
    c.lineJoin = 'round';
    c.strokeStyle = INK;
    c.stroke();
  }

  function ell(c, fill, cx, cy, rx, ry, rot) {
    c.beginPath();
    c.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, Math.PI * 2);
    outlined(c, fill);
  }

  function softEll(c, fill, cx, cy, rx, ry, rot) { // no outline (shading blobs)
    c.beginPath();
    c.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
  }

  function limb(c, color, x1, y1, x2, y2, w) {
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
    c.lineWidth = w + 2.6; c.strokeStyle = INK; c.stroke();
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
    c.lineWidth = w; c.strokeStyle = color; c.stroke();
  }

  function line(c, color, w, x1, y1, x2, y2) {
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
    c.lineWidth = w; c.strokeStyle = color; c.stroke();
  }

  function ease(p) { p = Math.max(0, Math.min(1, p)); return p * p * (3 - 2 * p); }

  // squash/stretch scaler around the feet
  function squash(c, sx, sy) { c.scale(sx, sy); }

  // ---- JACCO — small, low, wide-shouldered, a coiled fist ------------------

  function drawJacco(c, s, pal) {
    var t = s.t, rt = s.rt;
    var fur = pal.fur, fur2 = shade(pal.fur, 0.78);
    var breathe = Math.sin(rt * 0.06) * 0.35;
    var walk = Math.sin(t * 0.38);
    var lean = 0, lift = 0, sx = 1, sy = 1;
    var armSwing = 0, legSwing = 0, mouth = 0, curl = 0;

    switch (s.pose) {
      case 'walk': armSwing = walk * 3; legSwing = -walk * 3; break;
      case 'jump': lean = -0.25; legSwing = 2; break;
      case 'hit': lean = 0.55; mouth = 1; sx = 0.94; sy = 1.02; break;
      case 'block': curl = 1; break;
      case 'down': break;
      case 'dazed': lean = Math.sin(t * 0.1) * 0.18; mouth = 0.4; break;
      case 'light':
        if (s.phase === 'wind') { lean = -0.15; sx = 0.94; }
        else if (s.phase === 'act') { armSwing = 0; mouth = 0.6; sx = 1.06; }
        else lean = -0.05;
        break;
      case 'heavy': break; // handled below (present the back)
      case 'special':
      case 'grab_hold':
      case 'finish':
        lean = -0.5; sx = 1.2; sy = 0.9; mouth = 1;
        break;
    }
    if (s.airborne && s.pose !== 'special') { lean -= 0.15; }

    if (s.pose === 'down') {
      ell(c, fur, 0, -5, 15, 4.5, 0);
      ell(c, pal.muzzle, 12, -4, 4, 2.6, 0.2);
      limb(c, fur2, -8, -5, -14, -2, 3);
      limb(c, fur2, 5, -5, 12, -2, 3);
      return;
    }

    c.save();
    squash(c, sx, sy);
    c.rotate(0); // feet-anchored; body parts carry the lean

    if (s.pose === 'heavy' && s.phase !== 'rec') {
      // PRESENT THE BACK: turned away, arched, riding forward on the lunge
      var arch = s.phase === 'act' ? 0.35 : 0.15;
      ell(c, fur, -2, -13, 14, 9, -arch);                    // arched back, no face
      softEll(c, fur2, -4, -9, 10, 4.5, -arch);              // belly shade
      ell(c, fur, -10, -18, 5.5, 5, 0);                      // tucked head (back of skull)
      limb(c, fur2, -6, -8, -11, 0, 3.4);
      limb(c, fur2, 2, -8, 7 + (s.phase === 'act' ? 4 : 0), 0, 3.6);
      limb(c, fur2, 8, -12, 13 + (s.phase === 'act' ? 5 : 0), -2, 3.6);
      c.restore();
      return;
    }

    if (curl) {
      // guard: a tight ball behind crossed arms
      ell(c, fur, 0, -11, 10.5, 9.5, 0);
      softEll(c, fur2, 0, -7, 8, 4, 0);
      limb(c, pal.muzzle, -6, -13, 6, -15, 3.4);
      limb(c, pal.muzzle, -6, -9, 6, -11, 3.4);
      ell(c, fur, 2, -18, 5, 4.4, 0);
      c.restore();
      return;
    }

    // hind legs
    limb(c, fur2, -8, -9, -11 + legSwing, 0, 3.2);
    limb(c, fur2, -4, -9, -6 - legSwing, 0, 3.2);
    // body: forward-hunched bean
    ell(c, fur, -1, -13 + breathe * 0.4 + lift, 13, 8.2, -0.28 + lean * 0.4);
    softEll(c, fur2, -3, -9 + breathe * 0.4, 9, 3.6, -0.2);
    // the skin moves before he does — a travelling ripple on the shoulders
    if (s.ripple) {
      c.beginPath();
      var rx0 = -6 + ((s.t * 2.4) % 12);
      c.ellipse(rx0, -20.5, 3.4, 2.0, -0.3, 0, Math.PI * 2);
      outlined(c, shade(pal.fur, 1.16));
    }
    // long knuckle-walking arms
    limb(c, fur, 5, -14, 10 + armSwing, 0, 3.8);
    limb(c, fur, 8, -15, 13 - armSwing, 0, 3.8);
    // light attack: raking swipe arm
    if (s.pose === 'light' && s.phase === 'act') {
      var a = -1.4 + ease(s.p) * 2.0;
      var px = 7 + Math.cos(a) * 13, py = -14 + Math.sin(a) * 13;
      limb(c, fur, 7, -14, px, py, 3.8);
      for (var k = 0; k < 3; k++) line(c, pal.muzzle, 1.4, px, py, px + 3.4, py - 2 + k * 2);
    }
    if ((s.pose === 'special' || s.pose === 'grab_hold' || s.pose === 'finish')) {
      limb(c, fur, 6, -16, 15, -18, 3.8);
      limb(c, fur, 4, -12, 14, -13, 3.8);
    }
    // head, low and forward
    var hx = 9 + lean * -6, hy = -17 - lean * 3 + breathe * 0.4;
    ell(c, fur, hx, hy, 6, 5.4, lean * 0.3);
    ell(c, fur, hx - 3.5, hy - 4.5, 2.2, 2.2, 0);                 // ear
    ell(c, pal.muzzle, hx + 4.5, hy + 1, 3.6, 2.8, 0.15);         // pale scarred muzzle
    softEll(c, INK, hx + 2.6, hy - 1.6, 1.1, 1.4, 0);             // eye
    if (mouth > 0) {
      c.beginPath();
      c.ellipse(hx + 5.4, hy + 2.2, 2.2 * mouth + 0.6, 1.6 * mouth + 0.4, 0.2, 0, Math.PI * 2);
      c.fillStyle = pal.wound; c.fill();
      c.lineWidth = 1.1; c.strokeStyle = INK; c.stroke();
    }
    line(c, pal.muzzle, 1.1, hx - 1, hy + 3.4, hx + 2.5, hy + 3.8); // old scar on the jaw
    // iron collar
    line(c, pal.chain, 2.4, hx - 4, hy + 4.4, hx + 1, hy + 5.2);
    c.restore();
  }

  // ---- BROCK — a door lying on its side ------------------------------------

  function drawBrock(c, s, pal) {
    var t = s.t, rt = s.rt;
    var coat = pal.coat, coat2 = shade(pal.coat, 0.8);
    var sway = Math.sin(rt * 0.045) * 0.5;
    var walk = Math.sin(t * 0.22);
    var stretch = 1, h = 1, jaw = 0, flatten = 0;

    switch (s.pose) {
      case 'walk': break;
      case 'hit': stretch = 0.92; h = 1.05; jaw = 0.5; break;
      case 'block': h = 0.85; break;
      case 'down': flatten = 1; break;
      case 'dazed': jaw = 0.3; break;
      case 'light':
        if (s.phase === 'act') { jaw = 1; stretch = 1.05; }
        else if (s.phase === 'wind') { h = 0.92; }
        break;
      case 'heavy': // BARREL SET: planted, lowered, near-unmovable
        h = 0.74; stretch = 1.08;
        break;
      case 'special': // DRAWN AGAIN: exploding out of the crouch
        if (s.phase === 'wind') { h = 0.7; stretch = 0.9; }
        else if (s.phase === 'act') { h = 0.95; stretch = 1.3; jaw = 1; }
        else { h = 0.95; jaw = 0.3; }
        break;
    }

    if (flatten) {
      ell(c, coat, 0, -5.5, 21, 5, 0);
      softEll(c, pal.ochre, -3, -3.5, 14, 2.4, 0);
      ell(c, coat, 17, -5, 6.5, 3.6, 0.15);
      line(c, pal.stripe, 2.6, 19, -6.5, 23.5, -4.5);
      return;
    }

    c.save();
    squash(c, stretch, h);
    // stumpy legs
    limb(c, coat2, -13, -6, -15 + walk * 2, 0, 3.6);
    limb(c, coat2, -6, -6, -7 - walk * 2, 0, 3.6);
    limb(c, coat2, 6, -6, 5 + walk * 2, 0, 3.6);
    limb(c, coat2, 12, -6, 14 - walk * 2, 0, 3.6);
    // the wedge: broad, low, almost no legs visible
    c.beginPath();
    c.moveTo(-21, -3);
    c.quadraticCurveTo(-23, -14 + sway, -12, -16.5 + sway);
    c.quadraticCurveTo(0, -19 + sway, 10, -15.5);
    c.quadraticCurveTo(19, -12.5, 22.5, -6.5);
    c.quadraticCurveTo(23, -2.5, 18, -2.2);
    c.quadraticCurveTo(0, -1, -21, -3);
    c.closePath();
    outlined(c, coat);
    softEll(c, pal.ochre, -4, -4.5, 15, 2.6, 0);        // sawdust-stained belly
    softEll(c, coat2, -8, -13 + sway, 10, 3.4, -0.1);   // grizzled shoulder shade
    // head wedge with the black stripes
    var hx = 17, hy = -8.5;
    c.beginPath();
    c.moveTo(hx - 6, hy - 5);
    c.quadraticCurveTo(hx + 4, hy - 6.5, hx + 8.5, hy + 1 + jaw * 1.2);
    c.quadraticCurveTo(hx + 4, hy + 3.6, hx - 4, hy + 3);
    c.closePath();
    outlined(c, shade(pal.coat, 1.12));
    line(c, pal.stripe, 2.4, hx - 5, hy - 4.4, hx + 8, hy + 0.4);   // eye stripe
    line(c, pal.stripe, 2.0, hx - 3, hy + 2.6, hx + 7.5, hy + 2.2); // jaw stripe
    softEll(c, INK, hx + 1.5, hy - 1.4, 1.1, 1.2, 0);               // the working eye
    if (jaw > 0.4) {
      c.beginPath();
      c.moveTo(hx + 8.5, hy + 1.5);
      c.lineTo(hx + 12, hy + 3 + jaw * 2);
      c.lineTo(hx + 6.5, hy + 3.6);
      c.closePath();
      outlined(c, pal.blood);
    }
    c.restore();
  }

  // ---- BILLY — wire-tight, never fully still --------------------------------

  function drawBilly(c, s, pal) {
    var t = s.t, rt = s.rt;
    var w = pal.white, w2 = shade(pal.white, 0.82);
    var walk = Math.sin(t * 0.45);
    // the twitch: head jerks a quarter-turn at nothing, twice a second
    var twitch = (Math.floor(rt / 14) % 4 === 0) ? 0.3 : (Math.floor(rt / 31) % 5 === 0 ? -0.22 : 0);
    var lean = 0, sx = 1, sy = 1, jaw = 0, ghosts = 0;

    switch (s.pose) {
      case 'walk': break;
      case 'jump': lean = -0.2; break;
      case 'hit': lean = 0.5; jaw = 0.6; sx = 0.94; break;
      case 'block': sy = 0.9; lean = 0.1; break;
      case 'dazed': lean = Math.sin(t * 0.1) * 0.15; break;
      case 'light':
        if (s.phase === 'wind') { sx = 0.93; }
        else if (s.phase === 'act') { sx = 1.1; jaw = 1; twitch = 0; }
        break;
      case 'heavy': // SIX TWENTY-FIVE: uncancellable flurry
        lean = -0.25; sx = 1.12; jaw = 1; twitch = 0; ghosts = s.phase === 'act' ? 2 : 0;
        break;
      case 'special': // THE HUNDRED: lost in the rats
        sy = 0.85; lean = 0.1; jaw = 0.5; twitch = 0.5;
        break;
    }

    if (s.pose === 'down') {
      ell(c, w, 0, -5, 15, 4.4, 0);
      softEll(c, pal.liver, -4, -6.5, 5, 2.4, 0);
      ell(c, w, 13, -4.5, 4.6, 3.2, 0.2);
      softEll(c, pal.muzzle, 16.5, -4, 1.8, 1.4, 0);
      return;
    }

    c.save();
    squash(c, sx, sy);
    for (var gi = ghosts; gi >= 0; gi--) {
      c.save();
      c.translate(-gi * 4.5, 0);
      c.globalAlpha = gi ? 0.22 / gi : 1;
      billyBody(c, s, pal, w, w2, walk, twitch, lean, jaw);
      c.restore();
    }
    c.restore();
  }

  function billyBody(c, s, pal, w, w2, walk, twitch, lean, jaw) {
    // stiff tail, a straight line
    line(c, w2, 2.6, -13, -14, -19, -18);
    // legs: thin, straight, sprung
    limb(c, w2, -9, -9, -11 + walk * 2.5, 0, 2.8);
    limb(c, w2, -5, -9, -6 - walk * 2.5, 0, 2.8);
    limb(c, w2, 7, -10, 6 + walk * 2.5, 0, 2.8);
    limb(c, w2, 10, -10, 12 - walk * 2.5, 0, 2.8);
    // chest + tucked waist
    ell(c, w, 4, -13, 9.5, 7.4, -0.1 + lean * 0.3);
    ell(c, w, -7, -12, 6.5, 5.4, 0.05);
    softEll(c, pal.liver, -2, -17.5, 5.4, 3, -0.2);        // the brown patch
    softEll(c, w2, 0, -8.5, 8, 3, 0);
    // head: low and level, jerking at nothing
    c.save();
    c.translate(12.5, -17);
    c.rotate(twitch + lean * 0.4);
    ell(c, w, 0, 0, 5.2, 4.4, 0);
    ell(c, w, -1.5, -4, 1.9, 2.6, -0.35);                   // pricked ear
    softEll(c, pal.liver, -0.5, -3.4, 2.2, 1.6, -0.3);
    ell(c, pal.muzzle, 4.4, 1, 2.8, 2, 0.1);                // pink raw muzzle
    softEll(c, INK, 1.6, -1, 1.0, 1.2, 0);
    if (jaw > 0) {
      c.beginPath();
      c.ellipse(4.6, 2.4, 2 * jaw + 0.4, 1.4 * jaw + 0.3, 0.15, 0, Math.PI * 2);
      c.fillStyle = pal.rat; c.fill();
      c.lineWidth = 1; c.strokeStyle = INK; c.stroke();
    }
    c.restore();
  }

  // ---- PUSS — she stands like something that has been shown off -------------

  function drawPuss(c, s, pal) {
    var t = s.t, rt = s.rt;
    var w = pal.white, w2 = shade(pal.white, 0.85);
    var walk = Math.sin(t * 0.35);
    var lean = 0, sx = 1, sy = 1, jab = 0, headY = 0, jaw = 0;

    switch (s.pose) {
      case 'walk': break;
      case 'jump': lean = -0.2; break;
      case 'hit': lean = 0.45; jaw = 0.5; headY = 3; break;
      case 'block': sy = 0.92; headY = 2; break;
      case 'dazed': lean = Math.sin(t * 0.1) * 0.15; headY = 4; break;
      case 'light':
        if (s.phase === 'wind') sx = 0.95;
        else if (s.phase === 'act') { jab = 1; sx = 1.06; }
        break;
      case 'heavy': // BOTTOM: eats one on purpose to land hers
        lean = -0.2; headY = 2; sy = 0.95; jaw = s.phase === 'act' ? 1 : 0;
        break;
      case 'special': // THE CHAMPION'S BITCH: sustained pressure
        lean = -0.28; sx = 1.08; jaw = 1;
        break;
    }

    if (s.pose === 'down') {
      ell(c, w, 0, -5.5, 16, 4.6, 0);
      ell(c, w, 14, -5, 4.6, 3.4, 0.15);
      ribbon(c, pal, 8, -8, 0.4);
      line(c, pal.scar, 1.8, -2, -8, 3, -6);
      return;
    }

    c.save();
    squash(c, sx, sy);
    // hind
    limb(c, w2, -8, -12, -11 + walk * 2, 0, 3);
    limb(c, w2, -5, -12, -5 - walk * 2, 0, 3);
    ell(c, w, -7, -15, 7.4, 6, 0.08);
    // deep chest, forward
    ell(c, w, 4, -17, 9.4, 8.6, -0.12 + lean * 0.3);
    softEll(c, w2, 2, -11, 8, 3.2, 0);
    // clean straight front legs (the jab extends one)
    limb(c, w, 6, -13, 7 + walk * 2, 0, 3);
    limb(c, w, 9, -13, 9 - walk * 2 + jab * 9, jab ? -14 : 0, 3);
    // neck and high head — shown off
    var hx = 10 + lean * -4, hy = -26 + headY;
    limb(c, w, 7, -20, hx, hy + 3, 5);
    c.save();
    c.translate(hx, hy);
    c.rotate(lean * 0.4);
    ell(c, w, 0, 0, 5, 4.4, 0);
    ell(c, w, -2, -4, 1.8, 2.6, -0.3);
    ell(c, w, 4.2, 1, 2.8, 1.9, 0.1);
    softEll(c, INK, 1.6, -0.8, 1.0, 1.2, 0);
    if (jaw > 0) {
      c.beginPath();
      c.ellipse(4.6, 2.3, 1.9 * jaw + 0.4, 1.3 * jaw + 0.3, 0.1, 0, Math.PI * 2);
      c.fillStyle = pal.red; c.fill();
      c.lineWidth = 1; c.strokeStyle = INK; c.stroke();
    }
    c.restore();
    // Cribb's colours, ribboned on her collar — pristine while she is not
    ribbon(c, pal, 7.5, -21.5, Math.sin(rt * 0.09) * 0.25);
    // the pre-cut: a neat, deliberate, straight-edged wound. No tooth did that.
    line(c, pal.scar, 2, 3, -22.5, 8.5, -18.5);
    c.restore();
  }

  function ribbon(c, pal, x, y, flutter) {
    line(c, pal.ribbon_blue, 2.6, x - 3, y, x + 3, y + 1);
    line(c, pal.ribbon_blue, 2, x - 3, y + 0.5, x - 8, y + 4 + flutter * 3);
    line(c, pal.ribbon_buff, 2, x - 2.4, y + 1.4, x - 7, y + 6 - flutter * 3);
  }

  // ---- AISTROP — the only upright silhouette, the only rendered face --------

  function drawAistrop(c, s, pal) {
    var t = s.t, rt = s.rt;
    var coat = pal.coat, coat2 = shade(pal.coat, 0.78);
    var breathe = Math.sin(rt * 0.05) * 0.4;
    var walk = Math.sin(t * 0.25);
    var lean = 0, caneAngle = 0.9, armsFwd = 0, coinArm = 0;

    switch (s.pose) {
      case 'walk': break;
      case 'hit': lean = 0.3; break;
      case 'block': caneAngle = 0.15; break;
      case 'dazed': lean = Math.sin(t * 0.09) * 0.12; break;
      case 'light': // The Cane: a contemptuous horizontal tap
        if (s.phase === 'wind') caneAngle = 1.35;
        else if (s.phase === 'act') caneAngle = -0.05 - ease(s.p) * 0.05;
        else caneAngle = 0.5;
        break;
      case 'heavy': // TAKE UP THE SLACK: he hauls the chain
        lean = s.phase === 'act' ? -0.3 : -0.16;
        armsFwd = 1;
        break;
      case 'special': // MOPUSSES: a fistful of coins into the crowd
        coinArm = s.phase === 'wind' ? 0.5 : 1;
        break;
    }

    if (s.pose === 'down') {
      // on the sawdust — the hat stays on
      ell(c, pal.cream, -22, -5, 4, 4, 0);                       // face
      c.fillStyle = pal.black;
      c.fillRect(-31, -8.5, 7, 8); c.fillRect(-32.5, -1.5, 10, 2.4);   // hat, still on
      ell(c, coat, -2, -6, 16, 5.5, 0);
      c.fillStyle = pal.black; c.fillRect(14, -8, 9, 5);
      softEll(c, pal.gold, 4, -2, 2.2, 1.6, 0);                  // spilled guinea
      softEll(c, pal.gold, 9, -1.4, 1.8, 1.4, 0);
      return;
    }

    c.save();
    c.rotate(-lean * 0.35);
    // boots
    c.fillStyle = pal.black;
    limb(c, pal.black, -3.5, -14, -4.5 + walk * 1.6, 0, 4.2);
    limb(c, pal.black, 3.5, -14, 4.5 - walk * 1.6, 0, 4.2);
    // breeches
    limb(c, pal.cream, -3.5, -26, -3.8, -13, 4.6);
    limb(c, pal.cream, 3.5, -26, 3.8, -13, 4.6);
    // long bottle-green coat, flared skirt
    c.beginPath();
    c.moveTo(-8, -52 + breathe);
    c.quadraticCurveTo(-11.5, -36, -10.5, -22);
    c.lineTo(-4, -24);
    c.lineTo(0, -22);
    c.lineTo(4, -24);
    c.lineTo(10.5, -22);
    c.quadraticCurveTo(11.5, -36, 8, -52 + breathe);
    c.quadraticCurveTo(0, -56 + breathe, -8, -52 + breathe);
    c.closePath();
    outlined(c, coat);
    softEll(c, coat2, 0, -30, 7.5, 6, 0);
    // cravat
    c.beginPath();
    c.moveTo(-3, -51 + breathe); c.lineTo(3, -51 + breathe); c.lineTo(0.5, -41 + breathe); c.closePath();
    outlined(c, pal.cream);
    // coin purse at the hip — he pays out of it without looking
    ell(c, pal.gold, 8.5, -27, 3.2, 3.8, 0.15);
    line(c, INK, 1, 6.5, -30, 10.5, -30);
    // left arm: holds the chain (drawn by the stage pass to the tethered animal)
    if (armsFwd) {
      limb(c, coat, -6, -46 + breathe, -14, -34, 4);
      limb(c, coat, 6, -46 + breathe, -12, -31, 4);
      line(c, pal.chain, 2, -14, -34, -12, -31);
    } else {
      limb(c, coat, -6, -46 + breathe, -9, -30, 4);
      softEll(c, pal.cream, -9.5, -29, 2, 2, 0);
    }
    // right arm + malacca cane
    if (coinArm) {
      limb(c, coat, 6, -46 + breathe, 13, -56 - coinArm * 4, 4);
      softEll(c, pal.cream, 13.5, -58 - coinArm * 4, 2, 2, 0);
      if (s.phase === 'act') for (var k = 0; k < 3; k++) softEll(c, pal.gold, 16 + k * 4, -60 - k * 3, 1.6, 1.6, 0);
    } else if (!armsFwd) {
      var hx0 = 8, hy0 = -38 + breathe;
      limb(c, coat, 6, -46 + breathe, hx0, hy0, 4);
      softEll(c, pal.cream, hx0 + 0.5, hy0 + 0.5, 2, 2, 0);
      // cane from the hand
      var cx2 = hx0 + Math.cos(caneAngle) * 26, cy2 = hy0 + Math.sin(caneAngle) * 26;
      line(c, pal.black, 2.2, hx0, hy0, cx2, cy2);
      softEll(c, pal.gold, hx0 - Math.cos(caneAngle) * 2.4, hy0 - Math.sin(caneAngle) * 2.4, 1.8, 1.8, 0);
    }
    // the face — the only rendered face in the game
    var fy = -60 + breathe;
    ell(c, pal.cream, 0, fy, 5.6, 6, 0);
    softEll(c, INK, -1.8, fy - 0.8, 0.9, 1.1, 0);
    softEll(c, INK, 1.8, fy - 0.8, 0.9, 1.1, 0);
    c.beginPath(); c.moveTo(-1.6, fy + 2.8); c.quadraticCurveTo(0.4, fy + 3.8, 2.2, fy + 2.6);
    c.lineWidth = 1; c.strokeStyle = INK; c.stroke();  // the pleasant, terrible smile
    line(c, shade(pal.cream, 0.8), 1, -4.5, fy + 3.6, -2, fy + 4.4); // whisker shadow
    // tall beaver hat: he never takes it off
    c.beginPath(); c.ellipse(0, fy - 5.4, 8.2, 1.8, 0, 0, Math.PI * 2);
    c.fillStyle = pal.black; c.fill(); c.lineWidth = 1.4; c.strokeStyle = INK; c.stroke();
    c.beginPath();
    c.moveTo(-5.4, fy - 5.8); c.lineTo(-6.2, fy - 19); c.lineTo(6.2, fy - 19); c.lineTo(5.4, fy - 5.8);
    c.closePath();
    outlined(c, pal.black);
    c.restore();
  }

  // ---- registry -------------------------------------------------------------

  var DRAWERS = { jacco: drawJacco, brock: drawBrock, billy: drawBilly, puss: drawPuss, aistrop: drawAistrop };

  // palette slots each drawer actually reads — validated by the headless suite
  var REQUIRED_PALETTE = {
    jacco: ['fur', 'muzzle', 'wound', 'chain'],
    brock: ['coat', 'stripe', 'ochre', 'blood'],
    billy: ['white', 'liver', 'muzzle', 'rat'],
    puss: ['white', 'ribbon_blue', 'ribbon_buff', 'scar', 'red'],
    aistrop: ['coat', 'cream', 'black', 'gold', 'chain']
  };

  // Draw a character at the current origin (feet at 0,0, facing +x).
  function draw(ctx, id, spec, palette) {
    var fn = DRAWERS[id];
    if (!fn) throw new Error('chars: no drawer for character "' + id + '"');
    var req = REQUIRED_PALETTE[id];
    for (var i = 0; i < req.length; i++) {
      if (!palette[req[i]]) {
        throw new Error('chars: character "' + id + '" palette is missing "' + req[i] +
          '" (data/characters/' + id + '.yaml)');
      }
    }
    fn(ctx, spec, palette);
  }

  // approximate visual heights (logical units) for shadows/flashes
  var HEIGHTS = { jacco: 24, brock: 20, billy: 24, puss: 31, aistrop: 82 };
  var WIDTHS = { jacco: 30, brock: 46, billy: 34, puss: 34, aistrop: 26 };

  g.MB = g.MB || {};
  g.MB.Chars = {
    draw: draw, DRAWERS: DRAWERS, REQUIRED_PALETTE: REQUIRED_PALETTE,
    HEIGHTS: HEIGHTS, WIDTHS: WIDTHS, INK: INK, shade: shade
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = g.MB.Chars;
})(typeof window !== 'undefined' ? window : globalThis);
