// Matrix sprite system — shared between web/matrix and sandboxes/matrix/clients/wasm-rt.
//
// Defines SPRITES (registry), SPRITE_NAMES (key → bitmap filename), TINT_VARIANTS
// (named tint colors), and the tinting / loading / drawing primitives.
// Clients call:
//   loadSprites(basePath)  → Promise resolved when all bitmaps are loaded
//   buildTints(colors)     → produces tinted canvases using a colors object
//   drawSprite(ctx, sprite, tint, x, y, size)  → blits a tinted canvas
//
// The tinting strategy is fill-and-mask: fill a canvas with the tint color,
// then use the source bitmap's alpha channel as a mask (composite mode
// 'destination-in'). Source RGB is discarded — only alpha shapes matter.

const SPRITES = {};

const SPRITE_NAMES = {
    ship: 'Ship',
    move: 'MoveForward',
    evade: 'MoveEvade',
    rotate: 'MoveRotate',
    tagRight: 'AttackRight',
    tagLeft: 'AttackLeft',
    tagForward: 'AttackForward',
    tagFwdAtRange: 'AttackForwardAtRange',
    blockForward: 'BlockForward',
    blockRight: 'BlockRight',
    blockLeft: 'BlockLeft',
};

// Every tint variant the renderer is allowed to request. Keep in sync with any
// new phaseTint return values. Adding a tint here and forgetting to wire its
// color throws at buildTints time, not silently at draw time.
const TINT_VARIANTS = [
    ['idle',     'tint_idle'],
    ['attack',   'tint_attack'],
    ['active',   'tint_active'],
    ['gain',     'tint_transform_gain'],
    ['lose',     'tint_transform_lose'],
    ['warn',     'tint_warn'],
    ['cooldown', 'tint_cooldown'],
];

function tintImage(img, color, label) {
    if (!img) throw new Error(`tintImage: no image (label=${label})`);
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
        throw new Error(`tintImage: invalid color ${JSON.stringify(color)} (label=${label})`);
    }
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    if (!c.width || !c.height) {
        throw new Error(`tintImage: zero-size image (label=${label}, size=${c.width}x${c.height})`);
    }
    const cx = c.getContext('2d');
    cx.fillStyle = color;
    cx.fillRect(0, 0, c.width, c.height);
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(img, 0, 0);
    return c;
}

function buildTints(colors) {
    for (const [key, filename] of Object.entries(SPRITE_NAMES)) {
        const img = SPRITES[key]?.raw;
        if (!img) {
            throw new Error(`buildTints: sprite '${key}' (${filename}.png) failed to load`);
        }
        for (const [variant, colorKey] of TINT_VARIANTS) {
            const color = colors[colorKey];
            if (!color) {
                throw new Error(`buildTints: color '${colorKey}' missing for tint '${variant}' (sprite=${key})`);
            }
            SPRITES[key][variant] = tintImage(img, color, `${key}:${variant}`);
        }
    }
}

function drawSprite(ctx, sprite, tint, x, y, size) {
    if (!sprite) throw new Error(`drawSprite: null sprite (tint=${tint})`);
    if (!sprite[tint]) {
        const spriteKey = Object.keys(SPRITES).find(k => SPRITES[k] === sprite) || '?';
        const available = Object.keys(sprite).filter(k => k !== 'raw').join(',');
        throw new Error(`drawSprite: sprite '${spriteKey}' has no tint variant '${tint}' (have: ${available})`);
    }
    ctx.drawImage(sprite[tint], x, y, size, size);
}

function loadSprites(basePath) {
    const promises = [];
    for (const [key, filename] of Object.entries(SPRITE_NAMES)) {
        const img = new Image();
        SPRITES[key] = { raw: null };
        const src = `${basePath}/${filename}.png`;
        const p = new Promise((resolve, reject) => {
            img.onload = () => { SPRITES[key].raw = img; resolve(); };
            img.onerror = () => reject(new Error(`loadSprites: failed to load '${src}' (sprite key='${key}')`));
        });
        img.src = src;
        promises.push(p);
    }
    return Promise.all(promises);
}
