/**
 * SashimiFX — client-side presentation effects: projectile trails,
 * hit/death FX sprites, and the ground layer. State-driven per the root
 * "Rendering Architecture": the simulation tick and the presentation
 * event ring mutate FX state here; drawing happens exclusively inside
 * rt-render's frame pass through the effectsUnder/effectsOver hooks.
 *
 * Everything visual in this module is presentation-only; no game
 * parameter lives here (root CLAUDE.md decision 13).
 *
 * Projectile trails — ported from the Unity trail pipeline:
 *   MoveSystem.cs:303-327   one position point per sim tick, buffer capped
 *                           at ProjectilesConfig.TrailDuration * tickRate
 *                           (0.375 s * 60 = 22 points;
 *                           GameStartPropertiesAuthoring.cs:35)
 *   ProjectilePresentation.prefab:223-224 (startWidth 0.05, endWidth
 *   0.01) + ProjectileTrailController.cs:49-56
 *                           InitializeLineRenderer swaps them on purpose:
 *                           0.01 wu at the oldest point tapering to
 *                           0.05 wu at the projectile
 *   ProjectileTrailController.cs:58-77
 *                           TrailOffset rotated by the projectile's
 *                           facing, applied to every point
 *   PresentSpriteSystem.cs:239-242
 *                           startColor = TrailColor at half alpha (tail),
 *                           endColor = TrailColor (head)
 *   TrailColor per projectile prefab (variant overrides on
 *   ProjectileEntity.prefab:201 TrailColor {1,1,1,1}):
 *     Shuriken_Projectile.prefab:371-382       (0.644, 0.879, 0.463)
 *     Feather_Projectile.prefab:315-326        (0.349, 0.643, 0.683)
 *     FeatherRecall_Projectile.prefab:124-135  (0.349, 0.416, 0.682)
 *       (the bridge exports both feather prefabs as kind 9, so the
 *       recall projectile reuses the Feather trail color)
 *     CreatureWisp_Projectile.prefab:162-178   (0.199, 0, 0.2),
 *       TrailOffset.x 0.1
 *   The trail clears when the projectile despawns
 *   (ProjectileTrailController.OnDisable), so entries die with their
 *   view unit.
 *
 * Hit/death FX — short-lived sprite entries drawn by effectsOver:
 *   spawnHit(attackerKind) plays the attacker's HitFX flipbook (Unity:
 *                every live weapon/ability prefab wires HitFXPrefab ->
 *                an EASO "Spawn" clip; extracted per attacker kind by
 *                extract-art.py, see HIT_FX there) at the victim's
 *                position on an EV_HIT event
 *   spawnDeath() plays the creature's own authored Defeat row where it
 *                fell, at alpha 0.75 (Unity fades the corpse sprite via
 *                SpriteAlpha75FX while PresentUnitAnimationSystem plays
 *                the Defeat clip; our simulation deletes creatures the
 *                tick they die, so the client detaches the clip from
 *                the entity and plays it out in place)
 * Entries expire when their play-once row has run its course.
 */
var SashimiFX = (function() {
    /* kind -> trail spec (world units / seconds; Unity provenance above) */
    var TRAIL_SECONDS = 0.375;          /* projectileConfig.TrailDuration */
    var TRAILS = {
        8:  { r: 164, g: 224, b: 118, offset: 0 },     /* shuriken  */
        9:  { r: 89,  g: 164, b: 174, offset: 0 },     /* feather   */
        10: { r: 51,  g: 0,   b: 51,  offset: 0.1 },   /* wisp shot */
    };
    var TRAIL_W_TAIL = 0.01, TRAIL_W_HEAD = 0.05;      /* world units */
    var TAIL_ALPHA = 0.5, HEAD_ALPHA = 1.0;

    function init(opts) {
        var sprites = opts.sprites;
        var tickRate = opts.tickRate || 60;
        var maxPts = Math.floor(TRAIL_SECONDS * tickRate);

        /* ── Trails: entity id -> { spec, pts[] oldest..newest } ────── */
        var trails = {};

        /* ── FX entries: { def, state, dir, start, x, y, sizeWu,
              seconds } — removed once their clock passes `seconds` ──── */
        var fx = [];

        /* Called once per simulation tick, after view.update. */
        function tick(units, now) {
            var live = {};
            for (var i = 0; i < units.length; i++) {
                var u = units[i];
                var spec = TRAILS[u.kind];
                if (!spec) continue;
                live[u.id] = true;
                var tr = trails[u.id];
                if (!tr) tr = trails[u.id] = { spec: spec, u: u, pts: [] };
                tr.u = u;
                tr.pts.push({ x: u.x, y: u.y });
                if (tr.pts.length > maxPts) tr.pts.shift();
            }
            /* trail dies with its projectile (OnDisable clears) */
            for (var id in trails) {
                if (!live[id]) delete trails[id];
            }
        }

        function spawnFx(def, state, dir, x, y, sizeWu, seconds, alpha,
                         now) {
            if (!sprites.defs[def]) return;
            fx.push({ def: def, state: state, dir: dir || 'S',
                      x: x, y: y, sizeWu: sizeWu, seconds: seconds,
                      alpha: alpha, start: now });
        }

        /* EV_HIT: the attacker's HitFX flipbook at the victim. */
        function spawnHit(attackerKind, x, y, now) {
            var spec = sprites.hitFxFor && sprites.hitFxFor(attackerKind);
            if (!spec) return;
            spawnFx(spec.def, 'spawn', 'S', x, y, spec.size,
                    spec.seconds, 1, now);
        }

        /* EV_CREATURE_DIED: detach the creature's authored Defeat row and
           play it out where it fell (corpse alpha 0.75, SpriteAlpha75FX). */
        function spawnDeath(kind, dir, x, y, now) {
            var def = sprites.defName(kind);
            var seconds = sprites.stateDuration(kind, 'defeat');
            if (!seconds) return;
            spawnFx(def, 'defeat', dir, x, y, sprites.size(kind),
                    seconds, 0.75, now);
        }

        /* ── Pre-spawn telegraphs: {x, y, frac} per pending warning
              (frac 1 -> 0 across the window), replaced wholesale each
              tick by the client (setPendings). Drawn as the Unity
              SpawnWarning indicator looping at the warning position. ── */
        var pendings = [];
        function setPendings(list) { pendings = list || []; }

        function drawPendings(gfx, view, t) {
            var warn = sprites.warn;
            if (!pendings.length || !warn || !sprites.defs[warn.def])
                return;
            var def = sprites.defs[warn.def];
            var sizePx = warn.size * view.tilePx;
            for (var i = 0; i < pendings.length; i++) {
                var p = pendings[i];
                /* quick ramp-in when the warning appears, then hold */
                var a = Math.min(1, (1 - p.frac) * 8) * 0.9;
                if (a <= 0) continue;
                RTSprites.draw(gfx, def, 'idle', 'S', t,
                               view.toX(p.x), view.toY(p.y), sizePx, 0, a);
            }
        }

        /* ── Draw passes (called from rt-render's hooks only, through the
              backend-neutral Gfx surface) ─────────────────────────────── */

        /* effectsUnder: telegraphs under the trails, both under units */
        function drawUnder(gfx, view, t) {
            drawPendings(gfx, view, t);
            drawTrails(gfx, view, t);
        }

        function drawTrails(gfx, view, t) {
            for (var id in trails) {
                var tr = trails[id];
                var n = tr.pts.length;
                if (n < 1) continue;
                var spec = tr.spec;
                /* TrailOffset rotated to the projectile's facing
                   (offset is along local +x = the travel direction) */
                var ox = 0, oy = 0;
                if (spec.offset) {
                    var fl = Math.hypot(tr.u.faceX, tr.u.faceY) || 1;
                    ox = spec.offset * tr.u.faceX / fl;
                    oy = spec.offset * tr.u.faceY / fl;
                }
                /* head = the interpolated render position, so the trail
                   stays glued to the sprite between ticks */
                var hx = tr.u.prevX + (tr.u.x - tr.u.prevX) * view.alpha;
                var hy = tr.u.prevY + (tr.u.y - tr.u.prevY) * view.alpha;
                var px = view.toX(hx + ox), py = view.toY(hy + oy);
                for (var i = n - 1; i >= 0; i--) {
                    var frac = n > 1 ? i / (n - 1) : 1;   /* 1 = head */
                    var sx = view.toX(tr.pts[i].x + ox);
                    var sy = view.toY(tr.pts[i].y + oy);
                    var a = TAIL_ALPHA + (HEAD_ALPHA - TAIL_ALPHA) * frac;
                    var lw = Math.max(1,
                        (TRAIL_W_TAIL + (TRAIL_W_HEAD - TRAIL_W_TAIL) *
                         frac) * view.tilePx);
                    gfx.line(px, py, sx, sy, lw, true,
                             spec.r / 255, spec.g / 255, spec.b / 255, a);
                    px = sx; py = sy;
                }
            }
        }

        function drawFx(gfx, view, t) {
            var keep = 0;
            for (var i = 0; i < fx.length; i++) {
                var e = fx[i];
                var age = t - e.start;
                if (age > e.seconds) continue;   /* expired: drop */
                fx[keep++] = e;
                RTSprites.draw(gfx, sprites.defs[e.def], e.state, e.dir,
                               age, view.toX(e.x), view.toY(e.y),
                               e.sizeWu * view.tilePx, 0, e.alpha);
            }
            fx.length = keep;
        }

        /* Restart: entity ids are reused after a module re-init, so
           drop everything keyed by id and all pending entries. */
        function reset() {
            trails = {};
            fx.length = 0;
            pendings = [];
        }

        return {
            tick: tick,
            reset: reset,
            spawnHit: spawnHit,
            spawnDeath: spawnDeath,
            setPendings: setPendings,
            drawUnder: drawUnder,
            drawTrails: drawTrails,
            drawFx: drawFx,
        };
    }

    return { init: init };
})();
