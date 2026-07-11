/**
 * SashimiClient — bootstrap for the sashimi real-time WASM client.
 *
 * Wires the shared engine client runtime (lib/rt-*.js from
 * engine/clients/lib/) to the sashimi WASM bridge:
 *
 *   rAF frame (RTLoop, display rate)
 *     ├── accumulator >= 16.67ms?  (fixed 60Hz, spiral guard)
 *     │     ├── RTInput.sample() -> wasm_set_input (octant snap engine-side)
 *     │     ├── wasm_tick()      -> one sashimi simulation tick
 *     │     └── RTView.update(reader)  scalar accessors -> view units
 *     │           (reader.extra copies kind/flags/radius per unit)
 *     │     └── processTick()   event ring -> SashimiAudio (SFX) + hero
 *     │           attack/respawn anim latches + SashimiFX (hit/death FX
 *     │           entries, trail points, white hit-flash latch); stage
 *     │           edges -> windup audio; pending exports -> pre-spawn
 *     │           telegraph markers (fx.setPendings); first-seen
 *     │           creatures -> Spawn row + quick fade-in
 *     └── RTRender.frame(units, alpha)  camera follows P1's hero,
 *           the real Adventure ground (cfg.ground; assets/ground.png),
 *           pre-spawn telegraphs + projectile trails (effectsUnder),
 *           y-sort, per-kind real Unity sprites (assets/*.png +
 *           lib/sashimi-art-data.js manifests; ?art=proc falls back to
 *           the procedural placeholders), white hit-flash silhouettes
 *           (overlayFor), hit/death FX (effectsOver), HUD
 *
 * Screen flow (SashimiScreens; the Unity UIManager/AdventureUIController
 * sequence): TITLE -> HERO SELECT -> PLAYING -> RESULTS, with PLAY AGAIN
 * returning to HERO SELECT and TITLE returning to the title screen. The
 * engine world exists from bootstrap but wasm_tick is only called while
 * PLAYING (Unity's title/select do not run the match) — menus tick
 * nothing, they only poll menu input. Start music plays on the menus,
 * the adventure loop in-game, victory/defeat loops on results (the
 * MusicController fade targets).
 *
 * Join = possession: both heroes exist from app start; every HUMAN
 * hero is possessed AT GAME START (realizeRoster: wasm_join_hero adds
 * PossessedBy, clientId = roster order), before any device input --
 * Unity fixes possession before the match starts
 * (ServerPossessSystem.cs:39-42) and an input-less possessed hero
 * simply stands still (ClientGameInputSystem.cs:180-192), so hero_ai
 * NEVER drives a human-rostered hero. Devices claim DEVICE slots 1..2
 * on their first input (rt-input.js); a device is bound to a hero on
 * its first MEANINGFUL input through the routing table (routeFor /
 * bindDevice in start(), one device per hero by construction) -- its
 * own clientId when that possesses a hero, else a free (AI) hero, else
 * the lowest orphaned possessed clientId, else its input is dropped
 * and announced. Touch joins like any device: the first joystick touch
 * claims a slot. P/ESC or the pause button opens the
 * PAUSE screen (PauseVT.uxml: opaque art, Resume default-focus / End
 * Match); the engine only advances when we call wasm_tick, so holding
 * that call while the screen is up is a real pause. P/ESC/Resume returns
 * to gameplay exactly where it froze; End Match tears the run down to the
 * title (the toTitle path). R or the results screen's PLAY AGAIN re-inits
 * the module and returns to hero select, re-possessing joined devices on
 * the next start. No game parameter lives here (root CLAUDE.md decision
 * 13) — arena bounds, timers, XP tables, waves all come from the engine.
 *
 * Coordinates: the sim is origin-centered and y-up (Unity convention);
 * screen space is y-down. The reader flips the projection
 * (screenY = maxY - simY, dirY negated) and the sampled device vectors
 * (screen-up = -1) are negated in y before wasm_set_input, so the sim
 * always speaks y-up and the arena renders Unity-matched. Both flips are
 * presentation-side only.
 */
var SashimiClient = (function() {
    var FLAG_DEFEATED = 1, FLAG_HIT = 2, FLAG_IFRAMES = 4;

    /* Realize a select-screen roster at game start. Absent heroes are
       removed (Unity FollowerInputSystem.cs:57-77, AllowBots=0 bot
       destruction) and every HUMAN hero is possessed NOW, clientId =
       roster order (P1 = 1, P2 = 2), whether or not that player's
       device has joined yet. Unity fixes possession before the match
       starts (ServerPossessSystem.cs:39-42: "We don't allow for
       possession changes once the game has started") and an input-less
       possessed hero stands still (ClientGameInputSystem.cs:180-192
       zeroes MoveDirection on input cancel) -- deferring possession to
       the device's first input left a mouse-started human hero
       un-possessed, so hero_ai drove it until the first keypress (the
       "AI takes over when the player is idle" bug). Devices reach
       these possessed clientIds through the routing table (routeFor /
       bindDevice in start()): bound on first meaningful input, one
       device per hero. `engine` needs removeHero(kind) +
       joinHero(clientId, kind). Pure wiring -- headless-tested against
       the live bridge in tests/test_wasm.js. */
    function realizeRoster(roster, engine) {
        roster.absent.forEach(function(k) { engine.removeHero(k); });
        var possessed = [];
        for (var i = 0; i < roster.human.length; i++) {
            possessed.push({
                clientId: i + 1,
                kind: roster.human[i],
                eid: engine.joinHero(i + 1, roster.human[i]),
            });
        }
        return possessed;
    }

    function start(M, opts) {
        var CONFIG = opts.config || 'default';

        /* Presentation quality knob (NOT a game parameter — root decision 13
           is about sim-affecting inputs). ?dpr=N caps the canvas backing-store
           devicePixelRatio: use it on weak/integrated GPUs that present below
           the rAF rate when filling a full-window Retina canvas. Sanity-clamped
           to 0.5..4; absent -> no cap (native devicePixelRatio, unchanged). */
        var dprCap;
        try {
            var dprParam = new URLSearchParams(location.search).get('dpr');
            if (dprParam !== null && dprParam !== '') {
                var dprVal = parseFloat(dprParam);
                if (!isNaN(dprVal))
                    dprCap = Math.max(0.5, Math.min(4, dprVal));
            }
        } catch (e) { /* no URLSearchParams/location -> no cap */ }

        var hud = SashimiHUD.init({
            hud: opts.hud, banner: opts.banner,
        });

        /* ── Leaderboard: per-category high scores (SashimiLeaderboard,
           KeepBest, localStorage). The category + record gate (>= 1
           human) are captured from the roster at startGame; the score
           (gems) is recorded on VICTORY only (matchResult -- Unity
           uploads only from the victory screen). playerName is 'guest'
           until Google auth lands (config-gated online board). */
        var lb = SashimiLeaderboard.store(
            typeof localStorage !== 'undefined' ? localStorage : {
                getItem: function() { return null; },
                setItem: function() {},
            });
        var runCategory = null;      /* this run's category, from roster */
        var runRecordable = false;   /* >= 1 human in this run's roster */
        var playerName = null;       /* signed-in display name (auth) */
        var playerAlias = null;      /* board alias (from the fetched CSV) */
        var lbNote = '';             /* online-board status for the HUD */

        /* Online board config (window.SASHIMI_LEADERBOARD_CONFIG in
           index.html, passed as opts.leaderboard). Inert when
           unconfigured: enabled=false means no network, no auth -- the
           game plays exactly as before. */
        var lbConfig = SashimiLeaderboard.config(opts.leaderboard);

        /* Google Sign-In (SashimiAuth; config-gated, inert as shipped).
           The gate runs at START after a valid roster (intent before
           auth); the session persists in localStorage. The signed-in
           name replaces 'guest' on the debug overlay and the ID token
           rides score submissions. */
        var auth = SashimiAuth.init(lbConfig, {
            onChange: function(s) { playerName = s ? s.name : null; },
        });

        /* ---- Victory board provenance (user ruling 2026-07-09:
           "telling someone they are on the leaderboard when they
           aren't is verboten"). boardState tracks what actually
           happened to this run's score (submit POST + board fetch,
           both async); refreshBoard re-derives the panel through the
           pure SashimiLeaderboard.boardPresentation and re-applies it
           (screens.setBoardView) whenever either resolves -- the
           results screen renders immediately and mutates late, never
           blocks. A local board is always titled '<BOARD> - LOCAL
           BEST' with a visible not-submitted/submitted declaration;
           a projected own row on the fetched board appears only after
           the POST is known to have succeeded. */
        var boardState = null;       /* null = defeat / no board */

        function refreshBoard() {
            if (!boardState) return;
            var p = SashimiLeaderboard.boardPresentation(boardState);
            if (p) screens.setBoardView(p);
            lbNote = 'submit ' + boardState.submit +
                (boardState.submitError
                    ? ' (' + boardState.submitError + ')' : '') +
                ' / board ' + (boardState.board === 'ok'
                    ? boardState.online.length + ' rows'
                    : boardState.board + (boardState.boardError
                        ? ' (' + boardState.boardError + ')' : ''));
        }

        /* Score submission at match end (victory only). NOT silent:
           the resolution lands in boardState.submit ('ok' / 'offline'
           / 'signed-out' / 'failed') and refreshBoard puts the
           declaration on the results screen. Unconfigured and
           signed-out resolve synchronously inside submitScore.
           alias (string | null): a CONFIRMED alias rides the POST;
           null omits the field so the Worker keeps the existing
           alias (or defaults a first row to the Google name). */
        function submitRun(gems, alias) {
            if (!(runRecordable && runCategory)) return;
            if (boardState) boardState.submit = 'pending';
            refreshBoard();
            SashimiLeaderboard.submitScore(lbConfig, {
                googleIdToken: auth.token(),
                category: runCategory,
                gems: gems,
                alias: alias || undefined,
            }, function(err) {
                if (boardState) {
                    if (!err) {
                        boardState.submit = 'ok';
                        if (alias) {
                            /* the Worker applied it (or the run was
                               non-qualifying server-side and kept the
                               old one; the next board fetch settles
                               the display either way) */
                            playerAlias = alias;
                            if (boardState.player)
                                boardState.player.name = alias;
                        }
                    }
                    else if (err === 'unconfigured')
                        boardState.submit = 'offline';
                    else if (err === 'not signed in')
                        boardState.submit = 'signed-out';
                    else {
                        boardState.submit = 'failed';
                        boardState.submitError = err;
                    }
                }
                if (err) console.warn('[leaderboard] submit failed:', err);
                refreshBoard();
            });
        }

        /* ---- Alias hold (the ignore-the-input contract) ----
           On a NEW-BEST victory the submission is HELD (submit state
           'alias-wait', declared on the panel) while the alias input
           is up. flushAlias fires the POST exactly once: with the
           player's confirmed alias, or WITHOUT an alias field when the
           grace timer (ALIAS_GRACE_MS) expires or the player leaves
           the results screen (reinitWorld) -- the score is never lost
           because the player didn't type. */
        var ALIAS_GRACE_MS = 8000;
        var aliasHold = null;        /* { gems } while the input is up */
        var aliasTimer = null;
        function flushAlias(aliasText) {
            if (!aliasHold) return;
            var gems = aliasHold.gems;
            aliasHold = null;
            if (aliasTimer) { clearTimeout(aliasTimer); aliasTimer = null; }
            screens.setAliasPrompt(null);
            var alias = SashimiLeaderboard.sanitizeAlias(aliasText);
            submitRun(gems, alias || null);
        }

        /* Fetch the public board CSV into boardState.online. Success
           swaps the victory slots to real ranked rows (player rank
           -2..+2); failure/empty falls back to the LOCAL board rows
           already captured in boardState (boardPresentation labels
           them; with no local best either, the self-stats fill
           painted by fillResults stays). */
        function loadBoard() {
            SashimiLeaderboard.fetchBoard(lbConfig, function(err, text) {
                if (!boardState) return;
                if (err) {
                    boardState.board = 'unavailable';
                    boardState.boardError = err;
                    if (err !== 'unconfigured')
                        console.warn('[leaderboard] board fetch failed:',
                                     err);
                } else {
                    var rows = SashimiLeaderboard.parseCsv(text);
                    /* The player's alias lives on ANY of their rows
                       (it is per-sub, not per-category): remember it
                       for the HUD and late-prefill an OPEN alias
                       prompt (ignored once the player typed). */
                    var mine = SashimiLeaderboard.aliasFor(rows,
                                                           auth.sub());
                    if (mine) {
                        playerAlias = mine;
                        if (boardState.player &&
                            boardState.submit !== 'ok')
                            boardState.player.name = mine;
                        if (aliasHold)
                            screens.setAliasPrompt({ value: mine });
                    }
                    var sorted = SashimiLeaderboard.rankedRows(
                        rows, runCategory);
                    if (sorted.length) {
                        boardState.board = 'ok';
                        boardState.online = sorted;
                    } else {
                        boardState.board = 'unavailable';
                        boardState.boardError = 'empty board';
                    }
                }
                refreshBoard();
            });
        }

        /* ── Transport: WASM exports via cwrap (scalar accessors) ── */
        var engine = {
            init: M.cwrap('wasm_init_with_config', 'number', ['string']),
            tick: M.cwrap('wasm_tick', 'number', []),
            join: M.cwrap('wasm_join', 'number', ['number']),
            joinHero: M.cwrap('wasm_join_hero', 'number',
                              ['number', 'number']),
            removeHero: M.cwrap('wasm_remove_hero', 'number', ['number']),
            setInput: M.cwrap('wasm_set_input', null, ['number', 'number', 'number']),
            playerEntityId: M.cwrap('wasm_player_entity_id', 'number', ['number']),
            count: M.cwrap('wasm_get_unit_count', 'number', []),
            id: M.cwrap('wasm_get_unit_entity_id', 'number', ['number']),
            x: M.cwrap('wasm_get_unit_x', 'number', ['number']),
            y: M.cwrap('wasm_get_unit_y', 'number', ['number']),
            dirX: M.cwrap('wasm_get_unit_dir_x', 'number', ['number']),
            dirY: M.cwrap('wasm_get_unit_dir_y', 'number', ['number']),
            health: M.cwrap('wasm_get_unit_health', 'number', ['number']),
            maxHealth: M.cwrap('wasm_get_unit_max_health', 'number', ['number']),
            radius: M.cwrap('wasm_get_unit_radius', 'number', ['number']),
            kind: M.cwrap('wasm_get_unit_kind', 'number', ['number']),
            flags: M.cwrap('wasm_get_unit_flags', 'number', ['number']),
            stage: M.cwrap('wasm_get_unit_stage', 'number', ['number']),
            slot: M.cwrap('wasm_get_unit_slot', 'number', ['number']),
            eventCount: M.cwrap('wasm_get_event_count', 'number', []),
            eventType: M.cwrap('wasm_get_event_type', 'number', ['number']),
            eventKind: M.cwrap('wasm_get_event_kind', 'number', ['number']),
            eventEntity: M.cwrap('wasm_get_event_entity', 'number', ['number']),
            eventData: M.cwrap('wasm_get_event_data', 'number', ['number']),
            getTurn: M.cwrap('wasm_get_turn', 'number', []),
            getTickMs: M.cwrap('wasm_get_tick_ms', 'number', []),
            gameTick: M.cwrap('wasm_get_game_tick', 'number', []),
            tickRate: M.cwrap('wasm_get_tick_rate', 'number', []),
            victoryTicks: M.cwrap('wasm_get_victory_ticks', 'number', []),
            wave: M.cwrap('wasm_get_wave', 'number', []),
            waveCount: M.cwrap('wasm_get_wave_count', 'number', []),
            gems: M.cwrap('wasm_get_gems', 'number', []),
            kills: M.cwrap('wasm_get_kills', 'number', []),
            heroLevel: M.cwrap('wasm_get_hero_level', 'number', []),
            nextLevelXp: M.cwrap('wasm_get_next_level_xp', 'number', []),
            levelXp: M.cwrap('wasm_get_level_xp', 'number', []),
            isGameOver: M.cwrap('wasm_is_game_over', 'number', []),
            isVictory: M.cwrap('wasm_is_victory', 'number', []),
            gameOverMessage: M.cwrap('wasm_get_game_over_message', 'string', []),
            arenaMinX: M.cwrap('wasm_get_arena_min_x', 'number', []),
            arenaMinY: M.cwrap('wasm_get_arena_min_y', 'number', []),
            arenaMaxX: M.cwrap('wasm_get_arena_max_x', 'number', []),
            arenaMaxY: M.cwrap('wasm_get_arena_max_y', 'number', []),
            pendingCount: M.cwrap('wasm_get_pending_count', 'number', []),
            pendingX: M.cwrap('wasm_get_pending_x', 'number', ['number']),
            pendingY: M.cwrap('wasm_get_pending_y', 'number', ['number']),
            pendingKind: M.cwrap('wasm_get_pending_kind', 'number', ['number']),
            pendingTicks: M.cwrap('wasm_get_pending_ticks', 'number', ['number']),
            telegraphTicks: M.cwrap('wasm_get_telegraph_ticks', 'number', []),
        };

        if (!engine.init(CONFIG)) {
            hud.setBanner('engine init failed (config: ' + CONFIG + ')');
            return null;
        }

        /* Arena: sim space is origin-centered (ArenaBounds); the renderer
           works in [0, mapW) x [0, mapH). Shift here, presentation-side. */
        var arena = {
            minX: engine.arenaMinX(), minY: engine.arenaMinY(),
            maxX: engine.arenaMaxX(), maxY: engine.arenaMaxY(),
        };
        var mapW = arena.maxX - arena.minX;
        var mapH = arena.maxY - arena.minY;

        /* ── Reader: scalar accessors -> RTView, arena-shifted and
              y-flipped (sim is y-up like Unity; screen is y-down) ── */
        var reader = {
            count: engine.count,
            id: engine.id,
            x: function(i) { return engine.x(i) - arena.minX; },
            y: function(i) { return arena.maxY - engine.y(i); },
            dirX: engine.dirX,
            dirY: function(i) { return -engine.dirY(i); },
            health: engine.health,
            maxHealth: engine.maxHealth,
            slot: engine.slot,
            extra: function(u, i) {
                u.kind = engine.kind(i);
                u.flags = engine.flags(i);
                u.stage = engine.stage(i);
                u.radius = engine.radius(i);
            },
        };

        /* ── Shared runtime ── */
        var sprites = SashimiSprites.build();
        /* trails + hit/death FX (tick rate matches RTLoop's tickHz) */
        var fx = SashimiFX.init({ sprites: sprites, tickRate: 60 });
        var audio = SashimiAudio.init({
            muteBtn: opts.muteBtn,
            volSlider: opts.volSlider,
        });
        audio.menuMusic();   /* Start loop; plays on the unlock gesture */
        var view = RTView.init();

        /* ── Screen state machine ──
           'title' | 'select' | 'playing' | 'pause' | 'results'. The
           engine only ticks while 'playing'; every other screen (pause
           included) holds wasm_tick and polls its own focus input. */
        var screen = 'title';

        /* Select VO for a freshly possessed hero. Resolves the hero's
           kind straight from the bridge — the view is empty at game
           start (it only updates inside the playing tick), so
           view.find(eid) was always null there and the clientId fell
           through as a fake kind (P1 always got the eagle VO). */
        function possessedVO(eid, kind) {
            var hk = 0;
            for (var i = 0; i < engine.count(); i++) {
                if (engine.id(i) === eid) { hk = engine.kind(i); break; }
            }
            audio.select(hk || kind || 1);
        }

        var MAX_PLAYERS = 2;   /* up to two heroes exist: co-op = possession */
        var input = RTInput.init({
            maxPlayers: MAX_PLAYERS,
            onJoin: function(clientId, label) {
                /* Joining claims a DEVICE slot only. Heroes are bound on
                   the device's first meaningful input (routeFor below),
                   never on join -- so an idle device (a menu-navigating
                   gamepad, a stray touch) can never occupy a hero it is
                   not actually driving. */
                hud.setBanner(screen === 'playing'
                    ? label + ' joined -- first move takes a hero'
                    : label + ' joined');
            },
        });

        /* -- Device -> hero input routing --
           rt-input claims DEVICE slots in join order; realizeRoster
           possesses heroes in ROSTER order (P1..PH). The two can
           disagree -- a lingering gamepad or stray touch on slot 1
           leaves the keyboard on slot 2 -- and pre-fix a device sitting
           on a hero-less clientId wrote input that went NOWHERE (the
           2026-07-09 "I press S and stay in place / AI controls are
           fighting with me" report; measured dy = 0.000 under held
           input). Contract: a device binds to a hero on its first
           MEANINGFUL input (|axis| >= BIND_MAG), trying in order:
             1. its own clientId, when that clientId possesses a hero no
                other device claimed (the common case -- identical to the
                old slot == clientId behavior);
             2. a free (un-possessed, i.e. AI) hero via wasm_join_hero --
                the old mid-game join semantics, now input-gated;
             3. the lowest ORPHANED possessed clientId -- a hero whose
                own device never produced meaningful input (the
                stranded-keyboard case);
             4. nothing: its input is knowingly dropped and announced.
           One device per hero, one hero per device, BY CONSTRUCTION:
           binding claims the engine clientId, and hero_ai never touches
           a possessed hero (the systems.c query-boundary invariant), so
           exactly one writer -- one human device or the AI -- can ever
           reach a hero's InputDirection. Bindings reset every match. */
        var BIND_MAG = 0.5;
        var routes = {};      /* device clientId -> engine clientId (0 = dead) */
        var claimedBy = {};   /* engine clientId -> device clientId */
        function resetRoutes() { routes = {}; claimedBy = {}; }
        function deviceLabel(dev) {
            var ps = input.players();
            for (var i = 0; i < ps.length; i++)
                if (ps[i].clientId === dev) return ps[i].label;
            return 'Device ' + dev;
        }
        function bindDevice(dev) {
            var label = deviceLabel(dev);
            /* 1. identity */
            if (engine.playerEntityId(dev) && !claimedBy[dev]) {
                routes[dev] = dev;
                claimedBy[dev] = dev;
                return dev;
            }
            /* 2. free hero. Guarded so an idempotent wasm_join_hero
               return (this clientId already possesses a hero claimed by
               ANOTHER device) can never create a second writer. */
            if (!claimedBy[dev]) {
                var eid = engine.joinHero(dev, 0);
                if (eid) {
                    routes[dev] = dev;
                    claimedBy[dev] = dev;
                    possessedVO(eid, 0);
                    hud.setBanner(label + ' took a hero as P' + dev);
                    return dev;
                }
            }
            /* 3. orphaned possessed clientId */
            for (var c = 1; c <= MAX_PLAYERS; c++) {
                if (engine.playerEntityId(c) && !claimedBy[c]) {
                    routes[dev] = c;
                    claimedBy[c] = dev;
                    hud.setBanner(label + ' controls P' + c);
                    return c;
                }
            }
            /* 4. nothing to control (more active devices than heroes) */
            routes[dev] = 0;
            hud.setBanner(label + ': no free hero -- input ignored');
            return 0;
        }
        function routeFor(f) {
            var eng = routes[f.clientId];
            if (eng !== undefined) return eng;
            if (Math.abs(f.x) < BIND_MAG && Math.abs(f.y) < BIND_MAG)
                return 0;   /* unbound until the first meaningful input */
            return bindDevice(f.clientId);
        }
        /* Animation state machine over the per-tick flags + ability stage,
           mirroring the Unity UnitAnimationManager: Defeated -> Defeat
           (plays once, holds the last frame), TookDamage -> Damage (a
           blocking animation: latched until its clip length elapses even
           though the flag lasts one tick), spawn telegraph -> Spawn,
           ability stage -> Windup/Active/Recovery (the manifests' attack
           rows; stage timing comes from the engine so the rows track the
           real hitbox windows), hero weapon fire / respawn -> latched
           play-once Attack / Spawn rows, else Walk/Idle. State changes
           reset the unit's animation clock (animTimeFor) so play-once
           rows start at frame 0 — the UASO clips are authored to run
           from the state edge, exactly like Unity's animator. */
        var STAGE_STATE = { 1: 'windup', 2: 'active', 3: 'recovery' };
        var ATTACK_LATCH_FALLBACK = 0.35;  /* s, for looping attack rows */
        function blockDur(kind, state) {
            var d = sprites.stateDuration(kind, state);
            return d > 0 ? d : ATTACK_LATCH_FALLBACK;
        }
        function stateFor(u) {
            var t = performance.now() / 1000;
            var want;
            if (u.flags & FLAG_DEFEATED) want = 'defeat';
            else if (u.flags & FLAG_HIT) want = 'damage';
            else if (STAGE_STATE[u.stage]) want = STAGE_STATE[u.stage];
            else want = u.moving ? 'walk' : 'idle';
            if (want !== 'damage' && want !== 'defeat') {
                if (u.animState === 'damage' &&
                    t - u.animStart <
                        sprites.stateDuration(u.kind, 'damage')) {
                    want = 'damage';  /* blocking anim runs to completion */
                } else if ((want === 'walk' || want === 'idle') &&
                           (u.animState === 'attack' ||
                            u.animState === 'spawn') &&
                           t - u.animStart < blockDur(u.kind, u.animState)) {
                    want = u.animState;  /* play-once latch */
                }
            }
            if (want !== u.animState) {
                u.animState = want;
                u.animStart = t;
            }
            return want;
        }

        /* White hit-flash (PORT-INVENTED, minimal): Unity has no damage
           tint — its feedback is the Damage clip + the attacker's HitFX
           + impact SFX (PresentDamageSystem / PresentUnitAnimationSystem).
           This client adds a white-silhouette overlay fading out over
           FLASH_SECONDS, replacing the earlier port-invented alpha dip
           on TookDamage. */
        var FLASH_SECONDS = 0.15, FLASH_ALPHA = 0.75;
        /* Materialization fade-in after the true pre-spawn telegraph
           (the old client held creatures invisible for 35% of a
           post-hoc 1.25 s window; the warning now precedes the spawn) */
        var FADE_IN_SECONDS = 0.25;

        var render = RTRender.init({
            canvas: opts.canvas,
            mapW: mapW, mapH: mapH,
            tilePx: 64,
            dprCap: dprCap,        /* ?dpr=N cap (undefined -> no cap; caps the
                                      GL backing store); rt-render leaves default
                                      behavior when falsy. */
            onUnsupported: function(msg) {
                /* WebGL is the sole renderer; show the explanation on the HUD
                   banner instead of a black canvas (root decision 12). */
                hud.setBanner(msg);
            },
            minTilesVisible: 11,   /* phone zoom-out: keep >= 11 world units
                                      on the shorter axis, both orientations */
            followRate: 5,
            unitDefs: sprites.defs,
            ground: sprites.ground,   /* real Adventure tilemap (null ->
                                         rt-render's procedural ground) */
            effectsUnder: fx.drawUnder,
            effectsOver: function(gfx, view, t) {
                fx.drawFx(gfx, view, t);
                /* End-match countdown over each hero (last 12 s of the
                   victory timer), so the match no longer ends abruptly.
                   Seconds remaining come straight from the time exports. */
                if (screen === 'playing') {
                    var rate = engine.tickRate();
                    var secs = Math.floor(
                        (engine.victoryTicks() - engine.gameTick()) / rate);
                    fx.drawHeroCountdown(gfx, view, units, secs);
                }
            },
            defFor: function(u) { return sprites.defName(u.kind); },
            sizeFor: function(u, tilePx) {
                return tilePx * sprites.size(u.kind);
            },
            stateFor: stateFor,
            animTimeFor: function(u, t) {
                return u.animStart !== undefined ? t - u.animStart
                                                 : t + u.animPhase;
            },
            barFor: function(u, tilePx) {
                return sprites.barFor(u.kind, tilePx);
            },
            /* Spawn telegraphs are TRUE pre-spawn now: the warning
               indicator draws at the warning position during the whole
               1.25 s PendingSpawn window (pending exports -> fx pass in
               effectsUnder, Unity's SpawnWarning entity), and the
               creature fades in quickly at materialization. */
            alphaFor: function(u, t) {
                if (u.fadeInUntil && t < u.fadeInUntil)
                    return 1 - (u.fadeInUntil - t) / FADE_IN_SECONDS;
                if (u.flags & FLAG_DEFEATED) return 0.55;
                if (u.flags & FLAG_IFRAMES)
                    return 0.45 + 0.35 * Math.sin(t * 24);
                /* damage feedback is the white flash overlay now, not an
                   alpha dip */
                return 1;
            },
            /* white hit-flash: the unit's silhouette def drawn over the
               current frame (same state/dir/clock — rt-render defaults),
               fading out across FLASH_SECONDS */
            overlayFor: function(u, tilePx, t) {
                if (!u.flashUntil || t >= u.flashUntil) return null;
                var fd = sprites.flashDefName(u.kind);
                if (!fd) return null;
                return {
                    def: fd,
                    alpha: FLASH_ALPHA * (u.flashUntil - t) / FLASH_SECONDS,
                };
            },
        });

        /* WebGL unavailable: RTRender.init already showed the explanation
           (onUnsupported -> HUD banner) and returned null. Abort bootstrap
           rather than run with no renderer (root decision 12). */
        if (!render) return null;

        var units = [];
        var engineMs = 0;
        var gameOverShown = false;
        var tickIndex = 0;   /* spawn telegraphs skip the initial roster */

        /* SW kind range that owns abilities / spawn telegraphs. */
        function isCreature(kind) { return kind >= 3 && kind <= 7; }

        /* Per-tick post-processing: presentation events -> audio + hero
           anim latches + FX (hit bursts, detached death clips); flags ->
           white hit-flash latch; trail point append; stage edges ->
           windup/active audio; first-seen creatures -> spawn telegraph
           window. lastPos remembers every exported unit's previous-tick
           position/facing so events about entities deleted this tick
           (creature deaths, spent projectiles) can still be placed. */
        var EV_WEAPON_FIRED = 1, EV_HIT = 2, EV_CREATURE_DIED = 4,
            EV_HERO_RESPAWN = 6;
        var lastPos = {};
        function unitPos(id) {
            return view.find(id) || lastPos[id] || null;
        }
        function processTick() {
            var now = performance.now() / 1000;
            tickIndex++;
            for (var i = 0; i < units.length; i++) {
                var u = units[i];
                if (!u.seen) {
                    u.seen = true;
                    if (tickIndex > 1 && isCreature(u.kind)) {
                        /* materialization: play-once Spawn row + quick
                           fade-in (the warning already telegraphed it) */
                        u.animState = 'spawn';
                        u.animStart = now;
                        u.fadeInUntil = now + FADE_IN_SECONDS;
                    }
                }
                if (u.flags & FLAG_HIT)
                    u.flashUntil = now + FLASH_SECONDS;
                if (isCreature(u.kind)) {
                    var prev = u.prevStage || 0;
                    if (u.stage !== prev)
                        audio.stageChange(u.kind, prev, u.stage);
                    u.prevStage = u.stage;
                }
            }
            /* True pre-spawn telegraphs: project the pending exports
               (same arena shift + y-flip as the reader); frac runs
               1 -> 0 across the warning window. */
            var pendCount = engine.pendingCount();
            var pends = [];
            if (pendCount > 0) {
                var teleTicks = engine.telegraphTicks();
                for (var pi = 0; pi < pendCount; pi++) {
                    pends.push({
                        x: engine.pendingX(pi) - arena.minX,
                        y: arena.maxY - engine.pendingY(pi),
                        frac: engine.pendingTicks(pi) / teleTicks,
                    });
                }
            }
            fx.setPendings(pends);
            fx.tick(units, now);
            var n = engine.eventCount();
            for (var e = 0; e < n; e++) {
                var type = engine.eventType(e);
                audio.onEvent(type, engine.eventKind(e));
                if (type === EV_WEAPON_FIRED) {
                    /* data = firing owner: heroes play their Attack row */
                    var owner = view.find(engine.eventData(e));
                    if (owner && (owner.kind === 1 || owner.kind === 2)) {
                        owner.animState = 'attack';
                        owner.animStart = now;
                    }
                } else if (type === EV_HIT) {
                    /* kind = attacker (projectile or ability owner);
                       data = victim: the attacker's HitFX flipbook plays
                       at the victim */
                    var v = unitPos(engine.eventData(e));
                    if (v) fx.spawnHit(engine.eventKind(e), v.x, v.y, now);
                } else if (type === EV_CREATURE_DIED) {
                    /* the sim deletes creatures the tick they die; play
                       the detached Defeat clip where it fell */
                    var c = unitPos(engine.eventEntity(e));
                    if (c) {
                        fx.spawnDeath(engine.eventKind(e),
                                      RTSprites.dirFromVector(
                                          c.faceX || 0, c.faceY || 1),
                                      c.x, c.y, now);
                    }
                } else if (type === EV_HERO_RESPAWN) {
                    var hero = view.find(engine.eventEntity(e));
                    if (hero) {
                        hero.animState = 'spawn';   /* respawn pop-in row */
                        hero.animStart = now;
                    }
                }
            }
            lastPos = {};
            for (var j = 0; j < units.length; j++) {
                var lu = units[j];
                lastPos[lu.id] = { x: lu.x, y: lu.y,
                                   faceX: lu.faceX, faceY: lu.faceY };
            }
        }

        function freeze() {
            for (var i = 0; i < units.length; i++) {
                units[i].prevX = units[i].x;
                units[i].prevY = units[i].y;
            }
        }

        function firstHero() {
            var p1 = view.find(engine.playerEntityId(1));
            if (p1) return p1;
            for (var i = 0; i < units.length; i++) {
                if (units[i].kind === 1 || units[i].kind === 2)
                    return units[i];
            }
            return null;
        }

        function showGameOver() {
            gameOverShown = true;
            var hero = firstHero();
            var victory = engine.isVictory() === 1;
            audio.gameOver(victory, hero ? hero.kind : 1);
            screen = 'results';
            setPauseVisible(false);
            /* Record + submit on VICTORY only -- Unity's upload path
               exists solely on the victory screen
               (VictoryScreenController.cs:104-107, 173-197). A defeat
               never records a personal best nor POSTs to the Worker;
               its stats card shows the STORED best (matchResult reads
               lb.best without recording). Victory messaging is Unity's
               score-to-beat math (scoreMessage: >= tie counts,
               "Collect N more...", :226-249). */
            var gems = engine.gems();
            var res = SashimiLeaderboard.matchResult(
                lb, runCategory, runRecordable, victory, gems);
            /* Board provenance state for this victory (defeat: none).
               localRows are captured AFTER matchResult recorded, so a
               run that just set the best shows the new value. */
            lbNote = '';
            boardState = (victory && runCategory) ? {
                victory: true,
                boardName: screens.boardTitle(runCategory),
                player: runRecordable ? {
                    sub: auth.sub(),
                    name: playerAlias || playerName || 'you',
                } : null,
                playerBest: typeof res.best === 'number' ? res.best : gems,
                submit: 'none', submitError: '',
                board: 'pending', online: null, boardError: '',
                localRows: runRecordable
                    ? SashimiLeaderboard.localBoardRows(
                          runCategory, lb, playerAlias || playerName)
                    : [],
            } : null;
            screens.show('results', {
                victory: victory,
                message: engine.gameOverMessage(),
                timeSec: engine.gameTick() / engine.tickRate(),
                wave: engine.wave(),
                waveCount: engine.waveCount(),
                level: engine.heroLevel(),
                gems: gems,
                kills: engine.kills(),
                best: res.best,
                newBest: res.newBest,
                bestText: res.text,
                category: runCategory,
            });
            /* Online board (config-gated, non-blocking). Submission
               and leaderboard rows are VICTORY-only (Unity behavior).
               submitRun may resolve synchronously (unconfigured /
               signed-out), so refresh after it to paint the
               declaration before any network round-trip.

               ALIAS GATE (client side of the Worker rule): the alias
               input opens exactly when this run STRICTLY improved the
               local best (res.improved -- the same beat-your-best
               condition the Worker enforces) AND the submission can
               actually carry an alias (signed in + submit path
               configured). The POST is then HELD ('alias-wait') until
               confirm / the grace timer / screen exit -- flushAlias
               always fires it, so the score is never lost. All other
               submittable runs POST immediately with NO alias field. */
            var canAlias = res.submit && res.improved && !!auth.token() &&
                           lbConfig.enabled && !!lbConfig.workerUrl;
            if (canAlias) {
                if (boardState) boardState.submit = 'alias-wait';
                aliasHold = { gems: gems };
                screens.setAliasPrompt({
                    value: playerAlias || playerName || '',
                    onConfirm: flushAlias,
                });
                if (typeof setTimeout === 'function') {
                    aliasTimer = setTimeout(function() {
                        flushAlias(null);
                    }, ALIAS_GRACE_MS);
                } else {
                    flushAlias(null);   /* no timers: submit now */
                }
            } else if (res.submit) {
                submitRun(gems, null);
            }
            refreshBoard();
            if (boardState) loadBoard();
            hud.setBanner('PLAY AGAIN or R — pick heroes on the next screen');
        }

        /* Fresh world for the next run (PLAY AGAIN / TITLE): re-init the
           module; possession is re-established at the next startGame. */
        function reinitWorld() {
            /* Leaving the results screen fires a still-held new-best
               submission (no alias field) -- the score must never be
               lost because the player skipped the input. */
            flushAlias(null);
            if (!engine.init(CONFIG)) {
                hud.setBanner('engine re-init failed');
                return false;
            }
            view = RTView.init();
            units = [];
            tickIndex = 0;
            lastPos = {};
            fx.reset();
            gameOverShown = false;
            boardState = null;   /* a late submit/fetch resolution from
                                    the finished run must not touch the
                                    next run's screen or lbNote */
            setPauseVisible(false);  /* back to a menu; startGame reshows */
            return true;
        }

        /* SELECT -> PLAYING: realize the roster (realizeRoster, above).
           Absent heroes are removed; HUMAN heroes are possessed NOW in
           roster order (P1, P2), device joined or not -- an input-less
           possessed hero stands still, exactly like Unity, and hero_ai
           never drives it; AI heroes are left un-possessed for hero_ai
           to drive. Devices attach to their hero on first input via
           wasm_join_hero idempotence (onJoin). */
        function startGame() {
            screen = 'playing';
            screens.hide();
            setPauseVisible(true);
            resetRoutes();   /* device -> hero bindings are per match */
            var r = screens.roster();
            /* Leaderboard category + record gate for this run (score is
               recorded at game over on VICTORY only; AI-only matches
               never record). Category mapping is participation-based
               (human + AI -> coop) -- a user-ruled known delta from
               Unity's PossessedTag solo mapping; see
               sashimi-leaderboard.js. */
            runCategory = SashimiLeaderboard.categoryFor(r);
            runRecordable = SashimiLeaderboard.shouldRecord(r);
            var possessed = realizeRoster(r, engine);
            possessed.forEach(function(p) {
                if (p.eid) possessedVO(p.eid, p.kind);
            });
            audio.startMusic();   /* the adventure loop */
            var players = input.players();
            var nAI = r.ai.length;
            var joined = Math.min(players.length, r.human.length);
            hud.setBanner(
                (joined ? joined + (joined > 1 ? ' players' : ' player') + ' in'
                        : 'First input joins as P1 (keyboard, gamepad, touch)')
                + (joined && r.human.length > joined
                    ? ' — P' + (joined + 1) + ' joins on its first input' : '')
                + (nAI ? ' — ' + nAI + ' AI' : ''));
        }

        function playAgain() {
            if (!reinitWorld()) return;
            screen = 'select';
            audio.menuMusic();
            screens.show('select');
            hud.setBanner('Pick heroes, then START');
        }

        function toTitle() {
            if (!reinitWorld()) return;
            screen = 'title';
            audio.menuMusic();
            screens.show('title');
            hud.setBanner('');
        }

        function setPauseVisible(v) {
            if (opts.pauseBtn)
                opts.pauseBtn.style.display = v ? 'block' : 'none';
        }

        /* PLAYING -> PAUSE: open the opaque PauseVT screen. wasm_tick is
           held while it is up (the screen != 'playing' tick gate), so
           the sim freezes exactly where it stood. The floating pause
           button hides behind the art; Resume/End Match live on-screen. */
        function pauseGame() {
            if (screen !== 'playing' || engine.isGameOver()) return;
            screen = 'pause';
            setPauseVisible(false);
            screens.show('pause');
        }

        /* PAUSE -> PLAYING: hide the screen and resume in place. */
        function resumeGame() {
            if (screen !== 'pause') return;
            screen = 'playing';
            screens.hide();
            setPauseVisible(true);
        }

        var screens = SashimiScreens.init({
            root: opts.screens,
            onPlay: function() {
                screen = 'select';
                screens.show('select');
                hud.setBanner('Pick heroes, then START — a second ' +
                              'device can join on its first input');
            },
            /* START = intent; the auth gate runs after the (valid)
               roster choice and before the match. Pass-through when
               auth is unconfigured or already satisfied. */
            onStart: function() { auth.gate(startGame); },
            onResume: resumeGame,
            onEndMatch: toTitle,     /* tear the run down to the title */
            onPlayAgain: playAgain,
            onTitle: toTitle,
        });

        /* P/ESC opens the pause screen while playing and closes it (ESC =
           Cancel = Resume, matching Unity) while it is up; Resume/End Match
           on-screen do the rest. R restarts from the results screen. */
        document.addEventListener('keydown', function(e) {
            /* typing in the alias input must not pause/restart (the
               range slider keeps its P/ESC behavior) */
            if (e.target && e.target.tagName === 'INPUT' &&
                e.target.type === 'text') return;
            if (e.code === 'KeyP' || e.code === 'Escape') {
                if (screen === 'playing' && !engine.isGameOver()) pauseGame();
                else if (screen === 'pause') resumeGame();
            }
            if (e.code === 'KeyR' && screen === 'results') playAgain();
        });
        if (opts.pauseBtn) {
            opts.pauseBtn.addEventListener('click', function() {
                if (screen === 'playing' && !engine.isGameOver()) pauseGame();
                else if (screen === 'pause') resumeGame();
                opts.pauseBtn.blur();  /* Space must not re-trigger */
            });
        }

        var loop = RTLoop.init({
            tickHz: 60,
            maxCatchUp: 5,
            tick: function() {
                if (screen !== 'playing') {
                    /* Menus/results: the engine does not tick (a real
                       hold, like pause). Poll menu focus input and keep
                       sampling devices so gamepads can claim a slot. */
                    screens.poll();
                    input.sample();
                    freeze();
                    return;
                }
                if (engine.isGameOver()) {
                    if (!gameOverShown) showGameOver();
                    freeze();
                    return;
                }
                /* Input is sampled once per simulation tick, never per
                   frame (rt-input contract). Device vectors are screen-space
                   (up = -y); the sim is y-up, so negate y here — the same
                   wasm_set_input contract for keyboard/gamepad/touch.
                   Frames route device -> hero through the binding table
                   (routeFor above): unbound and dead devices write
                   nothing, so input can never target a hero-less
                   clientId or a hero another device already drives. */
                var frames = input.sample();
                for (var i = 0; i < frames.length; i++) {
                    var eng = routeFor(frames[i]);
                    if (eng) engine.setInput(eng, frames[i].x, -frames[i].y);
                }
                engine.tick();
                engineMs = engine.getTickMs();
                units = view.update(reader);
                processTick();
            },
            render: function(alpha, frameDt) {
                render.frame(units, alpha, frameDt, firstHero());
            },
            onStats: function(s) {
                if (screen !== 'playing') return;  /* HUD is covered */
                var hero = firstHero();
                var tickRate = engine.tickRate();
                hud.update({
                    hp: hero ? hero.health : 0,
                    maxHp: hero ? hero.maxHealth : 0,
                    down: hero ? (hero.flags & FLAG_DEFEATED) !== 0 : false,
                    level: engine.heroLevel(),
                    gems: engine.gems(),
                    xpFloor: engine.levelXp(),
                    xpNext: engine.nextLevelXp(),
                    wave: engine.wave(),
                    waveCount: engine.waveCount(),
                    timeSec: engine.gameTick() / tickRate,
                    victorySec: engine.victoryTicks() / tickRate,
                    kills: engine.kills(),
                    rafFps: s.rafFps,
                    simHz: s.simHz,
                    simTarget: tickRate,
                    tickMs: s.tickMs,
                    engineMs: engineMs,
                    drawMs: s.renderMs,
                    entities: units.length,
                    /* possession observability: which hero each device
                       drives (routing table) + who possesses each hero */
                    players: input.players().map(function(p) {
                        var eng = routes[p.clientId];
                        return p.label + '>' + (eng ? 'P' + eng
                            : (eng === 0 ? 'none' : 'unbound'));
                    }).join(', '),
                    heroes: units.filter(function(u) {
                        return u.kind === 1 || u.kind === 2;
                    }).map(function(u) {   /* SW_KIND_HERO_EAGLE/FROG */
                        return (u.kind === 1 ? 'eagle' : 'frog') + ':' +
                               (u.slot ? 'P' + u.slot : 'AI');
                    }).join(' '),
                    playerName: playerName,
                    playerAlias: playerAlias,
                    bestGems: runCategory ? lb.best(runCategory) : null,
                    bestCategory: runCategory,
                    lbNote: lbNote,
                });
            },
            statsEvery: 250,
        });

        /* CLI control channel (rt-control.js -> tools/serve-client.py
           relay -> tools/client.py): state mirrors what the player
           sees; press routes through the same activation paths as
           pointer/keyboard (screens.press / pauseGame). Inert unless
           served by serve-client.py on localhost. */
        var control = RTControl.init({
            state: function() {
                var hero = firstHero();
                var s = loop.stats;
                /* While playing, 'pause' is the one action; on the pause
                   screen (screen !== 'playing') its own Resume/End Match
                   buttons come through screens.state(). */
                var actions = screen === 'playing'
                    ? [{ name: 'pause', label: 'pause (P/ESC)',
                         disabled: engine.isGameOver() === 1,
                         focused: false }]
                    : screens.state().buttons;
                return {
                    sandbox: 'sashimi',
                    screen: screen,
                    paused: screen === 'pause',
                    gameOver: engine.isGameOver() === 1,
                    actions: actions,
                    ui: screen === 'playing' ? null : screens.state(),
                    game: {
                        tick: engine.gameTick(),
                        timeSec: +(engine.gameTick() /
                                   engine.tickRate()).toFixed(1),
                        wave: engine.wave(),
                        waveCount: engine.waveCount(),
                        gems: engine.gems(),
                        kills: engine.kills(),
                        level: engine.heroLevel(),
                        heroHp: hero ? +hero.health.toFixed(1) : 0,
                        heroMaxHp: hero ? hero.maxHealth : 0,
                        units: units.length,
                        players: input.players().map(function(p) {
                            var eng = routes[p.clientId];
                            return p.label + '>' + (eng ? 'P' + eng
                                : (eng === 0 ? 'none' : 'unbound'));
                        }),
                        heroes: units.filter(function(u) {
                            return u.kind === 1 || u.kind === 2;
                        }).map(function(u) {
                            return (u.kind === 1 ? 'eagle' : 'frog') + ':' +
                                   (u.slot ? 'P' + u.slot : 'AI');
                        }),
                    },
                    render: {
                        backend: render.backend,
                        renderer: render.renderer,
                    },
                    perf: {
                        rafFps: +s.rafFps.toFixed(1),
                        simHz: +s.simHz.toFixed(1),
                        tickMs: +s.tickMs.toFixed(3),
                        engineMs: +engineMs.toFixed(3),
                        renderMs: +s.renderMs.toFixed(3),
                        droppedMs: Math.round(s.droppedMs),
                        frames: s.totalFrames,
                        slow20: s.slow20,
                        slow33: s.slow33,
                        worstMs: +s.winWorstMs.toFixed(1),
                    },
                    visibility: document.visibilityState,
                };
            },
            commands: {
                press: function(args) {
                    var name = String(args.button || '').toLowerCase();
                    if (screen === 'playing') {
                        if (name === 'pause') {
                            if (engine.isGameOver() === 1)
                                throw new Error('game is over');
                            pauseGame();
                            return { pressed: 'pause', screen: screen };
                        }
                        throw new Error("no button '" + name +
                            "' while playing (available: pause)");
                    }
                    /* pause screen: resume / end-match go through the same
                       activation path as a pointer click on those buttons */
                    return screens.press(name);
                },
            },
        });

        /* Boot on the title screen; the engine world is ready but holds
           until startGame ticks it. Title interaction doubles as the
           audio unlock gesture. */
        setPauseVisible(false);
        screens.show('title');
        hud.setBanner('');

        loop.start();
        return { loop: loop, engine: engine, screens: screens,
                 start: startGame, restart: playAgain, audio: audio,
                 control: control };
    }

    /* realizeRoster is exported for the headless bridge test
       (tests/test_wasm.js): the possess-at-start contract is pinned
       against the real WASM module. */
    return { start: start, realizeRoster: realizeRoster };
})();
