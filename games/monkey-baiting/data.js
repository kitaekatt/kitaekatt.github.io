/* MONKEY BAITING — data.js
   Loads and validates all YAML data. Isomorphic: caller supplies readFn(relPath)
   returning a Promise of file text (fetch in the browser, fs in node).
   Project rule: NO silent fallbacks — any missing file or field fails loudly
   with the file and field named. */
(function (g) {
  'use strict';

  var CHARACTERS = ['jacco', 'brock', 'billy', 'puss', 'aistrop'];

  var FILES = ['tuning.yaml', 'structure.yaml', 'script.yaml', 'strategies.yaml'].concat(
    CHARACTERS.map(function (c) { return 'characters/' + c + '.yaml'; }));

  // ---- validation helpers -------------------------------------------------

  function Checker(file, errors) { this.file = file; this.errors = errors; }
  Checker.prototype.get = function (obj, path, type) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) {
        this.errors.push(this.file + ': missing required field "' + path + '"');
        return undefined;
      }
      cur = cur[parts[i]];
    }
    if (type && !typeMatches(cur, type)) {
      this.errors.push(this.file + ': field "' + path + '" should be ' + type +
        ', got ' + (cur === null ? 'null' : typeof cur));
      return undefined;
    }
    return cur;
  };

  function typeMatches(v, type) {
    if (type === 'number') return typeof v === 'number' && isFinite(v);
    if (type === 'string') return typeof v === 'string' && v.length > 0;
    if (type === 'boolean') return typeof v === 'boolean';
    if (type === 'list') return Array.isArray(v);
    if (type === 'map') return v !== null && typeof v === 'object' && !Array.isArray(v);
    return true;
  }

  var MOVE_NUM_FIELDS = [
    'startup_frames', 'active_frames', 'recovery_frames', 'damage',
    'base_knockback', 'knockback_growth', 'launch_angle', 'hitstun',
    'blockstun', 'pushback_hit', 'pushback_block', 'hit_freeze', 'shake',
    'cooldown'
  ];
  var MOVE_TYPES = ['strike', 'grab', 'stance', 'chain_yank', 'hazard_rats',
    'hazard_coins', 'retreat'];

  function checkMove(ck, chr, key) {
    var mv = ck.get(chr, 'moves.' + key, 'map');
    if (!mv) return;
    var p = 'moves.' + key + '.';
    ck.get(chr, p + 'name', 'string');
    var type = ck.get(chr, p + 'type', 'string');
    if (type && MOVE_TYPES.indexOf(type) < 0) {
      ck.errors.push(ck.file + ': ' + p + 'type "' + type + '" is not one of ' + MOVE_TYPES.join('/'));
    }
    MOVE_NUM_FIELDS.forEach(function (f) { ck.get(chr, p + f, 'number'); });
    var hb = ck.get(chr, p + 'hitbox', 'map');
    if (hb) ['x', 'y', 'w', 'h'].forEach(function (f) { ck.get(chr, p + 'hitbox.' + f, 'number'); });
    ck.get(chr, p + 'sound', 'string');
    if (type === 'grab') ck.get(chr, p + 'grab_hold_frames', 'number');
    if (type === 'stance') {
      ck.get(chr, p + 'stance_take_ratio', 'number');
      ck.get(chr, p + 'stance_return_ratio', 'number');
    }
    if (type === 'chain_yank') ck.get(chr, p + 'yank_speed', 'number');
    if (type === 'hazard_rats') ['rats_duration', 'rats_chip_dps', 'rats_invuln_frames']
      .forEach(function (f) { ck.get(chr, p + f, 'number'); });
    if (type === 'hazard_coins') ['coins_duration', 'coins_zones', 'coins_zone_width', 'coins_chip_dps']
      .forEach(function (f) { ck.get(chr, p + f, 'number'); });
    if (type === 'retreat') ck.get(chr, p + 'projectile_interval', 'number');
    if (mv.hits !== undefined) ck.get(chr, p + 'hit_interval', 'number');
    if (mv.armor_frames !== undefined && (!Array.isArray(mv.armor_frames) || mv.armor_frames.length !== 2)) {
      ck.errors.push(ck.file + ': ' + p + 'armor_frames must be [start, end]');
    }
    if (mv.input !== undefined && ['jump', 'light', 'heavy', 'special', 'block'].indexOf(mv.input) < 0) {
      ck.errors.push(ck.file + ': ' + p + 'input must be one of jump/light/heavy/special/block');
    }
  }

  function checkCharacter(file, chr, errors) {
    var ck = new Checker(file, errors);
    ['id', 'name'].forEach(function (f) { ck.get(chr, f, 'string'); });
    ['max_health', 'walk_speed', 'jump_velocity', 'gravity', 'weight', 'grip_resistance']
      .forEach(function (f) { ck.get(chr, f, 'number'); });
    ck.get(chr, 'hurtbox.w', 'number');
    ck.get(chr, 'hurtbox.h', 'number');
    ck.get(chr, 'palette', 'map');
    var finMove = ck.get(chr, 'mechanics.finisher_move', 'string');
    if (finMove && chr.moves && !chr.moves[finMove]) {
      errors.push(file + ': mechanics.finisher_move "' + finMove + '" is not a move of this character');
    }
    var ai = ck.get(chr, 'ai', 'map');
    if (ai) ['aggression', 'poke_range', 'block_chance', 'retreat_chance',
      'special_min_range', 'special_max_range', 'jump_chance']
      .forEach(function (f) { ck.get(chr, 'ai.' + f, 'number'); });
    var moves = ck.get(chr, 'moves', 'map');
    if (moves) {
      ['light', 'heavy', 'special'].forEach(function (k) {
        if (!(k in moves)) errors.push(file + ': missing required move "moves.' + k + '"');
        else checkMove(ck, chr, k);
      });
      Object.keys(moves).forEach(function (k) {
        if (['light', 'heavy', 'special'].indexOf(k) < 0) checkMove(ck, chr, k);
      });
    }
  }

  function checkTuning(file, t, errors) {
    var ck = new Checker(file, errors);
    ['logic_hz', 'internal_width', 'internal_height', 'floor_y'].forEach(function (f) { ck.get(t, f, 'number'); });
    ['ring.left', 'ring.right', 'ring.center', 'ring.wall_height',
      'combat.block_chip_ratio', 'combat.hit_freeze_default', 'combat.ko_slowmo_frames',
      'combat.ko_fall_frames', 'combat.low_health_announce', 'combat.knockback_scale',
      'combat.min_health_floor', 'ai.decision_interval_frames']
      .forEach(function (f) { ck.get(t, f, 'number'); });
  }

  function checkStructure(file, st, errors) {
    var ck = new Checker(file, errors);
    ['rounds.wins_to_take_match', 'rounds.time_seconds', 'rounds.intro_frames',
      'rounds.end_frames', 'finisher.health_threshold', 'finisher.window_seconds',
      'finisher.rearm_frames', 'finisher.cinematic_frames']
      .forEach(function (f) { ck.get(st, f, 'number'); });
    ['rounds.timeout_tie_winner', 'finisher.condition', 'finisher.prompt_key',
      'finisher.prompt_key_final', 'continue_rules.retry', 'continue_rules.decline',
      'flow.start']
      .forEach(function (f) { ck.get(st, f, 'string'); });
    ck.get(st, 'continue_rules.allowed', 'boolean');
    ck.get(st, 'fight_sequence', 'list');
    var campaigns = ck.get(st, 'campaigns', 'map');
    if (campaigns) {
      CHARACTERS.forEach(function (cid) {
        if (!campaigns[cid]) { errors.push(file + ': missing campaigns.' + cid); return; }
        var cck = new Checker(file + ' campaigns.' + cid, errors);
        var cstyle = cck.get(campaigns[cid], 'continue_style', 'string');
        if (cstyle && ['countdown', 'tally', 'wipe', 'purse', 'house'].indexOf(cstyle) < 0) {
          errors.push(file + ' campaigns.' + cid + ': continue_style "' + cstyle +
            '" must be countdown/tally/wipe/purse/house');
        }
        var fights = cck.get(campaigns[cid], 'fights', 'list');
        if (!fights) return;
        fights.forEach(function (f, i) {
          var where = file + ' campaigns.' + cid + '.fights[' + i + ']';
          var c = new Checker(where, errors);
          c.get(f, 'opponent', 'string');
          c.get(f, 'stage_wear', 'number');
          var chain = f ? f.chain : undefined;
          if (chain === undefined) errors.push(where + ': missing required field "chain"');
          else if (chain !== 'none' && chain !== null) {
            if (typeof chain !== 'object' ||
              ['player', 'opponent'].indexOf(chain.to) < 0 ||
              ['stake', 'player', 'opponent'].indexOf(chain.from) < 0) {
              errors.push(where + ': chain must be "none" or {to: player|opponent, from: stake|player|opponent}');
            }
          }
        });
      });
      Object.keys(campaigns).forEach(function (cid) {
        if (CHARACTERS.indexOf(cid) < 0) errors.push(file + ': campaigns.' + cid + ' is not a roster character');
      });
    }
    var nodes = ck.get(st, 'flow.nodes', 'map');
    if (nodes) {
      if (st.flow.start && !nodes[st.flow.start]) {
        errors.push(file + ': flow.start "' + st.flow.start + '" is not a flow node');
      }
      Object.keys(nodes).forEach(function (name) {
        var n = nodes[name];
        var c = new Checker(file + ' flow.nodes.' + name, errors);
        var kind = c.get(n, 'kind', 'string');
        function ref(field) {
          var v = c.get(n, field, 'string');
          if (v && !nodes[v]) errors.push(file + ': flow.nodes.' + name + '.' + field +
            ' points to unknown node "' + v + '"');
        }
        if (kind === 'screen' || kind === 'select') ref('next');
        else if (kind === 'fight') { c.get(n, 'index', 'number'); ref('win'); ref('lose'); }
        else if (kind === 'continue') { /* uses continue_rules */ }
        else if (kind) errors.push(file + ': flow.nodes.' + name + ': unknown kind "' + kind + '"');
      });
    }
  }

  var STRATEGY_KINDS = ['default', 'spam'];

  function checkStrategies(file, st, errors) {
    var ck = new Checker(file, errors);
    var strategies = ck.get(st, 'strategies', 'map');
    if (!strategies) return;
    if (!strategies.default) errors.push(file + ': a "default" strategy is required');
    if (!strategies.spam) errors.push(file + ': the "spam" strategy template is required');
    Object.keys(strategies).forEach(function (name) {
      var sfile = file + ' strategies.' + name;
      var c = new Checker(sfile, errors);
      var kind = c.get(strategies[name], 'kind', 'string');
      if (kind && STRATEGY_KINDS.indexOf(kind) < 0) {
        errors.push(sfile + ': kind "' + kind + '" must be one of ' + STRATEGY_KINDS.join('/'));
      }
      if (kind === 'spam') {
        ['reach_margin', 'leap_reach_bonus', 'unranged_reach'].forEach(function (p) {
          c.get(strategies[name], 'params.' + p, 'number');
        });
      }
    });
  }

  function checkScript(file, s, errors) {
    var ck = new Checker(file, errors);
    ['shared.title', 'shared.tagline', 'shared.poster_footnote',
      'shared.prefight_ritual', 'shared.closing_note']
      .forEach(function (f) { ck.get(s, f, 'string'); });
    ck.get(s, 'shared.poster', 'list');
    ck.get(s, 'shared.barker', 'list');
    ['round1', 'round2', 'round3', 'finisher', 'finisher_final', 'perfect',
      'low_health', 'victory', 'defeat']
      .forEach(function (f) { ck.get(s, 'shared.announcer.' + f, 'string'); });
    CHARACTERS.forEach(function (c) { ck.get(s, 'shared.names.' + c, 'string'); });

    var campaigns = ck.get(s, 'campaigns', 'map');
    if (!campaigns) return;
    CHARACTERS.forEach(function (cid) {
      var cam = campaigns[cid];
      if (!cam) { errors.push(file + ': missing campaigns.' + cid); return; }
      var cfile = file + ' campaigns.' + cid;
      var cc = new Checker(cfile, errors);
      var avail = cc.get(cam, 'available', 'boolean');
      cc.get(cam, 'select_line', 'string');
      if (!avail) return; // pending campaign: text not authored yet, loader will refuse to run it
      ['opening_crawl', 'ending_a', 'ending_a_card', 'bill_footnote',
        'continue_screen.heading', 'continue_screen.note']
        .forEach(function (f) { cc.get(cam, f, 'string'); });
      cc.get(cam, 'bill', 'list');
      // ending_b (the "give up" ending) is optional; jacco has one, and a
      // campaign that lacks it routes decline straight to the closing note.
      if ((cam.ending_b === undefined) !== (cam.ending_b_card === undefined)) {
        errors.push(cfile + ': ending_b and ending_b_card must be present together');
      }
      if (cam.ending_a_card_2 !== undefined && !typeMatches(cam.ending_a_card_2, 'string')) {
        errors.push(cfile + ': ending_a_card_2 must be a string');
      }
      var fights = cc.get(cam, 'fights', 'list');
      if (fights) {
        if (fights.length !== 4) errors.push(cfile + ': "fights" must list exactly 4 fights');
        fights.forEach(function (f, i) {
          var c = new Checker(cfile + '.fights[' + i + ']', errors);
          ['opponent', 'billing', 'finisher_name', 'victory', 'defeat'].forEach(function (k) { c.get(f, k, 'string'); });
          var d = c.get(f, 'dialogue', 'list');
          if (d) d.forEach(function (line, j) {
            var lc = new Checker(cfile + '.fights[' + i + '].dialogue[' + j + ']', errors);
            lc.get(line, 'who', 'string');
            lc.get(line, 'text', 'string');
          });
        });
      }
      if (cam.announcer !== undefined && (cam.announcer === null || typeof cam.announcer !== 'object')) {
        errors.push(cfile + ': announcer override must be a map of announcer keys');
      }
    });
    Object.keys(campaigns).forEach(function (cid) {
      if (CHARACTERS.indexOf(cid) < 0) errors.push(file + ': campaigns.' + cid + ' is not a roster character');
    });
  }

  // ---- loading ------------------------------------------------------------

  function load(readFn, YAML) {
    YAML = YAML || g.MB.YAML;
    var texts = {};
    return Promise.all(FILES.map(function (f) {
      return Promise.resolve(readFn('data/' + f)).then(function (text) {
        if (typeof text !== 'string' || text.length === 0) {
          throw new Error('data/' + f + ': file is empty or unreadable');
        }
        texts[f] = text;
      }, function (e) {
        throw new Error('failed to load data/' + f + ': ' + (e && e.message ? e.message : e));
      });
    })).then(function () {
      var errors = [];
      var parsed = {};
      FILES.forEach(function (f) {
        try { parsed[f] = YAML.parse(texts[f], 'data/' + f); }
        catch (e) { errors.push(e.message); }
      });
      if (errors.length) throw new Error('DATA ERRORS:\n' + errors.join('\n'));

      checkTuning('data/tuning.yaml', parsed['tuning.yaml'], errors);
      checkStructure('data/structure.yaml', parsed['structure.yaml'], errors);
      checkScript('data/script.yaml', parsed['script.yaml'], errors);
      checkStrategies('data/strategies.yaml', parsed['strategies.yaml'], errors);
      var characters = {};
      CHARACTERS.forEach(function (c) {
        var file = 'characters/' + c + '.yaml';
        checkCharacter('data/' + file, parsed[file], errors);
        characters[c] = parsed[file];
        if (parsed[file] && parsed[file].id !== c) {
          errors.push('data/' + file + ': id "' + parsed[file].id + '" does not match filename');
        }
      });
      // cross-checks
      var tun = parsed['tuning.yaml'], scr = parsed['script.yaml'], st = parsed['structure.yaml'];
      if (st && st.campaigns) {
        CHARACTERS.forEach(function (cid) {
          var cam = st.campaigns[cid];
          if (!cam || !Array.isArray(cam.fights)) return;
          cam.fights.forEach(function (f, i) {
            var where = 'structure.yaml campaigns.' + cid + '.fights[' + i + ']';
            if (!f) return;
            if (!characters[f.opponent]) errors.push(where + ': unknown opponent "' + f.opponent + '"');
            if (f.opponent === cid) errors.push(where + ': ' + cid + ' cannot fight themselves');
            // a stake tether requires a chain radius on the tethered character
            if (f.chain && typeof f.chain === 'object' && f.chain.from === 'stake') {
              var tetheredId = f.chain.to === 'player' ? cid : f.opponent;
              var tc = characters[tetheredId];
              if (tc && (!tc.mechanics || typeof tc.mechanics.chain_radius !== 'number')) {
                errors.push(where + ': chain.from is "stake" but ' + tetheredId +
                  ' has no mechanics.chain_radius');
              }
            }
          });
          // authored script must agree with structure fight-for-fight
          var camScr = scr && scr.campaigns && scr.campaigns[cid];
          if (camScr && camScr.available && Array.isArray(camScr.fights)) {
            if (camScr.fights.length !== cam.fights.length) {
              errors.push('script.yaml campaigns.' + cid + ' lists ' + camScr.fights.length +
                ' fights but structure.yaml lists ' + cam.fights.length);
            }
            for (var i = 0; i < Math.min(camScr.fights.length, cam.fights.length); i++) {
              if (camScr.fights[i] && cam.fights[i] && camScr.fights[i].opponent !== cam.fights[i].opponent) {
                errors.push('campaigns.' + cid + '.fights[' + i + ']: structure.yaml says ' +
                  cam.fights[i].opponent + ' but script.yaml says ' + camScr.fights[i].opponent);
              }
            }
          }
          if (st.flow && st.flow.nodes) {
            Object.keys(st.flow.nodes).forEach(function (name) {
              var n = st.flow.nodes[name];
              if (n && n.kind === 'fight' && typeof n.index === 'number' &&
                (n.index < 0 || n.index >= cam.fights.length)) {
                errors.push('structure.yaml flow.nodes.' + name + '.index ' + n.index +
                  ' out of range for campaign ' + cid);
              }
            });
          }
        });
      }
      if (errors.length) throw new Error('DATA ERRORS:\n' + errors.join('\n'));

      return {
        tuning: tun, structure: st, script: scr,
        strategies: parsed['strategies.yaml'].strategies,
        characters: characters, characterIds: CHARACTERS.slice()
      };
    });
  }

  var Data = { FILES: FILES, CHARACTERS: CHARACTERS, load: load };

  g.MB = g.MB || {};
  g.MB.Data = Data;
  if (typeof module !== 'undefined' && module.exports) module.exports = Data;
})(typeof window !== 'undefined' ? window : globalThis);
