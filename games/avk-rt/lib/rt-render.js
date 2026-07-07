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
 * Backend: WebGL (GfxGL) is the SOLE renderer. All drawing goes through the
 * backend-neutral Gfx surface, but there is exactly one implementation of it.
 * There is NO 2D-canvas fallback and no ?render override: a 2D fallback would
 * deliver an unplayable experience on precisely the machines that would hit it
 * (weak/integrated GPUs), which is a silent fallback hiding a real problem —
 * forbidden by root CLAUDE.md decision 12 ("No silent fallbacks — exit with a
 * clear error message instead"). When WebGL is unavailable (no context, driver
 * failure, hardware acceleration disabled), RTRender.init fails LOUDLY: it
 * surfaces a plain user-visible explanation (cfg.onUnsupported(message), else a
 * DOM overlay written over the canvas) and returns null — the caller aborts
 * bootstrap. The pre-GL 2D renderer remains recoverable from git history
 * (commit 12ccede) if a visual comparison is ever needed.
 *
 * The returned renderer exposes backend (always 'webgl' when running) and
 * renderer (the GPU string when the WEBGL_debug_renderer_info extension exposes
 * it; the diagnostic that motivated the field) for introspection — the CLI
 * state() surfaces these.
 *
 * Usage:
 *   var r = RTRender.init({
 *       canvas: el, mapW: 64, mapH: 36,
 *       tilePx: 48,            // on-screen CSS pixels per world unit
 *       minTilesVisible: 11,   // optional: shrink tilePx on small screens so
 *                              // at least this many world units fit on the
 *                              // shorter viewport axis (phone zoom-out)
 *       followRate: 4,         // 1/s; higher = snappier camera
 *       dprCap: 2,             // optional: cap the GL backing-store
 *                              // devicePixelRatio (effective dpr =
 *                              // min(devicePixelRatio, dprCap)). Fewer pixels
 *                              // to fill per frame — presentation quality knob
 *                              // for weak GPUs (see resize()). Absent -> no cap.
 *       onUnsupported: fn,     // optional: called with a plain-text message
 *                              // when WebGL is unavailable; init then returns
 *                              // null. Absent -> a default DOM overlay is
 *                              // written over the canvas. Never silent.
 *       unitDefs: { hero: def, wanderer: def },  // RTSprites defs
 *       defFor: function(u) { return u.slot > 0 ? 'hero' : 'wanderer'; },
 *   });
 *   if (!r) return;           // WebGL unavailable — message already shown
 *   r.frame(viewUnits, alpha, frameDtMs, followUnit /\* or null *\/);
 *   r.resize();  // also wired to window resize
 *
 * The GL canvas backing store is scaled by devicePixelRatio (crisp on phones);
 * all layout math stays in CSS px, handed to the GL projection each frame via
 * gfx.begin(viewW, viewH, dpr). cfg.dprCap caps that ratio at a single read
 * point in resize(), so the GL viewport/backing store shrinks with it.
 */
var RTRender = (function() {
    /* Colors as numeric rgb (0..1 floats) at definition — the Gfx surface
       takes floats and formats the backend color string. Slot rings/labels
       were '#4dd2ff'/'#ffd24d'/'#ff4dd2'/'#ff8c4d'; the background was
       '#10101c'. */
    var SLOT_COLORS = {
        1: [77 / 255, 210 / 255, 255 / 255],   /* #4dd2ff */
        2: [255 / 255, 210 / 255, 77 / 255],   /* #ffd24d */
        3: [255 / 255, 77 / 255, 210 / 255],   /* #ff4dd2 */
        4: [255 / 255, 140 / 255, 77 / 255],   /* #ff8c4d */
    };
    var WHITE = [1, 1, 1];                      /* #ffffff fallback */
    var BG = [16 / 255, 16 / 255, 28 / 255];    /* #10101c background */

    /* ══════════════════════════════════════════════════════════════════
       GfxGL — WebGL-1 backend behind the backend-neutral Gfx surface. This
       is the SOLE renderer: init() calls tryCreate, and a null return fails
       loudly (no 2D fallback — see the header's no-silent-fallbacks note).
       Reproduces every Gfx primitive as textured
       quads through ONE shader (pos+uv+rgba, ortho u_proj, fragment =
       texture2D * v_color, all premultiplied). Painter's order is the
       contract: the batcher NEVER reorders.

       Alpha semantics (load-bearing): per-primitive alpha is a
       straight opacity multiplier, and some callers pass PRE-multiplied
       opacity (the health-bar backdrop arrives as 0.55*ea). With
       premultiplied blending the vertex color for a solid of color
       (r,g,b) at opacity a is (r*a, g*a, b*a, a) — the single formula
       below (premul). sprite()'s r,g,b are a reserved tint channel;
       (1,1,1) = untinted; tint is a multiply, so (1,1,1,a) premultiplies
       to (a,a,a,a) and scales the (premultiplied) sheet's opacity — the
       white-flash silhouette stays correct.

       Pure math is factored into module-scope seams (orthoMatrix,
       applyOrtho, uvRect, spriteCorners, makeBatcher) exposed on
       RTRender._gl for headless unit tests (no GL needed).
       ══════════════════════════════════════════════════════════════════ */

    /* Ortho projection mapping CSS px onto clip space: (0,0)->(-1,+1),
       (viewW,viewH)->(+1,-1) (y flips: CSS y-down -> clip y-up). dpr does
       NOT enter here — it lives only in the viewport/backing-store
       relationship (begin sets gl.viewport to backing-store px). Returns a
       column-major 4x4 Float32Array (WebGL uniformMatrix4fv order). */
    function orthoMatrix(viewW, viewH) {
        var m = new Float32Array(16);
        m[0] = 2 / viewW;    /* x scale */
        m[5] = -2 / viewH;   /* y scale (flip) */
        m[10] = -1;
        m[12] = -1;          /* x translate */
        m[13] = 1;           /* y translate */
        m[15] = 1;
        return m;
    }

    /* Apply a column-major ortho matrix to a 2D point -> [ndcX, ndcY]
       (w == 1 for this affine matrix). */
    function applyOrtho(m, x, y) {
        return [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]];
    }

    /* UV rect for a sheet frame: [u0, v0, u1, v1] normalized by texture
       dimensions. */
    function uvRect(sx, sy, sw, sh, texW, texH) {
        return [sx / texW, sy / texH, (sx + sw) / texW, (sy + sh) / texH];
    }

    /* Four screen-space quad corners (TL, TR, BR, BL) for a sprite frame
       drawn at anchor (cx, cy). Reproduces Gfx2D's sprite transform
       order exactly: translate(cx,cy) . rotate(angle) . scale(mirror?-1:1)
       applied to the local frame rect whose anchor sits at the local
       origin (left=-w*anchorX .. right=w*(1-anchorX), likewise y). Mirror
       flips x about the anchor; angle rotates the whole quad about
       (cx, cy). */
    function spriteCorners(cx, cy, w, h, anchorX, anchorY, mirror, angleRad) {
        var left = -w * anchorX, right = w * (1 - anchorX);
        var top = -h * anchorY, bottom = h * (1 - anchorY);
        var cos = Math.cos(angleRad || 0), sin = Math.sin(angleRad || 0);
        var s = mirror ? -1 : 1;
        function xf(lx, ly) {
            var mx = s * lx;
            return { x: cx + mx * cos - ly * sin,
                     y: cy + mx * sin + ly * cos };
        }
        return [xf(left, top), xf(right, top),
                xf(right, bottom), xf(left, bottom)];
    }

    /* Interleaved-quad batcher over one dynamic VBO. Vertex layout is
       [x, y, u, v, r, g, b, a] (8 floats); 6 verts/quad (two triangles,
       TL-TR-BR + TL-BR-BL). Flushes (bufferSubData + drawArrays TRIANGLES)
       on: texture change, blend change, scratch full, explicit flush().
       NEVER reorders — painter's order is the contract. applyBlend(mode)
       (optional) is invoked after a flush when the blend mode changes:
       the documented flush-on-blend-change seam (only one mode is ever
       set today — the extension point for future blend modes, NOT an
       additive program here). */
    function makeBatcher(gl, maxQuads, applyBlend) {
        var FLOATS_PER_VERT = 8, VERTS_PER_QUAD = 6;
        var cap = maxQuads * VERTS_PER_QUAD * FLOATS_PER_VERT;
        var scratch = new Float32Array(cap);
        var n = 0;          /* floats written */
        var verts = 0;      /* vertices written */
        var curTex = null, curBlend = null;

        function flush() {
            if (n === 0) return;
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch.subarray(0, n));
            gl.drawArrays(gl.TRIANGLES, 0, verts);
            n = 0; verts = 0;
        }
        function setTexture(tex) {
            if (tex === curTex) return;
            flush();
            curTex = tex;
            gl.bindTexture(gl.TEXTURE_2D, tex);
        }
        function setBlend(mode) {
            if (mode === curBlend) return;
            flush();
            curBlend = mode;
            if (applyBlend) applyBlend(mode);
        }
        function reserve(nVerts) {
            if (n + nVerts * FLOATS_PER_VERT > cap) flush();
        }
        function vertex(x, y, u, v, r, g, b, a) {
            scratch[n++] = x; scratch[n++] = y;
            scratch[n++] = u; scratch[n++] = v;
            scratch[n++] = r; scratch[n++] = g;
            scratch[n++] = b; scratch[n++] = a;
            verts++;
        }
        /* One quad: pos = [TL,TR,BR,BL] {x,y}; uv = [u0,v0,u1,v1];
           col = [r,g,b,a] (already premultiplied by the caller). */
        function quad(tex, blend, pos, uv, col) {
            setTexture(tex);
            setBlend(blend);
            reserve(VERTS_PER_QUAD);
            var u0 = uv[0], v0 = uv[1], u1 = uv[2], v1 = uv[3];
            var r = col[0], g = col[1], b = col[2], a = col[3];
            vertex(pos[0].x, pos[0].y, u0, v0, r, g, b, a);
            vertex(pos[1].x, pos[1].y, u1, v0, r, g, b, a);
            vertex(pos[2].x, pos[2].y, u1, v1, r, g, b, a);
            vertex(pos[0].x, pos[0].y, u0, v0, r, g, b, a);
            vertex(pos[2].x, pos[2].y, u1, v1, r, g, b, a);
            vertex(pos[3].x, pos[3].y, u0, v1, r, g, b, a);
        }
        return { setTexture: setTexture, setBlend: setBlend,
                 reserve: reserve, vertex: vertex, quad: quad,
                 flush: flush };
    }

    var GfxGL = (function() {
        var VERT_SRC =
            'attribute vec2 a_pos;' +
            'attribute vec2 a_uv;' +
            'attribute vec4 a_color;' +
            'uniform mat4 u_proj;' +
            'varying vec2 v_uv;' +
            'varying vec4 v_color;' +
            'void main(){' +
            '  gl_Position = u_proj * vec4(a_pos, 0.0, 1.0);' +
            '  v_uv = a_uv;' +
            '  v_color = a_color;' +
            '}';
        var FRAG_SRC =
            'precision mediump float;' +
            'uniform sampler2D u_tex;' +
            'varying vec2 v_uv;' +
            'varying vec4 v_color;' +
            'void main(){' +
            '  gl_FragColor = texture2D(u_tex, v_uv) * v_color;' +
            '}';

        function compile(gl, type, src) {
            var s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                gl.deleteShader(s);
                return null;
            }
            return s;
        }
        function link(gl) {
            var vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
            var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
            if (!vs || !fs) return null;
            var p = gl.createProgram();
            gl.attachShader(p, vs);
            gl.attachShader(p, fs);
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
                gl.deleteProgram(p);
                return null;
            }
            return p;
        }

        /* 1x1 opaque premultiplied-white texture — the solid-primitive
           sampler (rect/line/ellipse/text bodies sample this so a single
           shader covers both textured and solid draws). */
        function makeWhiteTex(gl) {
            var t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA,
                gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return t;
        }

        /* 64x64 radial-alpha disc (premultiplied white: rgb == a) for
           round line caps and any soft round primitive. Built as a raw
           pixel array, so we premultiply by hand — UNPACK_PREMULTIPLY_ALPHA
           only affects DOM-element uploads, not ArrayBufferView data. */
        function makeDiscTex(gl) {
            var N = 64, px = new Uint8Array(N * N * 4);
            var c = (N - 1) / 2;
            for (var y = 0; y < N; y++) {
                for (var x = 0; x < N; x++) {
                    var dx = (x - c) / (N / 2), dy = (y - c) / (N / 2);
                    var d = Math.sqrt(dx * dx + dy * dy);
                    var a = d >= 1 ? 0 : (d <= 0.9 ? 1 : (1 - (d - 0.9) / 0.1));
                    var v = Math.round(255 * a), o = (y * N + x) * 4;
                    px[o] = v; px[o + 1] = v; px[o + 2] = v; px[o + 3] = v;
                }
            }
            var t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA,
                gl.UNSIGNED_BYTE, px);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return t;
        }

        /* Factory: null on ANY failure (caller falls back to 2D). */
        function tryCreate(canvas) {
            try {
                if (!canvas || !canvas.getContext) return null;
                var opts = {
                    powerPreference: 'high-performance',
                    alpha: false, antialias: false,
                    premultipliedAlpha: true,
                    preserveDrawingBuffer: false,
                    desynchronized: true,
                    failIfMajorPerformanceCaveat: false,
                };
                var gl = canvas.getContext('webgl', opts) ||
                         canvas.getContext('experimental-webgl', opts);
                if (!gl) return null;
                return build(canvas, gl);
            } catch (e) {
                return null;
            }
        }

        function build(canvas, gl) {
            var program = null, loc = null, vbo = null, batcher = null;
            var whiteTex = null, discTex = null;
            var texCache = null;   /* source object -> {tex, w, h} */
            var textCache = null;  /* str@size -> offscreen canvas */
            var lost = false;
            var vW = 0, vH = 0;

            /* premultiplied vertex color for opacity a (straight
               multiplier); tint (r,g,b) folds in identically. */
            function premul(r, g, b, a) { return [r * a, g * a, b * a, a]; }

            function applyBlend() {
                /* single mode today: premultiplied over. */
                gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            }

            function createGpuResources() {
                program = link(gl);
                if (!program) { lost = true; return false; }
                loc = {
                    pos: gl.getAttribLocation(program, 'a_pos'),
                    uv: gl.getAttribLocation(program, 'a_uv'),
                    color: gl.getAttribLocation(program, 'a_color'),
                    proj: gl.getUniformLocation(program, 'u_proj'),
                    tex: gl.getUniformLocation(program, 'u_tex'),
                };
                var MAX_QUADS = 4096;
                vbo = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
                gl.bufferData(gl.ARRAY_BUFFER,
                    MAX_QUADS * 6 * 8 * 4, gl.DYNAMIC_DRAW);
                batcher = makeBatcher(gl, MAX_QUADS, applyBlend);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                whiteTex = makeWhiteTex(gl);
                discTex = makeDiscTex(gl);
                texCache = (typeof Map !== 'undefined') ? new Map() : null;
                textCache = {};
                lost = false;
                return true;
            }

            /* Context loss: log once, no-op draws until restored; on
               restore rebuild program/buffers and drop the texture cache
               so every source lazily re-uploads. */
            var loggedLoss = false;
            canvas.addEventListener('webglcontextlost', function(e) {
                e.preventDefault();
                lost = true;
                if (!loggedLoss && typeof console !== 'undefined') {
                    loggedLoss = true;
                    console.log('RTRender: WebGL context lost');
                }
            }, false);
            canvas.addEventListener('webglcontextrestored', function() {
                createGpuResources();
            }, false);

            if (!createGpuResources()) return null;

            /* Texture cache keyed by source identity. Lazy upload; re-upload
               when the source's dimensions changed (the sashimi ground
               canvas goes 0x0 -> painted) or on invalidate(). Images skip
               while naturalWidth===0 (matches Gfx2D's undecoded-image skip);
               canvases with 0 area skip too. */
            function dimsOf(src) {
                if (src.naturalWidth !== undefined)   /* HTMLImageElement */
                    return { w: src.naturalWidth, h: src.naturalHeight };
                return { w: src.width, h: src.height }; /* HTMLCanvasElement */
            }
            function texFor(src) {
                if (!texCache) return null;
                var d = dimsOf(src);
                if (!d.w || !d.h) return null;   /* undecoded / unpainted */
                var e = texCache.get(src);
                if (!e) {
                    var t = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, t);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
                        gl.UNSIGNED_BYTE, src);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    e = { tex: t, w: d.w, h: d.h };
                    texCache.set(src, e);
                } else if (e.w !== d.w || e.h !== d.h) {
                    gl.bindTexture(gl.TEXTURE_2D, e.tex);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
                        gl.UNSIGNED_BYTE, src);
                    e.w = d.w; e.h = d.h;
                }
                return e;
            }

            function fullUV() { return [0, 0, 1, 1]; }

            function api() { return {
                backend: 'webgl',
                renderer: rendererStr,
                begin: function(viewW, viewH, dpr) {
                    if (lost) return;
                    vW = viewW; vH = viewH;
                    gl.viewport(0, 0, canvas.width, canvas.height);
                    gl.useProgram(program);
                    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
                    var stride = 8 * 4;
                    gl.enableVertexAttribArray(loc.pos);
                    gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, stride, 0);
                    gl.enableVertexAttribArray(loc.uv);
                    gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, stride, 8);
                    gl.enableVertexAttribArray(loc.color);
                    gl.vertexAttribPointer(loc.color, 4, gl.FLOAT, false, stride, 16);
                    gl.uniformMatrix4fv(loc.proj, false,
                        orthoMatrix(viewW, viewH));
                    gl.activeTexture(gl.TEXTURE0);
                    gl.uniform1i(loc.tex, 0);
                    gl.disable(gl.DEPTH_TEST);
                    gl.enable(gl.BLEND);
                    batcher.setBlend('normal');
                },
                clear: function(r, g, b) {
                    if (lost) return;
                    gl.clearColor(r, g, b, 1);
                    gl.clear(gl.COLOR_BUFFER_BIT);
                },
                flush: function() { if (!lost) batcher.flush(); },
                invalidate: function(source) {
                    if (texCache && source) texCache['delete'](source);
                },
                image: function(source, dx, dy, dw, dh) {
                    if (lost) return;
                    var e = texFor(source);
                    if (!e) return;
                    var pos = [{ x: dx, y: dy }, { x: dx + dw, y: dy },
                               { x: dx + dw, y: dy + dh }, { x: dx, y: dy + dh }];
                    batcher.quad(e.tex, 'normal', pos, fullUV(), [1, 1, 1, 1]);
                },
                sprite: function(source, sx, sy, sw, sh, cx, cy, w, h,
                                 anchorX, anchorY, mirror, angleRad, r, g, b, a) {
                    if (lost) return;
                    var e = texFor(source);
                    if (!e) return;   /* undecoded sheet: skip (Gfx2D parity) */
                    var pos = spriteCorners(cx, cy, w, h, anchorX, anchorY,
                                            !!mirror, angleRad || 0);
                    var uv = uvRect(sx, sy, sw, sh, e.w, e.h);
                    batcher.quad(e.tex, 'normal', pos, uv, premul(r, g, b, a));
                },
                rect: function(x, y, w, h, r, g, b, a) {
                    if (lost) return;
                    var pos = [{ x: x, y: y }, { x: x + w, y: y },
                               { x: x + w, y: y + h }, { x: x, y: y + h }];
                    batcher.quad(whiteTex, 'normal', pos, fullUV(),
                                 premul(r, g, b, a));
                },
                line: function(x0, y0, x1, y1, widthPx, round, r, g, b, a) {
                    if (lost) return;
                    var dx = x1 - x0, dy = y1 - y0;
                    var len = Math.sqrt(dx * dx + dy * dy) || 1;
                    var hw = widthPx / 2;
                    var nx = -dy / len * hw, ny = dx / len * hw;
                    var col = premul(r, g, b, a);
                    var pos = [{ x: x0 + nx, y: y0 + ny },
                               { x: x1 + nx, y: y1 + ny },
                               { x: x1 - nx, y: y1 - ny },
                               { x: x0 - nx, y: y0 - ny }];
                    batcher.quad(whiteTex, 'normal', pos, fullUV(), col);
                    if (round) {
                        cap(x0, y0, hw, col); cap(x1, y1, hw, col);
                    }
                },
                ellipseStroke: function(cx, cy, rx, ry, widthPx, r, g, b, a) {
                    if (lost) return;
                    var col = premul(r, g, b, a);
                    var hw = widthPx / 2;
                    var segs = Math.max(24,
                        Math.ceil(2 * Math.PI * Math.max(rx, ry) / 4));
                    var uv = fullUV();
                    var prev = ringPt(cx, cy, rx, ry, hw, 0);
                    for (var i = 1; i <= segs; i++) {
                        var cur = ringPt(cx, cy, rx, ry, hw, i / segs * Math.PI * 2);
                        batcher.quad(whiteTex, 'normal',
                            [prev.o, cur.o, cur.i, prev.i], uv, col);
                        prev = cur;
                    }
                },
                text: function(str, cx, cy, sizePx, r, g, b, a) {
                    if (lost) return;
                    var tc = textTex(str, sizePx);
                    if (!tc) return;
                    var e = texFor(tc.canvas);
                    if (!e) return;
                    var x = cx - tc.w / 2, y = cy - tc.baseline;
                    var pos = [{ x: x, y: y }, { x: x + tc.w, y: y },
                               { x: x + tc.w, y: y + tc.h }, { x: x, y: y + tc.h }];
                    batcher.quad(e.tex, 'normal', pos, fullUV(),
                                 premul(r, g, b, a));
                },
            }; }

            function cap(x, y, hw, col) {
                var pos = [{ x: x - hw, y: y - hw }, { x: x + hw, y: y - hw },
                           { x: x + hw, y: y + hw }, { x: x - hw, y: y + hw }];
                batcher.quad(discTex, 'normal', pos, [0, 0, 1, 1], col);
            }
            function ringPt(cx, cy, rx, ry, hw, ang) {
                var c = Math.cos(ang), s = Math.sin(ang);
                return {
                    o: { x: cx + (rx + hw) * c, y: cy + (ry + hw) * s },
                    i: { x: cx + (rx - hw) * c, y: cy + (ry - hw) * s },
                };
            }

            /* Per-(string, sizePx-bucket) offscreen-2D text texture:
               'bold Npx monospace', WHITE (tinted by the vertex color),
               centered. Cached by str + size bucket so the canvas identity
               is stable for the texture cache. */
            function textTex(str, sizePx) {
                if (typeof document === 'undefined') return null;
                var bucket = Math.round(sizePx);
                var key = str + '@' + bucket;
                var meta = textCache[key];
                if (meta) return meta;
                var cv = document.createElement('canvas');
                var g = cv.getContext('2d');
                g.font = 'bold ' + bucket + 'px monospace';
                var w = Math.max(1, Math.ceil(g.measureText(str).width));
                var h = Math.ceil(bucket * 1.5);
                var baseline = Math.round(bucket * 1.15);
                cv.width = w; cv.height = h;
                g = cv.getContext('2d');
                g.font = 'bold ' + bucket + 'px monospace';
                g.textAlign = 'center';
                g.textBaseline = 'alphabetic';
                g.fillStyle = '#fff';
                g.fillText(str, w / 2, baseline);
                meta = { canvas: cv, w: w, h: h, baseline: baseline };
                textCache[key] = meta;
                return meta;
            }

            /* GPU renderer string (best effort; '' when the debug ext is
               unavailable). Read once at build. */
            var rendererStr = '';
            try {
                var dbg = gl.getExtension('WEBGL_debug_renderer_info');
                if (dbg) rendererStr = gl.getParameter(
                    dbg.UNMASKED_RENDERER_WEBGL) || '';
            } catch (e2) { rendererStr = ''; }

            return api();
        }

        return { tryCreate: tryCreate };
    })();

    /* No-WebGL failure message (root CLAUDE.md decision 12: no silent
       fallbacks). Written into a DOM overlay over the canvas when the caller
       supplies no cfg.onUnsupported. Guarded for Node-safety. */
    var WEBGL_UNSUPPORTED_MSG =
        'This game requires WebGL, which this browser does not provide ' +
        '(or hardware acceleration is disabled). Enable hardware ' +
        'acceleration or try a different browser.';

    function showCanvasError(canvas, msg) {
        if (typeof console !== 'undefined' && console.error)
            console.error('RTRender: ' + msg);
        try {
            if (typeof document === 'undefined' || !canvas ||
                !canvas.parentNode) return;
            var el = document.createElement('div');
            el.setAttribute('role', 'alert');
            el.textContent = msg;
            el.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;' +
                'display:flex;align-items:center;justify-content:center;' +
                'text-align:center;padding:24px;box-sizing:border-box;' +
                'font-family:monospace;font-size:15px;line-height:1.5;' +
                'color:#eee;background:#10101c;z-index:9999;';
            canvas.parentNode.appendChild(el);
        } catch (e) { /* last resort: the console.error above */ }
    }

    /* Loud, no-silent-fallback failure path shared by init and
       createSurface (root CLAUDE.md decision 12): surface a plain
       user-visible explanation via cfg.onUnsupported (else a DOM overlay
       over the canvas). */
    function failUnsupported(canvas, cfg) {
        if (cfg.onUnsupported) {
            try { cfg.onUnsupported(WEBGL_UNSUPPORTED_MSG); }
            catch (e) { /* client handler failed; the overlay is the
                           safety net */ showCanvasError(canvas,
                           WEBGL_UNSUPPORTED_MSG); }
        } else {
            showCanvasError(canvas, WEBGL_UNSUPPORTED_MSG);
        }
    }

    /* Surface-only consumption path (avk): create just the backend-neutral
       Gfx draw surface — no camera, tilemap, or frame loop (init bundles
       those, which is the wrong fit for a turn-based, fixed-internal-
       resolution client that owns its own rAF loop and view state). Returns
       the gfx object on success, or null after failing loudly (same
       WebGL-required contract as init). Module scope stays Node-safe: no
       GL/DOM touched at load; tryCreate is the sole GL entry point. */
    function createSurface(cfg) {
        var canvas = cfg.canvas;
        var gfx = GfxGL.tryCreate(canvas);
        if (!gfx) {
            failUnsupported(canvas, cfg);
            return null;
        }
        return gfx;
    }

    function init(cfg) {
        var canvas = cfg.canvas;

        /* WebGL is the SOLE backend. tryCreate returns null on ANY failure
           (no WebGL context, driver failure, hardware acceleration disabled);
           we then fail LOUDLY — surface a plain user-visible explanation and
           return null so the caller aborts bootstrap (root CLAUDE.md decision
           12: no silent fallbacks). There is no 2D fallback and no ?render
           override. */
        var gfx = GfxGL.tryCreate(canvas);
        if (!gfx) {
            failUnsupported(canvas, cfg);
            return null;
        }
        var curDpr = window.devicePixelRatio || 1;  /* set each resize(),
                                                        read by frame()'s
                                                        gfx.begin */
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
              The GL backing store is devicePixelRatio-scaled; drawing code
              works in CSS px, handed to the GL projection each frame via
              gfx.begin(viewW, viewH, dpr). tilePx adapts on small (phone)
              viewports when cfg.minTilesVisible is set, so portrait and
              landscape both keep a playable field of view. ── */
        function resize() {
            var dpr = window.devicePixelRatio || 1;
            /* Optional backing-store resolution cap: fewer pixels for the GL
               backend to fill per frame on weak/integrated GPUs (cfg.dprCap;
               absent -> no cap). Capped at the single point dpr is read; the
               GL viewport (set in begin() from canvas.width/height) shrinks
               with it, and all layout/scale math below is unchanged. */
            if (cfg.dprCap) dpr = Math.min(dpr, cfg.dprCap);
            curDpr = dpr;   /* captured for frame()'s gfx.begin */
            viewW = window.innerWidth;
            viewH = window.innerHeight;
            canvas.width = Math.round(viewW * dpr);
            canvas.height = Math.round(viewH * dpr);
            canvas.style.width = viewW + 'px';
            canvas.style.height = viewH + 'px';
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

        /* ea = the unit's effective draw alpha (1 unless alphaFor dimmed it).
           The old code drew the bars with ctx.globalAlpha == ea in force, so
           fold ea into each fill: the 0.55 backdrop nets 0.55*ea, the opaque
           bar nets ea — identical compositing to globalAlpha multiplication. */
        function drawHealthBar(sx, sy, w, pct, ea) {
            var h = 4;
            var x = sx - w / 2, y = sy;
            gfx.rect(x - 1, y - 1, w + 2, h + 2, 0, 0, 0, 0.55 * ea);
            var g = Math.round(200 * pct), r = Math.round(220 * (1 - pct) + 35);
            gfx.rect(x, y, Math.max(0, w * pct), h, r / 255, g / 255, 40 / 255, ea);
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

            /* Per-frame Gfx setup (GL program/attribs bound, projection set
               from viewW/viewH, backing-store viewport from curDpr). */
            gfx.begin(viewW, viewH, curDpr);

            /* Background */
            gfx.clear(BG[0], BG[1], BG[2]);
            var mx0 = worldToScreenX(0), my0 = worldToScreenY(0);
            gfx.image(groundLayer(), mx0, my0, mapW * tilePx, mapH * tilePx);

            /* Optional effects passes (additive hooks; see the sprite-hook
               comment below). Both receive (gfx, view, tSec): the
               backend-neutral Gfx surface and a screen-projection view:
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
            if (cfg.effectsUnder) cfg.effectsUnder(gfx, fxv, t);

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
                        RTSprites.draw(gfx, cfg.unitDefs[un.def],
                                       un.state || 'idle', un.dir || 'S',
                                       un.t === undefined ? t : un.t,
                                       d.sx, d.sy,
                                       un.sizePx || sizePx, 0,
                                       Math.max(0, Math.min(1, ua)));
                    }
                }

                /* ea = this unit's effective alpha; the old code held it in
                   ctx.globalAlpha across the ring, sprite, health bar and
                   label, so pass it into each of those draws. Overlay/underlay
                   keep their own independent opacity. */
                var alpha = cfg.alphaFor ? cfg.alphaFor(u2, t) : 1;
                var ea = alpha !== 1 ? Math.max(0, Math.min(1, alpha)) : 1;

                /* player slot ring under the sprite */
                if (u2.slot > 0) {
                    var rc = SLOT_COLORS[u2.slot] || WHITE;
                    gfx.ellipseStroke(d.sx, d.sy, sizePx * 0.28, sizePx * 0.12,
                                      2, rc[0], rc[1], rc[2], ea);
                }

                var animT = cfg.animTimeFor ? cfg.animTimeFor(u2, t)
                                            : t + u2.animPhase;
                var angle = def.rotate
                    ? Math.atan2(u2.faceY || 0, u2.faceX || 1) : 0;
                RTSprites.draw(gfx, def, state, dir, animT, d.sx, d.sy,
                               sizePx, angle, ea);

                /* overlay (drawn right after the sprite, own opacity) */
                var ov = cfg.overlayFor ? cfg.overlayFor(u2, tilePx, t) : null;
                if (ov && cfg.unitDefs[ov.def]) {
                    var oa = ov.alpha === undefined ? 1 : ov.alpha;
                    if (oa > 0) {
                        RTSprites.draw(gfx, cfg.unitDefs[ov.def],
                                       ov.state || state, ov.dir || dir,
                                       ov.t === undefined ? animT : ov.t,
                                       d.sx, d.sy,
                                       ov.sizePx || sizePx, angle,
                                       Math.max(0, Math.min(1, oa)));
                    }
                }

                /* health bar above the sprite (entities without a health
                   pool — maxHealth 0 — draw none) */
                var bar = cfg.barFor ? cfg.barFor(u2, tilePx) : null;
                var barY = d.sy - (bar ? bar.dy : sizePx * 0.95);
                if (u2.maxHealth > 0) {
                    var pct = u2.health / u2.maxHealth;
                    drawHealthBar(d.sx, barY, bar ? bar.w : sizePx * 0.6,
                                  Math.max(0, Math.min(1, pct)), ea);
                }

                /* player label */
                if (u2.slot > 0) {
                    var lc = SLOT_COLORS[u2.slot] || WHITE;
                    gfx.text('P' + u2.slot, d.sx,
                             bar ? barY - 5 : d.sy - sizePx * 1.05,
                             Math.round(tilePx * 0.25),
                             lc[0], lc[1], lc[2], ea);
                }
            }

            if (cfg.effectsOver) cfg.effectsOver(gfx, fxv, t);
            gfx.flush();
        }

        /* backend/renderer expose the active Gfx backend and GPU renderer
           string (the CLI state() surfaces these). */
        return { frame: frame, resize: resize, camera: cam,
                 backend: gfx.backend, renderer: gfx.renderer };
    }

    /* _gl: pure GfxGL math seams, exported for headless unit tests
       (test_rt_gfx.js) — no GL context required. */
    return { init: init, createSurface: createSurface, _gl: {
        orthoMatrix: orthoMatrix,
        applyOrtho: applyOrtho,
        uvRect: uvRect,
        spriteCorners: spriteCorners,
        makeBatcher: makeBatcher,
    } };
})();
