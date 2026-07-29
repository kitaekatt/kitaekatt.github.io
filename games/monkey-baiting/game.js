/* MONKEY BAITING — game.js
   Bootstrap + screen flow + input + fixed-timestep loop.
   Progression is driven entirely by data/structure.yaml's flow graph:
   no hardcoded fight order or screen sequence here. */
(function () {
  'use strict';

  var VERSION = 'v6';
  var MB = window.MB;

  var game = {
    version: VERSION,
    mode: 'loading',
    nodeName: null, node: null,
    lastFightNode: null,
    campaignId: null,
    selIndex: 0, selMove: 0,
    retries: 0,
    fightIndex: 0,
    seqPos: 0,
    match: null,
    dialogue: null,
    card: null,
    continueDisplay: null,
    screenT: 0,
    fx: { roundText: '', announce: null, finisherPrompt: '', finisherName: '', gutter: 0 },
    data: null
  };

  function campScript() { return game.data.script.campaigns[game.campaignId]; }
  function campStruct() { return game.data.structure.campaigns[game.campaignId]; }
  // announcer line: campaign override if present, else the shared line
  function ann(key) {
    var cs = campScript();
    if (cs && cs.announcer && cs.announcer[key]) return cs.announcer[key];
    return game.data.script.shared.announcer[key];
  }

  var input = MB.Logic.emptyInput();
  var confirmQueued = false;

  // ---- fatal errors: fail loudly, name the file/field ----------------------

  function fatal(err) {
    var pre = document.createElement('pre');
    pre.style.cssText = 'position:fixed;inset:0;background:#160f0c;color:#e8ddc0;' +
      'padding:24px;font:13px/1.5 monospace;white-space:pre-wrap;overflow:auto;z-index:99;margin:0';
    pre.textContent = 'MONKEY BAITING failed to start.\n\n' +
      (err && err.message ? err.message : String(err)) +
      '\n\nFix the data file and reload.';
    document.body.appendChild(pre);
    if (err && err.stack) console.error(err);
  }

  // ---- boot -----------------------------------------------------------------

  function readFile(rel) {
    return fetch(rel, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(rel + ': HTTP ' + r.status);
      return r.text();
    });
  }

  MB.Data.load(readFile).then(function (data) {
    game.data = data;
    MB.Render.init(document.getElementById('game'), data);
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);
    setupKeyboard();
    setupPad();
    setupMute();
    enterNode(data.structure.flow.start);
    requestAnimationFrame(loop);
  }).catch(fatal);

  function sizeCanvas() {
    // canvas sized from the window, never from a container that includes it
    MB.Render.resize(window.innerWidth, window.innerHeight);
  }

  // ---- flow graph (data/structure.yaml) ---------------------------------------

  function enterNode(name, opts) {
    var st = game.data.structure;
    var node = st.flow.nodes[name];
    if (!node) { fatal(new Error('structure.yaml: flow node "' + name + '" does not exist')); return; }
    game.nodeName = name; game.node = node; game.screenT = 0;

    if (node.kind === 'screen') {
      enterScreen(name);
    } else if (node.kind === 'fight') {
      game.lastFightNode = name;
      game.fightIndex = node.index;
      // on a continue-retry, skip the dialogue and go straight back down the stair
      game.seqPos = (opts && opts.retry) ? Math.max(0, st.fight_sequence.indexOf('match')) : 0;
      runFightSequence();
    } else if (node.kind === 'select') {
      game.mode = 'select';
      game.selMove = 0;
      game.continueChoice = null;
    } else if (node.kind === 'continue') {
      if (!st.continue_rules.allowed) { enterNode(st.continue_rules.decline); return; }
      game.mode = 'continue';
      game.lastCount = undefined;
      game.continueDisplay = {
        style: campStruct().continue_style,
        heading: campScript().continue_screen.heading,
        note: campScript().continue_screen.note
      };
      MB.Audio.play('coins');
    }
  }

  function enterScreen(name) {
    var scr = game.data.script;
    var cs = campScript();
    if (name === 'title') {
      game.mode = 'title';
      resetRunState();
    } else if (name === 'bill') {
      // the campaign's own bill-poster, before the descent
      game.mode = 'card';
      game.card = { poster: cs.bill, posterFootnote: cs.bill_footnote };
      MB.Audio.play('slate');
    } else if (name === 'crawl') {
      game.mode = 'crawl';
    } else if (name === 'ending_a') {
      game.mode = 'card';
      game.card = {
        body: cs.ending_a, finalCard: cs.ending_a_card,
        finalCard2: cs.ending_a_card_2, small: true
      };
      MB.Audio.setDrone(false);
    } else if (name === 'ending_b') {
      // the "give up" ending; campaigns without one go straight to the note
      if (cs.ending_b === undefined || cs.ending_b === null) {
        enterNode(game.data.structure.flow.nodes[name].next);
        return;
      }
      game.mode = 'card';
      game.card = { body: cs.ending_b, finalCard: cs.ending_b_card, small: true, italic: true };
      MB.Audio.setDrone(false);
    } else if (name === 'closing_note') {
      game.mode = 'card';
      game.card = { heading: 'A NOTE, AFTER', body: scr.shared.closing_note, small: true };
    } else {
      fatal(new Error('structure.yaml: screen node "' + name + '" has no screen implementation'));
    }
  }

  function resetRunState() {
    game.match = null;
    game.campaignId = null;
    game.selIndex = 0; // default highlight: Jacco
    game.retries = 0;
    game.fightIndex = 0;
    game.fx = { roundText: '', announce: null, finisherPrompt: '', finisherName: '', gutter: 0 };
  }

  function runFightSequence() {
    var st = game.data.structure;
    var seq = st.fight_sequence;
    if (game.seqPos >= seq.length) { enterNode(game.node.win); return; }
    var step = seq[game.seqPos];
    var fightScript = campScript().fights[game.fightIndex];
    game.screenT = 0;

    if (step === 'prefight') {
      game.mode = 'prefight';
      game.dialogue = {
        billing: fightScript.billing,
        opponent: fightScript.opponent,
        lines: fightScript.dialogue,
        idx: 0
      };
      MB.Audio.play('slate');
    } else if (step === 'match') {
      startMatch();
    } else if (step === 'victory') {
      game.mode = 'card';
      game.card = {
        heading: ann('victory'),
        body: game.data.script.shared.names[game.campaignId] + ' — ' + fightScript.victory,
        italic: true
      };
      MB.Audio.play('coins');
      MB.Audio.crowdSwell(0.08);
    } else if (step === 'interstitial') {
      if (fightScript.interstitial === null || fightScript.interstitial === undefined) {
        game.seqPos++; runFightSequence(); return;
      }
      game.mode = 'card';
      game.card = { body: fightScript.interstitial, small: true, italic: true };
    } else {
      fatal(new Error('structure.yaml: unknown fight_sequence step "' + step + '"'));
    }
  }

  function advanceSequence() { game.seqPos++; runFightSequence(); }

  // ---- match ------------------------------------------------------------------

  function startMatch() {
    game.mode = 'match';
    game.match = new MB.Logic.Match(game.data, game.campaignId, game.fightIndex, {});
    game.fx.roundText = '';
    game.fx.finisherPrompt = '';
    game.fx.announce = null;
    game.matchOver = false;
    MB.Audio.startAmbience();
    var wear = game.match.fight.stage_wear;
    MB.Audio.setCrowd(wear === 3 ? 0.1 : 0.25 + wear * 0.2);
    MB.Audio.setDrone(game.match.opp.id === 'aistrop' || game.match.player.id === 'aistrop');
  }

  function endMatch() {
    var match = game.match;
    var fightScript = campScript().fights[game.fightIndex];
    if (match.winner === match.player) {
      advanceSequence(); // -> victory card
    } else {
      game.mode = 'card';
      game.defeated = true;
      game.card = {
        heading: ann('defeat'),
        headingColor: '#7a7264',
        body: game.data.script.shared.names[fightScript.opponent] + ' — ' + fightScript.defeat,
        italic: true
      };
    }
  }

  // ---- logic events -> audio/particles/fx --------------------------------------

  function handleEvents(match) {
    var evs = match.drainEvents();
    var floorY = game.data.tuning.floor_y;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      switch (ev.type) {
        case 'round_start':
          game.fx.roundText = ev.text;
          MB.Audio.play('slate');
          break;
        case 'hit':
          MB.Audio.play(ev.sound);
          MB.Audio.crowdSwell(ev.heavy ? 0.07 : 0.03);
          MB.Render.spawn('blood', ev.x, floorY + ev.y, ev.heavy ? 8 : 4, ev.dir);
          MB.Render.spawn('dust', ev.x, floorY - 2, 2);
          if (ev.heavy) MB.Audio.play('creak');
          break;
        case 'block': MB.Audio.play('block'); MB.Render.spawn('spark', ev.x, floorY + ev.y, 3); break;
        case 'armor': MB.Audio.play('thud'); MB.Render.spawn('spark', ev.x, floorY + ev.y, 2); break;
        case 'stance_return': MB.Audio.play('thud'); MB.Render.spawn('dust', ev.x, floorY - 2, 4); break;
        case 'whiff': MB.Audio.play('whiff'); break;
        case 'grab': MB.Audio.play(ev.sound); MB.Audio.play('chain_rigid'); break;
        case 'grab_release': MB.Audio.play('thud'); break;
        case 'chain': MB.Audio.play('chain'); break;
        case 'chain_rigid': MB.Audio.play('chain_rigid'); break;
        case 'yank':
          MB.Audio.play('chain'); MB.Audio.play('thud');
          MB.Render.spawn('dust', ev.x || match.player.x, floorY - 2, 5);
          break;
        case 'coins': MB.Audio.play('coins'); break;
        case 'rats': MB.Audio.play('rats'); MB.Audio.crowdSwell(0.05); break;
        case 'crowd_throw': MB.Audio.play('creak'); break;
        case 'thud': MB.Audio.play('thud'); MB.Render.spawn('dust', ev.x, floorY - 2, 3); break;
        case 'chip': MB.Audio.play('scuff'); break;
        case 'step': if (Math.random() < 0.5) MB.Audio.play('scuff'); break;
        case 'ko':
          MB.Audio.play('ko'); MB.Audio.play('roar'); MB.Audio.crowdSwell(0.1);
          MB.Render.spawn('blood', ev.x, floorY - 16, 10, 1);
          break;
        case 'round_end':
          game.fx.finisherPrompt = '';
          if (ev.winnerId === 'jacco') MB.Audio.play('coins');
          break;
        case 'timeout': MB.Audio.play('slate'); break;
        case 'announce':
          game.fx.announce = { text: ev.text, t: 130 };
          if (ev.kind === 'low_health') MB.Audio.crowdSwell(0.08);
          break;
        case 'finisher_prompt':
          game.fx.finisherPrompt = ev.text;
          MB.Audio.play('sting');
          break;
        case 'finisher_lapsed': game.fx.finisherPrompt = ''; break;
        case 'finisher_start':
          game.fx.finisherPrompt = '';
          game.fx.finisherName = ev.name;
          game.fx.gutter = match.st.finisher.cinematic_frames;
          MB.Audio.play('crack');           // the rail, at the moment of any finisher
          MB.Audio.hush(match.st.finisher.cinematic_frames / 60); // gas cuts out; near-silence
          break;
        case 'cross_start': MB.Audio.play('slate'); MB.Audio.setDrone(true); break;
        case 'cross_break': MB.Audio.play('chain_rigid'); MB.Audio.play('slate'); MB.Audio.crowdSwell(0.1); break;
        case 'cross_end': MB.Audio.play('slate'); break;
        case 'odds_flip': MB.Audio.play('slate'); MB.Audio.setCrowd(0.15); break;
        case 'stakes_down': MB.Audio.play('creak'); break;
        case 'match_end': game.matchOver = true; break;
      }
    }
  }

  // ---- input --------------------------------------------------------------------

  var KEYMAP = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'jump', w: 'jump', W: 'jump',
    j: 'light', J: 'light', x: 'light', X: 'light',
    k: 'heavy', K: 'heavy', c: 'heavy', C: 'heavy',
    l: 'special', L: 'special', v: 'special', V: 'special',
    s: 'block', S: 'block', z: 'block', Z: 'block', ArrowDown: 'block'
  };
  var CONFIRM_KEYS = ['j', 'J', 'x', 'X', 'k', 'K', 'c', 'C', 'l', 'L', 'v', 'V', 'Enter', ' '];

  function setupKeyboard() {
    window.addEventListener('keydown', function (e) {
      MB.Audio.resume(); MB.Audio.startAmbience();
      if (game.mode === 'title') { confirmQueued = true; }
      else if (CONFIRM_KEYS.indexOf(e.key) >= 0) confirmQueued = true;
      var act = KEYMAP[e.key];
      if (act) { input[act] = true; e.preventDefault(); }
      // continue screen choices
      if (game.mode === 'continue') {
        if (KEYMAP[e.key] === 'light') game.continueChoice = 'retry';
        if (KEYMAP[e.key] === 'block') game.continueChoice = 'decline';
      }
      if (game.mode === 'select') {
        if (KEYMAP[e.key] === 'left') game.selMove -= 1;
        if (KEYMAP[e.key] === 'right') game.selMove += 1;
      }
    });
    window.addEventListener('keyup', function (e) {
      var act = KEYMAP[e.key];
      if (act) { input[act] = false; e.preventDefault(); }
    });
    window.addEventListener('pointerdown', function (e) {
      MB.Audio.resume(); MB.Audio.startAmbience();
      if (e.target.tagName === 'CANVAS' || e.target === document.body) confirmQueued = true;
    });
  }

  // On-screen controller: D-pad bottom-left, four actions bottom-right.
  // Multi-touch via per-button pointer tracking (move + attack simultaneously).
  function setupPad() {
    var pad = document.getElementById('pad');
    var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var visible = isTouch;
    function apply() { pad.style.display = visible ? 'block' : 'none'; }
    apply();
    document.getElementById('padToggle').addEventListener('click', function () {
      visible = !visible; apply();
    });

    var buttons = pad.querySelectorAll('[data-act]');
    Array.prototype.forEach.call(buttons, function (el) {
      var act = el.getAttribute('data-act');
      var pointers = 0;
      function press(e) {
        e.preventDefault();
        MB.Audio.resume();
        pointers++;
        el.classList.add('on');
        input[act] = true;
        if (game.mode !== 'match') {
          if (act === 'light' || act === 'heavy' || act === 'special' || act === 'jump') confirmQueued = true;
          if (game.mode === 'continue') {
            if (act === 'light') game.continueChoice = 'retry';
            if (act === 'block') game.continueChoice = 'decline';
          }
          if (game.mode === 'select') {
            if (act === 'left') game.selMove -= 1;
            if (act === 'right') game.selMove += 1;
          }
          if (game.mode === 'title') confirmQueued = true;
        }
      }
      function release(e) {
        if (e) e.preventDefault();
        pointers = Math.max(0, pointers - 1);
        if (pointers === 0) { el.classList.remove('on'); input[act] = false; }
      }
      el.addEventListener('pointerdown', function (e) { el.setPointerCapture(e.pointerId); press(e); });
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
  }

  function setupMute() {
    var btn = document.getElementById('mute');
    btn.addEventListener('click', function () {
      MB.Audio.resume();
      var muted = MB.Audio.toggleMute();
      btn.textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
    });
  }

  function takeConfirm() {
    var c = confirmQueued; confirmQueued = false; return c;
  }

  // ---- main loop: fixed-timestep logic, rAF rendering ----------------------------

  var last = 0, acc = 0, tickParity = 0, crashed = false;
  // watchdog: silent freezes must be as loud as crashes. Tracks wall-clock
  // time of the last logic tick and the last observable progress (any tick;
  // in a match, the match's own frame counter advancing).
  var wdLastTick = 0, wdLastProgress = 0, wdLastMatchFrame = -1;
  var WD_STALL_MS = 5000;

  function watchdog(now, ticked) {
    if (!wdLastTick) { wdLastTick = now; wdLastProgress = now; return; }
    if (ticked) wdLastTick = now;
    var progressed = ticked;
    if (game.mode === 'match' && game.match) {
      progressed = game.match.frame !== wdLastMatchFrame;
      wdLastMatchFrame = game.match.frame;
    }
    if (progressed) wdLastProgress = now;
    if (now - wdLastTick > WD_STALL_MS || now - wdLastProgress > WD_STALL_MS) {
      var m = game.match;
      throw new Error('WATCHDOG: game stalled for ' +
        Math.round((now - Math.max(wdLastTick, wdLastProgress)) / 1000) + 's in mode "' +
        game.mode + '"' +
        (m ? ' (match phase ' + m.phase + ', frame ' + m.frame + ', phaseT ' + m.phaseT +
          ', slowmo ' + m.slowmo + ')' : '') +
        ' | loop state: acc=' + acc + ' last=' + last + ' now=' + now +
        ' step=' + (1000 / game.data.tuning.logic_hz) +
        ' | this is a logic stall, not a crash — report these numbers.');
    }
  }

  function loopBody(now) {
    lastLoopWall = now;
    if (!last) last = now;
    var dt = now - last;
    last = now;
    // sanitize the frame delta: a NaN/negative/absurd delta must never poison
    // the accumulator (a NaN acc stops logic forever with no exception —
    // render keeps drawing the frozen state, which is the silent-freeze bug class)
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 100) dt = 100;
    acc += dt;
    if (!isFinite(acc) || acc < 0) acc = 0;
    // fail loudly: a frame exception stops the loop and names itself on screen,
    // never a silent black canvas with console spam
    try {
      var step = 1000 / game.data.tuning.logic_hz;
      var ticked = false;
      while (acc >= step) {
        acc -= step;
        tick();
        ticked = true;
      }
      watchdog(now, ticked);
      MB.Render.frame(game);
    } catch (err) {
      crashed = true;
      fatal(err);
    }
  }

  function loop(now) {
    if (crashed) return;
    requestAnimationFrame(loop);
    loopBody(now);
  }

  // rAF SUSPENSION BACKSTOP (the verified silent-freeze root cause):
  // macOS Chrome stops delivering requestAnimationFrame to occluded /
  // automation-driven windows even though timers and input keep firing —
  // the game lived entirely in the rAF loop, so whatever screen was up
  // simply froze with no exception. If no rAF frame has run for 200ms,
  // pump the same loop body from a timer (100ms interval + 100ms dt clamp
  // still yields the full 60 logic ticks per second).
  // Chrome also throttles setInterval to ~1Hz in that state, so each fire
  // catches up on the elapsed wall time in 100ms slices (dt is clamped per
  // slice) instead of pumping once — otherwise the game crawls at ~10% speed.
  var lastLoopWall = 0;
  var backstop = setInterval(function () {
    if (crashed || !game.data) return;
    var now = performance.now();
    var guard = 0;
    while (now - lastLoopWall > 200 && guard++ < 15) {
      loopBody(Math.min(lastLoopWall + 100, now));
    }
  }, 100);
  if (backstop && backstop.unref) backstop.unref(); // node test harness only

  function tick() {
    game.screenT++;
    if (game.fx.announce && --game.fx.announce.t <= 0) game.fx.announce = null;
    if (game.fx.gutter > 0) game.fx.gutter--;

    switch (game.mode) {
      case 'title':
        if (takeConfirm()) enterNode(game.node.next);
        break;

      case 'select': {
        var ids = game.data.characterIds;
        if (game.selMove) {
          game.selIndex = ((game.selIndex + game.selMove) % ids.length + ids.length) % ids.length;
          game.selMove = 0;
          MB.Audio.play('scuff');
        }
        if (takeConfirm()) {
          var cid = ids[game.selIndex];
          if (game.data.script.campaigns[cid].available) {
            game.campaignId = cid;
            MB.Audio.play('slate');
            enterNode(game.node.next);
          } else {
            MB.Audio.play('block'); // not on tonight's bill
          }
        }
        break;
      }

      case 'crawl':
        // done when it has scrolled through, or on tap
        if (takeConfirm() || game.screenT > 1400) enterNode(game.node.next);
        break;

      case 'prefight':
        if (takeConfirm()) {
          MB.Audio.play('scuff');
          game.dialogue.idx++;
          if (game.dialogue.idx >= game.dialogue.lines.length) advanceSequence();
        }
        break;

      case 'match': {
        var match = game.match;
        // KO slow-motion: run logic at half rate while slowmo frames remain
        tickParity ^= 1;
        if (!(match.slowmo > 0 && tickParity)) {
          match.step(input);
          handleEvents(match);
        }
        takeConfirm(); // swallow stray confirms during play
        if (game.matchOver) { game.matchOver = false; endMatch(); }
        break;
      }

      case 'card':
        if (game.screenT > 30 && takeConfirm()) {
          if (game.defeated) {
            game.defeated = false;
            enterNode(game.node.lose); // -> continue node (per structure.yaml)
          } else if (game.node.kind === 'fight') {
            advanceSequence();
          } else {
            enterNode(game.node.next);
          }
        }
        break;

      case 'continue': {
        var st = game.data.structure;
        var cd = game.continueDisplay;
        var n, autoDecline = false;
        switch (cd.style) {
          case 'countdown': // Jacco: Aistrop's coin counter runs down; 0 = walk away
            n = Math.max(0, 9 - Math.floor(game.screenT / 55));
            autoDecline = n === 0 && game.screenT % 55 === 54;
            break;
          case 'tally':     // Brock: times drawn tonight — rises whether he answers or not
            n = game.retries + 1 + Math.floor(game.screenT / 60);
            break;
          case 'wipe':      // Billy: the count wipes itself back to nought
            n = game.screenT < 40 ? Math.max(0, 99 - game.screenT * 3) : 0;
            break;
          case 'purse':     // Puss: Mr Cribb's hundred guineas, laid again
            n = 100;
            break;
          case 'house':     // Aistrop: his counter goes UP on his own loss
            n = 11 + game.retries * 2 + Math.floor(game.screenT / 45);
            break;
        }
        cd.n = n;
        if (game.lastCount !== n) {
          game.lastCount = n;
          MB.Audio.play(cd.style === 'wipe' ? 'slate' : 'coin_one');
        }
        if (game.continueChoice === 'retry') {
          game.continueChoice = null;
          game.retries++;
          enterNode(game.lastFightNode, { retry: true });
        } else if (game.continueChoice === 'decline' || autoDecline) {
          game.continueChoice = null;
          enterNode(st.continue_rules.decline);
        }
        takeConfirm();
        break;
      }
    }
  }
})();
