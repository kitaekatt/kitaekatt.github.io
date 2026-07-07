/**
 * SashimiScreens — DOM screen flow for the sashimi client:
 *
 *   TITLE -> HERO SELECT -> (gameplay, screens hidden) -> RESULTS
 *              ^                                            |
 *              +--------------- PLAY AGAIN <----------------+
 *   TITLE <-------------------- TITLE button ---------------+
 *
 * Faithful to the shipped Unity flow (UIManager + AdventureUIController):
 *
 * - TITLE reproduces TitleVT.uxml: the "Sushi Title Screen" art with a
 *   left menu-button group (GlobalUIStyle.uss .menu-button, kenvector
 *   font, focus = bold). Options/Quit are dropped (the port's audio
 *   controls are always on screen; Quit is meaningless in a browser).
 * - HERO SELECT is port-designed: Unity's shipped character select is a
 *   static full-screen image panel with no interaction (Adventure.unity
 *   _characterSelectPanel; the game starts when players possess heroes
 *   via netcode RPCs that shipped disabled). The port overlays the SAME
 *   art ("Sushi Character Select" — baked Ninja / Plumamancer cards)
 *   with clickable card hotspots aligned to the baked cards, a pick
 *   status readout in the art's empty middle box, and a START button.
 * - RESULTS reproduces VictoryVT.uxml / DefeatVT.uxml over the shipped
 *   victory/defeat art: the .uss-positioned "You collected N gems!"
 *   line (victory), match stats in the art's baked leaderboard slots
 *   (victory; the port has no Steam leaderboard — stats are the
 *   port-designed use of the panel), a left button group (Continue ->
 *   PLAY AGAIN + TITLE), and a defeat stats card (port-added; Unity's
 *   defeat screen shows no numbers).
 *
 * Input: pointer (click/tap), keyboard (arrows/A/D move focus,
 * Enter/Space activate) and gamepad (dpad/stick move focus, face button
 * activates — poll() is called once per RTLoop tick while a screen is
 * up). The client owns WHEN screens show and what happens on
 * activation; this module owns DOM, focus and pick state only.
 *
 * Hero picks are per-slot preferences (pick[1], pick[2] = SW hero kind
 * or 0), consumed by the client at game start via
 * wasm_join_hero(clientId, kind). Card activation assigns P1 first,
 * then P2; re-activating with both assigned re-picks P2 (same-kind
 * picks are legal — the engine falls back to the remaining hero).
 */
var SashimiScreens = (function() {
    /* SW hero kinds (wasm_main.c) */
    var KIND_EAGLE = 1, KIND_FROG = 2;

    /* Select-art card hotspots, measured from the baked card borders in
     * "Sushi Character Select.png" (1920x1080), as stage percentages. */
    var CARD_FROG = { left: 2.71, top: 35.0, width: 35.26, height: 23.98 };
    var CARD_EAGLE = { left: 62.03, top: 35.93, width: 35.26, height: 23.89 };
    var MIDDLE_BOX = { left: 39.17, top: 35.0, width: 21.04, height: 23.98 };

    /* Victory-art leaderboard slot rows (dark bars at x 1501-1860,
     * five rows starting y 724, pitch ~55 px) as stage percentages. */
    var LB_SLOT = { left: 78.18, width: 18.70, height: 4.44 };
    var LB_TOPS = [67.04, 71.94, 76.94, 82.22, 87.41];

    function el(tag, className, parent, text) {
        var d = document.createElement(tag);
        if (className) d.className = className;
        if (text !== undefined) d.textContent = text;
        if (parent) parent.appendChild(d);
        return d;
    }

    function pct(box) {
        return 'left:' + box.left + '%;top:' + box.top + '%;width:' +
               box.width + '%;height:' + box.height + '%;';
    }

    function pad2(n) { return n < 10 ? '0' + n : '' + n; }
    function mmss(sec) {
        sec = Math.max(0, Math.floor(sec));
        return Math.floor(sec / 60) + ':' + pad2(sec % 60);
    }

    function init(opts) {
        var root = opts.root;
        var current = null;          /* 'title' | 'select' | 'results' | null */
        var pick = { 1: 0, 2: 0 };

        /* ── Shared focus model (Unity ButtonGroup.UpdateFocus) ──────
           Each screen registers its focusable elements in order;
           arrows/dpad move focus, Enter/Space/pad face button
           activates. Pointer hover moves focus; click activates. */
        var focusables = [];         /* [{el, activate}] for the active screen */
        var focusIndex = 0;

        function setFocus(i) {
            if (!focusables.length) return;
            focusIndex = (i + focusables.length) % focusables.length;
            for (var f = 0; f < focusables.length; f++) {
                focusables[f].el.classList.toggle('focused',
                                                  f === focusIndex);
            }
        }
        function moveFocus(step) { setFocus(focusIndex + step); }
        function activateFocused() {
            if (focusables[focusIndex]) focusables[focusIndex].activate();
        }
        function focusIndexOf(node) {
            for (var f = 0; f < focusables.length; f++)
                if (focusables[f].el === node) return f;
            return -1;
        }
        function bindFocusable(node, activate) {
            focusables.push({ el: node, activate: activate });
            if (!node.dataset.control) node.dataset.control =
                (node.textContent || '').trim().toLowerCase()
                    .replace(/\s+/g, '-');
            /* Screens re-register their focusables on every show;
               DOM listeners attach once and dispatch through the
               CURRENT registration (duplicate listeners double-fired
               activations — one card click picked both P1 and P2). */
            node.__activate = activate;
            if (!node.__focusBound) {
                node.__focusBound = true;
                node.addEventListener('click', function(e) {
                    e.preventDefault();
                    var i = focusIndexOf(node);
                    if (i < 0) return;
                    setFocus(i);
                    node.__activate();
                });
                node.addEventListener('pointerenter', function() {
                    var i = focusIndexOf(node);
                    if (i >= 0) setFocus(i);
                });
            }
        }

        document.addEventListener('keydown', function(e) {
            if (!current) return;
            if (e.code === 'ArrowLeft' || e.code === 'KeyA' ||
                e.code === 'ArrowUp' || e.code === 'KeyW') {
                moveFocus(-1);
            } else if (e.code === 'ArrowRight' || e.code === 'KeyD' ||
                       e.code === 'ArrowDown' || e.code === 'KeyS') {
                moveFocus(1);
            } else if (e.code === 'Enter' || e.code === 'Space') {
                e.preventDefault();
                activateFocused();
            }
        });

        /* Gamepad menu nav: edge-detected dpad/stick + face buttons.
           Called once per RTLoop tick while a screen is shown. */
        var padPrev = {};            /* gamepad index -> {x, act} */
        function poll() {
            if (!current || !navigator.getGamepads) return;
            var pads = navigator.getGamepads();
            for (var p = 0; p < pads.length; p++) {
                var gp = pads[p];
                if (!gp || !gp.connected) continue;
                var prev = padPrev[gp.index] || { x: 0, act: true };
                var x = gp.axes.length ? gp.axes[0] : 0;
                if (gp.buttons.length > 15) {
                    if (gp.buttons[14].pressed) x = -1;
                    if (gp.buttons[15].pressed) x = 1;
                }
                var dir = x > 0.5 ? 1 : (x < -0.5 ? -1 : 0);
                var prevDir = prev.x > 0.5 ? 1 : (prev.x < -0.5 ? -1 : 0);
                if (dir !== 0 && dir !== prevDir) moveFocus(dir);
                var act = false;     /* face buttons 0..3, start 9 */
                for (var b = 0; b < gp.buttons.length && b < 10; b++) {
                    if ((b < 4 || b === 9) && gp.buttons[b].pressed)
                        act = true;
                }
                if (act && !prev.act) activateFocused();
                padPrev[gp.index] = { x: x, act: act };
            }
        }

        /* ── Screen scaffolding ──────────────────────────────────────
           Each screen = fixed cyan backdrop + a 16:9 stage div carrying
           the shipped 1920x1080 art; children position in stage %. */
        function makeScreen(name, art) {
            var screen = el('div', 'screen screen-' + name, root);
            var stage = el('div', 'stage', screen);
            stage.style.backgroundImage = 'url(assets/ui/' + art + ')';
            return { screen: screen, stage: stage };
        }

        /* ── TITLE (TitleVT.uxml) ──────────────────────────────────── */
        var title = makeScreen('title', 'title.png');
        var titleButtons = el('div', 'menu-group', title.stage);
        var playBtn = el('button', 'menu-button', titleButtons, 'Play');

        /* ── HERO SELECT (port-designed over the shipped art) ─────── */
        var select = makeScreen('select', 'select.png');
        var frogCard = el('button', 'hero-card', select.stage);
        frogCard.style.cssText = pct(CARD_FROG);
        frogCard.dataset.control = 'pick-frog';   /* cards have no text */
        var eagleCard = el('button', 'hero-card', select.stage);
        eagleCard.style.cssText = pct(CARD_EAGLE);
        eagleCard.dataset.control = 'pick-eagle';
        var frogBadge = el('div', 'pick-badge', frogCard);
        var eagleBadge = el('div', 'pick-badge', eagleCard);
        var middle = el('div', 'pick-status', select.stage);
        middle.style.cssText = pct(MIDDLE_BOX);
        var pickLine1 = el('div', 'pick-line', middle);
        var pickLine2 = el('div', 'pick-line', middle);
        var pickHint = el('div', 'pick-hint', middle);
        var resetBtn = el('button', 'pick-reset', middle, 'reset picks');
        var startBtn = el('button', 'menu-button start-button', select.stage,
                          'Start');

        function heroName(kind) {
            return kind === KIND_FROG ? 'NINJA (Frog)'
                 : kind === KIND_EAGLE ? 'PLUMAMANCER (Eagle)' : '—';
        }

        function refreshSelect() {
            pickLine1.textContent = 'P1  ' +
                (pick[1] ? heroName(pick[1]) : 'pick a hero');
            pickLine2.textContent = 'P2  ' +
                (pick[2] ? heroName(pick[2]) : (pick[1] ? 'optional' : ''));
            pickHint.textContent = pick[1]
                ? 'START when ready'
                : 'choose your hero';
            frogBadge.textContent = badgeText(KIND_FROG);
            eagleBadge.textContent = badgeText(KIND_EAGLE);
            frogBadge.style.display = frogBadge.textContent ? 'block' : 'none';
            eagleBadge.style.display =
                eagleBadge.textContent ? 'block' : 'none';
            resetBtn.style.display = pick[1] ? 'inline-block' : 'none';
            startBtn.disabled = !pick[1];
        }

        function badgeText(kind) {
            var t = [];
            if (pick[1] === kind) t.push('P1');
            if (pick[2] === kind) t.push('P2');
            return t.join(' ');
        }

        function pickHero(kind) {
            if (!pick[1]) pick[1] = kind;
            else pick[2] = kind;     /* second (or re-)pick is P2's */
            refreshSelect();
        }

        function resetPicks() {
            pick[1] = 0;
            pick[2] = 0;
            refreshSelect();
        }

        resetBtn.dataset.control = 'reset-picks';
        resetBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            resetPicks();
        });

        /* ── RESULTS (VictoryVT/DefeatVT over the shipped art) ────── */
        var results = makeScreen('results', 'victory.png');
        var resultButtons = el('div', 'menu-group', results.stage);
        var againBtn = el('button', 'menu-button', resultButtons,
                          'Play Again');
        var titleBtn = el('button', 'menu-button', resultButtons, 'Title');
        var resultMsg = el('div', 'result-msg', resultButtons);
        /* Victory: the .uss score line (score-title-group at 756,510) */
        var scoreLine = el('div', 'victory-score', results.stage);
        var scorePrefix = el('span', 'victory-title', scoreLine,
                             'You collected ');
        var scoreValue = el('span', 'victory-title-bold', scoreLine, '0');
        var scoreSuffix = el('span', 'victory-title', scoreLine, ' gems!');
        /* Victory: stats into the art's five leaderboard slots */
        var lbRows = [];
        for (var s = 0; s < 5; s++) {
            var row = el('div', 'leaderboard-entry', results.stage);
            row.style.cssText = pct({
                left: LB_SLOT.left, top: LB_TOPS[s],
                width: LB_SLOT.width, height: LB_SLOT.height,
            });
            lbRows.push(row);
        }
        /* Defeat: compact port-added stats card (Unity shows none) */
        var defeatStats = el('div', 'defeat-stats', results.stage);

        function statLines(d) {
            return [
                ['survived', mmss(d.timeSec)],
                ['wave', d.wave + '/' + d.waveCount],
                ['level', String(d.level)],
                ['gems', String(d.gems)],
                ['kills', String(d.kills)],
            ];
        }

        function fillResults(d) {
            results.stage.style.backgroundImage =
                'url(assets/ui/' + (d.victory ? 'victory.png'
                                              : 'defeat.png') + ')';
            resultMsg.textContent = d.message || '';
            scoreLine.style.display = d.victory ? 'block' : 'none';
            scoreValue.textContent = String(d.gems);
            var lines = statLines(d);
            for (var i = 0; i < lbRows.length; i++) {
                lbRows[i].style.display = d.victory ? 'flex' : 'none';
                lbRows[i].innerHTML = '';
                el('span', 'lb-label', lbRows[i], lines[i][0]);
                el('span', 'lb-value', lbRows[i], lines[i][1]);
            }
            defeatStats.style.display = d.victory ? 'none' : 'block';
            defeatStats.innerHTML = '';
            for (var j = 0; j < lines.length; j++) {
                var dl = el('div', 'defeat-stat-line', defeatStats);
                el('span', 'lb-label', dl, lines[j][0]);
                el('span', 'lb-value', dl, lines[j][1]);
            }
        }

        /* ── Show / hide ───────────────────────────────────────────── */
        var screens = {
            title: title.screen,
            select: select.screen,
            results: results.screen,
        };

        function rebuildFocus(name) {
            for (var f = 0; f < focusables.length; f++)
                focusables[f].el.classList.remove('focused');
            focusables = [];
            if (name === 'title') {
                bindFocusable(playBtn, function() { opts.onPlay(); });
            } else if (name === 'select') {
                bindFocusable(frogCard, function() { pickHero(KIND_FROG); });
                bindFocusable(eagleCard, function() { pickHero(KIND_EAGLE); });
                bindFocusable(startBtn, function() {
                    if (pick[1]) opts.onStart();
                });
            } else if (name === 'results') {
                bindFocusable(againBtn, function() { opts.onPlayAgain(); });
                bindFocusable(titleBtn, function() { opts.onTitle(); });
            }
            setFocus(0);
        }

        function show(name, data) {
            for (var k in screens) {
                screens[k].classList.toggle('active', k === name);
            }
            current = name;
            if (name === 'select') refreshSelect();
            if (name === 'results' && data) fillResults(data);
            rebuildFocus(name);
            root.style.display = 'block';
        }

        function hide() {
            for (var k in screens) screens[k].classList.remove('active');
            current = null;
            root.style.display = 'none';
        }

        hide();

        /* ── CLI control surface (rt-control.js / tools/client.py) ──
           state() reports what a player could see; press() activates
           a control through the SAME path as a pointer click. */
        function state() {
            return {
                screen: current,
                picks: { p1: pick[1], p2: pick[2] },
                buttons: focusables.map(function(f, i) {
                    return {
                        name: f.el.dataset.control,
                        label: (f.el.textContent || '').trim(),
                        disabled: !!f.el.disabled,
                        focused: i === focusIndex,
                    };
                }).concat(current === 'select' && pick[1] ? [{
                    name: 'reset-picks',
                    label: 'reset picks',
                    disabled: false,
                    focused: false,
                }] : []),
            };
        }

        function press(name) {
            var want = String(name || '').toLowerCase();
            for (var i = 0; i < focusables.length; i++) {
                var f = focusables[i];
                var label = (f.el.textContent || '').trim().toLowerCase();
                if (f.el.dataset.control !== want && label !== want)
                    continue;
                if (f.el.disabled)
                    throw new Error("button '" + name + "' is disabled");
                setFocus(i);
                f.activate();
                return { pressed: f.el.dataset.control, screen: current };
            }
            /* reset-picks is pointer-only (not in the focus ring) */
            if (want === 'reset-picks' && current === 'select') {
                resetPicks();
                return { pressed: 'reset-picks', screen: current };
            }
            throw new Error("no button '" + name + "' on screen '" +
                            current + "'");
        }

        return {
            show: show,
            hide: hide,
            poll: poll,
            current: function() { return current; },
            picks: function() { return pick; },
            state: state,
            press: press,
        };
    }

    return { init: init, KIND_EAGLE: KIND_EAGLE, KIND_FROG: KIND_FROG };
})();
