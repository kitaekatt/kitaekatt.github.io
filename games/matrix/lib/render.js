// Matrix shared rendering helpers — math, grid, pending-spawn overlay,
// capability constants. Consumed by both web/matrix and clients/wasm-rt.

const CAP = {
    Move: 0, Evade: 1, Rotate: 2, TagRight: 3, TagLeft: 4,
    TagFwdAtRange: 5, BlockForward: 6, BlockRight: 7, BlockLeft: 8,
};

const CAP_COMPONENT_NAMES = [
    'Move', 'Evade', 'Rotate', 'TagRight', 'TagLeft',
    'TagForwardAtRange', 'BlockForward', 'BlockRight', 'BlockLeft',
];

const FACING_DEG = [0, 90, 180, 270];

// GL₃(F₂) — invertible 3×3 matrices over F₂. Used by the spawner to pick a
// random valid capability matrix.
function detMod2(bits) {
    const a=(bits>>0)&1, b=(bits>>1)&1, c=(bits>>2)&1;
    const d=(bits>>3)&1, e=(bits>>4)&1, f=(bits>>5)&1;
    const g=(bits>>6)&1, h=(bits>>7)&1, k=(bits>>8)&1;
    return (a*(e*k-f*h) - b*(d*k-f*g) + c*(d*h-e*g)) & 1;
}

const VALID_MATRICES = (() => {
    const out = [];
    for (let b = 0; b < 512; b++) if (detMod2(b)) out.push(b);
    return out;
})();

function packCaps(components) {
    let bits = 0;
    for (let i = 0; i < CAP_COMPONENT_NAMES.length; i++) {
        if (components[CAP_COMPONENT_NAMES[i]] !== undefined) bits |= (1 << i);
    }
    return bits;
}

// Phase progress: returns 0 before phase, 1 after, linear in between.
function phaseT(p, phase) {
    if (p < phase.start) return 0;
    if (p >= phase.end) return 1;
    return (p - phase.start) / (phase.end - phase.start);
}

function hexToRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

// Hex string -> [r, g, b] as 0..1 floats. The Gfx surface takes float rgba,
// not CSS color strings.
function hexToRgbF(hex) {
    const p = hexToRgb(hex);
    return [p.r / 255, p.g / 255, p.b / 255];
}

// Dashed polyline through the Gfx surface: no ctx.setLineDash on the WebGL
// surface, so the dash pattern is walked along the path and each "on" span is
// a gfx.line segment. `pts` is a list of {x,y}; when `closed`, the last point
// connects back to the first and the dash phase carries continuously across
// every corner (matching canvas strokeRect, which strokes the rectangle as one
// dashed subpath). Butt-capped segments leave sub-pixel gaps at corners — with
// a 2px stroke on a small spawn marker this is not perceptible, and the dashes
// break the outline regardless.
function drawDashedPath(gfx, pts, closed, width, dash, r, g, b, a) {
    const on = dash[0], off = dash[1];
    const segCount = closed ? pts.length : pts.length - 1;
    let drawnOn = true;      // dash pattern starts "on"
    let rem = on;            // length remaining in the current phase span
    for (let i = 0; i < segCount; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) continue;
        const ux = dx / len, uy = dy / len;
        let pos = 0;
        while (pos < len - 1e-6) {
            const step = Math.min(rem, len - pos);
            if (drawnOn) {
                gfx.line(p0.x + ux * pos, p0.y + uy * pos,
                         p0.x + ux * (pos + step), p0.y + uy * (pos + step),
                         width, false, r, g, b, a);
            }
            pos += step; rem -= step;
            if (rem <= 1e-6) { drawnOn = !drawnOn; rem = drawnOn ? on : off; }
        }
    }
}

function lerpColor(a, b, t) {
    const pa = hexToRgb(a), pb = hexToRgb(b);
    return `rgb(${Math.round(pa.r + (pb.r - pa.r) * t)},`
         + `${Math.round(pa.g + (pb.g - pa.g) * t)},`
         + `${Math.round(pa.b + (pb.b - pa.b) * t)})`;
}

// Clear background, draw grid, return origin offsets {offX, offY} for cell math.
// The client must call gfx.begin(...) before this and gfx.flush() after the
// frame; drawGrid issues the background clear (must precede all batched draws)
// and the grid lines.
function drawGrid(gfx, canvas, mapW, mapH, CELL, colors) {
    const bg = hexToRgbF(colors.background);
    gfx.clear(bg[0], bg[1], bg[2]);
    const offX = Math.floor((canvas.width - mapW * CELL) / 2);
    const offY = Math.floor((canvas.height - mapH * CELL) / 2) + 20;
    const g = hexToRgbF(colors.grid);
    for (let x = 0; x <= mapW; x++) {
        gfx.line(offX + x * CELL, offY, offX + x * CELL, offY + mapH * CELL,
                 0.5, false, g[0], g[1], g[2], 1);
    }
    for (let y = 0; y <= mapH; y++) {
        gfx.line(offX, offY + y * CELL, offX + mapW * CELL, offY + y * CELL,
                 0.5, false, g[0], g[1], g[2], 1);
    }
    return { offX, offY };
}

// Hollow green dashed marker for spawn requests waiting for the next turn.
function drawPendingSpawns(gfx, origin, pendingSpawns, CELL, colors) {
    if (!pendingSpawns || pendingSpawns.length === 0) return;
    const size = Math.max(4, CELL * 0.5);
    const offset = (CELL - size) / 2;
    const g = hexToRgbF(colors.tint_transform_gain);
    for (const p of pendingSpawns) {
        if (p.x <= 0 || p.y <= 0) continue;
        const px = origin.offX + (p.x - 1) * CELL + offset;
        const py = origin.offY + (p.y - 1) * CELL + offset;
        // Translucent fill (was globalAlpha 0.3 + fillRect).
        gfx.rect(px, py, size, size, g[0], g[1], g[2], 0.3);
        // Dashed outline (was globalAlpha 0.9 + lineWidth 2 + setLineDash([3,3])
        // + strokeRect). Four corners, closed, continuous dash phase.
        drawDashedPath(gfx, [
            { x: px,        y: py },
            { x: px + size, y: py },
            { x: px + size, y: py + size },
            { x: px,        y: py + size },
        ], true, 2, [3, 3], g[0], g[1], g[2], 0.9);
    }
}

// Resize canvas to fill window; recompute CELL to fit map. Returns CELL.
function resizeCanvas(canvas, mapW, mapH, CELL_MIN) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (mapW > 0 && mapH > 0) {
        return Math.max(CELL_MIN, Math.min(
            Math.floor((canvas.width - 20) / mapW),
            Math.floor((canvas.height - 50) / mapH),
        ));
    }
    return CELL_MIN;
}

// Default color palette. Clients can override fields by passing a partial
// object to `Object.assign(COL_DEFAULTS, override)` or loading from YAML.
const COL_DEFAULTS = {
    background: '#000000',
    grid: '#1a1a2e',
    tint_idle: '#888899',
    tint_attack: '#dd4444',
    tint_active: '#4488dd',
    tint_transform_gain: '#44cc66',
    tint_transform_lose: '#dd4444',
    tint_warn: '#ff8822',
    tint_cooldown: '#666670',
};

// Surface errors loudly — paint them over the canvas so they can't be missed
// in the common "I glanced at the browser and nothing looked wrong" failure.
function showFatal(err) {
    console.error(err);
    const loading = document.getElementById('loading');
    if (loading) {
        loading.style.display = '';
        loading.style.color = '#ff4444';
        loading.style.background = '#220000';
        loading.style.padding = '1em';
        loading.style.whiteSpace = 'pre-wrap';
        loading.textContent = 'FATAL: ' + (err && err.stack ? err.stack : String(err));
    }
    throw err;
}
