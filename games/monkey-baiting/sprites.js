/* MONKEY BAITING — sprites.js
   Procedural pixel art. Each fighter is a set of small pixel grids (string
   rows), one pose per state-machine window (poseOf in logic.js). Letters map
   to palette slot NAMES; the actual colours come from the character's YAML
   palette, so the art obeys the data files. 'K' is the shared ink/outline.
   Rows may be ragged; they are padded on decode. Sprites face RIGHT and are
   mirrored at draw time when facing left. Anchor: bottom-centre. */
(function (g) {
  'use strict';

  var INK = '#1a1512'; // period print ink — shared outline colour (art, not tuning)

  // ---- helpers ------------------------------------------------------------

  function pad(rows) {
    var w = 0, i;
    for (i = 0; i < rows.length; i++) w = Math.max(w, rows[i].length);
    var out = [];
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      while (r.length < w) r += '.';
      out.push(r);
    }
    return out;
  }

  function shiftX(rows, dx, from, to) {
    // horizontally shift rows [from, to) by dx (positive = right)
    rows = pad(rows);
    var out = rows.slice();
    for (var i = (from || 0); i < (to === undefined ? rows.length : to); i++) {
      var r = rows[i];
      if (dx > 0) out[i] = new Array(dx + 1).join('.') + r.slice(0, r.length - dx);
      else out[i] = r.slice(-dx) + new Array(1 - dx).join('.');
    }
    return out;
  }

  function dropTop(rows) { // squash 1px: remove a blank-ish top row, duplicate bottom
    rows = pad(rows);
    return rows.slice(1).concat([rows[rows.length - 1]]);
  }

  // ---- JACCO — small, low, wide-shouldered, a coiled fist ------------------
  // letters: f fur, m muzzle, r mouth/wound, c chain, K ink
  var jaccoIdle = [
    '....................',
    '.......KKKK.........',
    '......KffffKK.......',
    '.....KffffffKKKK....',
    '....KfffffffKffmK...',
    '...KffffffffffmmmK..',
    '...KfffffffffKmrmK..',
    '..KffffffffffKmmK...',
    '..KffKffffKfffKK....',
    '..KfK.KffK..KfK.....',
    '..KfK.KfK...KfK.....',
    '.KffK.KfK..KffK.....',
    '..KK...K....KK......'
  ];
  var jacco = {
    scale: 2,
    letters: { f: 'fur', m: 'muzzle', r: 'wound', c: 'chain' },
    frames: {
      idle1: jaccoIdle,
      idle2: dropTop(jaccoIdle),
      walk1: shiftX(jaccoIdle, 1, 8, 13),
      walk2: shiftX(jaccoIdle, -1, 8, 13),
      ripple: shiftX(jaccoIdle, 1, 1, 5), // the skin moves before he does
      wind: [
        '....................',
        '....................',
        '.......KKKK.........',
        '......KffffKK.......',
        '.....KffffffKKK.....',
        '....KfffffffKfmK....',
        '...KffffffffKmmmK...',
        '...KffffffffKmrmK...',
        '..KfffffffffKmmK....',
        '..KffKffffKffKK.....',
        '..KfKKffKK.KfK......',
        '.KffK.KfK..KffK.....',
        '..KK...K....KK......'
      ],
      light: [ // Saucer Hand — raking swipe, arm out
        '....................',
        '.......KKKK.........',
        '......KffffKK.......',
        '.....KffffffKKKK....',
        '....KfffffffKffmK...',
        '...KfffffffffmmmKK..',
        '...KffffffffKmrmKfK.',
        '..KfffffffffKmmKffK.',
        '..KffKffffKffKKKfKK.',
        '..KfK.KffK..KfK.K...',
        '..KfK.KfK...KfK.....',
        '.KffK.KfK..KffK.....',
        '..KK...K....KK......'
      ],
      heavy: [ // Present the Back — turned, riding up the body
        '....................',
        '......KKKK..........',
        '....KKffffK.........',
        '..KKfffffffK........',
        '.KfmKfffffffK.......',
        '.KmmfffffffffK......',
        '..KKfffffffffK......',
        '...KfffffffffK......',
        '..KffffKffffKK......',
        '..KffKK.KffK........',
        '..KfK...KfK.........',
        '.KffK..KffK.........',
        '..KK....KK..........'
      ],
      special: [ // WINDPIPE — leap to the throat, arms and feet forward
        '....................',
        '........KKKK........',
        '.......KffffKKK.....',
        '..KKKKKffffffKmK....',
        '.KfffffffffffmmmK...',
        '.KfffffffffffKmrK...',
        '..KKffffffffffKmK...',
        '....KffffffKffKK....',
        '...KffKKKffKKffK....',
        '..KfKK...KfK.KfK....',
        '..KK......K...K.....',
        '....................',
        '....................'
      ],
      hit: [
        '....................',
        '....KKKK............',
        '..KKffffK...........',
        '.KmffffffKK.........',
        'KmmKfffffffKK.......',
        'KmrKfffffffffK......',
        '.KKffffffffffK......',
        '..KfffffffffKK......',
        '..KffKffffKfK.......',
        '..KfK.KffKKfK.......',
        '.KfK..KfK..KfK......',
        '.KK...KK....KK......',
        '....................'
      ],
      block: [ // curled, arms up
        '....................',
        '....................',
        '.......KKKK.........',
        '......KffffKK.......',
        '.....KffffffKK......',
        '....KffffffffKK.....',
        '...KffffffffffK.....',
        '...KffKffffKffK.....',
        '...KffKffffKffK.....',
        '...KfKKffffKKfK.....',
        '...KfK.KffK.KfK.....',
        '....K...KK...K......',
        '....................'
      ],
      jump: [
        '....................',
        '.......KKKK.........',
        '......KffffKK.......',
        '.....KffffffKKKK....',
        '....KfffffffKffmK...',
        '...KffffffffffmmK...',
        '...KfffffffffKmrK...',
        '..KffffffffffKmK....',
        '..KffKffffKffKK.....',
        '..KfK..KfK.KfK......',
        '.KfK...KfK..KfK.....',
        '.K......K....K......',
        '....................'
      ],
      down: [
        '....................',
        '....................',
        '....................',
        '....................',
        '....................',
        '....................',
        '....................',
        '....................',
        '....KKKKKKKK........',
        '..KKffffffffKKKK....',
        '.KmmfffffffffffKK...',
        'KmrmfffffffffffffK..',
        '.KKKKKKKKKKKKKKK....'
      ]
    }
  };
  jacco.frames.light_wind = jacco.frames.ripple;
  jacco.frames.light_rec = jacco.frames.idle2;
  jacco.frames.heavy_wind = jacco.frames.heavy;
  jacco.frames.heavy_rec = jacco.frames.wind;
  jacco.frames.special_wind = jacco.frames.wind;
  jacco.frames.special_rec = jacco.frames.idle2;

  // ---- BROCK — a door lying on its side ------------------------------------
  // letters: g coat, s stripe, o ochre, b blood
  var brockIdle = [
    '..........................',
    '......KKKKKKKKKK..........',
    '...KKKggggggggggKKKK......',
    '..KgggggggggggggggggKKK...',
    '.KgggggggggggggggggsssKK..',
    '.KooggggggggggggggsgggsK..',
    '.KoogggggggggggggsgggssK..',
    '.KgggggggggggggggsggsbK...',
    '..KggKggggggKgggggssKK....',
    '..KoK.KooK..KoK.KoK.......',
    '...K...KK....K...K........'
  ];
  var brock = {
    scale: 2,
    letters: { g: 'coat', s: 'stripe', o: 'ochre', b: 'blood' },
    frames: {
      idle1: brockIdle,
      idle2: dropTop(brockIdle),
      walk1: shiftX(brockIdle, 1, 8, 11),
      walk2: shiftX(brockIdle, -1, 8, 11),
      wind: dropTop(dropTop(brockIdle)), // lowers before he moves
      light: [ // Snap — jaw at knee height
        '..........................',
        '......KKKKKKKKKK..........',
        '...KKKggggggggggKKK.......',
        '..KggggggggggggggggKK.....',
        '.KggggggggggggggggsssK....',
        '.KoogggggggggggggsgggsKK..',
        '.KooggggggggggggsgggssbK..',
        '.KggggggggggggggsggsbKK...',
        '..KggKggggggKgggssKKbK....',
        '..KoK.KooK..KoK.KoK.......',
        '...K...KK....K...K........'
      ],
      heavy: [ // Barrel Set — planted, lowered, immovable
        '..........................',
        '..........................',
        '.....KKKKKKKKKKKK.........',
        '..KKKggggggggggggKKKK.....',
        '.KgggggggggggggggggssKK...',
        '.KoogggggggggggggsgggsK...',
        '.KooggggggggggggsggssbK...',
        '.KggggggggggggggsggsbK....',
        '.KggKKggggggKKgggssKK.....',
        '.KooKKooooooKKooKKoK......',
        '..KKKKKKKKKKKKKKKKK.......'
      ],
      special: [ // DRAWN AGAIN — lunging bite, mouth open
        '..........................',
        '.....KKKKKKKKKK...........',
        '..KKKggggggggggKKKK.......',
        '.KgggggggggggggggggsssKK..',
        '.KooggggggggggggggsgggsK..',
        '.KoogggggggggggggsggbbbK..',
        '.KggggggggggggggggssKKK...',
        '.KgggggggggggggggsggssbK..',
        '..KggKggggggKggggggsKbK...',
        '.KoK...KooK...KoK..KK.....',
        '..K.....KK.....K..........'
      ],
      hit: [
        '..........................',
        '....KKKKKKKKKK............',
        '..KKggggggggggKKK.........',
        '.KsssggggggggggggKK.......',
        '.KsgggsggggggggggggK......',
        '.KsggsggggggggggggooK.....',
        '.KbsggsgggggggggggooK.....',
        '..KKsggggggggggggggK......',
        '...KKggKggggggKggK........',
        '....KoK.KooK..KoK.........',
        '.....K...KK....K..........'
      ],
      block: dropTop(dropTop(brockIdle)),
      jump: brockIdle,
      down: [
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '.......KKKKKKKKKKKK.......',
        '...KKKKggggggggggggKKK....',
        '..KggggggggggggggggggsKK..',
        '.KoogggggggggggggggsssbK..',
        '..KKKKKKKKKKKKKKKKKKKK....'
      ]
    }
  };
  brock.frames.light_wind = brock.frames.wind;
  brock.frames.light_rec = brock.frames.idle2;
  brock.frames.heavy_wind = brock.frames.wind;
  brock.frames.heavy_rec = brock.frames.idle2;
  brock.frames.special_wind = brock.frames.block; // defensive crouch, then yanked out
  brock.frames.special_rec = brock.frames.idle2;

  // ---- BILLY — wire-tight, head low and level, never still ------------------
  // letters: w white, l liver, p muzzle, r rat-shadow
  var billyIdle = [
    '........................',
    '..K.....................',
    '..KK........KKKKK.......',
    '..KwK.....KKwwwwwKKK....',
    '..KwwKKKKKwwwwwwwwwwK...',
    '...KwwwwwwwwwllwwwwwK...',
    '...KwwwwwwwwwllwwwwppK..',
    '....KwwwwwwwwwwwwwppKK..',
    '....KwwwwwwwwwwwwwKK....',
    '....KwwKwwwwwKwwwK......',
    '....KwK.KwwK.KwK........',
    '....KwK.KwK..KwK........',
    '.....K...K....K.........'
  ];
  var billy = {
    scale: 2,
    letters: { w: 'white', l: 'liver', p: 'muzzle', r: 'rat' },
    frames: {
      idle1: billyIdle,
      idle2: shiftX(billyIdle, 1, 2, 8), // the twitch: head jerks at nothing
      walk1: shiftX(billyIdle, 1, 9, 13),
      walk2: shiftX(billyIdle, -1, 9, 13),
      wind: dropTop(billyIdle),
      light: [ // Shake
        '........................',
        '..K.....................',
        '..KK.......KKKKK........',
        '..KwK....KKwwwwwKKKK....',
        '..KwwKKKKwwwwwwwwwwppK..',
        '...KwwwwwwwwllwwwwppKK..',
        '...KwwwwwwwwllwwwwwKpK..',
        '....KwwwwwwwwwwwwwKK....',
        '....KwwwwwwwwwwwwK......',
        '....KwwKwwwwwKwwwK......',
        '....KwK.KwwK.KwK........',
        '....KwK.KwK..KwK........',
        '.....K...K....K.........'
      ],
      heavy: [ // Six Twenty-Five — full-body flurry
        '........................',
        '.K......................',
        '.KK.........KKKKK.......',
        '.KwK......KKwwwwwKKKK...',
        '.KwwKKKKKwwwwwwwwwwppK..',
        '..KwwwwwwwwwllwwwppKKK..',
        '..KwwwwwwwwwllwwwwpKpK..',
        '...KwwwwwwwwwwwwwwKK....',
        '...KwwwwwwwwwwwwwK......',
        '...KwKwwwwwKwwwwK.......',
        '..KwK.KwwK..KwKwK.......',
        '.KwK..KwK....KwK........',
        '..K....K......K.........'
      ],
      special: [ // THE HUNDRED — lost in the rats
        '........................',
        '........................',
        '..K.........KKKKK.......',
        '..KK......KKwwwwwKK.....',
        '..KwKKKKKwwwwwwwwwwK....',
        '...KwwwwwwwllwwwwwppK...',
        '...KwwwwwwwllwwwwwppK...',
        '....KwwwwwwwwwwwwwKK....',
        '..rrKwwwwwwwwwwwwKrr....',
        '.rrKwwKwwwwwKwwwKrrr....',
        'rrrKwK.KwwK.KwKrrrrrr...',
        'rrrrrrrrrrrrrrrrrrrrrr..',
        '.rrrrrrrrrrrrrrrrrrr....'
      ],
      hit: [
        '........................',
        '....................K...',
        '.....KKKKK.........KK...',
        '...KKwwwwwKKK.....KwK...',
        '..ppwwwwwwwwwwKKKKwwK...',
        '..KppwwwwllwwwwwwwwK....',
        '..KpKwwwwllwwwwwwwK.....',
        '...KKwwwwwwwwwwwwK......',
        '.....KwwwwwwwwwwK.......',
        '.....KwwKwwwwKwwK.......',
        '....KwK..KwK..KwK.......',
        '....K.....K....K........',
        '........................'
      ],
      block: dropTop(billyIdle),
      jump: billyIdle,
      down: [
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '.....KKKKKKKKKKK........',
        '..KKKwwwwwwwwwwwKKKK....',
        '.KppwwwwwllwwwwwwwwwK...',
        '..KKKKKKKKKKKKKKKKKK....',
        '........................'
      ]
    }
  };
  billy.frames.light_wind = billy.frames.wind;
  billy.frames.light_rec = billy.frames.idle2;
  billy.frames.heavy_wind = billy.frames.wind;
  billy.frames.heavy_rec = billy.frames.idle1;
  billy.frames.special_wind = billy.frames.wind;
  billy.frames.special_rec = billy.frames.idle2;

  // ---- PUSS — stands like something that has been shown off -----------------
  // letters: W white, B ribbon blue, U ribbon buff, S scar (the pre-cut), R red
  var pussIdle = [
    '..........................',
    '..................KKKK....',
    '.................KWWWWK...',
    '..K..............KWWWWWK..',
    '..KK....KKKKKKKKKWWWWWK...',
    '..KWKKKKWWWWWWWWWWBUBK....',
    '...KWWWWWWSSWWWWWWWWK.....',
    '...KWWWWWWSSWWWWWWWK......',
    '....KWWWWWWWWWWWWWK.......',
    '....KWWWWWWWWWWWWK........',
    '....KWWKWWWWWKWWK.........',
    '....KWK..KWK..KWK.........',
    '....KWK..KWK...KWK........',
    '.....K....K.....K.........',
    '..........................'
  ];
  var puss = {
    scale: 2,
    letters: { W: 'white', B: 'ribbon_blue', U: 'ribbon_buff', S: 'scar', R: 'red' },
    frames: {
      idle1: pussIdle,
      idle2: dropTop(pussIdle),
      walk1: shiftX(pussIdle, 1, 10, 14),
      walk2: shiftX(pussIdle, -1, 10, 14),
      wind: dropTop(pussIdle),
      light: [ // Jab — short, straight, snapping lead
        '..........................',
        '..............KKKK........',
        '.............KWWWWKKK.....',
        '..K..........KWWWWWWRK....',
        '..KK...KKKKKKWWWWWWKKK....',
        '..KWKKKWWWWWWWWBUBKK......',
        '...KWWWWWSSWWWWWWWK.......',
        '...KWWWWWSSWWWWWWK........',
        '....KWWWWWWWWWWWK.........',
        '....KWWWWWWWWWWWK.........',
        '....KWWKWWWWKWWK..........',
        '....KWK..KWK.KWK..........',
        '....KWK..KWK..KWK.........',
        '.....K....K....K..........',
        '..........................'
      ],
      heavy: [ // Bottom — leaning in to trade
        '..........................',
        '..........................',
        '................KKKK......',
        '...............KWWWWK.....',
        '..K............KWWWWWK....',
        '..KK...KKKKKKKKWWWWWK.....',
        '..KWKKKWWWWWWWWWBUBRK.....',
        '...KWWWWWSSWWWWWWWWK......',
        '...KWWWWWSSWWWWWWWK.......',
        '....KWWWWWWWWWWWWK........',
        '....KWWWWWWWWWWWK.........',
        '....KWWKWWWWKWWK..........',
        '...KWK..KWK..KWWK.........',
        '...KK....K.....KK.........',
        '..........................'
      ],
      special: [ // THE CHAMPION'S BITCH — sustained pressure
        '..........................',
        '..............KKKK........',
        '.............KWWWWK.......',
        '..K..........KWWWWWKK.....',
        '..KK...KKKKKKWWWWWWRKK....',
        '..KWKKKWWWWWWWWBUBKKRK....',
        '...KWWWWWSSWWWWWWWKK......',
        '...KWWWWWSSWWWWWWK........',
        '....KWWWWWWWWWWWK.........',
        '....KWWWWWWWWWWK..........',
        '...KWWKWWWWKWWWK..........',
        '..KWK..KWK..KWKWK.........',
        '..KK....K....K.K..........',
        '..........................',
        '..........................'
      ],
      hit: [
        '..........................',
        '..KKKK....................',
        '.KWWWWK...................',
        'KWWWWWK...K...............',
        '.KWWWWKKKKKKKKKKK.KK......',
        '..KBUBWWWWWWWWWWWWKWK.....',
        '...KWWWWWWSSWWWWWWWK......',
        '....KWWWWWSSWWWWWWK.......',
        '.....KWWWWWWWWWWWK........',
        '.....KWWWWWWWWWWK.........',
        '.....KWWKWWWWKWWK.........',
        '....KWK..KWK..KWK.........',
        '....K.....K....K..........',
        '..........................',
        '..........................'
      ],
      block: dropTop(dropTop(pussIdle)),
      jump: pussIdle,
      down: [
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '..........................',
        '......KKKKKKKKKKKK........',
        '...KKKWWWWWWWWWWWWKKKK....',
        '..KWWWWWWSSWWWWWWWWBUBK...',
        '..KRKKKKKKKKKKKKKKKKKK....',
        '..........................',
        '..........................'
      ]
    }
  };
  puss.frames.light_wind = puss.frames.wind;
  puss.frames.light_rec = puss.frames.idle2;
  puss.frames.heavy_wind = puss.frames.wind;
  puss.frames.heavy_rec = puss.frames.idle2;
  puss.frames.special_wind = puss.frames.wind;
  puss.frames.special_rec = puss.frames.idle2;

  // ---- AISTROP — the only upright silhouette, the only rendered face --------
  // letters: G coat, C cream, B black (hat/boots), g gold, c chain
  var aistropIdle = [
    '....BBBBBB....',
    '....BBBBBB....',
    '....BBBBBB....',
    '...BBBBBBBB...',
    '.....CCCC.....',
    '....KCCCCK....',
    '....KCKCCK....',
    '.....CCCC.....',
    '....KCCCK.....',
    '...KGGGGGK....',
    '..KGGGGGGGK...',
    '.KGGGGGGGGGK..',
    '.KGKGGGGGKGK..',
    '.KGKGGGGGKGK..',
    'cKGKGGGGGKGKB.',
    'cKGKGGGGGKGKB.',
    'cKGKGGGGGKGB..',
    'ccKKGGGGGKKB..',
    'c.KGGGGGGKgB..',
    'c.KGGGGGGKgB..',
    '..KGGGGGGK.B..',
    '..KCCKKCCK.B..',
    '..KCCK.KCCK...',
    '..KCCK.KCCK...',
    '..KCCK.KCCK...',
    '..KCCK.KCCK...',
    '..BBBB.KBBB...',
    '..BBBB.KBBB...',
    '.BBBBB.BBBBB..'
  ];
  var aistrop = {
    scale: 2,
    letters: { G: 'coat', C: 'cream', B: 'black', g: 'gold', c: 'chain' },
    frames: {
      idle1: aistropIdle,
      idle2: shiftX(aistropIdle, 0, 0, 1), // he barely moves; coin hand ticks
      walk1: shiftX(aistropIdle, 1, 22, 29),
      walk2: shiftX(aistropIdle, -1, 22, 29),
      wind: shiftX(aistropIdle, -1, 0, 9), // leans back
      light: [ // The Cane — contemptuous horizontal tap
        '....BBBBBB......................',
        '....BBBBBB......................',
        '....BBBBBB......................',
        '...BBBBBBBB.....................',
        '.....CCCC.......................',
        '....KCCCCK......................',
        '....KCKCCK......................',
        '.....CCCC.......................',
        '....KCCCK.......................',
        '...KGGGGGK......................',
        '..KGGGGGGGKKK...................',
        '.KGGGGGGGGGGGKKBBBBBBBBBBBBBBB..',
        '.KGKGGGGGGGGGGKK................',
        '.KGKGGGGGKGKK...................',
        'cKGKGGGGGKGKB...................',
        'cKGKGGGGGKGKB...................',
        'cKGKGGGGGKGB....................',
        'ccKKGGGGGKKB....................',
        'c.KGGGGGGKgB....................',
        'c.KGGGGGGKgB....................',
        '..KGGGGGGK.B....................',
        '..KCCKKCCK.B....................',
        '..KCCK.KCCK.....................',
        '..KCCK.KCCK.....................',
        '..KCCK.KCCK.....................',
        '..KCCK.KCCK.....................',
        '..BBBB.KBBB.....................',
        '..BBBB.KBBB.....................',
        '.BBBBB.BBBBB....................'
      ],
      heavy: [ // TAKE UP THE SLACK — both hands hauling the chain
        '......BBBBBB..',
        '......BBBBBB..',
        '......BBBBBB..',
        '.....BBBBBBBB.',
        '.......CCCC...',
        '......KCCCCK..',
        '......KCKCCK..',
        '.......CCCC...',
        '......KCCCK...',
        '.....KGGGGGK..',
        '....KGGGGGGGK.',
        '...KGGGGGGGGK.',
        'cccKGKGGGGGGK.',
        'ccKCCKGGGGGGK.',
        'cKCCKGGGGGGGK.',
        'cKCCKGGGGGGKB.',
        'c.KKGGGGGGGKB.',
        'c..KGGGGGGKKB.',
        'c..KGGGGGGKgB.',
        '...KGGGGGGKgB.',
        '...KGGGGGGK.B.',
        '...KCCKKCCK.B.',
        '...KCCK.KCCK..',
        '...KCCK.KCCK..',
        '...KCCK.KCCK..',
        '...KCCK.KCCK..',
        '...BBBB.KBBB..',
        '...BBBB.KBBB..',
        '..BBBBB.BBBBB.'
      ],
      special: [ // MOPUSSES — a fistful of coins into the crowd
        '....BBBBBB...g',
        '....BBBBBB..g.',
        '....BBBBBB.g.g',
        '...BBBBBBBB.g.',
        '.....CCCC..KCK',
        '....KCCCCK.KCK',
        '....KCKCCKKCK.',
        '.....CCCCKCK..',
        '....KCCCKCK...',
        '...KGGGGGK....',
        '..KGGGGGGGK...',
        '.KGGGGGGGGGK..',
        '.KGKGGGGGGGK..',
        '.KGKGGGGGGGK..',
        'cKGKGGGGGGGKB.',
        'cKGKGGGGGGGKB.',
        'cKGKGGGGGGKB..',
        'ccKKGGGGGKKB..',
        'c.KGGGGGGKgB..',
        'c.KGGGGGGKgB..',
        '..KGGGGGGK.B..',
        '..KCCKKCCK.B..',
        '..KCCK.KCCK...',
        '..KCCK.KCCK...',
        '..KCCK.KCCK...',
        '..KCCK.KCCK...',
        '..BBBB.KBBB...',
        '..BBBB.KBBB...',
        '.BBBBB.BBBBB..'
      ],
      hit: shiftX(aistropIdle, -2, 0, 12), // staggers; the hat stays on
      block: aistropIdle,
      jump: aistropIdle,
      down: [ // on the sawdust — hat still on
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '..............................',
        '.....................gg.gg....',
        '.............KKKKK..g..g......',
        'BBBB.CCCC.KKGGGGGGGKKK.gg.....',
        'BBBBBKCKCKGGGGGGGGGGGGKKKKK...',
        'BBBB.CCCC.KGGGGGGGGGGGGCCKBB..',
        '.BB...................KCCKBB..',
        '..............................'
      ]
    }
  };
  aistrop.frames.light_wind = aistrop.frames.wind;
  aistrop.frames.light_rec = aistrop.frames.idle1;
  aistrop.frames.heavy_wind = aistrop.frames.heavy;
  aistrop.frames.heavy_rec = aistrop.frames.idle1;
  aistrop.frames.special_wind = aistrop.frames.wind;
  aistrop.frames.special_rec = aistrop.frames.idle1;

  var SHEETS = { jacco: jacco, brock: brock, billy: billy, puss: puss, aistrop: aistrop };

  // Resolve a pose name to a padded grid with fallbacks (wind -> generic wind,
  // rec -> follow-through, anything else -> idle1).
  function frameFor(id, pose) {
    var sheet = SHEETS[id];
    var f = sheet.frames;
    if (f[pose]) return pad(f[pose]);
    if (/_wind$/.test(pose)) return pad(f.wind || f.idle1);
    if (/_rec$/.test(pose)) return pad(f.wind || f.idle1);
    var base = pose.replace(/_(wind|rec)$/, '');
    if (f[base]) return pad(f[base]);
    return pad(f.idle1);
  }

  // Colour for a letter given the character's YAML palette.
  function colorFor(id, ch, palette) {
    if (ch === 'K') return INK;
    var slot = SHEETS[id].letters[ch];
    if (!slot || !palette[slot]) {
      throw new Error('sprites: character "' + id + '" letter "' + ch +
        '" has no palette slot (data/characters/' + id + '.yaml palette.' + slot + ')');
    }
    return palette[slot];
  }

  g.MB = g.MB || {};
  g.MB.Sprites = { SHEETS: SHEETS, frameFor: frameFor, colorFor: colorFor, INK: INK, pad: pad };
  if (typeof module !== 'undefined' && module.exports) module.exports = g.MB.Sprites;
})(typeof window !== 'undefined' ? window : globalThis);
