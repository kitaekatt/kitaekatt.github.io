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
 * Join = possession: both heroes exist from app start; a device's first
 * input claims clientId 1..2 (rt-input.js) and wasm_join_hero adds
 * PossessedBy so hero_ai hands the hero over — preferring the hero kind
 * the player picked on the select screen (picks are per-slot
 * preferences; 0 = no preference = first free hero). Devices that join
 * on a menu are possessed when the game starts; devices that join
 * mid-game are possessed immediately. Touch joins like any device: the
 * first joystick touch claims a slot. P or the pause button pauses (the
 * engine only advances when we call wasm_tick, so a client-side gate is
 * a real pause). R or the results screen's PLAY AGAIN re-inits the
 * module and returns to hero select, re-possessing joined devices on
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

    function start(M, opts) {
        var CONFIG = opts.config || 'default';
        var hud = SashimiHUD.init({
            hud: opts.hud, banner: opts.banner,
        });

        /* ── Transport: WASM exports via cwrap (scalar accessors) ── */
        var engine = {
            init: M.cwrap('wasm_init_with_config', 'number', ['string']),
            tick: M.cwrap('wasm_tick', 'number', []),
            join: M.cwrap('wasm_join', 'number', ['number']),
            joinHero: M.cwrap('wasm_join_hero', 'number',
                              ['number', 'number']),
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
           'title' | 'select' | 'playing' | 'results'. The engine only
           ticks while 'playing'; menus poll their own focus input. */
        var screen = 'title';

        /* Possess a hero for a joined device, honoring its select-screen
           pick (0 = no preference -> first free hero). */
        function possess(clientId, label) {
            var kind = screens.picks()[clientId] || 0;
            var eid = engine.joinHero(clientId, kind);
            if (eid) {
                var hu = view.find(eid);
                audio.select(hu ? hu.kind : clientId); /* Select VO */
            }
            if (label) {
                hud.setBanner(eid
                    ? label + ' joined as P' + clientId +
                      ' — a second device joins on its first input'
                    : label + ': no free hero to possess');
            }
            return eid;
        }

        var input = RTInput.init({
            maxPlayers: 2,   /* two heroes exist: co-op = possession */
            onJoin: function(clientId, label) {
                /* Mid-game joins possess immediately; menu-time joins
                   wait for game start (their pick may not exist yet). */
                if (screen === 'playing') possess(clientId, label);
                else hud.setBanner(label + ' joined as P' + clientId);
            },
        });
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
            minTilesVisible: 11,   /* phone zoom-out: keep >= 11 world units
                                      on the shorter axis, both orientations */
            followRate: 5,
            unitDefs: sprites.defs,
            ground: sprites.ground,   /* real Adventure tilemap (null ->
                                         rt-render's procedural ground) */
            effectsUnder: fx.drawUnder,
            effectsOver: fx.drawFx,
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

        var units = [];
        var engineMs = 0;
        var paused = false;
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
            audio.gameOver(engine.isVictory() === 1, hero ? hero.kind : 1);
            screen = 'results';
            setPauseVisible(false);
            screens.show('results', {
                victory: engine.isVictory() === 1,
                message: engine.gameOverMessage(),
                timeSec: engine.gameTick() / engine.tickRate(),
                wave: engine.wave(),
                waveCount: engine.waveCount(),
                level: engine.heroLevel(),
                gems: engine.gems(),
                kills: engine.kills(),
            });
            hud.setBanner('PLAY AGAIN or R — hero picks are kept');
        }

        /* Fresh world for the next run (PLAY AGAIN / TITLE): re-init the
           module; possession is re-established at the next startGame. */
        function reinitWorld() {
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
            setPaused(false);
            setPauseVisible(false);  /* back to a menu; startGame reshows */
            return true;
        }

        /* SELECT -> PLAYING: possess a hero per joined device (honoring
           picks); later joins possess on their first input (onJoin). */
        function startGame() {
            screen = 'playing';
            screens.hide();
            setPauseVisible(true);
            var players = input.players();
            for (var i = 0; i < players.length; i++)
                possess(players[i].clientId, null);
            audio.startMusic();   /* the adventure loop */
            hud.setBanner(players.length
                ? players.map(function(p) {
                      return 'P' + p.clientId;
                  }).join(' ') + ' in — a second device joins on its ' +
                  'first input'
                : 'First input joins as P1 (keyboard, gamepad, or touch)');
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

        function setPaused(p) {
            paused = p;
            if (opts.pauseBtn)
                opts.pauseBtn.textContent = paused ? '▶' : '❚❚';
        }

        function setPauseVisible(v) {
            if (opts.pauseBtn)
                opts.pauseBtn.style.display = v ? 'block' : 'none';
        }

        var screens = SashimiScreens.init({
            root: opts.screens,
            onPlay: function() {
                screen = 'select';
                screens.show('select');
                hud.setBanner('Pick heroes, then START — a second ' +
                              'device can join on its first input');
            },
            onStart: startGame,
            onPlayAgain: playAgain,
            onTitle: toTitle,
        });

        document.addEventListener('keydown', function(e) {
            if (e.code === 'KeyP' && screen === 'playing' &&
                !engine.isGameOver()) {
                setPaused(!paused);
            }
            if (e.code === 'KeyR' && screen === 'results') playAgain();
        });
        if (opts.pauseBtn) {
            opts.pauseBtn.addEventListener('click', function() {
                if (screen === 'playing' && !engine.isGameOver())
                    setPaused(!paused);
                opts.pauseBtn.blur();  /* Space must not re-toggle */
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
                if (paused) { freeze(); return; }
                /* Input is sampled once per simulation tick, never per
                   frame (rt-input contract). Device vectors are screen-space
                   (up = -y); the sim is y-up, so negate y here — the same
                   wasm_set_input contract for keyboard/gamepad/touch. */
                var frames = input.sample();
                for (var i = 0; i < frames.length; i++) {
                    engine.setInput(frames[i].clientId,
                                    frames[i].x, -frames[i].y);
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
                    players: input.players().map(function(p) {
                        return 'P' + p.clientId;
                    }).join(' '),
                    paused: paused,
                });
            },
            statsEvery: 250,
        });

        /* CLI control channel (rt-control.js -> tools/serve-client.py
           relay -> tools/client.py): state mirrors what the player
           sees; press routes through the same activation paths as
           pointer/keyboard (screens.press / setPaused). Inert unless
           served by serve-client.py on localhost. */
        var control = RTControl.init({
            state: function() {
                var hero = firstHero();
                var s = loop.stats;
                var actions = screen === 'playing'
                    ? [{ name: paused ? 'resume' : 'pause',
                         label: paused ? 'resume (P)' : 'pause (P)',
                         disabled: engine.isGameOver() === 1,
                         focused: false }]
                    : screens.state().buttons;
                return {
                    sandbox: 'sashimi',
                    screen: screen,
                    paused: paused,
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
                            return 'P' + p.clientId;
                        }),
                    },
                    perf: {
                        rafFps: +s.rafFps.toFixed(1),
                        simHz: +s.simHz.toFixed(1),
                        tickMs: +s.tickMs.toFixed(3),
                        engineMs: +engineMs.toFixed(3),
                        renderMs: +s.renderMs.toFixed(3),
                        droppedMs: Math.round(s.droppedMs),
                    },
                    visibility: document.visibilityState,
                };
            },
            commands: {
                press: function(args) {
                    var name = String(args.button || '').toLowerCase();
                    if (screen === 'playing') {
                        if (name === 'pause' || name === 'resume') {
                            if (engine.isGameOver() === 1)
                                throw new Error('game is over');
                            setPaused(name === 'pause');
                            return { pressed: name, paused: paused };
                        }
                        throw new Error("no button '" + name +
                            "' while playing (available: " +
                            (paused ? 'resume' : 'pause') + ')');
                    }
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

    return { start: start };
})();
