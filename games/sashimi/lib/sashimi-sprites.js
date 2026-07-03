/**
 * SashimiSprites — sprite sheets + animation tables for the sashimi client,
 * as rt-sprites.js unit definitions (sheet + directional animation table
 * with mirror fallback chains — the UnitAnimationDataSO pattern).
 *
 * Two art paths:
 *   REAL (default)   — the Unity project's actual sprites: packed sheet
 *     PNGs (assets/<name>.png, HTTP-loaded) + generated manifests
 *     (lib/sashimi-art-data.js), both emitted by
 *     clients/tools/extract-art.py from the UnitAnimationDataSO tables,
 *     .anim keyframes and texture slicing metadata. World sizes are
 *     PPU-derived, so entities render at exactly Unity's scale.
 *   PROCEDURAL (fallback) — the original placeholder painters, kept for
 *     art-less debugging and as a reference for the def format. Select
 *     with ?art=proc, or automatically when sashimi-art-data.js is absent.
 *
 * Kinds mirror the WASM bridge enum (wasm_main.c SW_KIND_*):
 *   1 HeroEagle  2 HeroFrog  3 Slime  4 Wolf  5 Golem  6 Wisp  7 Cube
 *   8 Shuriken  9 Feather  10 WispShot  11 Gem  12 Heart
 * KIND_INFO names match the manifest unit names 1:1.
 *
 * All values here are presentation-only (frame rects, anchors, on-screen
 * sizes). Game parameters stay engine-side (root CLAUDE.md decision 13).
 */
var SashimiSprites = (function() {
    var DIRS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];

    /* ── Sheet builders ──────────────────────────────────────────────── */

    /* Radially symmetric unit (blobs, orbs, pickups): one authored row,
       every state x direction falls back to it. */
    function makeSimpleUnit(fs, frames, fps, anchorY, painter) {
        var canvas = document.createElement('canvas');
        canvas.width = fs * frames;
        canvas.height = fs;
        var g = canvas.getContext('2d');
        for (var f = 0; f < frames; f++) {
            g.save();
            g.translate(f * fs, 0);
            painter(g, fs, [0, 1], f / frames, true);
            g.restore();
        }
        var table = { idle_S: { row: 0, frames: frames, fps: fps } };
        for (var s = 0; s < 2; s++) {
            var state = s === 0 ? 'walk' : 'idle';
            for (var d = 0; d < DIRS.length; d++) {
                var key = state + '_' + DIRS[d];
                if (!table[key]) table[key] = { fallback: 'idle_S' };
            }
        }
        return { sheet: canvas, frameSize: fs, anchorY: anchorY, table: table };
    }

    /* Directional unit (heroes, wolf, golem, cube): authored walk E/S/N
       (4 frames) + idle S (2 frames), left side mirrors right. */
    function makeDirectionalUnit(fs, anchorY, painter) {
        var rows = [
            { key: 'walk_E', face: [1, 0],  frames: 4, walk: true },
            { key: 'walk_S', face: [0, 1],  frames: 4, walk: true },
            { key: 'walk_N', face: [0, -1], frames: 4, walk: true },
            { key: 'idle_S', face: [0, 1],  frames: 2, walk: false },
        ];
        var canvas = document.createElement('canvas');
        canvas.width = fs * 4;
        canvas.height = fs * rows.length;
        var g = canvas.getContext('2d');

        var table = {};
        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            for (var f = 0; f < row.frames; f++) {
                g.save();
                g.translate(f * fs, r * fs);
                var phase = row.walk ? f / row.frames : (f === 0 ? 0 : 0.5);
                painter(g, fs, row.face, phase, row.walk);
                g.restore();
            }
            table[row.key] = { row: r, frames: row.frames,
                               fps: row.walk ? 8 : 2 };
        }
        table.walk_W  = { fallback: 'walk_E', mirror: true };
        table.walk_NE = { fallback: 'walk_E' };
        table.walk_SE = { fallback: 'walk_E' };
        table.walk_NW = { fallback: 'walk_E', mirror: true };
        table.walk_SW = { fallback: 'walk_E', mirror: true };
        table.idle_E  = { fallback: 'idle_S' };
        table.idle_N  = { fallback: 'idle_S' };
        table.idle_NE = { fallback: 'idle_S' };
        table.idle_NW = { fallback: 'idle_S' };
        table.idle_W  = { fallback: 'idle_S' };
        table.idle_SW = { fallback: 'idle_S' };
        table.idle_SE = { fallback: 'idle_S' };
        return { sheet: canvas, frameSize: fs, anchorY: anchorY, table: table };
    }

    function shadow(g, fs, w) {
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath();
        g.ellipse(fs / 2, fs * 0.85, fs * w, fs * w * 0.35, 0, 0, Math.PI * 2);
        g.fill();
    }

    /* ── Painters (one frame each) ───────────────────────────────────── */

    function paintSlime(pal) {
        return function(g, fs, face, phase) {
            var squash = Math.sin(phase * Math.PI * 2);
            shadow(g, fs, 0.24);
            var w = fs * (0.26 + squash * 0.04);
            var h = fs * (0.22 - squash * 0.05);
            var cy = fs * 0.85 - h;
            g.fillStyle = pal.body;
            g.beginPath();
            g.ellipse(fs / 2, cy + h * 0.35, w, h, 0, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = pal.outline;
            g.lineWidth = 1;
            g.stroke();
            g.fillStyle = pal.eye;
            g.beginPath();
            g.arc(fs / 2 - w * 0.35, cy, fs * 0.035, 0, Math.PI * 2);
            g.arc(fs / 2 + w * 0.35, cy, fs * 0.035, 0, Math.PI * 2);
            g.fill();
        };
    }

    function paintWolf(pal) {
        return function(g, fs, face, phase, walk) {
            var swing = walk ? Math.sin(phase * Math.PI * 2) : 0;
            shadow(g, fs, 0.3);
            var cy = fs * 0.66 - Math.abs(swing) * fs * 0.02;
            g.strokeStyle = pal.legs;
            g.lineWidth = Math.max(2, fs * 0.05);
            g.lineCap = 'round';
            g.beginPath();
            g.moveTo(fs * 0.36, cy);
            g.lineTo(fs * 0.36 + swing * fs * 0.06, fs * 0.85);
            g.moveTo(fs * 0.62, cy);
            g.lineTo(fs * 0.62 - swing * fs * 0.06, fs * 0.85);
            g.stroke();
            /* body along facing axis */
            g.fillStyle = pal.body;
            g.beginPath();
            if (face[1] === 0) {           /* E: long horizontal body */
                g.ellipse(fs / 2, cy, fs * 0.3, fs * 0.14, 0, 0, Math.PI * 2);
            } else {                       /* N/S: foreshortened */
                g.ellipse(fs / 2, cy, fs * 0.18, fs * 0.2, 0, 0, Math.PI * 2);
            }
            g.fill();
            g.strokeStyle = pal.outline;
            g.lineWidth = 1;
            g.stroke();
            /* head + snout toward facing */
            var hx = fs / 2 + face[0] * fs * 0.3;
            var hy = cy + face[1] * fs * 0.2 - fs * 0.06;
            g.fillStyle = pal.body;
            g.beginPath();
            g.arc(hx, hy, fs * 0.11, 0, Math.PI * 2);
            g.fill();
            g.stroke();
            g.fillStyle = pal.nose;
            g.beginPath();
            g.arc(hx + face[0] * fs * 0.09, hy + face[1] * fs * 0.07,
                  fs * 0.04, 0, Math.PI * 2);
            g.fill();
            /* ears */
            g.fillStyle = pal.body;
            g.beginPath();
            g.moveTo(hx - fs * 0.06, hy - fs * 0.08);
            g.lineTo(hx - fs * 0.02, hy - fs * 0.17);
            g.lineTo(hx + fs * 0.02, hy - fs * 0.08);
            g.fill();
        };
    }

    function paintGolem(pal) {
        return function(g, fs, face, phase, walk) {
            var bob = walk ? Math.abs(Math.sin(phase * Math.PI * 2)) : 0;
            shadow(g, fs, 0.32);
            var cy = fs * 0.55 - bob * fs * 0.02;
            /* bulky rock torso */
            g.fillStyle = pal.body;
            g.beginPath();
            g.moveTo(fs * 0.24, fs * 0.82);
            g.lineTo(fs * 0.2, cy);
            g.lineTo(fs * 0.34, cy - fs * 0.22);
            g.lineTo(fs * 0.66, cy - fs * 0.22);
            g.lineTo(fs * 0.8, cy);
            g.lineTo(fs * 0.76, fs * 0.82);
            g.closePath();
            g.fill();
            g.strokeStyle = pal.outline;
            g.lineWidth = 1.5;
            g.stroke();
            /* cracks */
            g.strokeStyle = pal.crack;
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(fs * 0.42, cy - fs * 0.1);
            g.lineTo(fs * 0.5, cy + fs * 0.05);
            g.lineTo(fs * 0.44, fs * 0.72);
            g.stroke();
            /* eyes toward facing */
            g.fillStyle = pal.eye;
            var ex = fs / 2 + face[0] * fs * 0.08;
            var ey = cy - fs * 0.12 + face[1] * fs * 0.04;
            g.beginPath();
            g.arc(ex - fs * 0.07, ey, fs * 0.03, 0, Math.PI * 2);
            g.arc(ex + fs * 0.07, ey, fs * 0.03, 0, Math.PI * 2);
            g.fill();
        };
    }

    function paintWisp(pal) {
        return function(g, fs, face, phase) {
            var hover = Math.sin(phase * Math.PI * 2) * fs * 0.04;
            shadow(g, fs, 0.16);
            var cy = fs * 0.45 + hover;
            /* glow */
            g.fillStyle = pal.glow;
            g.beginPath();
            g.arc(fs / 2, cy, fs * 0.22, 0, Math.PI * 2);
            g.fill();
            /* core */
            g.fillStyle = pal.body;
            g.beginPath();
            g.arc(fs / 2, cy, fs * 0.13, 0, Math.PI * 2);
            g.fill();
            /* wavy tail */
            g.strokeStyle = pal.body;
            g.lineWidth = Math.max(2, fs * 0.05);
            g.lineCap = 'round';
            g.beginPath();
            g.moveTo(fs / 2, cy + fs * 0.12);
            g.quadraticCurveTo(fs / 2 + Math.sin(phase * Math.PI * 2) * fs * 0.12,
                               cy + fs * 0.26, fs / 2, fs * 0.8 + hover * 0.5);
            g.stroke();
        };
    }

    function paintCube(pal) {
        return function(g, fs, face, phase, walk) {
            var tilt = walk ? Math.sin(phase * Math.PI * 2) * 0.12 : 0;
            shadow(g, fs, 0.34);
            g.save();
            g.translate(fs / 2, fs * 0.55);
            g.rotate(tilt);
            var s = fs * 0.3;
            g.fillStyle = pal.body;
            g.fillRect(-s, -s, s * 2, s * 2);
            g.strokeStyle = pal.outline;
            g.lineWidth = 2;
            g.strokeRect(-s, -s, s * 2, s * 2);
            g.fillStyle = pal.inner;
            g.fillRect(-s * 0.55, -s * 0.55, s * 1.1, s * 1.1);
            /* eyes toward facing */
            g.fillStyle = pal.eye;
            g.beginPath();
            g.arc(face[0] * s * 0.3 - s * 0.25, face[1] * s * 0.3 - s * 0.15,
                  fs * 0.035, 0, Math.PI * 2);
            g.arc(face[0] * s * 0.3 + s * 0.25, face[1] * s * 0.3 - s * 0.15,
                  fs * 0.035, 0, Math.PI * 2);
            g.fill();
            g.restore();
        };
    }

    function paintShuriken(pal) {
        return function(g, fs, face, phase) {
            g.save();
            g.translate(fs / 2, fs / 2);
            g.rotate(phase * Math.PI);   /* spins across frames */
            g.fillStyle = pal.body;
            for (var i = 0; i < 4; i++) {
                g.rotate(Math.PI / 2);
                g.beginPath();
                g.moveTo(0, 0);
                g.lineTo(fs * 0.1, -fs * 0.12);
                g.lineTo(0, -fs * 0.34);
                g.lineTo(-fs * 0.1, -fs * 0.12);
                g.closePath();
                g.fill();
            }
            g.fillStyle = pal.core;
            g.beginPath();
            g.arc(0, 0, fs * 0.07, 0, Math.PI * 2);
            g.fill();
            g.restore();
        };
    }

    function paintFeather(pal) {
        return function(g, fs, face, phase) {
            g.save();
            g.translate(fs / 2, fs / 2);
            g.rotate(-0.6 + Math.sin(phase * Math.PI * 2) * 0.25);
            g.fillStyle = pal.body;
            g.beginPath();
            g.ellipse(0, 0, fs * 0.1, fs * 0.3, 0, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = pal.spine;
            g.lineWidth = 1.5;
            g.beginPath();
            g.moveTo(0, -fs * 0.3);
            g.lineTo(0, fs * 0.34);
            g.stroke();
            g.restore();
        };
    }

    function paintOrb(pal) {
        return function(g, fs, face, phase) {
            var pulse = 1 + Math.sin(phase * Math.PI * 2) * 0.18;
            g.fillStyle = pal.glow;
            g.beginPath();
            g.arc(fs / 2, fs / 2, fs * 0.2 * pulse, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = pal.body;
            g.beginPath();
            g.arc(fs / 2, fs / 2, fs * 0.11 * pulse, 0, Math.PI * 2);
            g.fill();
        };
    }

    function paintGem(pal) {
        return function(g, fs, face, phase) {
            var f = Math.floor(phase * 4);
            shadow(g, fs, 0.12);
            var cy = fs * 0.55 + Math.sin(phase * Math.PI * 2) * fs * 0.03;
            g.fillStyle = pal.body;
            g.beginPath();
            g.moveTo(fs / 2, cy - fs * 0.22);
            g.lineTo(fs / 2 + fs * 0.15, cy);
            g.lineTo(fs / 2, cy + fs * 0.22);
            g.lineTo(fs / 2 - fs * 0.15, cy);
            g.closePath();
            g.fill();
            g.strokeStyle = pal.edge;
            g.lineWidth = 1;
            g.stroke();
            if (f === 1) {  /* sparkle frame */
                g.strokeStyle = pal.sparkle;
                g.beginPath();
                g.moveTo(fs / 2 - fs * 0.24, cy - fs * 0.2);
                g.lineTo(fs / 2 - fs * 0.16, cy - fs * 0.12);
                g.moveTo(fs / 2 - 0.2 * fs, cy - fs * 0.2);
                g.lineTo(fs / 2 - 0.2 * fs, cy - fs * 0.11);
                g.stroke();
            }
        };
    }

    function paintHeart(pal) {
        return function(g, fs, face, phase) {
            var pulse = 1 + Math.sin(phase * Math.PI * 2) * 0.12;
            shadow(g, fs, 0.12);
            var cy = fs * 0.5;
            var s = fs * 0.2 * pulse;
            g.fillStyle = pal.body;
            g.beginPath();
            g.moveTo(fs / 2, cy + s);
            g.bezierCurveTo(fs / 2 - s * 1.4, cy, fs / 2 - s * 0.8, cy - s * 1.1,
                            fs / 2, cy - s * 0.35);
            g.bezierCurveTo(fs / 2 + s * 0.8, cy - s * 1.1, fs / 2 + s * 1.4, cy,
                            fs / 2, cy + s);
            g.fill();
        };
    }

    /* ── Kind registry ───────────────────────────────────────────────── */

    /* def name, on-screen size in world units (presentation-only). */
    var KIND_INFO = {
        1:  { name: 'eagle',    size: 1.0 },
        2:  { name: 'frog',     size: 1.0 },
        3:  { name: 'slime',    size: 0.7 },
        4:  { name: 'wolf',     size: 0.85 },
        5:  { name: 'golem',    size: 1.15 },
        6:  { name: 'wisp',     size: 0.75 },
        7:  { name: 'cube',     size: 1.1 },
        8:  { name: 'shuriken', size: 0.4 },
        9:  { name: 'feather',  size: 0.4 },
        10: { name: 'wispShot', size: 0.35 },
        11: { name: 'gem',      size: 0.45 },
        12: { name: 'heart',    size: 0.5 },
    };

    /* ── Real art (extract-art.py manifests + packed sheet PNGs) ────── */

    function buildReal() {
        var version = SashimiArtData.version;
        var defs = {};
        var byKind = {};
        Object.keys(SashimiArtData.units).forEach(function(name) {
            var u = SashimiArtData.units[name];
            var img = new Image();
            /* content-hash version busts GitHub Pages caching (root
               CLAUDE.md decision 22); rt-sprites draws nothing until the
               sheet is decoded, so art pops in as it loads */
            img.src = u.sheet + '?v=' + version;
            defs[name] = {
                sheet: img,
                frameW: u.frameW, frameH: u.frameH,
                anchorX: u.anchorX, anchorY: u.anchorY,
                rotate: u.rotate,
                table: u.table,
            };
            byKind[u.kind] = { name: name, unit: u };
        });

        return {
            real: true,
            defs: defs,
            defName: function(kind) {
                var k = byKind[kind];
                return k ? k.name : 'slime';
            },
            /* on-screen height in world units == Unity sprite height
               (frame px / PPU) */
            size: function(kind) {
                var k = byKind[kind];
                return k ? k.unit.worldH : 0.7;
            },
            /* health-bar geometry from the idle art's visual bounds (the
               frame cell is padded by defeat/attack FX frames) */
            barFor: function(kind, tilePx) {
                var k = byKind[kind];
                if (!k) return null;
                var w = Math.max(12, Math.min(60, k.unit.uiW * tilePx * 0.9));
                return { dy: k.unit.uiTop * tilePx + 6, w: w };
            },
            /* seconds a play-once state runs (0 = looping/absent) */
            stateDuration: function(kind, state) {
                var k = byKind[kind];
                if (!k) return 0;
                var a = RTSprites.resolve(k.unit.table, state + '_SE');
                if (!a) a = RTSprites.resolve(k.unit.table, state + '_S');
                return (a && a.once) ? a.frames / a.fps : 0;
            },
        };
    }

    /* ── Procedural placeholder art (fallback path) ─────────────────── */

    function buildProcedural() {
        var FS = 32;
        var defs = {
            eagle: RTSprites.makePlaceholderUnit({
                frameSize: FS,
                body: '#e8e4d8', head: '#f0d890', nose: '#c87820',
                legs: '#907840', outline: '#403010',
            }),
            frog: RTSprites.makePlaceholderUnit({
                frameSize: FS,
                body: '#48a838', head: '#88d060', nose: '#184818',
                legs: '#286020', outline: '#103008',
            }),
            slime: makeSimpleUnit(FS, 4, 6, 0.85, paintSlime({
                body: '#e08828', outline: '#804810', eye: '#301800' })),
            wolf: makeDirectionalUnit(FS, 0.85, paintWolf({
                body: '#8890a0', legs: '#585c68', nose: '#282830',
                outline: '#303440' })),
            golem: makeDirectionalUnit(FS, 0.85, paintGolem({
                body: '#8a7860', outline: '#403828', crack: '#584c3c',
                eye: '#ffb020' })),
            wisp: makeSimpleUnit(FS, 4, 6, 0.8, paintWisp({
                body: '#70e8d8', glow: 'rgba(80,220,200,0.3)' })),
            cube: makeDirectionalUnit(FS, 0.85, paintCube({
                body: '#28a098', inner: '#40c8c0', outline: '#105850',
                eye: '#083430' })),
            shuriken: makeSimpleUnit(FS, 4, 12, 0.5, paintShuriken({
                body: '#c8ccd8', core: '#606878' })),
            feather: makeSimpleUnit(FS, 4, 8, 0.5, paintFeather({
                body: '#f0f0e8', spine: '#a8a8a0' })),
            wispShot: makeSimpleUnit(FS, 4, 8, 0.5, paintOrb({
                body: '#a0f0e0', glow: 'rgba(80,220,200,0.4)' })),
            gem: makeSimpleUnit(FS, 4, 4, 0.7, paintGem({
                body: '#4890f0', edge: '#1848a0', sparkle: '#d0e8ff' })),
            heart: makeSimpleUnit(FS, 4, 4, 0.7, paintHeart({
                body: '#e03848' })),
        };

        return {
            real: false,
            defs: defs,
            defName: function(kind) {
                var k = KIND_INFO[kind];
                return k ? k.name : 'slime';
            },
            size: function(kind) {
                var k = KIND_INFO[kind];
                return k ? k.size : 0.7;
            },
            barFor: function() { return null; },       /* default geometry */
            stateDuration: function() { return 0; },   /* nothing blocks */
        };
    }

    function build() {
        var wantProc = typeof location !== 'undefined' &&
            /[?&]art=proc\b/.test(location.search);
        if (wantProc || typeof SashimiArtData === 'undefined') {
            return buildProcedural();
        }
        return buildReal();
    }

    return { build: build };
})();
