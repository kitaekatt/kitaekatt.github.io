/**
 * RTRender — camera, tilemap background, y-sorted sprites, health bars.
 *
 * One frame() call per rAF frame (from RTLoop's render callback). Draws:
 *   1. prerendered tilemap layer (camera-transformed)
 *   2. view units, y-sorted (painter's order), interpolated between the
 *      last two tick positions by alpha
 *   3. health bars above entities, player-slot rings under players
 *
 * World space is continuous: 1 world unit = 1 tile. Camera smoothly follows
 * a target view unit (exp smoothing, frame-rate independent).
 *
 * Usage:
 *   var r = RTRender.init({
 *       canvas: el, mapW: 64, mapH: 36,
 *       tilePx: 48,            // on-screen CSS pixels per world unit
 *       minTilesVisible: 11,   // optional: shrink tilePx on small screens so
 *                              // at least this many world units fit on the
 *                              // shorter viewport axis (phone zoom-out)
 *       followRate: 4,         // 1/s; higher = snappier camera
 *       unitDefs: { hero: def, wanderer: def },  // RTSprites defs
 *       defFor: function(u) { return u.slot > 0 ? 'hero' : 'wanderer'; },
 *   });
 *   r.frame(viewUnits, alpha, frameDtMs, followUnit /\* or null *\/);
 *   r.resize();  // also wired to window resize
 *
 * The canvas backing store is scaled by devicePixelRatio (crisp on phones);
 * all layout math stays in CSS pixels via a base ctx transform.
 */
var RTRender = (function() {
    var SLOT_COLORS = { 1: '#4dd2ff', 2: '#ffd24d', 3: '#ff4dd2', 4: '#ff8c4d' };

    function init(cfg) {
        var canvas = cfg.canvas;
        var ctx = canvas.getContext('2d');
        var mapW = cfg.mapW, mapH = cfg.mapH;
        var baseTilePx = cfg.tilePx || 48;
        var tilePx = baseTilePx;
        var followRate = cfg.followRate || 4;
        var viewW = 0, viewH = 0;   /* viewport in CSS px */

        var cam = { x: mapW / 2, y: mapH / 2 };

        /* ── Tilemap layer (prerendered once) ───────────────────── */
        var TILE_SRC = 16;  /* px per tile in the prerender, scaled up at draw */
        var tilemap = document.createElement('canvas');
        tilemap.width = mapW * TILE_SRC;
        tilemap.height = mapH * TILE_SRC;
        (function prerenderTilemap() {
            var g = tilemap.getContext('2d');
            for (var ty = 0; ty < mapH; ty++) {
                for (var tx = 0; tx < mapW; tx++) {
                    /* deterministic per-cell hash for tile variation */
                    var h = (tx * 73856093) ^ (ty * 19349663);
                    h = (h ^ (h >> 13)) >>> 0;
                    var v = h % 4;
                    var shade = 30 + v * 4 + ((tx + ty) % 2) * 3;
                    g.fillStyle = 'rgb(' + (shade - 8) + ',' + (shade + 14) + ',' + (shade - 4) + ')';
                    g.fillRect(tx * TILE_SRC, ty * TILE_SRC, TILE_SRC, TILE_SRC);
                    if (v === 3) {  /* sparse detail: darker tuft */
                        g.fillStyle = 'rgba(0,40,0,0.25)';
                        g.fillRect(tx * TILE_SRC + (h % 8), ty * TILE_SRC + ((h >> 4) % 8), 3, 3);
                    }
                }
            }
            /* map border */
            g.strokeStyle = 'rgba(255,255,255,0.35)';
            g.lineWidth = 2;
            g.strokeRect(1, 1, tilemap.width - 2, tilemap.height - 2);
        })();

        /* ── Canvas sizing (root CLAUDE.md decision 21: size from the
              window, never from a container that includes the canvas).
              Backing store is devicePixelRatio-scaled; drawing code works
              in CSS px through the base transform. tilePx adapts on small
              (phone) viewports when cfg.minTilesVisible is set, so portrait
              and landscape both keep a playable field of view. ── */
        function resize() {
            var dpr = window.devicePixelRatio || 1;
            viewW = window.innerWidth;
            viewH = window.innerHeight;
            canvas.width = Math.round(viewW * dpr);
            canvas.height = Math.round(viewH * dpr);
            canvas.style.width = viewW + 'px';
            canvas.style.height = viewH + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            tilePx = baseTilePx;
            if (cfg.minTilesVisible) {
                var fit = Math.floor(Math.min(viewW, viewH) / cfg.minTilesVisible);
                tilePx = Math.max(8, Math.min(baseTilePx, fit));
            }
        }
        resize();
        window.addEventListener('resize', resize);

        function worldToScreenX(wx) { return (wx - cam.x) * tilePx + viewW / 2; }
        function worldToScreenY(wy) { return (wy - cam.y) * tilePx + viewH / 2; }

        function clampCamera() {
            /* Keep the view inside the map when the map is larger than the
               viewport; center the axis otherwise (natural letterbox: the
               background fills the unused margin). */
            var halfW = viewW / 2 / tilePx;
            var halfH = viewH / 2 / tilePx;
            if (mapW > halfW * 2) cam.x = Math.max(halfW, Math.min(mapW - halfW, cam.x));
            else cam.x = mapW / 2;
            if (mapH > halfH * 2) cam.y = Math.max(halfH, Math.min(mapH - halfH, cam.y));
            else cam.y = mapH / 2;
        }

        function drawHealthBar(sx, sy, w, pct) {
            var h = 4;
            var x = sx - w / 2, y = sy;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
            var g = Math.round(200 * pct), r = Math.round(220 * (1 - pct) + 35);
            ctx.fillStyle = 'rgb(' + r + ',' + g + ',40)';
            ctx.fillRect(x, y, Math.max(0, w * pct), h);
        }

        /* Optional client-owned ground layer (cfg.ground: a canvas whose
           whole area maps onto the map rect). The client paints/repaints
           it (e.g. once a texture image decodes); rt-render just draws
           whatever it currently holds each frame. Absent -> the internal
           procedural tilemap (original behavior). */
        function groundLayer() {
            var g = cfg.ground;
            return (g && g.width > 0 && g.height > 0) ? g : tilemap;
        }

        function frame(units, alpha, frameDtMs, followUnit) {
            /* Camera: smooth follow (frame-rate independent exp smoothing) */
            var tx = mapW / 2, ty = mapH / 2;
            if (followUnit) {
                tx = followUnit.prevX + (followUnit.x - followUnit.prevX) * alpha;
                ty = followUnit.prevY + (followUnit.y - followUnit.prevY) * alpha;
            }
            var k = 1 - Math.exp(-followRate * frameDtMs / 1000);
            cam.x += (tx - cam.x) * k;
            cam.y += (ty - cam.y) * k;
            clampCamera();

            /* Background */
            ctx.fillStyle = '#10101c';
            ctx.fillRect(0, 0, viewW, viewH);
            var mx0 = worldToScreenX(0), my0 = worldToScreenY(0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(groundLayer(), mx0, my0, mapW * tilePx, mapH * tilePx);

            /* Optional effects passes (additive hooks; see the sprite-hook
               comment below). Both receive a screen-projection view:
                 { toX(wx), toY(wy), tilePx, alpha }
               (alpha = this frame's tick-interpolation factor, for
               effects glued to interpolated unit positions).
               effectsUnder draws between the ground and the unit pass
               (projectile trails, ground decals); effectsOver draws after
               the unit pass (impact sparks, death poofs). State-driven
               only — hooks draw from client state, never mutate it. */
            var t = performance.now() / 1000;
            var fxv = { toX: worldToScreenX, toY: worldToScreenY,
                        tilePx: tilePx, alpha: alpha };
            if (cfg.effectsUnder) cfg.effectsUnder(ctx, fxv, t);

            /* Interpolate + cull + y-sort */
            var draw = [];
            var margin = tilePx;
            for (var i = 0; i < units.length; i++) {
                var u = units[i];
                var ix = u.prevX + (u.x - u.prevX) * alpha;
                var iy = u.prevY + (u.y - u.prevY) * alpha;
                var sx = worldToScreenX(ix);
                var sy = worldToScreenY(iy);
                if (sx < -margin || sx > viewW + margin ||
                    sy < -margin || sy > viewH + margin) continue;
                draw.push({ u: u, sx: sx, sy: sy, iy: iy });
            }
            draw.sort(function(a, b) { return a.iy - b.iy; });

            /* Sprites. Optional per-unit hooks (all additive, defaults
               reproduce the original behavior):
                 sizeFor(u, tilePx)   -> on-screen frame size in px
                 stateFor(u)          -> animation state name
                 alphaFor(u, tSec)    -> draw opacity (i-frame flicker etc.)
                 animTimeFor(u, tSec) -> animation clock (state-relative
                                         clocks for play-once rows)
                 barFor(u, tilePx)    -> { dy, w } health-bar geometry in px
                                         (dy above the anchor); art whose
                                         frames are padded by FX cells needs
                                         bars tied to visual bounds, not the
                                         frame size
                 underlayFor(u, tilePx, tSec) -> null or { def, state, dir,
                                         t, sizePx, alpha } — an extra
                                         sprite drawn at the unit's anchor
                                         before the unit itself (ground
                                         markers, spawn telegraphs)
                 overlayFor(u, tilePx, tSec) -> same spec, drawn right
                                         after the unit sprite (hit-flash
                                         tints: a white-silhouette def of
                                         the same sheet drawn over the
                                         frame at a fading alpha)
               A def with rotate: true is drawn rotated to the unit's
               facing vector (projectiles fly point-first). */
            for (var j = 0; j < draw.length; j++) {
                var d = draw[j];
                var u2 = d.u;
                var def = cfg.unitDefs[cfg.defFor(u2)];
                var sizePx = cfg.sizeFor ? cfg.sizeFor(u2, tilePx) : tilePx * 1.1;
                var state = cfg.stateFor ? cfg.stateFor(u2)
                                         : (u2.moving ? 'walk' : 'idle');
                var dir = RTSprites.dirFromVector(u2.faceX, u2.faceY);

                /* underlay (drawn first, own opacity) */
                var un = cfg.underlayFor ? cfg.underlayFor(u2, tilePx, t) : null;
                if (un && cfg.unitDefs[un.def]) {
                    var ua = un.alpha === undefined ? 1 : un.alpha;
                    if (ua > 0) {
                        ctx.globalAlpha = Math.max(0, Math.min(1, ua));
                        RTSprites.draw(ctx, cfg.unitDefs[un.def],
                                       un.state || 'idle', un.dir || 'S',
                                       un.t === undefined ? t : un.t,
                                       d.sx, d.sy,
                                       un.sizePx || sizePx, 0);
                        ctx.globalAlpha = 1;
                    }
                }

                var alpha = cfg.alphaFor ? cfg.alphaFor(u2, t) : 1;
                if (alpha !== 1)
                    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

                /* player slot ring under the sprite */
                if (u2.slot > 0) {
                    ctx.strokeStyle = SLOT_COLORS[u2.slot] || '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.ellipse(d.sx, d.sy, sizePx * 0.28, sizePx * 0.12, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }

                var animT = cfg.animTimeFor ? cfg.animTimeFor(u2, t)
                                            : t + u2.animPhase;
                var angle = def.rotate
                    ? Math.atan2(u2.faceY || 0, u2.faceX || 1) : 0;
                RTSprites.draw(ctx, def, state, dir, animT, d.sx, d.sy, sizePx, angle);

                /* overlay (drawn right after the sprite, own opacity) */
                var ov = cfg.overlayFor ? cfg.overlayFor(u2, tilePx, t) : null;
                if (ov && cfg.unitDefs[ov.def]) {
                    var oa = ov.alpha === undefined ? 1 : ov.alpha;
                    if (oa > 0) {
                        ctx.globalAlpha = Math.max(0, Math.min(1, oa));
                        RTSprites.draw(ctx, cfg.unitDefs[ov.def],
                                       ov.state || state, ov.dir || dir,
                                       ov.t === undefined ? animT : ov.t,
                                       d.sx, d.sy,
                                       ov.sizePx || sizePx, angle);
                        ctx.globalAlpha = alpha !== 1
                            ? Math.max(0, Math.min(1, alpha)) : 1;
                    }
                }

                /* health bar above the sprite (entities without a health
                   pool — maxHealth 0 — draw none) */
                var bar = cfg.barFor ? cfg.barFor(u2, tilePx) : null;
                var barY = d.sy - (bar ? bar.dy : sizePx * 0.95);
                if (u2.maxHealth > 0) {
                    var pct = u2.health / u2.maxHealth;
                    drawHealthBar(d.sx, barY, bar ? bar.w : sizePx * 0.6, Math.max(0, Math.min(1, pct)));
                }

                /* player label */
                if (u2.slot > 0) {
                    ctx.fillStyle = SLOT_COLORS[u2.slot] || '#ffffff';
                    ctx.font = 'bold ' + Math.round(tilePx * 0.25) + 'px monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText('P' + u2.slot, d.sx,
                                 bar ? barY - 5 : d.sy - sizePx * 1.05);
                }
                if (alpha !== 1) ctx.globalAlpha = 1;
            }

            if (cfg.effectsOver) cfg.effectsOver(ctx, fxv, t);
        }

        return { frame: frame, resize: resize, camera: cam };
    }

    return { init: init };
})();
