// Matrix unit renderer — single source of truth for unit drawing.
//
// Accepts a feature-rich view-unit object. Fields the data layer doesn't
// supply default to falsy/zero, in which case the corresponding animation is
// suppressed (capability still draws idle/cooldown based on caps). This lets
// the WASM client render sprites today while exposing only a subset of fields,
// and the REST client fully animates intents/activations using the same code.
//
// Required fields: x, y, prevX, prevY, facing, prevFacing, caps, gained, lost,
// transformed, blockFwdTurns, blockRightTurns, blockLeftTurns, evadeTurns.
// Optional fields: moveActivated, moveFailed, evadeActivated, evadeFailed,
// taggedFwd, taggedRight, taggedLeft, fwdRange, hasTagForward.

const MOVEMENT_FACTOR = 0.3;
const UNIT_SCALE = 1.0;

function _phaseTint(activated, failed, tPhase, activeTint) {
    if (activated) {
        if (tPhase >= 1) return 'cooldown';
        if (tPhase <= 0) return 'idle';
        return activeTint || 'active';
    }
    if (failed && tPhase > 0 && tPhase < 1) return 'warn';
    return 'idle';
}

function _blockTint(turns, tPhase) {
    if (turns === 2) {
        if (tPhase >= 1) return 'cooldown';
        if (tPhase <= 0) return 'idle';
        return 'active';
    }
    if (turns === 1) return 'cooldown';
    return 'idle';
}

function _evadeTint(turns, failed, tPhase) {
    if (turns === 2) {
        if (tPhase >= 1) return 'cooldown';
        if (tPhase <= 0) return 'idle';
        return 'active';
    }
    if (turns === 1) return 'cooldown';
    if (failed && tPhase > 0 && tPhase < 1) return 'warn';
    return 'idle';
}

// Two-phase position interpolation: movement phase moves prev → mid (using
// pre-rotate facing delta when MoveActivated), tag phase moves mid → current
// (evade displacement). Falls back to a single linear interp when activation
// data is absent (WASM client today).
function _interpPosition(u, tMove, tTag) {
    if (u.moveActivated) {
        const mdx = [0, 1, 0, -1][u.prevFacing] || 0;
        const mdy = [-1, 0, 1, 0][u.prevFacing] || 0;
        const midX = u.prevX + mdx;
        const midY = u.prevY + mdy;
        return {
            ix: u.prevX + (midX - u.prevX) * tMove + (u.x - midX) * tTag,
            iy: u.prevY + (midY - u.prevY) * tMove + (u.y - midY) * tTag,
        };
    }
    return {
        ix: u.prevX + (u.x - u.prevX) * tMove,
        iy: u.prevY + (u.y - u.prevY) * tMove,
    };
}

function _interpFacing(u, tRotate) {
    const prevDeg = FACING_DEG[u.prevFacing] || 0;
    const curDeg = FACING_DEG[u.facing] || 0;
    let diff = curDeg - prevDeg;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return prevDeg + diff * tRotate;
}

function drawUnit(gfx, u, origin, CELL, phases) {
    const { tMove, tRotate, tTag, tTransform } = phases;
    const { ix, iy } = _interpPosition(u, tMove, tTag);
    const size = Math.floor(CELL * UNIT_SCALE);
    if (size < 2) return;
    // Unit center in world (canvas) space. The old code did
    // translate(px + size/2, py + size/2) with px = offX + (ix-1)*CELL + pad and
    // pad = (CELL-size)/2, so the center reduces to offX + (ix-1)*CELL + CELL/2,
    // independent of size.
    const cx0 = origin.offX + (ix - 1) * CELL + CELL / 2;
    const cy0 = origin.offY + (iy - 1) * CELL + CELL / 2;
    const rad = _interpFacing(u, tRotate) * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);

    // Blit a sprite whose center sits at local offset (dx, dy) in the unit's
    // rotated frame (after ctx.rotate(rad) in the old code), scaled by `scale`
    // and drawn at `alpha`. Maps the old translate(cx0,cy0).rotate(rad).
    // scale(scale).drawSprite(-half,-half,size) exactly: the local center (dx,dy)
    // rotates into world space, the sprite itself carries the same rotation, and
    // scale becomes the drawn size (transform draws use dx=dy=0, so scale-about-
    // origin only affects size; offset draws use scale=1).
    function blit(sprite, tint, dx, dy, scale, alpha) {
        const wcx = cx0 + dx * cos - dy * sin;
        const wcy = cy0 + dx * sin + dy * cos;
        drawSprite(gfx, sprite, tint, wcx, wcy, size * scale, rad, alpha);
    }

    const isAnimating = (t) => t > 0 && t < 1;
    const isTransformed = u.transformed && isAnimating(tTransform);
    const rotated = u.prevFacing !== u.facing;

    // Ship body — during transform, old body shrinks out (lose) and new body grows in (gain).
    if (isTransformed) {
        blit(SPRITES.ship, 'lose', 0, 0, 1 - 0.9 * tTransform, 1 - tTransform);
        blit(SPRITES.ship, 'gain', 0, 0, 0.1 + 0.9 * tTransform, tTransform);
    } else {
        blit(SPRITES.ship, 'idle', 0, 0, 1, 1);
    }

    // Capability bitmap. dx/dy shift the sprite in the unit's local frame
    // (after rotation): local -y is forward, +x is right, -x is left.
    function drawCap(bit, spriteKey, activeTint, dx = 0, dy = 0) {
        const has = (u.caps >> bit) & 1;
        const gained = (u.gained >> bit) & 1;
        const lost = (u.lost >> bit) & 1;
        const sprite = SPRITES[spriteKey];
        if (!sprite) return;

        if (gained && isAnimating(tTransform)) {
            blit(sprite, 'gain', 0, 0, 0.1 + 0.9 * tTransform, tTransform);
        } else if (lost && isAnimating(tTransform)) {
            blit(sprite, 'lose', 0, 0, 1 - 0.9 * tTransform, 1 - tTransform);
        } else if (has) {
            blit(sprite, activeTint, dx, dy, 1, 1);
        }
    }

    const fwdRange = u.fwdRange || 1;
    const fwdPeak = CELL * (fwdRange === 2 ? (1 + MOVEMENT_FACTOR) : MOVEMENT_FACTOR);
    const sidePeak = CELL * MOVEMENT_FACTOR;
    const lungeActive = tTag > 0 && tTag < 1;
    const lungeFwd   = (u.taggedFwd   && lungeActive) ? fwdPeak  * tTag : 0;
    const lungeRight = (u.taggedRight && lungeActive) ? sidePeak * tTag : 0;
    const lungeLeft  = (u.taggedLeft  && lungeActive) ? sidePeak * tTag : 0;

    drawCap(CAP.Move,         'move',         _phaseTint(u.moveActivated,  u.moveFailed,  tMove));
    drawCap(CAP.Evade,        'evade',        _evadeTint(u.evadeTurns | 0, u.evadeFailed, tTag));
    drawCap(CAP.Rotate,       'rotate',       _phaseTint(rotated,          false,         tRotate));
    drawCap(CAP.TagRight,     'tagRight',     _phaseTint(u.taggedRight,    false,         tTag, 'attack'), +lungeRight, 0);
    drawCap(CAP.TagLeft,      'tagLeft',      _phaseTint(u.taggedLeft,     false,         tTag, 'attack'), -lungeLeft,  0);
    drawCap(CAP.BlockForward, 'blockForward', _blockTint(u.blockFwdTurns | 0,   tTag));
    drawCap(CAP.BlockRight,   'blockRight',   _blockTint(u.blockRightTurns | 0, tTag));
    drawCap(CAP.BlockLeft,    'blockLeft',    _blockTint(u.blockLeftTurns | 0,  tTag));

    const hasFwdRange = (u.caps >> CAP.TagFwdAtRange) & 1;
    const fwdTint = _phaseTint(u.taggedFwd, false, tTag, 'attack');
    const hasTagForward = u.hasTagForward !== false; // default true
    if (hasTagForward) {
        if (hasFwdRange) {
            drawCap(CAP.TagFwdAtRange, 'tagFwdAtRange', fwdTint, 0, -lungeFwd);
        } else if (SPRITES.tagForward) {
            // Old: drawSprite at (-half, -half - lungeFwd) => local center (0, -lungeFwd).
            blit(SPRITES.tagForward, fwdTint, 0, -lungeFwd, 1, 1);
        }
    } else if (hasFwdRange) {
        drawCap(CAP.TagFwdAtRange, 'tagFwdAtRange', 'idle');
    }
}
