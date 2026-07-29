/* MONKEY BAITING — logic.js
   Pure game logic: fighter state machines, frame-data hit resolution, AI,
   round/match flow. No DOM, no canvas, no audio — runs headless in node.

   Architecture: a minimal shared core (states: idle, walk, jump, attack,
   stun, block, dazed, ko, down) driven by YAML frame data, plus per-move-type
   handlers and per-character extensions (chain tether, WINDPIPE grab, Barrel
   Set, THE HUNDRED, ON THE CROSS, chain yank, MOPUSSES, THE CROSS,
   STAKES DOWN), all parameterized from the character YAML.

   Knockback model (Smash-style, simplified): remaining-health scaling —
   kb = (base + growth * (1 - hp/max)) * knockback_scale / weight,
   applied along launch_angle. Chosen over accumulated-damage scaling for
   simplicity; equivalent shape for a health-bar game. */
(function (g) {
  'use strict';

  var DEG = Math.PI / 180;

  function emptyInput() {
    return { left: false, right: false, jump: false, light: false, heavy: false, special: false, block: false };
  }

  // ---------------------------------------------------------------- Fighter

  function Fighter(def, side, match) {
    this.def = def;
    this.id = def.id;
    this.side = side;              // 0 = left (jacco), 1 = right (opponent)
    this.match = match;
    this.roundsWon = 0;
    this.damageMult = 1;
    this.resetRound();
  }

  Fighter.prototype.resetRound = function () {
    var t = this.match.tuning;
    this.hp = this.def.max_health;
    this.x = this.side === 0 ? t.ring.center - 70 : t.ring.center + 70;
    this.y = 0;                    // height above floor; 0 = grounded
    this.vx = 0; this.vy = 0;
    this.facing = this.side === 0 ? 1 : -1;
    this.state = 'idle';
    this.t = 0;
    this.move = null; this.moveKey = null;
    this.stunT = 0; this.blockStun = false;
    this.dazedT = 0;
    this.cd = {};
    this.invulnFrames = 0;
    this.hitIndex = -1;
    this.grabT = 0; this.grabFoe = null;
    this.yankTarget = null;
    this.wallJumped = false;
    this.prevJump = false;
    this.retreatDir = 0;           // brock's post-exchange shuffle, aistrop's stakes-down
    this.retreatT = 0;
    this.tookDamage = false;
    this.aiHold = 0;
    this.aiInput = emptyInput();
    this.ripple = false;
    this.lowAnnounced = false;
  };

  Fighter.prototype.grounded = function () { return this.y <= 0.001 && this.vy >= -0.001; };
  Fighter.prototype.busy = function () {
    return this.state === 'attack' || this.state === 'stun' || this.state === 'ko' ||
      this.state === 'down' || this.state === 'grab_hold' || this.state === 'grabbed' ||
      this.state === 'dazed' || this.state === 'finish' || this.state === 'finish_victim';
  };
  Fighter.prototype.hurtbox = function () {
    var hb = this.def.hurtbox;
    return { x: this.x - hb.w / 2, y: -this.y - hb.h, w: hb.w, h: hb.h }; // y axis: 0 at floor, negative = up
  };
  Fighter.prototype.attackPhase = function () {
    if (this.state !== 'attack' || !this.move) return null;
    var m = this.move;
    if (this.t < m.startup_frames) return 'wind';
    if (this.t < m.startup_frames + m.active_frames) return 'act';
    return 'rec';
  };

  function overlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  Fighter.prototype.hitboxRect = function () {
    var m = this.move, hb = m.hitbox;
    var x = this.facing > 0 ? this.x + hb.x : this.x - hb.x - hb.w;
    return { x: x, y: hb.y - this.y, w: hb.w, h: hb.h };
  };

  // ------------------------------------------------------------------ Match

  function Match(data, campaignId, fightIndex, opts) {
    opts = opts || {};
    this.data = data;
    this.tuning = data.tuning;
    this.st = data.structure;
    this.campaignId = campaignId;
    this.campaign = this.st.campaigns[campaignId];
    if (!this.campaign) throw new Error('structure.yaml: no campaign "' + campaignId + '"');
    this.fightIndex = fightIndex;
    this.fight = this.campaign.fights[fightIndex];
    this.texts = opts.texts || defaultTexts(data, campaignId, fightIndex);
    this.rng = opts.rng || Math.random;
    this.playerAI = !!(opts.playerAI || opts.jaccoAI);
    this.events = [];
    this.hazards = [];             // rats waves, coin zones, thrown objects
    this.freeze = 0;               // global hit-freeze frames
    this.shake = 0;                // render hint, decays
    this.slowmo = 0;               // render/game hint frames
    this.cross = null;             // aistrop's THE CROSS state
    this.crossUsed = false;
    this.pussCross = false;
    this.finisherWindow = null;
    this.finisherRearm = 0;
    this.finisherDone = false;
    this.round = 0;
    this.frame = 0;
    this.winner = null;

    this.player = new Fighter(data.characters[campaignId], 0, this);
    this.opp = new Fighter(data.characters[this.fight.opponent], 1, this);
    this.fighters = [this.player, this.opp];

    // chain wiring from the fight's chain record (see structure.yaml)
    var ch = this.fight.chain;
    this.chain = (ch && typeof ch === 'object') ? ch : null;
    this.chainedFighter = null;
    this.chainHolder = null;
    if (this.chain) {
      this.chainedFighter = this.chain.to === 'player' ? this.player : this.opp;
      if (this.chain.from === 'stake') {
        this.chainedFighter.tethered = true;
      } else {
        this.chainHolder = this.chain.from === 'player' ? this.player : this.opp;
      }
    }
    this.startRound();
  }

  // Texts a match needs (announcer lines, finisher name), resolved from the
  // campaign's authored script. Refuses to run an unauthored campaign unless
  // the caller supplies opts.texts explicitly (headless tests do).
  function defaultTexts(data, campaignId, fightIndex) {
    var cs = data.script.campaigns[campaignId];
    if (!cs || !cs.available) {
      throw new Error('script.yaml: campaign "' + campaignId +
        '" is not authored yet (available: false)');
    }
    var ann = {};
    var shared = data.script.shared.announcer;
    for (var k in shared) ann[k] = shared[k];
    if (cs.announcer) for (var k2 in cs.announcer) ann[k2] = cs.announcer[k2];
    return { announcer: ann, finisher_name: cs.fights[fightIndex].finisher_name };
  }

  Match.prototype.emit = function (ev) { this.events.push(ev); };
  Match.prototype.drainEvents = function () { var e = this.events; this.events = []; return e; };

  Match.prototype.startRound = function () {
    this.round++;
    this.phase = 'intro';
    this.phaseT = this.st.rounds.intro_frames;
    this.timer = this.st.rounds.time_seconds * this.tuning.logic_hz;
    this.hazards = [];
    this.finisherWindow = null;
    this.cross = null;
    this.player.resetRound();
    this.opp.resetRound();
    // ON THE CROSS persists across rounds once triggered (she's been told)
    if (this.pussCross) {
      for (var pi = 0; pi < 2; pi++) {
        var pf = this.fighters[pi];
        if (pf.id === 'puss') pf.damageMult = pf.def.mechanics.cross_damage_mult;
      }
    }
    var key = this.round === 1 ? 'round1' : this.round === 2 ? 'round2' : 'round3';
    this.emit({ type: 'round_start', round: this.round, text: this.texts.announcer[key] });
  };

  Match.prototype.other = function (f) { return f === this.player ? this.opp : this.player; };

  Match.prototype.step = function (playerInput) {
    this.frame++;
    if (this.shake > 0) this.shake -= 0.5;
    if (this.slowmo > 0) this.slowmo--;

    if (this.phase === 'intro') {
      if (--this.phaseT <= 0) this.phase = 'fight';
      return;
    }
    if (this.phase === 'roundend') {
      this.stepPhysicsOnly();
      if (--this.phaseT <= 0) {
        var w = this.st.rounds.wins_to_take_match;
        if (this.player.roundsWon >= w || this.opp.roundsWon >= w) {
          this.phase = 'end';
          this.winner = this.player.roundsWon >= w ? this.player : this.opp;
          this.emit({ type: 'match_end', winnerId: this.winner.id, finisher: this.finisherDone });
        } else {
          this.startRound();
        }
      }
      return;
    }
    if (this.phase === 'finisher') {
      if (--this.phaseT <= 0) {
        this.opp.hp = 0;
        this.opp.state = 'down';
        this.player.roundsWon++;
        this.finisherDone = true;
        this.phase = 'roundend';
        this.phaseT = this.st.rounds.end_frames;
        this.emit({ type: 'round_end', winnerId: this.player.id, perfect: !this.player.tookDamage });
      }
      return;
    }
    if (this.phase === 'end') return;

    // ---- fight phase ----
    if (this.freeze > 0) { this.freeze--; return; }

    var inpP = this.playerAI ? this.aiThink(this.player) : (playerInput || emptyInput());
    var inpO = this.aiThink(this.opp);

    this.stepFighter(this.player, inpP);
    this.stepFighter(this.opp, inpO);
    this.stepHazards();
    this.stepCross();
    this.stepFinisherWindow();
    this.separate();
    this.checkAnnouncements();

    // round timer
    if (--this.timer <= 0) {
      var p = this.player.hp / this.player.def.max_health;
      var o = this.opp.hp / this.opp.def.max_health;
      var winner;
      if (p === o) winner = this.st.rounds.timeout_tie_winner === 'opponent' ? this.opp : this.player;
      else winner = p > o ? this.player : this.opp;
      this.emit({ type: 'timeout' });
      this.endRound(winner, false);
      return;
    }

    // KO check
    if (this.opp.hp <= 0 && this.opp.state !== 'ko') this.ko(this.opp);
    else if (this.player.hp <= 0 && this.player.state !== 'ko') this.ko(this.player);
  };

  Match.prototype.stepPhysicsOnly = function () {
    for (var i = 0; i < 2; i++) {
      var f = this.fighters[i];
      if (f.y > 0 || f.vy < 0) {
        f.vy += f.def.gravity;
        f.y = Math.max(0, f.y - f.vy);
        if (f.y <= 0 && f.vy > 0) { f.vy = 0; if (f.state === 'ko') { f.state = 'down'; this.emit({ type: 'land', id: f.id }); } }
      }
      f.x += f.vx; f.vx *= 0.85;
      this.clampX(f);
      f.t++;
    }
  };

  Match.prototype.ko = function (f) {
    f.hp = 0;
    f.state = 'ko'; f.t = 0;
    f.vy = -3.2; f.vx = -f.facing * 2.2; f.y = Math.max(f.y, 0.01);
    this.slowmo = this.tuning.combat.ko_slowmo_frames;
    this.emit({ type: 'ko', id: f.id, x: f.x });
    this.endRound(this.other(f), true);
  };

  Match.prototype.endRound = function (winner, wasKO) {
    winner.roundsWon++;
    this.phase = 'roundend';
    this.phaseT = this.st.rounds.end_frames + (wasKO ? this.tuning.combat.ko_slowmo_frames : 0);
    this.finisherWindow = null;
    var perfect = !winner.tookDamage;
    this.emit({ type: 'round_end', winnerId: winner.id, perfect: perfect });
    if (perfect && winner === this.player) {
      this.emit({ type: 'announce', kind: 'perfect', text: this.texts.announcer.perfect });
    }
  };

  Match.prototype.clampX = function (f) {
    var r = this.tuning.ring;
    var half = f.def.hurtbox.w / 2;
    if (f.x < r.left + half) f.x = r.left + half;
    if (f.x > r.right - half) f.x = r.right - half;
    // the stake tether: a leash on a stake at ring centre
    if (f.tethered) {
      var rad = f.def.mechanics.chain_radius;
      if (f.x < r.center - rad) { f.x = r.center - rad; this.chainTug(f); }
      if (f.x > r.center + rad) { f.x = r.center + rad; this.chainTug(f); }
    }
  };

  Match.prototype.chainTug = function (f) {
    if (this.frame % 20 === 0) this.emit({ type: 'chain', x: f.x });
  };

  Match.prototype.separate = function () {
    var a = this.player, b = this.opp;
    if (a.state === 'grab_hold' || b.state === 'grab_hold') return;
    var min = (a.def.hurtbox.w + b.def.hurtbox.w) / 2 - 4;
    var dx = b.x - a.x;
    if (Math.abs(dx) < min && Math.abs(a.y - b.y) < 20) {
      var push = (min - Math.abs(dx)) / 2;
      var dir = dx >= 0 ? 1 : -1;
      a.x -= dir * push; b.x += dir * push;
      this.clampX(a); this.clampX(b);
    }
  };

  // ------------------------------------------------------- fighter stepping

  Match.prototype.stepFighter = function (f, inp) {
    var foe = this.other(f);
    if (f.invulnFrames > 0) f.invulnFrames--;
    for (var k in f.cd) if (f.cd[k] > 0) f.cd[k]--;
    f.ripple = false;

    // auto-face when actionable
    if (!f.busy() || f.state === 'dazed') f.facing = foe.x >= f.x ? 1 : -1;

    // gravity
    var airborne = f.y > 0 || f.vy < 0;
    if (airborne) {
      f.vy += f.def.gravity;
      f.y -= f.vy;
      if (f.y <= 0) {
        f.y = 0; f.vy = 0; f.wallJumped = false;
        if (f.state === 'jump') { f.state = 'idle'; f.t = 0; this.emit({ type: 'step', id: f.id }); }
        if (f.state === 'ko') { f.state = 'down'; f.t = 0; }
      }
    }

    // knockback slide decay
    if (f.state === 'stun' || f.state === 'ko' || f.state === 'down') {
      f.x += f.vx; f.vx *= 0.86;
    }

    switch (f.state) {
      case 'stun':
        // aistrop's yank drags jacco across the ring during this stun
        if (f.yankTarget !== null) {
          var d = f.yankTarget - f.x;
          var step = Math.sign(d) * Math.min(Math.abs(d), f.yankSpeed);
          f.x += step;
          if (Math.abs(d) < 2) f.yankTarget = null;
        }
        if (--f.stunT <= 0) { f.state = 'idle'; f.t = 0; f.blockStun = false; f.yankTarget = null; }
        break;

      case 'block':
        if (!inp.block) { f.state = 'idle'; f.t = 0; }
        break;

      case 'dazed':
        if (--f.dazedT <= 0) { f.state = 'idle'; f.t = 0; }
        break;

      case 'attack':
        this.stepAttack(f, foe, inp);
        break;

      case 'grab_hold':
        this.stepGrabHold(f, foe);
        break;

      case 'grabbed':
      case 'ko':
      case 'down':
      case 'finish':
      case 'finish_victim':
        break;

      case 'jump':
        if (inp.left) { f.x -= f.def.walk_speed * 0.8; }
        if (inp.right) { f.x += f.def.walk_speed * 0.8; }
        // jacco extension: wall-scramble off the ring boards
        if (f.def.mechanics && f.def.mechanics.wall_scramble && !f.wallJumped &&
          inp.jump && !f.prevJump) {
          var r = this.tuning.ring, half = f.def.hurtbox.w / 2;
          var atWall = f.x <= r.left + half + 2 || f.x >= r.right - half - 2;
          var atChain = !!f.tethered &&
            (f.x <= r.center - f.def.mechanics.chain_radius + 2 ||
             f.x >= r.center + f.def.mechanics.chain_radius - 2);
          if (atWall || atChain) {
            f.vy = f.def.jump_velocity * 0.9;
            f.wallJumped = true;
            this.emit({ type: 'chain', x: f.x });
          }
        }
        break;

      default: // idle / walk
        this.stepGrounded(f, foe, inp);
    }

    f.prevJump = inp.jump;
    f.t++;
    this.clampX(f);

    // extension: brock always shuffles back toward the barrel after an exchange
    if (f.retreatT > 0 && (f.state === 'idle' || f.state === 'walk')) {
      f.x += f.retreatDir * f.def.walk_speed * 0.7;
      f.retreatT--;
      f.state = 'walk';
    }
  };

  Match.prototype.stepGrounded = function (f, foe, inp) {
    if (inp.block) { f.state = 'block'; f.t = 0; return; }
    var mv = null, key = null;
    if (inp.light) { key = 'light'; }
    else if (inp.heavy) { key = 'heavy'; }
    else if (inp.special) { key = 'special'; }
    else if (inp.stakes_down && f.def.moves.stakes_down) { key = 'stakes_down'; }
    else {
      // moves bound to another input via their YAML `input:` field
      // (e.g. Aistrop's STAKES DOWN on jump — he does not have to fight)
      for (var mk in f.def.moves) {
        var xm = f.def.moves[mk];
        if (xm.input && inp[xm.input] && (xm.input !== 'jump' || !f.prevJump)) { key = mk; break; }
      }
    }
    if (key) {
      mv = f.def.moves[key];
      if (mv && (!f.cd[key] || f.cd[key] <= 0)) { this.startMove(f, key, mv); return; }
    }
    if (inp.jump && !f.prevJump) {
      f.vy = f.def.jump_velocity; f.y = 0.01; f.state = 'jump'; f.t = 0;
      this.emit({ type: 'step', id: f.id });
      return;
    }
    if (inp.left || inp.right) {
      f.state = 'walk';
      f.x += (inp.right ? 1 : -1) * f.def.walk_speed;
      if (f.t % 14 === 0) this.emit({ type: 'step', id: f.id });
    } else if (f.state !== 'idle') { f.state = 'idle'; f.t = 0; }
  };

  Match.prototype.startMove = function (f, key, mv) {
    f.state = 'attack'; f.t = 0;
    f.move = mv; f.moveKey = key;
    f.hitIndex = -1;
    f.cd[key] = mv.cooldown;
    if (mv.type === 'retreat') {
      f.retreatDir = f.side === 0 ? -1 : 1; // back to his own edge of the ring
      this.emit({ type: 'stakes_down', id: f.id });
      f.projT = 0;
    }
    this.emit({ type: 'move_start', id: f.id, move: key, name: mv.name });
  };

  Match.prototype.stepAttack = function (f, foe, inp) {
    var m = f.move;
    var su = m.startup_frames, act = m.active_frames, rec = m.recovery_frames;
    var phase = f.attackPhase();

    // jacco extension: the skin moves before he does (grab-immune tell)
    var rip = f.def.mechanics && f.def.mechanics.ripple_frames;
    if (rip && phase === 'wind' && f.t >= su - rip) f.ripple = true;

    // leap moves (WINDPIPE) launch at the startup->active boundary
    if (m.leap && f.t === su) {
      f.vy = m.leap.vy; f.y = Math.max(f.y, 0.01);
      f.leapVX = m.leap.vx * f.facing;
      this.emit({ type: 'chain_rigid', id: f.id });
    }
    if (m.leap && f.y > 0) f.x += f.leapVX || 0;

    if (phase === 'act') {
      if (m.move_forward) f.x += m.move_forward * f.facing;

      switch (m.type) {
        case 'strike': this.stepStrike(f, foe, m); break;
        case 'grab': this.stepGrabAttempt(f, foe, m); break;
        case 'stance': /* passive; resolveHit handles it */ break;
        case 'chain_yank': this.stepYank(f, foe, m); break;
        case 'hazard_rats': this.spawnRats(f, m); break;
        case 'hazard_coins': this.spawnCoins(f, m); break;
        case 'retreat': this.stepRetreat(f, foe, m); break;
      }
    }

    if (f.t >= su + act + rec) {
      f.state = 'idle'; f.t = 0; f.move = null; f.moveKey = null;
      if (m.type === 'retreat') f.invulnFrames = 0;
    }
  };

  Match.prototype.stepStrike = function (f, foe, m) {
    var idx = 0;
    if (m.hits) idx = Math.floor((f.t - m.startup_frames) / m.hit_interval);
    if (idx <= f.hitIndex || (m.hits && idx >= m.hits)) return;
    if (overlap(f.hitboxRect(), foe.hurtbox())) {
      f.hitIndex = idx;
      this.resolveHit(f, foe, m);
    } else if (!m.hits && f.t === m.startup_frames + m.active_frames - 1) {
      this.emit({ type: 'whiff', id: f.id });
    }
  };

  // --------------------------------------------------------- hit resolution

  Match.prototype.resolveHit = function (att, vic, m) {
    if (vic.invulnFrames > 0 || vic.state === 'ko' || vic.state === 'down') return;
    // finisher: landing your named move inside the window triggers it
    if (this.finisherWindow && att === this.player && vic === this.opp &&
      att.moveKey === att.def.mechanics.finisher_move) {
      this.triggerFinisher();
      return;
    }
    // THE CROSS breaks if its victim lands their own signature move on the cheat
    if (this.cross && att === this.cross.victim && vic === this.cross.cheater &&
      att.moveKey === att.def.mechanics.finisher_move) {
      this.breakCross(att, vic);
      return;
    }
    var tun = this.tuning.combat;
    var dir = vic.x >= att.x ? 1 : -1;
    var dmg = m.damage * att.damageMult;

    // blocking
    var blocking = (vic.state === 'block' || (vic.state === 'stun' && vic.blockStun)) &&
      vic.grounded() && !m.unblockable;
    if (blocking) {
      vic.hp -= dmg * tun.block_chip_ratio;
      vic.tookDamage = true;
      vic.state = 'stun'; vic.stunT = m.blockstun; vic.blockStun = true; vic.t = 0;
      vic.vx = dir * m.pushback_block * 0.4;
      this.emit({ type: 'block', x: vic.x, y: -vic.y - vic.def.hurtbox.h * 0.6, id: vic.id });
      this.freeze = Math.max(this.freeze, 2);
      this.onExchange(att, vic);
      return;
    }

    // stance (Brock's Barrel Set): takes a fraction, returns half to the attacker
    if (vic.state === 'attack' && vic.move && vic.move.type === 'stance' && vic.attackPhase() === 'act') {
      vic.hp -= dmg * vic.move.stance_take_ratio;
      vic.tookDamage = true;
      att.hp -= dmg * vic.move.stance_return_ratio;
      att.tookDamage = true;
      att.state = 'stun'; att.stunT = 18; att.blockStun = false; att.t = 0;
      att.vx = -dir * 2.5;
      this.freeze = Math.max(this.freeze, 6);
      this.shake = Math.max(this.shake, 3);
      this.emit({ type: 'stance_return', x: att.x, id: vic.id });
      this.onExchange(att, vic);
      return;
    }

    // armour (Jacco's turn, Puss's Bottom / THE CHAMPION'S BITCH)
    var armored = false, armorRatio = 1;
    if (vic.state === 'attack' && vic.move) {
      var vm = vic.move;
      if (vm.armor_frames && vic.t >= vm.armor_frames[0] && vic.t <= vm.armor_frames[1]) {
        armored = true; armorRatio = vm.armor_damage_ratio !== undefined ? vm.armor_damage_ratio : 1;
      }
      if (vm.armor_if_health_above !== undefined &&
        vic.hp > vm.armor_if_health_above * vic.def.max_health &&
        vic.attackPhase() === 'act') {
        armored = true; armorRatio = 1;
      }
    }
    if (armored) {
      vic.hp -= dmg * armorRatio;
      vic.tookDamage = true;
      this.freeze = Math.max(this.freeze, 3);
      this.emit({ type: 'armor', x: vic.x, y: -vic.y - vic.def.hurtbox.h * 0.7, id: vic.id });
      this.onExchange(att, vic);
      return;
    }

    // clean hit
    vic.hp -= dmg;
    vic.tookDamage = true;
    var kb = (m.base_knockback + m.knockback_growth * (1 - Math.max(0, vic.hp) / vic.def.max_health)) *
      tun.knockback_scale / vic.def.weight;
    var ang = m.launch_angle * DEG;
    vic.vx = dir * (Math.cos(ang) * kb + m.pushback_hit * 0.3);
    var vy = Math.sin(ang) * kb * 1.3;
    if (vy > 1.4 && vic.grounded()) { vic.vy = -vy; vic.y = 0.01; }
    vic.state = 'stun'; vic.stunT = m.hitstun; vic.blockStun = false; vic.t = 0;
    if (vic.move && vic.state !== 'attack') { vic.move = null; vic.moveKey = null; }
    this.freeze = Math.max(this.freeze, m.hit_freeze);
    this.shake = Math.max(this.shake, m.shake);
    this.emit({
      type: 'hit', x: vic.x, y: -vic.y - vic.def.hurtbox.h * 0.7,
      dmg: dmg, heavy: m.shake >= 2, sound: m.sound, dir: dir, id: vic.id
    });
    this.onExchange(att, vic);
  };

  Match.prototype.onExchange = function (att, vic) {
    // extension: Brock retreats toward the barrel after every exchange
    for (var i = 0; i < 2; i++) {
      var f = this.fighters[i];
      if ((f === att || f === vic) && f.def.mechanics && f.def.mechanics.post_exchange_retreat) {
        f.retreatDir = f.side === 0 ? -1 : 1; // back toward his own corner, where the barrel waits
        f.retreatT = f.def.mechanics.post_exchange_retreat;
      }
    }
    // extension: Puss ON THE CROSS at half health — told to lose slowly
    for (var pi = 0; pi < 2; pi++) {
      var puss = this.fighters[pi];
      if (puss.id === 'puss' && !this.pussCross &&
        puss.hp <= puss.def.mechanics.cross_health * puss.def.max_health) {
        this.pussCross = true;
        puss.damageMult = puss.def.mechanics.cross_damage_mult;
        this.emit({ type: 'odds_flip', who: 'puss' });
      }
    }
  };

  // ------------------------------------------------------------------ grabs

  Match.prototype.stepGrabAttempt = function (f, foe, m) {
    if (f.hitIndex >= 0) return;
    if (foe.invulnFrames > 0 || foe.state === 'ko' || foe.state === 'down') return;
    // grip-resistance: a 9+ target with its ripple tell active cannot be grabbed
    if (foe.def.grip_resistance >= 9 && foe.ripple) return;
    if (!overlap(f.hitboxRect(), foe.hurtbox())) return;
    f.hitIndex = 0;

    // finisher: landing the named move inside the window triggers the finisher
    if (this.finisherWindow && f === this.player &&
      f.moveKey === f.def.mechanics.finisher_move) { this.triggerFinisher(); return; }

    // THE CROSS breaks when its victim lands their signature grab on the cheat
    // — the fix only holds if the little cove accepts it
    if (this.cross && f === this.cross.victim && foe === this.cross.cheater) {
      this.breakCross(f, foe);
      f.state = 'idle'; f.t = 0; f.move = null; f.y = 0; f.vy = 0;
      return;
    }

    f.state = 'grab_hold'; f.grabT = m.grab_hold_frames; f.grabFoe = foe;
    f.grabMove = m;
    f.y = 0; f.vy = 0;
    foe.state = 'grabbed'; foe.t = 0;
    foe.x = f.x + f.facing * (f.def.hurtbox.w / 2 + 4);
    foe.y = 0; foe.vy = 0;
    this.freeze = Math.max(this.freeze, m.hit_freeze);
    this.emit({ type: 'grab', id: f.id, sound: m.sound });
  };

  Match.prototype.stepGrabHold = function (f, foe) {
    var m = f.grabMove;
    foe.hp -= (m.damage * f.damageMult) / m.grab_hold_frames;
    foe.tookDamage = true;
    if (--f.grabT <= 0) {
      var tun = this.tuning.combat;
      var kb = (m.base_knockback + m.knockback_growth * (1 - Math.max(0, foe.hp) / foe.def.max_health)) *
        tun.knockback_scale / foe.def.weight;
      var ang = m.launch_angle * DEG;
      foe.vx = f.facing * Math.cos(ang) * kb;
      foe.vy = -Math.sin(ang) * kb * 1.3; foe.y = Math.max(foe.y, 0.01);
      foe.state = 'stun'; foe.stunT = m.hitstun; foe.t = 0;
      f.state = 'idle'; f.t = 0; f.move = null; f.moveKey = null;
      this.emit({ type: 'grab_release', id: f.id });
      this.onExchange(f, foe);
    }
  };

  // ------------------------------------------------ aistrop move extensions

  Match.prototype.stepYank = function (f, foe, m) {
    if (f.hitIndex >= 0) return;
    f.hitIndex = 0;
    // the only counter is to be airborne when it fires
    if (!foe.grounded()) { this.emit({ type: 'yank_whiff' }); return; }
    if (this.finisherWindow && f === this.player &&
      f.moveKey === f.def.mechanics.finisher_move) { this.triggerFinisher(); return; }
    foe.hp -= m.damage * f.damageMult;
    foe.tookDamage = true;
    foe.state = 'stun'; foe.stunT = m.hitstun; foe.blockStun = false; foe.t = 0;
    // dragged to Aistrop's feet regardless of position
    foe.yankTarget = f.x + f.facing * (f.def.hurtbox.w / 2 + 10);
    foe.yankSpeed = m.yank_speed;
    foe.vx = 0;
    this.freeze = Math.max(this.freeze, m.hit_freeze);
    this.shake = Math.max(this.shake, m.shake);
    this.emit({ type: 'yank', id: foe.id, sound: m.sound });
    this.onExchange(f, foe);
  };

  Match.prototype.spawnRats = function (f, m) {
    if (f.hitIndex >= 0) return;
    f.hitIndex = 0;
    f.invulnFrames = m.rats_invuln_frames;
    this.hazards.push({ kind: 'rats', t: 0, dur: m.rats_duration, dps: m.rats_chip_dps, owner: f.id });
    this.emit({ type: 'rats' });
  };

  Match.prototype.spawnCoins = function (f, m) {
    if (f.hitIndex >= 0) return;
    f.hitIndex = 0;
    var r = this.tuning.ring;
    for (var i = 0; i < m.coins_zones; i++) {
      var x = r.left + 20 + this.rng() * (r.right - r.left - 40);
      this.hazards.push({
        kind: 'coins', t: 0, dur: m.coins_duration, dps: m.coins_chip_dps,
        x: x - m.coins_zone_width / 2, w: m.coins_zone_width, owner: f.id
      });
    }
    this.emit({ type: 'coins' });
  };

  Match.prototype.stepRetreat = function (f, foe, m) {
    // he steps back out of the ring and lets the crowd throw things
    var r = this.tuning.ring;
    var edge = f.retreatDir > 0 ? r.right - f.def.hurtbox.w / 2 : r.left + f.def.hurtbox.w / 2;
    var d = edge - f.x;
    if (Math.abs(d) > 2) f.x += Math.sign(d) * 2.5;
    f.invulnFrames = 2;
    f.projT = (f.projT || 0) + 1;
    if (f.projT % m.projectile_interval === 0) {
      this.hazards.push({
        kind: 'thrown', x: foe.x + (this.rng() * 60 - 30), y: -140, vy: 0,
        dmg: m.damage, move: m, owner: f.id
      });
      this.emit({ type: 'crowd_throw' });
    }
  };

  Match.prototype.stepHazards = function () {
    for (var i = this.hazards.length - 1; i >= 0; i--) {
      var h = this.hazards[i];
      h.t = (h.t || 0) + 1;
      var owner = this.player.id === h.owner ? this.player : this.opp;
      var vic = this.other(owner);
      var vulnerable = vic.grounded() && vic.state !== 'ko' && vic.state !== 'down';
      if (h.kind === 'rats') {
        // the sawdust boils: chip damage to whoever is caught in the wave
        if (vulnerable) {
          vic.hp -= h.dps / this.tuning.logic_hz;
          vic.tookDamage = true;
          if (h.t % 30 === 0) this.emit({ type: 'chip', id: vic.id, x: vic.x });
        }
        if (h.t >= h.dur) this.hazards.splice(i, 1);
      } else if (h.kind === 'coins') {
        if (vulnerable && vic.x > h.x && vic.x < h.x + h.w) {
          vic.hp -= h.dps / this.tuning.logic_hz;
          vic.tookDamage = true;
          if (h.t % 30 === 0) this.emit({ type: 'chip', id: vic.id, x: vic.x });
        }
        if (h.t >= h.dur) this.hazards.splice(i, 1);
      } else if (h.kind === 'thrown') {
        h.vy += 0.3; h.y += h.vy;
        if (h.y >= 0) {
          if (Math.abs(h.x - vic.x) < 16 && vulnerable && vic.invulnFrames <= 0) {
            this.resolveHit(owner, vic, h.move);
          }
          this.emit({ type: 'thud', x: h.x });
          this.hazards.splice(i, 1);
        }
      }
    }
  };

  // extension: THE CROSS — the cheat, once per match, at low health. The HUD lies.
  // Works from either side of the ring: whoever is Aistrop declares the fix
  // and his opponent's bar starts draining as though ruled against.
  Match.prototype.stepCross = function () {
    var a = null;
    for (var i = 0; i < 2; i++) if (this.fighters[i].id === 'aistrop') a = this.fighters[i];
    if (!a) return;
    var mech = a.def.mechanics.the_cross;
    if (!this.crossUsed && this.phase === 'fight' &&
      a.hp > 0 && a.hp <= mech.trigger_health * a.def.max_health &&
      (a.state === 'idle' || a.state === 'walk')) {
      this.crossUsed = true;
      this.cross = {
        t: 0, window: Math.round(mech.window_seconds * this.tuning.logic_hz),
        cheater: a, victim: this.other(a)
      };
      this.emit({ type: 'cross_start' });
    }
    if (this.cross) {
      this.cross.t++;
      var v = this.cross.victim;
      v.hp = Math.max(mech.min_health, v.hp - mech.drain_per_second / this.tuning.logic_hz);
      if (this.cross.t >= this.cross.window) {
        this.cross = null;
        this.emit({ type: 'cross_end' });
      }
    }
  };

  Match.prototype.breakCross = function (breaker, cheater) {
    var mech = cheater.def.mechanics.the_cross;
    cheater.hp -= mech.break_bonus_damage;
    cheater.tookDamage = true;
    cheater.state = 'stun'; cheater.stunT = mech.break_stagger_frames; cheater.t = 0;
    cheater.vx = breaker.facing * 2;
    this.cross = null;
    this.freeze = 8; this.shake = 4;
    this.emit({ type: 'cross_break' });
  };

  // ------------------------------------------------------------- finishers

  Match.prototype.stepFinisherWindow = function () {
    var fin = this.st.finisher;
    if (this.finisherRearm > 0) this.finisherRearm--;
    if (this.finisherWindow) {
      if (--this.finisherWindow.t <= 0) {
        this.finisherWindow = null;
        this.finisherRearm = fin.rearm_frames;
        if (this.opp.state === 'dazed') { this.opp.state = 'idle'; this.opp.t = 0; }
        this.emit({ type: 'finisher_lapsed' });
      }
      return;
    }
    var w = this.st.rounds.wins_to_take_match;
    if (this.player.roundsWon === w - 1 && this.finisherRearm <= 0 &&
      this.opp.hp > 0 && this.opp.hp <= fin.health_threshold * this.opp.def.max_health &&
      this.opp.grounded() && this.opp.state !== 'ko' && this.opp.state !== 'down' && !this.cross) {
      this.finisherWindow = { t: Math.round(fin.window_seconds * this.tuning.logic_hz) };
      this.opp.state = 'dazed'; this.opp.dazedT = this.finisherWindow.t; this.opp.t = 0;
      this.opp.move = null; this.opp.moveKey = null;
      var isFinal = this.fightIndex === this.campaign.fights.length - 1;
      var key = isFinal ? this.st.finisher.prompt_key_final : this.st.finisher.prompt_key;
      var text = this.texts.announcer[key];
      this.emit({ type: 'finisher_prompt', text: text });
    }
  };

  Match.prototype.triggerFinisher = function () {
    this.phase = 'finisher';
    this.phaseT = this.st.finisher.cinematic_frames;
    this.finisherWindow = null;
    this.player.state = 'finish'; this.player.t = 0;
    this.player.move = null; this.player.moveKey = null;
    this.player.y = 0; this.player.vy = 0; this.player.vx = 0;
    this.opp.y = 0; this.opp.vy = 0; this.opp.vx = 0;
    this.opp.state = 'finish_victim'; this.opp.t = 0;
    this.emit({
      type: 'finisher_start',
      fight: this.fightIndex,
      name: this.texts.finisher_name
    });
  };

  // ---------------------------------------------------------- announcements

  Match.prototype.checkAnnouncements = function () {
    var p = this.player;
    if (!p.lowAnnounced && p.hp > 0 &&
      p.hp <= this.tuning.combat.low_health_announce * p.def.max_health) {
      p.lowAnnounced = true;
      this.emit({ type: 'announce', kind: 'low_health', text: this.texts.announcer.low_health });
    }
  };

  // --------------------------------------------------------------------- AI

  Match.prototype.aiThink = function (f) {
    var ai = f.def.ai;
    if (!ai) return emptyInput();
    if (f.aiHold > 0) { f.aiHold--; var held = f.aiInput; f.aiInput = dropPresses(held); return held; }
    f.aiHold = this.tuning.ai.decision_interval_frames;

    var inp = emptyInput();
    var foe = this.other(f);
    var dist = Math.abs(foe.x - f.x) - (f.def.hurtbox.w + foe.def.hurtbox.w) / 2;
    var toward = foe.x > f.x ? 'right' : 'left';
    var away = foe.x > f.x ? 'left' : 'right';
    var rng = this.rng;
    var foeWinding = foe.state === 'attack' && foe.attackPhase() === 'wind';

    if (f.busy() && f.state !== 'attack') { f.aiInput = inp; return inp; }

    // dodge the chain yank: be airborne when it fires
    if (foeWinding && foe.move && foe.move.type === 'chain_yank' && f.grounded() && rng() < 0.6) {
      inp.jump = true; f.aiInput = dropPresses(inp); return inp;
    }

    // block reaction
    if (foeWinding && dist < ai.poke_range + 26 && rng() < ai.block_chance) {
      inp.block = true; f.aiInput = inp; return inp;
    }

    // extension: Brock answers pressure with the Barrel Set
    if (ai.stance_chance && foe.state === 'attack' && dist < 50 && rng() < ai.stance_chance &&
      (!f.cd.heavy || f.cd.heavy <= 0)) {
      inp.heavy = true; f.aiInput = dropPresses(inp); return inp;
    }

    // extension: Aistrop steps out of the ring when pressed
    if (ai.stakes_down_health !== undefined && f.def.moves.stakes_down &&
      f.hp < ai.stakes_down_health * f.def.max_health && dist < 46 &&
      (!f.cd.stakes_down || f.cd.stakes_down <= 0) && rng() < 0.5) {
      inp.stakes_down = true; f.aiInput = dropPresses(inp); return inp;
    }

    // special
    if (dist >= ai.special_min_range && dist <= ai.special_max_range &&
      (!f.cd.special || f.cd.special <= 0) && rng() < 0.45 * ai.aggression) {
      inp.special = true; f.aiInput = dropPresses(inp); return inp;
    }

    // heavy (Aistrop's heavy is the yank — use it at range on a grounded foe)
    var heavyOk = (!f.cd.heavy || f.cd.heavy <= 0);
    if (f.def.moves.heavy.type === 'chain_yank') {
      if (heavyOk && dist > 55 && foe.grounded() && rng() < 0.5) {
        inp.heavy = true; f.aiInput = dropPresses(inp); return inp;
      }
    } else if (heavyOk && dist < ai.poke_range + 12 && rng() < ai.aggression * 0.35) {
      inp.heavy = true; f.aiInput = dropPresses(inp); return inp;
    }

    // light poke
    if (dist < ai.poke_range && rng() < ai.aggression) {
      inp.light = true; f.aiInput = dropPresses(inp); return inp;
    }

    // spacing
    if (ai.keep_range !== undefined && dist < ai.keep_range - 8) {
      inp[away] = true;
    } else if (dist > ai.poke_range - 6) {
      if (rng() < ai.retreat_chance) inp[away] = true; else inp[toward] = true;
    } else if (rng() < ai.retreat_chance) {
      inp[away] = true;
    }
    if (rng() < ai.jump_chance) inp.jump = true;

    f.aiInput = inp;
    return inp;
  };

  function dropPresses(inp) {
    // press-type buttons shouldn't be held across the whole decision interval
    return {
      left: inp.left, right: inp.right, block: inp.block,
      jump: false, light: false, heavy: false, special: false, stakes_down: false
    };
  }

  // ----------------------------------------------------------------- pose

  // One source of truth: frame data drives both hitboxes and what is drawn.
  function poseOf(f) {
    switch (f.state) {
      case 'walk': return (Math.floor(f.t / 10) % 2) ? 'walk2' : 'walk1';
      case 'jump': return 'jump';
      case 'block': return 'block';
      case 'stun': return f.blockStun ? 'block' : 'hit';
      case 'grabbed': return 'hit';
      case 'dazed': return (Math.floor(f.t / 16) % 2) ? 'hit' : 'idle2';
      case 'ko': return 'hit';
      case 'down': return 'down';
      case 'grab_hold': return 'special';
      case 'finish': return 'special';
      case 'finish_victim': return 'down';
      case 'attack': {
        var ph = f.attackPhase();
        var key = f.moveKey === 'stakes_down' ? 'special' : f.moveKey;
        if (ph === 'wind') return f.ripple ? 'ripple' : key + '_wind';
        if (ph === 'act') return key;
        return key + '_rec';
      }
      default:
        return (Math.floor(f.t / 24) % 2) ? 'idle2' : 'idle1';
    }
  }

  g.MB = g.MB || {};
  g.MB.Logic = { Match: Match, emptyInput: emptyInput, poseOf: poseOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = g.MB.Logic;
})(typeof window !== 'undefined' ? window : globalThis);
