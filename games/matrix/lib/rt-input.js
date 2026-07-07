/**
 * RTInput — local co-op input with a device join flow.
 *
 * Devices (the keyboard, up to 4 gamepads, plus one touch virtual joystick)
 * claim clientIds 1..maxPlayers on their first meaningful input. Each joined
 * device contributes one raw direction vector per simulation tick via
 * sample(). Vectors are raw (analog stick values, -1/0/1 key axes, or the
 * dead-zoned joystick offset) — 45-degree octant snapping is engine-side
 * (C rt_input_snap behind the wasm_set_input export) so native tests cover
 * it.
 *
 * Touch: a floating virtual joystick. The first touch in the join zone
 * (left half of the viewport, outside interactive DOM controls) joins the
 * touch device and anchors the joystick base at the touch point; dragging
 * sets the vector (dead zone TOUCH_DEAD_ZONE, magnitude clamped to 1);
 * lifting the finger zeroes it. The base/knob indicator is a DOM overlay
 * owned by this module (pointer-events: none). Disable with cfg.touch:
 * false.
 *
 * Usage:
 *   var input = RTInput.init({
 *       maxPlayers: 4,
 *       onJoin: function(clientId, label) {},   // optional
 *       touch: true,                            // default: enabled
 *   });
 *   // once per simulation tick:
 *   var frames = input.sample();  // [{clientId, x, y}, ...] joined devices only
 *   input.players()               // [{clientId, label}] for the HUD
 */
var RTInput = (function() {
    var STICK_JOIN_THRESHOLD = 0.5;
    var TOUCH_DEAD_ZONE = 0.22;    /* fraction of joystick radius */
    var TOUCH_RADIUS_PX = 56;      /* knob travel radius (CSS px) */
    var KEY_AXES = {
        'KeyW': [0, -1], 'ArrowUp': [0, -1],
        'KeyS': [0, 1],  'ArrowDown': [0, 1],
        'KeyA': [-1, 0], 'ArrowLeft': [-1, 0],
        'KeyD': [1, 0],  'ArrowRight': [1, 0],
    };

    function init(cfg) {
        var maxPlayers = cfg.maxPlayers || 4;
        /* slots[i] = device descriptor for clientId i+1, or null */
        var slots = [];
        for (var i = 0; i < maxPlayers; i++) slots.push(null);

        var keysDown = {};
        var keyboardSlot = -1;  /* index into slots once joined */

        function claimSlot(device) {
            for (var i = 0; i < maxPlayers; i++) {
                if (!slots[i]) {
                    slots[i] = device;
                    if (cfg.onJoin) cfg.onJoin(i + 1, device.label);
                    return i;
                }
            }
            return -1;
        }

        /* Keyboard: joins on first movement key */
        document.addEventListener('keydown', function(e) {
            if (!(e.code in KEY_AXES)) return;
            e.preventDefault();
            keysDown[e.code] = true;
            if (keyboardSlot < 0) {
                keyboardSlot = claimSlot({ kind: 'keyboard', label: 'Keyboard' });
            }
        });
        document.addEventListener('keyup', function(e) {
            if (e.code in KEY_AXES) keysDown[e.code] = false;
        });
        window.addEventListener('blur', function() { keysDown = {}; });

        function keyboardVector() {
            var x = 0, y = 0;
            for (var code in KEY_AXES) {
                if (keysDown[code]) { x += KEY_AXES[code][0]; y += KEY_AXES[code][1]; }
            }
            /* Opposite keys cancel; clamp to [-1, 1] */
            return [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
        }

        /* ── Touch: floating virtual joystick ─────────────────────────
           One touch device. First touch in the join zone claims a slot
           (auto-join); the joystick base anchors where the finger lands. */
        var touchSlot = -1;        /* index into slots once joined */
        var joy = null;            /* {pointerId, ox, oy, x, y} while held */
        var joyUI = null;          /* {base, knob} DOM overlay */

        function joyZoneOk(e) {
            /* Left half of the viewport; ignore touches on interactive
               DOM controls (buttons/links) so HUD taps never steer. */
            if (e.clientX > window.innerWidth * 0.5) return false;
            var t = e.target;
            return !(t && t.closest && t.closest('button, a, input, select'));
        }

        function ensureJoyUI() {
            if (joyUI) return joyUI;
            function el(size, style) {
                var d = document.createElement('div');
                d.style.cssText =
                    'position:fixed;left:0;top:0;width:' + size + 'px;height:' +
                    size + 'px;margin:' + (-size / 2) + 'px 0 0 ' + (-size / 2) +
                    'px;border-radius:50%;pointer-events:none;z-index:20;' +
                    'display:none;' + style;
                document.body.appendChild(d);
                return d;
            }
            var r = TOUCH_RADIUS_PX;
            joyUI = {
                base: el(r * 2, 'border:2px solid rgba(255,255,255,0.35);' +
                                'background:rgba(255,255,255,0.06);'),
                knob: el(r * 0.9, 'background:rgba(255,255,255,0.35);' +
                                  'border:2px solid rgba(255,255,255,0.5);'),
            };
            return joyUI;
        }

        function joyMove(ui, sx, sy) {
            ui.base.style.transform = 'translate(' + joy.ox + 'px,' + joy.oy + 'px)';
            ui.knob.style.transform = 'translate(' + sx + 'px,' + sy + 'px)';
        }

        function joyShow(show) {
            var ui = ensureJoyUI();
            ui.base.style.display = show ? 'block' : 'none';
            ui.knob.style.display = show ? 'block' : 'none';
        }

        function joyVector() {
            if (!joy) return [0, 0];
            var dx = (joy.x - joy.ox) / TOUCH_RADIUS_PX;
            var dy = (joy.y - joy.oy) / TOUCH_RADIUS_PX;
            var mag = Math.sqrt(dx * dx + dy * dy);
            if (mag < TOUCH_DEAD_ZONE) return [0, 0];
            if (mag > 1) { dx /= mag; dy /= mag; }
            return [dx, dy];
        }

        if (cfg.touch !== false && typeof window !== 'undefined' &&
            window.PointerEvent) {
            window.addEventListener('pointerdown', function(e) {
                if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
                if (joy || !joyZoneOk(e)) return;
                if (touchSlot < 0) {
                    touchSlot = claimSlot({ kind: 'touch', label: 'Touch' });
                    if (touchSlot < 0) return;   /* no free slot */
                }
                joy = { pointerId: e.pointerId,
                        ox: e.clientX, oy: e.clientY,
                        x: e.clientX, y: e.clientY };
                joyMove(ensureJoyUI(), joy.ox, joy.oy);
                joyShow(true);
                e.preventDefault();
            }, { passive: false });
            window.addEventListener('pointermove', function(e) {
                if (!joy || e.pointerId !== joy.pointerId) return;
                joy.x = e.clientX;
                joy.y = e.clientY;
                /* Knob clamps to the travel radius */
                var v = joyVector();
                joyMove(ensureJoyUI(),
                        joy.ox + v[0] * TOUCH_RADIUS_PX,
                        joy.oy + v[1] * TOUCH_RADIUS_PX);
                e.preventDefault();
            }, { passive: false });
            function joyEnd(e) {
                if (!joy || e.pointerId !== joy.pointerId) return;
                joy = null;
                joyShow(false);
            }
            window.addEventListener('pointerup', joyEnd);
            window.addEventListener('pointercancel', joyEnd);
        }

        function gamepadVector(gp) {
            var x = gp.axes.length > 0 ? gp.axes[0] : 0;
            var y = gp.axes.length > 1 ? gp.axes[1] : 0;
            /* D-pad (standard mapping buttons 12-15) overrides the stick
               when pressed */
            var b = gp.buttons;
            if (b.length > 15) {
                var dx = (b[15].pressed ? 1 : 0) - (b[14].pressed ? 1 : 0);
                var dy = (b[13].pressed ? 1 : 0) - (b[12].pressed ? 1 : 0);
                if (dx !== 0 || dy !== 0) { x = dx; y = dy; }
            }
            return [x, y];
        }

        function gamepadJoined(index) {
            for (var i = 0; i < maxPlayers; i++) {
                if (slots[i] && slots[i].kind === 'gamepad' && slots[i].index === index) return true;
            }
            return false;
        }

        function anyGamepadInput(gp) {
            var v = gamepadVector(gp);
            if (Math.abs(v[0]) > STICK_JOIN_THRESHOLD || Math.abs(v[1]) > STICK_JOIN_THRESHOLD) return true;
            for (var i = 0; i < gp.buttons.length; i++) {
                if (gp.buttons[i].pressed) return true;
            }
            return false;
        }

        /* Called once per simulation tick */
        function sample() {
            var pads = (navigator.getGamepads) ? navigator.getGamepads() : [];

            /* Join flow: unjoined pads claim a slot on first input */
            for (var p = 0; p < pads.length; p++) {
                var gp = pads[p];
                if (!gp || !gp.connected) continue;
                if (gamepadJoined(gp.index)) continue;
                if (anyGamepadInput(gp)) {
                    claimSlot({ kind: 'gamepad', index: gp.index, label: 'Gamepad ' + (gp.index + 1) });
                }
            }

            var frames = [];
            for (var i = 0; i < maxPlayers; i++) {
                var dev = slots[i];
                if (!dev) continue;
                var v;
                if (dev.kind === 'keyboard') {
                    v = keyboardVector();
                } else if (dev.kind === 'touch') {
                    v = joyVector();
                } else {
                    var pad = null;
                    for (var q = 0; q < pads.length; q++) {
                        if (pads[q] && pads[q].index === dev.index) { pad = pads[q]; break; }
                    }
                    v = pad ? gamepadVector(pad) : [0, 0];
                }
                frames.push({ clientId: i + 1, x: v[0], y: v[1] });
            }
            return frames;
        }

        function players() {
            var out = [];
            for (var i = 0; i < maxPlayers; i++) {
                if (slots[i]) out.push({ clientId: i + 1, label: slots[i].label });
            }
            return out;
        }

        return { sample: sample, players: players };
    }

    return { init: init };
})();
