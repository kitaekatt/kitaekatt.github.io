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
 *     └── RTRender.frame(units, alpha)  camera follows P1's hero,
 *           tilemap arena, y-sort, per-kind placeholder sprites, HUD
 *
 * Join = possession: both heroes exist from app start; a device's first
 * input claims clientId 1..2 and wasm_join adds PossessedBy so hero_ai
 * hands the hero over. Touch joins like any device: the first joystick
 * touch claims a slot (rt-input.js). P or the pause button pauses (the
 * engine only advances when we call wasm_tick, so a client-side gate is a
 * real pause). R or the overlay button restarts after game over. No game
 * parameter lives here (root CLAUDE.md decision 13) — arena bounds,
 * timers, XP tables, waves all come from the engine.
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
            hud: opts.hud, banner: opts.banner, overlay: opts.overlay,
        });

        /* ── Transport: WASM exports via cwrap (scalar accessors) ── */
        var engine = {
            init: M.cwrap('wasm_init_with_config', 'number', ['string']),
            tick: M.cwrap('wasm_tick', 'number', []),
            join: M.cwrap('wasm_join', 'number', ['number']),
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
            slot: M.cwrap('wasm_get_unit_slot', 'number', ['number']),
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
                u.radius = engine.radius(i);
            },
        };

        /* ── Shared runtime ── */
        var sprites = SashimiSprites.build();
        var view = RTView.init();
        var input = RTInput.init({
            maxPlayers: 2,   /* two heroes exist: co-op = possession */
            onJoin: function(clientId, label) {
                var eid = engine.join(clientId);
                hud.setBanner(eid
                    ? label + ' joined as P' + clientId +
                      ' — a second device joins on its first input'
                    : label + ': no free hero to possess');
            },
        });
        var render = RTRender.init({
            canvas: opts.canvas,
            mapW: mapW, mapH: mapH,
            tilePx: 64,
            minTilesVisible: 11,   /* phone zoom-out: keep >= 11 world units
                                      on the shorter axis, both orientations */
            followRate: 5,
            unitDefs: sprites.defs,
            defFor: function(u) { return sprites.defName(u.kind); },
            sizeFor: function(u, tilePx) {
                return tilePx * sprites.size(u.kind);
            },
            stateFor: function(u) {
                if (u.flags & FLAG_DEFEATED) return 'idle';
                return u.moving ? 'walk' : 'idle';
            },
            alphaFor: function(u, t) {
                if (u.flags & FLAG_DEFEATED) return 0.3;
                if (u.flags & FLAG_IFRAMES)
                    return 0.45 + 0.35 * Math.sin(t * 24);
                if (u.flags & FLAG_HIT) return 0.65;
                return 1;
            },
        });

        var units = [];
        var engineMs = 0;
        var paused = false;
        var gameOverShown = false;

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
            hud.showGameOver({
                victory: engine.isVictory() === 1,
                message: engine.gameOverMessage(),
                timeSec: engine.gameTick() / engine.tickRate(),
                wave: engine.wave(),
                waveCount: engine.waveCount(),
                level: engine.heroLevel(),
                gems: engine.gems(),
                kills: engine.kills(),
                onRestart: restart,   /* overlay button (touch); R also works */
            });
        }

        function restart() {
            if (!engine.init(CONFIG)) {
                hud.setBanner('engine re-init failed');
                return;
            }
            view = RTView.init();
            units = [];
            gameOverShown = false;
            setPaused(false);
            hud.hideGameOver();
            /* Re-possess heroes for already-joined devices. */
            var players = input.players();
            for (var i = 0; i < players.length; i++)
                engine.join(players[i].clientId);
        }

        function setPaused(p) {
            paused = p;
            if (opts.pauseBtn)
                opts.pauseBtn.textContent = paused ? '▶' : '❚❚';
        }

        document.addEventListener('keydown', function(e) {
            if (e.code === 'KeyP' && !engine.isGameOver()) setPaused(!paused);
            if (e.code === 'KeyR' && engine.isGameOver()) restart();
        });
        if (opts.pauseBtn) {
            opts.pauseBtn.addEventListener('click', function() {
                if (!engine.isGameOver()) setPaused(!paused);
                opts.pauseBtn.blur();  /* Space must not re-toggle */
            });
        }

        var loop = RTLoop.init({
            tickHz: 60,
            maxCatchUp: 5,
            tick: function() {
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
            },
            render: function(alpha, frameDt) {
                render.frame(units, alpha, frameDt, firstHero());
            },
            onStats: function(s) {
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
                    fps: s.fps,
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

        loop.start();
        return { loop: loop, engine: engine, restart: restart };
    }

    return { start: start };
})();
