/**
 * RTSprites — data-driven directional animation tables + sprite drawing.
 *
 * The table format is the sashimi UnitAnimationDataSO pattern: rows of
 * directional states with mirror fallback chains. A state key is
 * "<state>_<dir>" with dir in E NE N NW W SW S SE (screen coords, y down,
 * N = up). Each entry is either:
 *
 *   authored:  { row, frames, fps, mirror?, once? }   — a sheet row
 *              (once: play once and hold the last frame — blocking
 *              animations like Damage/Defeat; loops otherwise)
 *   fallback:  { fallback: '<state>_<dir>', mirror? }  — follow the chain,
 *              XOR-accumulating mirror flags (FallbackName/FallbackInverse)
 *
 * resolve() follows chains to the authored entry, so left-facing directions
 * are typically authored once and mirrored (e.g. walk_W -> walk_E mirrored).
 *
 * A unit definition:
 *   { sheet: <canvas|image>, frameSize: 32, anchorY: 0.85, table: {...} }
 * Non-square frames use frameW/frameH instead of frameSize; anchorX
 * (default 0.5) places the horizontal pivot. draw() takes an optional
 * angle (radians, rotation about the anchor) for units rendered facing
 * their travel direction (projectiles).
 *
 * makePlaceholderUnit(palette) builds a procedurally drawn sheet + a table
 * that exercises the machinery (5 authored walk directions, 3 authored idle
 * directions, mirror fallbacks and a two-hop chain) — stand-in art with real
 * animation-table plumbing.
 */
var RTSprites = (function() {
    /* Octants ordered by atan2 angle in screen coords (y down):
       0 rad = E, positive rotates toward S. */
    var DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

    function dirFromVector(x, y) {
        if (x === 0 && y === 0) return 'S';
        var oct = Math.round(Math.atan2(y, x) / (Math.PI / 4));
        return DIRS[(oct + 8) % 8];
    }

    /* Follow fallback chains to the authored row; returns
       { row, frames, fps, mirror, once } or null. */
    function resolve(table, stateKey) {
        var mirror = false;
        var key = stateKey;
        for (var guard = 0; guard < 8; guard++) {
            var e = table[key];
            if (!e) return null;
            if (e.mirror) mirror = !mirror;
            if (typeof e.row === 'number') {
                return { row: e.row, frames: e.frames, fps: e.fps,
                         mirror: mirror, once: !!e.once };
            }
            key = e.fallback;
        }
        return null;
    }

    /* Draw one unit sprite through the backend-neutral Gfx surface.
       (cx, cy) is the screen-space anchor (the def's pivot point), sizePx
       the on-screen frame *height* (width follows the frame aspect), tSec a
       monotonic animation clock — state-relative for `once` rows to make
       sense. angleRad (optional) rotates about the anchor. alpha (optional,
       default 1) is the draw opacity — it replaces the caller's old
       globalAlpha. Image sheets that have not finished loading draw nothing
       (Gfx.sprite skips sources with naturalWidth===0), so art pops in when
       ready. */
    function draw(gfx, def, state, dir, tSec, cx, cy, sizePx, angleRad, alpha) {
        var a = resolve(def.table, state + '_' + dir);
        if (!a) a = resolve(def.table, 'idle_S');
        if (!a) return;
        var idx = Math.floor(tSec * a.fps);
        var frame = a.once ? Math.min(Math.max(idx, 0), a.frames - 1)
                           : ((idx % a.frames) + a.frames) % a.frames;
        var fw = def.frameW !== undefined ? def.frameW : def.frameSize;
        var fh = def.frameH !== undefined ? def.frameH : def.frameSize;
        var sx = frame * fw;
        var sy = a.row * fh;
        var h = sizePx;
        var w = sizePx * fw / fh;
        var ax = def.anchorX !== undefined ? def.anchorX : 0.5;
        var ay = def.anchorY !== undefined ? def.anchorY : 0.85;
        gfx.sprite(def.sheet, sx, sy, fw, fh, cx, cy, w, h, ax, ay,
                   !!a.mirror, angleRad || 0, 1, 1, 1,
                   alpha === undefined ? 1 : alpha);
    }

    /* ── Placeholder sheet generation ─────────────────────────────────
       Rows: 0..4 walk E/NE/N/SE/S (4 frames), 5..7 idle E/N/S (2 frames). */

    var SHEET_ROWS = [
        { key: 'walk_E',  face: [1, 0],                    frames: 4, walk: true },
        { key: 'walk_NE', face: [0.7071, -0.7071],         frames: 4, walk: true },
        { key: 'walk_N',  face: [0, -1],                   frames: 4, walk: true },
        { key: 'walk_SE', face: [0.7071, 0.7071],          frames: 4, walk: true },
        { key: 'walk_S',  face: [0, 1],                    frames: 4, walk: true },
        { key: 'idle_E',  face: [1, 0],                    frames: 2, walk: false },
        { key: 'idle_N',  face: [0, -1],                   frames: 2, walk: false },
        { key: 'idle_S',  face: [0, 1],                    frames: 2, walk: false },
    ];

    function drawFigure(g, fs, face, phase, pal) {
        /* phase in [0,1): limb swing. Simple biped: shadow, legs, body,
           head, nose (facing marker). */
        var cx = fs / 2, feetY = fs * 0.85;
        var swing = Math.sin(phase * Math.PI * 2);

        /* shadow */
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath();
        g.ellipse(cx, feetY, fs * 0.22, fs * 0.08, 0, 0, Math.PI * 2);
        g.fill();

        /* legs */
        var legLen = fs * 0.2;
        var legSep = fs * 0.09;
        var stepX = face[0] * swing * fs * 0.08;
        var stepY = face[1] * swing * fs * 0.05;
        g.strokeStyle = pal.legs;
        g.lineWidth = Math.max(2, fs * 0.07);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(cx - legSep, feetY - legLen);
        g.lineTo(cx - legSep + stepX, feetY + stepY * 0.5);
        g.moveTo(cx + legSep, feetY - legLen);
        g.lineTo(cx + legSep - stepX, feetY - stepY * 0.5);
        g.stroke();

        /* body (bobs while walking) */
        var bob = Math.abs(swing) * fs * 0.03;
        var bodyY = fs * 0.52 - bob;
        g.fillStyle = pal.body;
        g.beginPath();
        g.ellipse(cx, bodyY, fs * 0.19, fs * 0.24, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = pal.outline;
        g.lineWidth = 1;
        g.stroke();

        /* head */
        var headY = fs * 0.26 - bob;
        g.fillStyle = pal.head;
        g.beginPath();
        g.arc(cx, headY, fs * 0.13, 0, Math.PI * 2);
        g.fill();
        g.stroke();

        /* nose — facing marker */
        g.fillStyle = pal.nose;
        g.beginPath();
        g.arc(cx + face[0] * fs * 0.1, headY + face[1] * fs * 0.08, fs * 0.045, 0, Math.PI * 2);
        g.fill();
    }

    function makePlaceholderUnit(pal) {
        var fs = pal.frameSize || 32;
        var maxFrames = 4;
        var canvas = document.createElement('canvas');
        canvas.width = fs * maxFrames;
        canvas.height = fs * SHEET_ROWS.length;
        var g = canvas.getContext('2d');

        var table = {};
        for (var r = 0; r < SHEET_ROWS.length; r++) {
            var row = SHEET_ROWS[r];
            for (var f = 0; f < row.frames; f++) {
                g.save();
                g.translate(f * fs, r * fs);
                var phase = row.walk ? f / row.frames : (f === 0 ? 0 : 0.15);
                drawFigure(g, fs, row.face, row.walk ? phase : phase * 0.5, pal);
                g.restore();
            }
            table[row.key] = { row: r, frames: row.frames, fps: row.walk ? 10 : 2 };
        }

        /* Mirror fallbacks (the sashimi pattern): left side mirrors right */
        table['walk_W']  = { fallback: 'walk_E',  mirror: true };
        table['walk_NW'] = { fallback: 'walk_NE', mirror: true };
        table['walk_SW'] = { fallback: 'walk_SE', mirror: true };
        /* Idle diagonals: includes a two-hop chain (NW -> NE -> E) to keep
           chain traversal honest */
        table['idle_NE'] = { fallback: 'idle_E' };
        table['idle_NW'] = { fallback: 'idle_NE', mirror: true };
        table['idle_W']  = { fallback: 'idle_E',  mirror: true };
        table['idle_SE'] = { fallback: 'idle_S' };
        table['idle_SW'] = { fallback: 'idle_SE', mirror: true };

        return { sheet: canvas, frameSize: fs, anchorY: 0.85, table: table };
    }

    return {
        dirFromVector: dirFromVector,
        resolve: resolve,
        draw: draw,
        makePlaceholderUnit: makePlaceholderUnit,
    };
})();
