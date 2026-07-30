/* MONKEY BAITING - the browser shell (architecture stage S7).
 *
 * THIS FILE COMPUTES NO GAMEPLAY. Every number it draws was produced by the C
 * core and read back through a wasm_* scalar accessor (root CLAUDE.md decision
 * 19). There is no health arithmetic here, no hit detection, no AI, no timer,
 * no state machine - those all live in sandboxes/monkey-baiting/systems/native
 * and are the same functions the tournament simulator runs. The retired
 * logic.js has no successor in this tree, which is the whole point of the
 * stage (architecture ruling 1.4(b): "no vestigial JS logic").
 *
 * What the shell DOES own: pixels, sound, keys, and which fight to ask for.
 *
 * ONE RENDER LOOP (root CLAUDE.md "Rendering Architecture"). requestAnimationFrame
 * runs forever and draws whatever the current state is. Buttons and keys mutate
 * input state only; the simulation advances on its own fixed step inside the
 * same callback. Nothing else touches the canvas.
 *
 * FIXED POINT AT THE BOUNDARY. Positions, velocities, health and hurtbox sizes
 * arrive as raw Q16.16 integers. `fp()` is the only place they become numbers
 * for drawing. Nothing converted here is ever fed back into the simulation. */
(function (g) {
  'use strict';

  var MB = g.MB = g.MB || {};

  /* ---------------------------------------------------------------- exports */

  /* Bound in boot(); each is a cwrap of a wasm_* export. */
  var C = {};

  function bind(Module) {
    function n(name, ret, args) { C[name] = Module.cwrap('wasm_' + name, ret, args || []); }
    var I = 'number', S = 'string';

    n('init', I);
    n('start_match', I, [S, S, S, S, I]);
    n('tick', I);
    n('free', null);

    n('set_human', null, [I]);
    n('get_human', I);
    n('set_input', null, [I, I]);
    ['left', 'right', 'jump', 'light', 'heavy', 'special', 'block', 'stakes_down']
      .forEach(function (k) { n('in_' + k, I); });

    ['fp_one', 'ring_left', 'ring_right', 'ring_center', 'logic_hz',
     'time_seconds', 'wins_to_take_match', 'max_rounds',
     'char_count', 'bot_count', 'move_key_count',
     'match_phase', 'match_phase_t', 'match_timer', 'match_round', 'match_frame',
     'match_freeze', 'match_slowmo', 'match_shake', 'match_active',
     'match_finished', 'match_winner', 'match_drawn', 'match_finishers',
     'match_seed_index',
     'cross_window', 'cross_t', 'cross_cheater', 'cross_victim',
     'finisher_armed', 'finisher_window', 'finisher_done',
     'hazard_count', 'harvested', 'result_hash'
    ].forEach(function (k) { n(k, I); });

    n('char_name', S, [I]);
    n('bot_name', S, [I]);
    n('move_key_name', S, [I]);
    n('sim_version', S);
    n('char_palette', S, [I, S]);
    n('char_has_move', I, [I, I]);
    n('char_max_health', I, [I]);
    n('result_field', I, [I, I]);
    n('f_cooldown', I, [I, I]);

    ['hazard_kind', 'hazard_t', 'hazard_dur', 'hazard_owner',
     'hazard_x', 'hazard_y', 'hazard_w'
    ].forEach(function (k) { n(k, I, [I]); });

    ['f_x', 'f_y', 'f_vx', 'f_vy', 'f_hp', 'f_max_hp', 'f_hurt_w', 'f_hurt_h',
     'f_took_damage', 'f_state', 'f_t', 'f_facing', 'f_stun_t', 'f_dazed_t',
     'f_block_stun', 'f_ripple', 'f_move_key', 'f_move_startup', 'f_move_active',
     'f_move_recovery', 'f_move_type', 'f_char_id', 'f_rounds_won', 'f_grab_t',
     'f_yank_active', 'f_input', 'f_policy_kind'
    ].forEach(function (k) { n(k, I, [I]); });
  }

  var FP = 65536;
  function fp(v) { return v / FP; }

  /* MbState, mirrored from systems/native/mb_types.h. Read-only labels: the
   * state machine itself is entirely in C. */
  var ST = {
    IDLE: 0, WALK: 1, JUMP: 2, ATTACK: 3, STUN: 4, BLOCK: 5, DAZED: 6,
    KO: 7, DOWN: 8, GRAB_HOLD: 9, GRABBED: 10, FINISH: 11, FINISH_VICTIM: 12
  };
  /* MbPhase */
  var PH = { EMPTY: 0, INTRO: 1, FIGHT: 2, ROUNDEND: 3, FINISHER: 4, END: 5, DONE: 6 };
  /* MbHazardKind */
  var HZ = { RATS: 1, COINS: 2, THROWN: 3 };

  /* Presentation-only geometry. floor_y is where the boards are DRAWN; the
   * simulation's y is height ABOVE the floor and never needs it. The width and
   * height match app.yaml map_size, which is the internal render resolution. */
  var VIEW_W = 400, VIEW_H = 225, FLOOR_Y = 190;

  /* The bot id a human-played side wears - see startNextFight. */
  var PLAYER_BOT = 'dummy';

  /* -------------------------------------------------------------- the state */

  var S = {
    screen: 'boot',       /* boot | select | fight | interlude | over */
    screenT: 0,
    error: null,
    roster: [],           /* [{id, name, palette}] */
    picked: -1,           /* the player's character */
    ladder: [],           /* char ids still to fight */
    ladderAt: 0,
    wins: 0,
    seedIndex: 0,
    bot: 'house',         /* the opponent temperament; a bots.yaml key */
    lastResult: null,
    held: {},             /* action name -> true */
    muted: false,
    cursor: 0
  };

  /* ------------------------------------------------------------------ input */

  /* action name -> the MB_IN_* bit the core defines. Read from the core so the
   * bit values are never duplicated here. */
  var BITS = {};

  var KEYS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump',
    a: 'left', d: 'right', w: 'jump',
    j: 'light', k: 'heavy', l: 'special', s: 'block',
    z: 'light', x: 'heavy', c: 'special', ' ': 'stakes_down'
  };

  function inputBits() {
    var b = 0;
    for (var k in S.held) if (S.held[k] && BITS[k]) b |= BITS[k];
    return b;
  }

  function bindInput(canvas) {
    function set(act, on) {
      if (!act) return;
      S.held[act] = on;
      if (on) S.anyKey = true;
    }
    g.addEventListener('keydown', function (e) {
      var act = KEYS[e.key] || KEYS[String(e.key).toLowerCase()];
      if (act) { set(act, true); e.preventDefault(); }
      if (e.key === 'Enter' || e.key === ' ') { S.confirm = true; }
      if (e.key === 'ArrowLeft') S.navL = true;
      if (e.key === 'ArrowRight') S.navR = true;
    });
    g.addEventListener('keyup', function (e) {
      var act = KEYS[e.key] || KEYS[String(e.key).toLowerCase()];
      if (act) { set(act, false); e.preventDefault(); }
    });
    /* Losing focus must not leave a button welded down. */
    g.addEventListener('blur', function () { S.held = {}; });

    /* On-screen pad, the same seven actions. */
    var pad = document.getElementById('pad');
    if (pad) {
      Array.prototype.forEach.call(pad.querySelectorAll('.btn'), function (el) {
        var act = el.getAttribute('data-act');
        function down(e) { e.preventDefault(); set(act, true); el.classList.add('on'); S.confirm = true; }
        function up(e) { e.preventDefault(); set(act, false); el.classList.remove('on'); }
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('pointerleave', up);
      });
    }
    canvas.addEventListener('pointerdown', function () { S.confirm = true; });
  }

  function takeConfirm() { var c = S.confirm; S.confirm = false; return c; }
  function takeNav() {
    var n = (S.navR ? 1 : 0) - (S.navL ? 1 : 0);
    S.navL = S.navR = false;
    return n;
  }

  /* -------------------------------------------------------------- the roster */

  /* The cast comes out of the core, in app.yaml's canonical order. The shell
   * has no roster of its own - adding a character to the sandbox adds it here
   * with no JS change (root CLAUDE.md decision 13). */
  function loadRoster() {
    var out = [], i, k;
    var KEYS_BY_ID = g.MB.Chars.REQUIRED_PALETTE;
    for (i = 0; i < C.char_count(); i++) {
      var name = C.char_name(i);
      var pal = {};
      var req = KEYS_BY_ID[name] || [];
      for (k = 0; k < req.length; k++) pal[req[k]] = C.char_palette(i, req[k]);
      out.push({ id: i, name: name, palette: pal });
    }
    return out;
  }

  /* ------------------------------------------------------------- the ladder */

  /* THE SIMPLIFIED CAMPAIGN (see the S7 as-built note in the architecture
   * spec). The retired game ran five scripted campaigns out of
   * web/monkey-baiting/data/{structure,script}.yaml - a node graph of screens,
   * announcer lines and endings. That narrative data was never ported to the
   * canonical sandbox (it is not gameplay and the balance loop never touched
   * it), so this ship is an ARCADE LADDER instead: pick a monkey, fight the
   * rest of the cast in roster order, one match each. It uses only data the
   * core already owns. The scripted campaigns are deferred, not deleted. */
  function buildLadder(pickedId) {
    var l = [], i;
    for (i = 0; i < S.roster.length; i++) if (i !== pickedId) l.push(i);
    return l;
  }

  function startNextFight() {
    var foe = S.ladder[S.ladderAt];
    /* The player's side still carries a bot id: entrant identity is
     * "<char>:<bot>" and the seeding is derived from it (../../CLAUDE.md), so
     * a human side cannot be nameless without inventing a second identity
     * scheme. `dummy` is the id it wears; human_input overwrites whatever it
     * decides, so the choice affects nothing but the entrant string. Note that
     * a result row from a human-played match is therefore LABELLED as dummy -
     * these rows are not tournament rows and are never scored. */
    var ok = C.start_match(S.roster[S.picked].name, PLAYER_BOT,
                           S.roster[foe].name, S.bot, S.seedIndex);
    if (!ok) {
      /* No silent fallback (root CLAUDE.md decision 12): if the core refused
       * the pairing, say so on the canvas rather than playing something else.
       * The reason is already on the console, from C. */
      S.error = 'the core refused ' + S.roster[S.picked].name + ' vs ' +
                S.roster[foe].name + ' - see the console';
      S.screen = 'over';
      return;
    }
    C.set_human(1);                 /* side 0 is the player */
    C.set_input(0, 0);
    S.screen = 'fight';
    S.screenT = 0;
    S.lastResult = null;
  }

  /* ---------------------------------------------------------------- drawing */

  var cv, b;

  function text(str, x, y, px, color, align, weight) {
    b.font = (weight || '') + ' ' + px + 'px Georgia, "Times New Roman", serif';
    b.fillStyle = color;
    b.textAlign = align || 'left';
    b.fillText(str, x, y);
    b.textAlign = 'left';
  }

  function mono(str, x, y, px, color, align) {
    b.font = px + 'px "Courier New", monospace';
    b.fillStyle = color;
    b.textAlign = align || 'left';
    b.fillText(str, x, y);
    b.textAlign = 'left';
  }

  /* The booth: boards, wall, the stake in the middle. Presentation only. */
  function drawStage() {
    var grad = b.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, '#151210');
    grad.addColorStop(0.62, '#241d18');
    grad.addColorStop(1, '#100c0a');
    b.fillStyle = grad;
    b.fillRect(0, 0, VIEW_W, VIEW_H);

    /* back wall boards */
    var i;
    for (i = 0; i < 26; i++) {
      b.fillStyle = i % 2 ? '#2a221c' : '#251e19';
      b.fillRect(i * 16, 70, 15, FLOOR_Y - 70);
    }
    b.fillStyle = 'rgba(0,0,0,0.35)';
    b.fillRect(0, 70, VIEW_W, 10);

    /* the pit floor */
    b.fillStyle = '#3b3029';
    b.fillRect(0, FLOOR_Y, VIEW_W, VIEW_H - FLOOR_Y);
    b.fillStyle = 'rgba(0,0,0,0.28)';
    for (i = 0; i < VIEW_W; i += 23) b.fillRect(i, FLOOR_Y, 1, VIEW_H - FLOOR_Y);

    /* the ring walls, straight off the core's geometry */
    var L = C.ring_left(), R = C.ring_right();
    b.fillStyle = '#1b1512';
    b.fillRect(0, 80, L - 4, FLOOR_Y - 80);
    b.fillRect(R + 4, 80, VIEW_W - R - 4, FLOOR_Y - 80);
    b.strokeStyle = '#5a4c3c';
    b.lineWidth = 1;
    b.beginPath();
    b.moveTo(L - 3.5, 80); b.lineTo(L - 3.5, FLOOR_Y);
    b.moveTo(R + 3.5, 80); b.lineTo(R + 3.5, FLOOR_Y);
    b.stroke();

    /* the stake at ring centre */
    var cx = C.ring_center();
    b.fillStyle = '#3a3d40';
    b.fillRect(cx - 2, FLOOR_Y - 9, 4, 10);
    b.fillStyle = '#4A4E52';
    b.fillRect(cx - 3.4, FLOOR_Y - 10.4, 6.8, 3);
  }

  /* The reference's specOf, rebuilt over the exports. Same three-phase split of
   * an attack, but the frame data comes from the authored character files via
   * the core, not from a JS copy of them. */
  function specOf(side, rt) {
    var st = C.f_state(side), t = C.f_t(side);
    var pose = 'idle', phase = null, p = 0;
    switch (st) {
      case ST.WALK: pose = 'walk'; break;
      case ST.JUMP: pose = 'jump'; break;
      case ST.BLOCK: pose = 'block'; break;
      case ST.STUN: pose = C.f_block_stun(side) ? 'block' : 'hit'; break;
      case ST.GRABBED: pose = 'hit'; break;
      case ST.DAZED: pose = 'dazed'; break;
      case ST.KO: pose = 'hit'; break;
      case ST.DOWN: case ST.FINISH_VICTIM: pose = 'down'; break;
      case ST.GRAB_HOLD: pose = 'grab_hold'; break;
      case ST.FINISH: pose = 'special'; phase = 'act'; p = 0.4; break;
      case ST.ATTACK: {
        var key = C.f_move_key(side);
        var name = key >= 0 ? C.move_key_name(key) : '';
        pose = (name === 'stakes_down' || name === '') ? 'special' : name;
        var su = C.f_move_startup(side), act = C.f_move_active(side),
            rec = C.f_move_recovery(side);
        if (t < su) { phase = 'wind'; p = t / Math.max(1, su); }
        else if (t < su + act) { phase = 'act'; p = (t - su) / Math.max(1, act); }
        else { phase = 'rec'; p = (t - su - act) / Math.max(1, rec); }
        break;
      }
      default: pose = 'idle';
    }
    return {
      pose: pose, phase: phase, p: p, t: t, rt: rt,
      ripple: !!C.f_ripple(side), airborne: fp(C.f_y(side)) > 0.01
    };
  }

  function drawFighter(side, rt) {
    var cid = C.f_char_id(side);
    if (cid < 0) return;
    var def = S.roster[cid];
    if (!def) return;
    var Chars = g.MB.Chars;
    var x = fp(C.f_x(side)), y = fp(C.f_y(side));
    var w = Chars.WIDTHS[def.name] || 30, h = Chars.HEIGHTS[def.name] || 24;

    b.beginPath();
    b.ellipse(x, FLOOR_Y + 2, w * 0.42, 2.6, 0, 0, Math.PI * 2);
    b.fillStyle = 'rgba(0,0,0,0.35)';
    b.fill();

    b.save();
    b.translate(x, FLOOR_Y - y);
    b.scale(C.f_facing(side), 1);
    Chars.draw(b, def.name, specOf(side, rt), def.palette);
    b.restore();

    /* fresh-hit flash */
    var t = C.f_t(side);
    if (C.f_state(side) === ST.STUN && t < 5 && !C.f_block_stun(side)) {
      b.beginPath();
      b.arc(x, FLOOR_Y - y - h * 0.55, 4 + t * 3, 0, Math.PI * 2);
      b.strokeStyle = 'rgba(245,239,216,' + (0.7 - t * 0.13) + ')';
      b.lineWidth = Math.max(0.6, 2.2 - t * 0.3);
      b.stroke();
      b.lineWidth = 1;
    }
  }

  function drawHazards() {
    var n = C.hazard_count(), i;
    for (i = 0; i < n; i++) {
      var kind = C.hazard_kind(i);
      var x = fp(C.hazard_x(i)), y = fp(C.hazard_y(i)), w = fp(C.hazard_w(i));
      if (kind === HZ.RATS) {
        var k;
        for (k = 0; k < 5; k++) {
          var rx = x - w / 2 + (w * (k + 0.5)) / 5;
          var bob = Math.sin((C.hazard_t(i) + k * 7) * 0.35) * 1.2;
          b.fillStyle = '#3d3630';
          b.beginPath();
          b.ellipse(rx, FLOOR_Y - 2 + bob, 3.2, 1.8, 0, 0, Math.PI * 2);
          b.fill();
        }
      } else if (kind === HZ.COINS) {
        b.fillStyle = 'rgba(201,162,39,0.22)';
        b.fillRect(x - w / 2, FLOOR_Y - 16, w, 16);
        b.strokeStyle = 'rgba(201,162,39,0.55)';
        b.strokeRect(x - w / 2, FLOOR_Y - 16, w, 16);
      } else if (kind === HZ.THROWN) {
        b.fillStyle = '#8a7350';
        b.beginPath();
        b.arc(x, FLOOR_Y - y, 2.4, 0, Math.PI * 2);
        b.fill();
      }
    }
  }

  /* Chalk betting slates. Health, rounds and the clock are all read values. */
  function drawSlate(x, w, name, hpFrac, rounds, right) {
    b.fillStyle = 'rgba(18,16,14,0.82)';
    b.fillRect(x, 8, w, 20);
    b.strokeStyle = '#4a4236';
    b.lineWidth = 1;
    b.strokeRect(x + 0.5, 8.5, w - 1, 19);

    b.fillStyle = '#2a2420';
    b.fillRect(x + 4, 19, w - 8, 5);
    b.fillStyle = hpFrac > 0.3 ? '#c9a227' : '#a33323';
    var bw = Math.max(0, Math.min(1, hpFrac)) * (w - 8);
    b.fillRect(right ? x + 4 + (w - 8 - bw) : x + 4, 19, bw, 5);

    text(name.toUpperCase(), right ? x + w - 5 : x + 5, 17, 9, '#e8ddc0',
         right ? 'right' : 'left');

    var i;
    for (i = 0; i < C.wins_to_take_match(); i++) {
      b.fillStyle = i < rounds ? '#c9a227' : '#443c30';
      b.beginPath();
      b.arc(right ? x + w - 6 - i * 7 : x + 6 + i * 7, 32, 2.2, 0, Math.PI * 2);
      b.fill();
    }
  }

  function drawHud() {
    drawSlate(6, 150, S.roster[C.f_char_id(0)].name,
              C.f_hp(0) / Math.max(1, C.f_max_hp(0)), C.f_rounds_won(0), false);
    drawSlate(VIEW_W - 156, 150, S.roster[C.f_char_id(1)].name,
              C.f_hp(1) / Math.max(1, C.f_max_hp(1)), C.f_rounds_won(1), true);

    /* The watch: the core's timer, ticking in whole seconds. */
    var secs = Math.ceil(C.match_timer() / Math.max(1, C.logic_hz()));
    b.fillStyle = 'rgba(18,16,14,0.85)';
    b.beginPath();
    b.arc(VIEW_W / 2, 20, 13, 0, Math.PI * 2);
    b.fill();
    b.strokeStyle = '#7a6a45';
    b.stroke();
    mono(String(secs), VIEW_W / 2, 24, 12, '#e8ddc0', 'center');

    mono('ROUND ' + C.match_round(), VIEW_W / 2, 40, 7, '#8a7f6c', 'center');

    if (C.cross_window() > 0)
      text('THE CROSS', VIEW_W / 2, 56, 12, '#d24a33', 'center', 'bold');
    else if (C.finisher_armed())
      text('FINISH HIM', VIEW_W / 2, 56, 12, '#c9a227', 'center', 'bold');
  }

  function drawBanner(str, sub) {
    b.fillStyle = 'rgba(10,8,7,0.72)';
    b.fillRect(0, 84, VIEW_W, sub ? 56 : 38);
    text(str, VIEW_W / 2, 110, 22, '#e8ddc0', 'center', 'bold');
    if (sub) mono(sub, VIEW_W / 2, 128, 8, '#9a8f78', 'center');
  }

  function drawSelect() {
    drawStage();
    b.fillStyle = 'rgba(10,8,7,0.55)';
    b.fillRect(0, 0, VIEW_W, VIEW_H);
    text('MONKEY BAITING', VIEW_W / 2, 34, 22, '#e8ddc0', 'center', 'bold');
    mono('choose your monkey  -  arrows to move, enter to take the chain',
         VIEW_W / 2, 48, 7, '#8a7f6c', 'center');

    var n = S.roster.length, i;
    var step = VIEW_W / (n + 1);
    for (i = 0; i < n; i++) {
      var cx = step * (i + 1);
      var on = i === S.cursor;
      b.save();
      b.translate(cx, 150);
      b.scale(on ? 1.15 : 0.85, on ? 1.15 : 0.85);
      try {
        g.MB.Chars.draw(b, S.roster[i].name,
          { pose: 'idle', phase: null, p: 0, t: S.screenT, rt: S.screenT,
            ripple: false, airborne: false },
          S.roster[i].palette);
      } catch (e) { /* a drawer is presentation; never let it stop the loop */ }
      b.restore();
      text(S.roster[i].name.toUpperCase(), cx, 168, on ? 10 : 8,
           on ? '#e8ddc0' : '#6d6455', 'center', on ? 'bold' : '');
    }
    mono('opponent temperament: ' + S.bot, VIEW_W / 2, 196, 7, '#6d6455', 'center');
  }

  function drawOver() {
    drawStage();
    b.fillStyle = 'rgba(10,8,7,0.7)';
    b.fillRect(0, 0, VIEW_W, VIEW_H);
    if (S.error) {
      text('THE BOOTH IS SHUT', VIEW_W / 2, 90, 18, '#d24a33', 'center', 'bold');
      mono(S.error, VIEW_W / 2, 112, 7, '#9a8f78', 'center');
      return;
    }
    var beat = S.wins >= S.ladder.length;
    text(beat ? 'THE BOOTH IS YOURS' : 'CARRIED OUT', VIEW_W / 2, 90, 20,
         beat ? '#c9a227' : '#8a7f6c', 'center', 'bold');
    mono(S.wins + ' of ' + S.ladder.length + ' taken', VIEW_W / 2, 112, 8,
         '#9a8f78', 'center');
    mono('press enter for another go', VIEW_W / 2, 150, 7, '#6d6455', 'center');
  }

  function drawFight(rt) {
    var shake = fp(C.match_shake());
    b.save();
    if (shake > 0.01) {
      b.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawStage();
    drawHazards();
    /* The opponent draws first so the player is always in front. */
    drawFighter(1, rt);
    drawFighter(0, rt);
    b.restore();

    drawHud();

    var ph = C.match_phase();
    if (ph === PH.INTRO) drawBanner('MONKEY BAITING', 'have at him');
    else if (ph === PH.ROUNDEND) drawBanner('ROUND ' + C.match_round());
    else if (ph === PH.FINISHER) drawBanner('FINISH HIM');
    else if (ph === PH.END || ph === PH.DONE) {
      var w = C.match_winner();
      drawBanner(C.match_drawn() ? 'NO DECISION'
                                 : (w === 0 ? 'YOU TAKE IT' : 'YOU ARE DONE'));
    }
  }

  function drawInterlude() {
    drawStage();
    b.fillStyle = 'rgba(10,8,7,0.66)';
    b.fillRect(0, 0, VIEW_W, VIEW_H);
    var won = S.lastResult && S.lastResult.winner === 0;
    text(won ? 'HE IS DOWN' : 'YOU ARE DOWN', VIEW_W / 2, 88, 18,
         won ? '#c9a227' : '#a33323', 'center', 'bold');
    if (S.lastResult) {
      mono('rounds ' + S.lastResult.rounds + '  frames ' + S.lastResult.frames,
           VIEW_W / 2, 108, 7, '#9a8f78', 'center');
    }
    mono(won ? 'press enter - the next one is waiting'
             : 'press enter to leave the booth',
         VIEW_W / 2, 140, 7, '#6d6455', 'center');
  }

  /* ------------------------------------------------------------- the loop */

  var acc = 0, last = 0, stepMs = 1000 / 60;

  /* Advances the SIMULATION on its own fixed step, independent of the display
   * refresh rate. One wasm_tick is one frame at logic_hz - the same frame the
   * tournament simulator steps (mb_engine.h, FRAME = TURN). A slow frame is
   * caught up, but never by more than a few steps, so a backgrounded tab does
   * not fast-forward the fight on return. */
  function advance(dtMs) {
    var steps = 0;
    acc += dtMs;
    while (acc >= stepMs && steps < 6) {
      if (C.get_human()) C.set_input(0, inputBits());
      C.tick();
      acc -= stepMs;
      steps++;
      if (C.match_finished()) break;
    }
    if (acc > stepMs * 6) acc = 0;
  }

  function harvestResult() {
    S.lastResult = {
      winner: C.result_field(0, 3),
      frames: C.result_field(0, 4),
      rounds: C.result_field(0, 5),
      drawn: C.result_field(0, 10),
      hash: C.result_hash()
    };
    if (S.lastResult.winner === 0) S.wins++;
  }

  function step(dtMs) {
    S.screenT++;
    switch (S.screen) {
      case 'select': {
        var nav = takeNav();
        if (nav) S.cursor = (S.cursor + nav + S.roster.length) % S.roster.length;
        if (takeConfirm()) {
          S.picked = S.cursor;
          S.ladder = buildLadder(S.picked);
          S.ladderAt = 0;
          S.wins = 0;
          startNextFight();
        }
        break;
      }
      case 'fight': {
        advance(dtMs);
        if (C.harvested() >= 1) {
          harvestResult();
          S.screen = 'interlude';
          S.screenT = 0;
          S.held = {};
        }
        break;
      }
      case 'interlude': {
        if (S.screenT > 30 && takeConfirm()) {
          if (S.lastResult && S.lastResult.winner === 0) {
            S.ladderAt++;
            S.seedIndex++;
            if (S.ladderAt >= S.ladder.length) { S.screen = 'over'; S.screenT = 0; }
            else startNextFight();
          } else {
            S.screen = 'over';
            S.screenT = 0;
          }
        }
        break;
      }
      case 'over': {
        if (S.screenT > 30 && takeConfirm()) {
          S.screen = 'select';
          S.screenT = 0;
          S.error = null;
        }
        break;
      }
    }
  }

  function frame(now) {
    var dt = last ? Math.min(now - last, 250) : 0;
    last = now;

    try {
      step(dt);
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.clearRect(0, 0, VIEW_W, VIEW_H);
      if (S.screen === 'select') drawSelect();
      else if (S.screen === 'fight') drawFight(S.screenT);
      else if (S.screen === 'interlude') drawInterlude();
      else if (S.screen === 'over') drawOver();
      else { drawStage(); text('...', VIEW_W / 2, 112, 14, '#6d6455', 'center'); }
    } catch (e) {
      /* Fail loudly and stop, rather than repainting a broken frame 60 times a
       * second (root CLAUDE.md decision 12). */
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.fillStyle = '#150a08';
      b.fillRect(0, 0, VIEW_W, VIEW_H);
      mono(String(e && e.message || e), 8, 20, 7, '#d24a33');
      console.error(e);
      return;
    }
    g.requestAnimationFrame(frame);
  }

  /* -------------------------------------------------------------- layout */

  function fit() {
    var s = Math.max(1, Math.min(
      Math.floor(g.innerWidth / VIEW_W * 100) / 100,
      Math.floor(g.innerHeight / VIEW_H * 100) / 100));
    /* Never measure a container that contains the canvas (root CLAUDE.md
     * decision 21): the window is the only thing asked. */
    cv.style.width = Math.floor(VIEW_W * s) + 'px';
    cv.style.height = Math.floor(VIEW_H * s) + 'px';
    cv.style.left = Math.floor((g.innerWidth - VIEW_W * s) / 2) + 'px';
    cv.style.top = Math.floor((g.innerHeight - VIEW_H * s) / 2) + 'px';
  }

  /* ---------------------------------------------------------------- boot */

  MB.boot = function (Module) {
    cv = document.getElementById('game');
    cv.width = VIEW_W;
    cv.height = VIEW_H;
    b = cv.getContext('2d');
    b.imageSmoothingEnabled = false;

    bind(Module);

    if (!C.init()) throw new Error('the core refused to start - see the console');

    FP = C.fp_one();
    stepMs = 1000 / C.logic_hz();
    BITS = {
      left: C.in_left(), right: C.in_right(), jump: C.in_jump(),
      light: C.in_light(), heavy: C.in_heavy(), special: C.in_special(),
      block: C.in_block(), stakes_down: C.in_stakes_down()
    };
    S.roster = loadRoster();
    if (!S.roster.length) throw new Error('the core reported an empty cast');

    bindInput(cv);
    fit();
    g.addEventListener('resize', fit);

    /* APPEND, never replace: publish.py stamps the version and source commit
     * into this div and reads the commit back to refuse a no-op republish
     * (root CLAUDE.md decision 22). Overwriting it would break that check and
     * hide which build is actually being served. */
    var stamp = document.getElementById('version');
    if (stamp) stamp.textContent = 'MONKEY BAITING ' + stamp.textContent +
                                   ' - ' + C.sim_version();

    S.screen = 'select';
    S.screenT = 0;
    g.requestAnimationFrame(frame);
  };

  /* The console handle. Everything the owner (or Claude) needs to inspect a
   * running fight from devtools, and the S7 cross-target determinism check:
   * MB.probe() after a match reports the result row and hash the batch
   * simulator prints for the same pairing and seed. */
  MB.dev = {
    state: S,
    core: C,
    probe: function () {
      return {
        sim_version: C.sim_version(),
        seed_index: C.match_seed_index(),
        harvested: C.harvested(),
        hash: C.result_hash() >>> 0,
        row: {
          winner: C.result_field(0, 3), frames: C.result_field(0, 4),
          rounds: C.result_field(0, 5), tie_rounds: C.result_field(0, 6),
          timeouts: C.result_field(0, 7), finishers: C.result_field(0, 8),
          capped: C.result_field(0, 9), drawn: C.result_field(0, 10)
        }
      };
    },
    /* Plays a whole match headlessly with both sides on their bots - the
     * browser-side half of the determinism spot-check. */
    exhibition: function (c0, b0, c1, b1, seed, maxFrames) {
      if (!C.start_match(c0, b0, c1, b1, seed | 0)) return null;
      C.set_human(0);
      var i, cap = maxFrames || 60000;
      for (i = 0; i < cap && C.harvested() < 1; i++) C.tick();
      return MB.dev.probe();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
