/**
 * SashimiScreens — DOM screen flow for the sashimi client:
 *
 *   TITLE -> HERO SELECT -> (gameplay, screens hidden) -> RESULTS
 *              ^                |  ^                         |
 *              |             PAUSE (Resume / End Match)      |
 *              +--------------- PLAY AGAIN <----------------+
 *   TITLE <---------- TITLE button / End Match -------------+
 *
 * Faithful to the shipped Unity flow (UIManager + AdventureUIController):
 *
 * - TITLE reproduces TitleVT.uxml: the "Sushi Title Screen" art with a
 *   left menu-button group (GlobalUIStyle.uss .menu-button, kenvector
 *   font, focus = bold). Options/Quit are dropped (the port's audio
 *   controls are always on screen; Quit is meaningless in a browser).
 * - PAUSE reproduces PauseVT.uxml: the "Sushi Pause Screen" art (opaque,
 *   full-screen) with the same left menu-button group — Resume (default
 *   focus) and End Match. Options is dropped, matching the Title delta
 *   (the port has no options panel). Resume returns to gameplay exactly
 *   where it froze (pause is a tick gate, not time-scale); End Match
 *   tears down the run and returns to TITLE (the toTitle() path).
 * - HERO SELECT is port-designed: Unity's shipped character select is a
 *   static full-screen image panel with no interaction (Adventure.unity
 *   _characterSelectPanel; the game starts when players possess heroes
 *   via netcode RPCs that shipped disabled). The port overlays the SAME
 *   art ("Sushi Character Select" — baked Ninja / Plumamancer cards)
 *   with clickable card hotspots aligned to the baked cards, a pick
 *   status readout in the art's empty middle box, and a START button.
 * - RESULTS reproduces VictoryVT.uxml / DefeatVT.uxml over the shipped
 *   victory/defeat art: the .uss-positioned "You collected N gems!"
 *   line (victory), the run's board name over the slots (victory only;
 *   Unity's LeaderBoardTitle, VictoryScreenController.cs:141-160),
 *   match stats in the art's baked leaderboard slots
 *   (victory; the port has no Steam leaderboard — stats are the
 *   port-designed use of the panel), a left button group (Continue ->
 *   PLAY AGAIN + TITLE), a defeat stats card (port-added; Unity's
 *   defeat screen shows no numbers), and the port-added alias input
 *   (setAliasPrompt; opened by the client on new-best victories only —
 *   the online board's alias-change gate).
 *
 * Input: pointer (click/tap), keyboard (arrows/A/D move focus,
 * Enter/Space activate) and gamepad (dpad/stick move focus, face button
 * activates — poll() is called once per RTLoop tick while a screen is
 * up). The client owns WHEN screens show and what happens on
 * activation; this module owns DOM, focus and roster state only.
 *
 * Participant roster (1P / 2P): each hero has a role — 'human', 'ai', or
 * 'none'. A hero card toggles its hero human; a per-card AI button
 * toggles it AI; 'none' heroes are removed at game start (Unity's
 * FollowerInputsystem bot destruction). The game may start with 1 or 2
 * participants (human and/or AI); zero blocks START. roster() reports
 * the human kinds (ordered = P1, P2), ai kinds, and absent kinds; the
 * client possesses joined devices onto the human heroes in order,
 * leaves ai heroes AI-driven, and removes the absent ones.
 *
 * EVERY entry to HERO SELECT starts from a FRESH roster (show('select')
 * calls resetPicks) — each match rosters from scratch, like Unity's
 * per-match server world. Roles used to persist across games ("picks
 * are kept"); because a card click TOGGLES, a stale role inverted the
 * next game's selection (clicking your previous hero deselected it),
 * so game 2 realized rosters built on game 1's state — the
 * "selected plumamancer, got a ninja" bug.
 */
var SashimiScreens = (function() {
    /* SW hero kinds (wasm_main.c) */
    var KIND_EAGLE = 1, KIND_FROG = 2;

    /* Select-art card hotspots, measured from the baked card borders in
     * "Sushi Character Select.png" (1920x1080), as stage percentages. */
    var CARD_FROG = { left: 2.71, top: 35.0, width: 35.26, height: 23.98 };
    var CARD_EAGLE = { left: 62.03, top: 35.93, width: 35.26, height: 23.89 };
    var MIDDLE_BOX = { left: 39.17, top: 35.0, width: 21.04, height: 23.98 };
    /* Per-hero "add AI" buttons, centered under each card. */
    var AI_FROG = { left: 12.71, top: 60.0, width: 15.26, height: 6.0 };
    var AI_EAGLE = { left: 72.03, top: 60.0, width: 15.26, height: 6.0 };

    /* Victory-art leaderboard slot rows (dark bars at x 1501-1860,
     * five rows starting y 724, pitch ~55 px) as stage percentages. */
    var LB_SLOT = { left: 78.18, width: 18.70, height: 4.44 };
    var LB_TOPS = [67.04, 71.94, 76.94, 82.22, 87.41];
    /* Board title above the slots (VictoryVT.uxml:24 LeaderBoardTitle;
     * .uss .leaderboard-title: right 238, top 633, 302x41,
     * translate 50%/50% -> left (1920-238-302)+151 = 1531, top 653.5
     * of 1920x1080) and the run-category board names
     * (VictoryScreenController.cs:141-160). */
    var LB_TITLE = { left: 79.74, top: 60.51, width: 15.73, height: 3.80 };
    var LB_TITLES = { ninja: 'NINJA', plumamancer: 'PLUMAMANCER',
                      coop: 'CO-OP' };

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
        var current = null;          /* 'title'|'select'|'pause'|'results'|null */
        /* Per-hero role: 'none' | 'human' | 'ai'. Kinds: FROG, EAGLE. */
        var role = {};
        role[KIND_FROG] = 'none';
        role[KIND_EAGLE] = 'none';
        var HERO_KINDS = [KIND_FROG, KIND_EAGLE];

        function humanKinds() {
            return HERO_KINDS.filter(function(k) { return role[k] === 'human'; });
        }
        function participantCount() {
            return HERO_KINDS.filter(function(k) {
                return role[k] !== 'none';
            }).length;
        }

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
            /* Typing in a text input (the alias field) must not drive
               menu focus/activation. */
            if (e.target && e.target.tagName === 'INPUT' &&
                e.target.type === 'text') return;
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

        /* ── PAUSE (PauseVT.uxml) ──────────────────────────────────── */
        var pause = makeScreen('pause', 'pause.png');
        var pauseButtons = el('div', 'menu-group', pause.stage);
        var resumeBtn = el('button', 'menu-button', pauseButtons, 'Resume');
        var endMatchBtn = el('button', 'menu-button', pauseButtons,
                             'End Match');

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
        var aiFrogBtn = el('button', 'ai-toggle', select.stage, '+ AI');
        aiFrogBtn.style.cssText = pct(AI_FROG);
        aiFrogBtn.dataset.control = 'ai-frog';
        var aiEagleBtn = el('button', 'ai-toggle', select.stage, '+ AI');
        aiEagleBtn.style.cssText = pct(AI_EAGLE);
        aiEagleBtn.dataset.control = 'ai-eagle';
        var middle = el('div', 'pick-status', select.stage);
        middle.style.cssText = pct(MIDDLE_BOX);
        var pickLine1 = el('div', 'pick-line', middle);
        var pickLine2 = el('div', 'pick-line', middle);
        var pickHint = el('div', 'pick-hint', middle);
        var resetBtn = el('button', 'pick-reset', middle, 'reset');
        var startBtn = el('button', 'menu-button start-button', select.stage,
                          'Start');

        var aiBtnFor = {};
        aiBtnFor[KIND_FROG] = aiFrogBtn;
        aiBtnFor[KIND_EAGLE] = aiEagleBtn;

        /* Badge = the hero's role: P1/P2 for humans (order = P1 then P2),
           AI for an AI hero, blank when absent. */
        function badgeText(kind) {
            if (role[kind] === 'human') {
                var hk = humanKinds();
                return 'P' + (hk.indexOf(kind) + 1);
            }
            if (role[kind] === 'ai') return 'AI';
            return '';
        }

        function refreshSelect() {
            var n = participantCount();
            pickLine1.textContent = n === 0 ? 'choose your hero'
                : n === 1 ? '1 player' : '2 players';
            pickLine2.textContent = n === 0 ? ''
                : 'card = you · AI button = bot';
            pickHint.textContent = n === 0
                ? 'tap a hero (or + AI)'
                : 'START when ready';
            frogBadge.textContent = badgeText(KIND_FROG);
            eagleBadge.textContent = badgeText(KIND_EAGLE);
            frogBadge.style.display = frogBadge.textContent ? 'block' : 'none';
            eagleBadge.style.display =
                eagleBadge.textContent ? 'block' : 'none';
            HERO_KINDS.forEach(function(k) {
                var b = aiBtnFor[k];
                var on = role[k] === 'ai';
                b.textContent = on ? 'AI ✓' : '+ AI';
                b.classList.toggle('active', on);
            });
            resetBtn.style.display = n ? 'inline-block' : 'none';
            startBtn.disabled = n === 0;
        }

        /* Card toggles the hero human (a second human card = P2); the AI
           button toggles it AI. The two roles are mutually exclusive per
           hero, and either toggles back to 'none' on a repeat press. */
        function pickHero(kind) {
            role[kind] = (role[kind] === 'human') ? 'none' : 'human';
            refreshSelect();
        }

        function toggleAI(kind) {
            role[kind] = (role[kind] === 'ai') ? 'none' : 'ai';
            refreshSelect();
        }

        function resetPicks() {
            HERO_KINDS.forEach(function(k) { role[k] = 'none'; });
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
        /* Personal best (SashimiLeaderboard, KeepBest): shown under the
           score line on victory; defeat gets a stats-card line instead. */
        var bestLine = el('div', 'personal-best', results.stage);
        /* Victory: the run's board name over the slots (Unity's
           LeaderBoardTitle, VictoryScreenController.cs:141-160 --
           NINJA / PLUMAMANCER / CO-OP; defeat shows no label). */
        var lbTitle = el('div', 'leaderboard-title', results.stage);
        lbTitle.style.cssText = pct(LB_TITLE);
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
        /* Provenance notice under the board slots (user ruling
           2026-07-09: "telling someone they are on the leaderboard
           when they aren't is verboten"): states whether this run's
           score reached the online board (offline / failed /
           submitted). Text comes from
           SashimiLeaderboard.boardPresentation via setBoardView. */
        var lbNotice = el('div', 'board-notice', results.stage);
        lbNotice.style.cssText = pct({ left: LB_SLOT.left, top: 92.2,
                                       width: LB_SLOT.width,
                                       height: 3.2 });
        /* Defeat: compact port-added stats card (Unity shows none) */
        var defeatStats = el('div', 'defeat-stats', results.stage);
        var lastVictory = false;     /* setBoardView applies to victory only */

        /* ── Alias input (victory, new-best runs only) ─────────────
           The client (sashimi-client.js) opens this via setAliasPrompt
           exactly when the run strictly improved the local best -- the
           same condition under which the Worker accepts an alias
           change. Enter or OK confirms (onConfirm receives the raw
           text); the prompt is pointer/typing only, outside the menu
           focus ring (the key-nav handler above skips INPUT targets,
           and the input's own keydown stops propagation so typing
           never reaches the client's R-restart handler). */
        var aliasRow = el('div', 'alias-row', results.stage);
        el('span', 'alias-label', aliasRow, 'alias');
        var aliasInput = el('input', 'alias-input', aliasRow);
        aliasInput.maxLength = 32;         /* Worker caps at 32 too */
        aliasInput.dataset.control = 'alias-input';
        var aliasBtn = el('button', 'alias-ok', aliasRow, 'OK');
        aliasBtn.dataset.control = 'alias-ok';
        var aliasConfirm = null;   /* onConfirm while the prompt is up */
        var aliasDirty = false;    /* the player typed something */
        aliasInput.addEventListener('input', function() {
            aliasDirty = true;
        });
        aliasInput.addEventListener('keydown', function(e) {
            e.stopPropagation();
            if (e.code === 'Enter') {
                e.preventDefault();
                confirmAlias();
            }
        });
        aliasBtn.addEventListener('click', function(e) {
            e.preventDefault();
            confirmAlias();
        });
        function confirmAlias() {
            var fn = aliasConfirm;
            if (!fn) return;
            var v = aliasInput.value;
            setAliasPrompt(null);
            fn(v);
        }
        /* setAliasPrompt(null) hides; { value, onConfirm } opens the
           prompt prefilled; { value } alone updates the prefill of an
           OPEN prompt (late board fetch) unless the player already
           typed. */
        function setAliasPrompt(p) {
            if (!p) {
                aliasConfirm = null;
                aliasRow.style.display = 'none';
                return;
            }
            if (!aliasConfirm) {
                if (!p.onConfirm) return;   /* nothing to confirm into */
                aliasConfirm = p.onConfirm;
                aliasDirty = false;
                aliasInput.value = p.value || '';
                aliasRow.style.display = 'flex';
                if (aliasInput.focus) aliasInput.focus();
                return;
            }
            if (p.onConfirm) aliasConfirm = p.onConfirm;
            if (!aliasDirty && p.value) aliasInput.value = p.value;
        }

        /* Swap the victory art's 5 slots to board rows (boardWindow or
           localBoardRows output). Unity shows the leaderboard on
           VICTORY only, and the board fetch is async -- fillResults
           already painted the self-stats fallback, so a late/failed
           fetch changes nothing. Internal: clients go through
           setBoardView so rows always arrive with their provenance
           (title + notice). */
        function setBoardRows(rows) {
            if (current !== 'results' || !lastVictory) return false;
            if (!rows || !rows.length) return false;
            for (var i = 0; i < lbRows.length; i++) {
                var r = rows[i];
                lbRows[i].innerHTML = '';
                lbRows[i].style.display = r ? 'flex' : 'none';
                lbRows[i].classList.toggle('lb-you', !!(r && r.you));
                if (!r) continue;
                el('span', 'lb-label', lbRows[i], '#' + r.rank + ' ' + r.name);
                el('span', 'lb-value', lbRows[i], String(r.gems));
            }
            return true;
        }

        /* Apply a SashimiLeaderboard.boardPresentation result to the
           victory panel: the board title (carries the ' - LOCAL BEST'
           suffix when the rows are local), the slot rows, and the
           provenance notice line. rows === null leaves the already
           painted slots (the self-stats fill). Victory results only --
           defeat never shows a board. */
        function setBoardView(p) {
            if (current !== 'results' || !lastVictory || !p) return false;
            if (p.title) {
                lbTitle.textContent = p.title;
                lbTitle.style.display = 'block';
            }
            lbNotice.textContent = p.notice || '';
            lbNotice.className = 'board-notice' + (p.notice
                ? ' board-notice-' + (p.noticeKind || 'warn') : '');
            lbNotice.style.display = p.notice ? 'block' : 'none';
            if (p.rows && p.rows.length) setBoardRows(p.rows);
            return true;
        }

        /* The category's board display name (Unity's LeaderBoardTitle
           strings) -- the boardName input to boardPresentation. */
        function boardTitle(category) {
            return LB_TITLES[category] || '';
        }

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
            /* Personal best line (victory + recorded runs only --
               >= 1 human in the roster; see SashimiLeaderboard).
               Text is Unity's score-to-beat messaging, precomputed by
               SashimiLeaderboard.scoreMessage: NEW HIGH SCORE! on a
               tie-or-better, else "Collect N more to beat your
               score!" (VictoryScreenController.cs:226-249). */
            var recorded = typeof d.best === 'number';
            bestLine.style.display =
                (d.victory && recorded) ? 'block' : 'none';
            bestLine.textContent =
                (d.victory && recorded) ? (d.bestText || '') : '';
            bestLine.classList.toggle('new-best', !!d.newBest);
            /* Board name over the slots on victory only (Unity's
               LeaderBoardTitle); defeat has no board panel. */
            var boardName = d.victory ? (LB_TITLES[d.category] || '') : '';
            lbTitle.textContent = boardName;
            lbTitle.style.display = boardName ? 'block' : 'none';
            lbNotice.textContent = '';        /* setBoardView owns it */
            lbNotice.style.display = 'none';
            setAliasPrompt(null);   /* the client re-opens it if eligible */
            lastVictory = !!d.victory;
            var lines = statLines(d);
            for (var i = 0; i < lbRows.length; i++) {
                lbRows[i].style.display = d.victory ? 'flex' : 'none';
                lbRows[i].innerHTML = '';
                lbRows[i].classList.remove('lb-you');
                el('span', 'lb-label', lbRows[i], lines[i][0]);
                el('span', 'lb-value', lbRows[i], lines[i][1]);
            }
            defeatStats.style.display = d.victory ? 'none' : 'block';
            defeatStats.innerHTML = '';
            /* Defeat keeps its 'best' row, but from the STORED best
               only -- a defeat never records (victory-only record,
               Unity VictoryScreenController.cs:173-197). */
            if (!d.victory && recorded) {
                lines.push(['best', String(d.best)]);
            }
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
            pause: pause.screen,
            results: results.screen,
        };

        function rebuildFocus(name) {
            for (var f = 0; f < focusables.length; f++)
                focusables[f].el.classList.remove('focused');
            focusables = [];
            if (name === 'title') {
                bindFocusable(playBtn, function() { opts.onPlay(); });
            } else if (name === 'pause') {
                bindFocusable(resumeBtn, function() { opts.onResume(); });
                bindFocusable(endMatchBtn, function() { opts.onEndMatch(); });
            } else if (name === 'select') {
                bindFocusable(frogCard, function() { pickHero(KIND_FROG); });
                bindFocusable(aiFrogBtn, function() { toggleAI(KIND_FROG); });
                bindFocusable(eagleCard, function() { pickHero(KIND_EAGLE); });
                bindFocusable(aiEagleBtn, function() { toggleAI(KIND_EAGLE); });
                bindFocusable(startBtn, function() {
                    if (participantCount() > 0) opts.onStart();
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
            /* Re-arm gamepad edge detection: a face button still held
               from gameplay (mashing as defeat lands) must not
               insta-activate this screen's focused button — poll()'s
               {act: true} default requires a release first. */
            padPrev = {};
            /* Fresh roster on every select entry (see header): a stale
               role from the previous game inverts the card toggle, so
               the roster must never survive into the next match. */
            if (name === 'select') resetPicks();
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
                roster: roster(),
                buttons: focusables.map(function(f, i) {
                    return {
                        name: f.el.dataset.control,
                        label: (f.el.textContent || '').trim(),
                        disabled: !!f.el.disabled,
                        focused: i === focusIndex,
                    };
                }).concat(current === 'select' && participantCount() ? [{
                    name: 'reset-picks',
                    label: 'reset',
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

        /* The client's game-start contract: human kinds (ordered = P1,
           P2), ai kinds, and absent kinds (removed at start). */
        function roster() {
            return {
                human: humanKinds(),
                ai: HERO_KINDS.filter(function(k) { return role[k] === 'ai'; }),
                absent: HERO_KINDS.filter(function(k) {
                    return role[k] === 'none';
                }),
            };
        }

        return {
            show: show,
            hide: hide,
            poll: poll,
            current: function() { return current; },
            roster: roster,
            participants: participantCount,
            state: state,
            press: press,
            setBoardView: setBoardView,
            setAliasPrompt: setAliasPrompt,
            boardTitle: boardTitle,
        };
    }

    return { init: init, KIND_EAGLE: KIND_EAGLE, KIND_FROG: KIND_FROG };
})();
