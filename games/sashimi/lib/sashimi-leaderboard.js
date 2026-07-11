/**
 * SashimiLeaderboard -- per-category high scores for the sashimi client.
 *
 * Score = gems (Unity's SteamLeaderboardManager metric:
 * MatchStats.GemsPickedup, exported as wasm_get_gems). Three categories
 * keyed by the participant roster captured at game start
 * (sashimi-screens.roster()):
 *
 *   'plumamancer'  solo Plumamancer (eagle, SW kind 1)
 *   'ninja'        solo Ninja (frog, SW kind 2)
 *   'coop'         both heroes participate
 *
 * KNOWN DELTA (user ruling 2026-07-09): the mapping is
 * PARTICIPATION-based -- a human + AI-partner run posts to 'coop'.
 * Unity instead derives the board from PossessedTag queries
 * (ClientGameOverSystem.cs:102-127), so human + AI bot lands on the
 * human's SOLO board there. The user ruled to keep the port's
 * participation-based mapping; do not "fix" this toward Unity.
 *
 * A run is recorded ONLY on VICTORY, and only when the roster contains
 * at least one HUMAN player (AI-only matches never score) -- Unity's
 * upload path exists solely on the victory screen
 * (VictoryScreenController.cs:104-107, 173-197). KeepBest semantics
 * everywhere: a stored score is overwritten only by a strictly higher
 * one.
 *
 * Online board (config-gated; inert when unconfigured): the client
 * config block lives in clients/wasm/index.html
 * (window.SASHIMI_LEADERBOARD_CONFIG). Submissions POST
 * { googleIdToken, category, gems, alias? } to the Cloudflare Worker
 * (sandboxes/sashimi/leaderboard/); the board is read as a public CSV
 * (boardUrl, e.g. https://kitaekatt.github.io/leaderboard/sashimi.csv)
 * with schema v2 columns
 * category,google_sub,alias,display_name,gems,updated_at.
 * Victory shows the player's rank -2..+2 in the art's 5 slots (Unity
 * VictoryScreenController / Steam GlobalAroundUser). When the online
 * board is unavailable (unconfigured, fetch failure, empty CSV) but a
 * local best exists for the run's category, the slots show a LOCAL
 * board instead (localBoardRows: one rank-1 own row, remaining slots
 * blank); with no local best either, the self-stats lines stay.
 *
 * ALIAS (per player = per google_sub, Worker-enforced): board rows
 * display the row's alias (defaults to the Google display name). An
 * alias can be set/changed ONLY by a submission that beats the
 * player's stored best in the submitted category -- the victory screen
 * shows an alias input exactly when this run strictly improved the
 * local best (matchResult.improved), the POST is HELD while the input
 * is up (submit state 'alias-wait', declared on the panel), and it
 * fires with the confirmed alias, or WITHOUT an alias field on the
 * grace timeout / screen exit (the Worker then keeps the existing
 * alias; the score is never lost). Wiring lives in sashimi-client.js.
 *
 * PROVENANCE HONESTY (user ruling 2026-07-09: "telling someone they
 * are on the leaderboard when they aren't is verboten"; root CLAUDE.md
 * decision 12, no silent fallbacks): boardPresentation() below is the
 * single derivation of what the victory panel may CLAIM. A local board
 * is always titled "<BOARD> - LOCAL BEST"; a projected own row on the
 * fetched board is allowed only after a submit KNOWN to have
 * succeeded; and the panel carries a visible notice whenever this
 * run's score did not (or may not yet have) reached the online board.
 *
 * This module is pure logic + a tiny storage wrapper so it runs
 * headless under Node (sandboxes/sashimi/tests/test_leaderboard.js);
 * the browser glue (who calls what, when) lives in sashimi-client.js.
 */
var SashimiLeaderboard = (function() {
    var KIND_EAGLE = 1, KIND_FROG = 2;      /* SW hero kinds (wasm_main.c) */
    var CATEGORIES = ['plumamancer', 'ninja', 'coop'];
    /* v2 (2026-07-10): fresh start with the alias board schema -- v1
       local bests are deliberately NOT migrated. */
    var STORE_KEY = 'sashimi.highscores.v2';
    var ALIAS_MAX = 32;

    /* Category from the roster captured at startGame: which heroes
       PARTICIPATE (human or ai; absent heroes are removed at start).
       null = no participants (START is blocked in that state anyway). */
    function categoryFor(roster) {
        var present = {};
        (roster.human || []).concat(roster.ai || []).forEach(function(k) {
            present[k] = true;
        });
        var eagle = !!present[KIND_EAGLE], frog = !!present[KIND_FROG];
        if (eagle && frog) return 'coop';
        if (eagle) return 'plumamancer';
        if (frog) return 'ninja';
        return null;
    }

    /* Record gate: at least one human player in the match. */
    function shouldRecord(roster) {
        return (roster.human || []).length >= 1;
    }

    /* KeepBest: only a strictly higher score replaces the stored one.
       Returns { best, improved } -- best is the post-update value. */
    function keepBest(prev, gems) {
        var has = typeof prev === 'number' && isFinite(prev);
        if (!has || gems > prev) return { best: gems, improved: true };
        return { best: prev, improved: false };
    }

    /* Storage wrapper over a localStorage-like object (getItem/setItem).
       Falls back to in-memory when storage throws (private browsing). */
    function store(storage) {
        var memory = null;   /* fallback copy when storage is unusable */

        function load() {
            var scores = {};
            try {
                var raw = storage.getItem(STORE_KEY);
                if (raw) scores = JSON.parse(raw) || {};
            } catch (e) { scores = memory || {}; }
            /* keep only known categories with sane numeric values */
            var clean = {};
            CATEGORIES.forEach(function(c) {
                var v = scores[c];
                if (typeof v === 'number' && isFinite(v) && v >= 0)
                    clean[c] = v;
            });
            return clean;
        }

        function save(scores) {
            memory = scores;
            try { storage.setItem(STORE_KEY, JSON.stringify(scores)); }
            catch (e) { /* in-memory fallback already holds it */ }
        }

        return {
            /* best(category) -> number | null */
            best: function(category) {
                var scores = load();
                return (category in scores) ? scores[category] : null;
            },
            /* record(category, gems) -> { best, improved } (KeepBest) */
            record: function(category, gems) {
                if (CATEGORIES.indexOf(category) < 0 ||
                    typeof gems !== 'number' || !isFinite(gems) || gems < 0)
                    return { best: null, improved: false };
                var scores = load();
                var r = keepBest(scores[category], gems);
                if (r.improved) {
                    scores[category] = r.best;
                    save(scores);
                }
                return r;
            },
        };
    }

    /* Victory score-to-beat messaging (VictoryScreenController.cs:
       226-249). Unity compares the run's gems against the player's
       post-upload board score with >= -- a TIE is a new high score
       (:235) -- and otherwise shows
       "Collect {best - gems + 1} more to beat your score!" (:232,
       :240-241). MESSAGE-only semantics: the store's KeepBest write
       stays strictly-greater (keepBest above); only the message treats
       a tie as a new high. best = the stored best AFTER recording
       (null/undefined = no prior score -> new high score).
       Returns { newBest, toBeat, text }. */
    function scoreMessage(gems, best) {
        var has = typeof best === 'number' && isFinite(best);
        if (!has || gems >= best)
            return { newBest: true, toBeat: 0, text: 'NEW HIGH SCORE!' };
        var n = best - gems + 1;
        return { newBest: false, toBeat: n,
                 text: 'Collect ' + n + ' more to beat your score!' };
    }

    /* Match-end outcome (the client's showGameOver calls this once).
       VICTORY-ONLY record + submit: Unity's upload path exists only on
       the victory screen (VictoryScreenController.cs:104-107, 173-197
       -- UploadScore is reachable solely from the victory controller),
       so a defeat never writes a personal best and never POSTs to the
       Worker. The defeat stats card still shows the STORED best, read
       without recording. st = store(...); eligible = shouldRecord()
       (>= 1 human).
       Returns { best, newBest, toBeat, text, submit, improved }:
       improved is the STRICT KeepBest result (this run beat the stored
       best) -- the alias-change gate. newBest stays the message-only
       tie-counts flag; the two differ exactly on a tie. */
    function matchResult(st, category, eligible, victory, gems) {
        if (!eligible || !category)
            return { best: null, newBest: false, toBeat: 0, text: '',
                     submit: false, improved: false };
        if (!victory)
            return { best: st.best(category), newBest: false, toBeat: 0,
                     text: '', submit: false, improved: false };
        var rec = st.record(category, gems);
        var msg = scoreMessage(gems, rec.best);
        return { best: rec.best, newBest: msg.newBest,
                 toBeat: msg.toBeat, text: msg.text, submit: true,
                 improved: rec.improved };
    }

    /* ---- Online board (config-gated) ---------------------------- */

    /* Normalize the client config block. ALL online behavior is inert
       when unconfigured: enabled is the master switch, and each path
       additionally needs its URL (workerUrl for submit, boardUrl for
       the read). authRequired gates match start behind Google Sign-In
       (sashimi-auth.js) and is meaningless without googleClientId. */
    function config(raw) {
        raw = raw || {};
        return {
            enabled: !!raw.enabled,
            authRequired: !!raw.authRequired,
            workerUrl: typeof raw.workerUrl === 'string' ? raw.workerUrl : '',
            googleClientId: typeof raw.googleClientId === 'string'
                ? raw.googleClientId : '',
            boardUrl: typeof raw.boardUrl === 'string' ? raw.boardUrl : '',
        };
    }

    /* Parse the public board CSV: header + one row per
       (category, google user). Schema v2 columns (the Worker writes
       them, sanitizing alias/display_name to keep the format
       6-field-splittable):
         category,google_sub,alias,display_name,gems,updated_at
       Unknown categories (including the header line itself), short
       lines (v1 5-field rows included -- no migration), and
       non-numeric gems are dropped -- a broken row never breaks the
       board. */
    function parseCsv(text) {
        var rows = [];
        if (typeof text !== 'string') return rows;
        var lines = text.split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            var f = line.split(',');
            if (f.length !== 6) continue;
            var gems = parseInt(f[4], 10);
            if (CATEGORIES.indexOf(f[0]) < 0) continue;
            if (!isFinite(gems) || gems < 0) continue;
            rows.push({ category: f[0], sub: f[1], alias: f[2],
                        name: f[3], gems: gems, ts: f[5] });
        }
        return rows;
    }

    /* The player's current alias across ALL board rows ('' when none):
       the alias-input prefill on a new-best victory. */
    function aliasFor(rows, sub) {
        if (!sub) return '';
        for (var i = 0; i < (rows || []).length; i++) {
            if (rows[i].sub === sub && rows[i].alias) return rows[i].alias;
        }
        return '';
    }

    /* Client-side mirror of the Worker's alias sanitization (printable
       ASCII, commas stripped, whitespace collapsed, max 32): '' means
       ABSENT -- the submit then omits the alias field entirely and the
       Worker keeps the existing alias. */
    function sanitizeAlias(name) {
        var s = typeof name === 'string' ? name : '';
        return s.replace(/[^\x20-\x7e]/g, '').replace(/,/g, ' ')
                .replace(/\s+/g, ' ').trim().slice(0, ALIAS_MAX).trim();
    }

    /* One category's rows, best first. Ties keep CSV order (the earlier
       row -- the earlier submitter -- ranks higher, like Steam). */
    function rankedRows(rows, category) {
        return rows.filter(function(x) { return x.category === category; })
                   .slice()
                   .sort(function(a, b) { return b.gems - a.gems; });
    }

    /* The victory screen's 5 slots: the player's rank -2..+2 (Unity
       VictoryScreenController; Steam GlobalAroundUser shifts the window
       at the edges to keep 5 rows when the board has them). player =
       { sub, name, gems } or null (no ranked player -> top 5). When the
       player's sub is not on the board yet (the submission commit is
       async, or submissions are unconfigured) a virtual row is inserted
       where their best would rank -- below existing equal scores.
       Returns [{ rank, name, gems, you }] -- name is the row's ALIAS
       (falling back to display_name; the Worker always writes one). */
    function boardWindow(sorted, player) {
        var list = sorted.slice();
        var idx = -1;
        if (player && player.sub) {
            for (var i = 0; i < list.length; i++) {
                if (list[i].sub === player.sub) { idx = i; break; }
            }
        }
        if (idx < 0 && player && typeof player.gems === 'number' &&
            isFinite(player.gems) && player.gems >= 0) {
            idx = 0;
            while (idx < list.length && list[idx].gems >= player.gems) idx++;
            list.splice(idx, 0, {
                sub: player.sub || '',
                name: player.name || 'you',
                gems: player.gems, ts: '',
            });
        }
        if (!list.length) return [];
        var start = Math.max(0, Math.min(idx < 0 ? 0 : idx - 2,
                                         list.length - 5));
        var out = [];
        for (var j = start; j < list.length && out.length < 5; j++) {
            out.push({ rank: j + 1, name: list[j].alias || list[j].name,
                       gems: list[j].gems, you: j === idx });
        }
        return out;
    }

    /* Local fallback board: when the online board is unavailable
       (boardUrl unconfigured, fetch failure, or an empty CSV) the
       victory slots show the player's STORED best for the run's
       category as a single rank-1 own row (the remaining slots stay
       blank -- Unity leaves failure rows blank). Same row shape as
       boardWindow. name = the signed-in display name, falling back to
       'you'. Returns [] when no local best exists, so the self-stats
       fallback stays on screen. The client records the run
       (matchResult) BEFORE rendering, so a run that just set the best
       shows the new value. */
    function localBoardRows(category, st, name) {
        if (!category || !st) return [];
        var best = st.best(category);
        if (typeof best !== 'number' || !isFinite(best)) return [];
        return [{ rank: 1, name: name || 'you', gems: best, you: true }];
    }

    /* Provenance-honest victory panel derivation (user ruling
       2026-07-09: "telling someone they are on the leaderboard when
       they aren't is verboten"). Pure: the client re-derives and
       re-applies this whenever the async submit/fetch state changes.

       s = {
         victory:     bool (defeat -> null; no board on defeat),
         boardName:   the category board title ('NINJA', ...; '' ok),
         player:      { sub, name } | null (null = ineligible/AI-only),
         playerBest:  this run's recorded best (the projected row),
         submit:      'none' | 'alias-wait' | 'pending' | 'ok'
                      | 'offline' | 'signed-out' | 'failed',
         submitError: short error text ('' unless failed),
         board:       'pending' | 'ok' | 'unavailable',
         online:      rankedRows output (board === 'ok'),
         boardError:  why the board is unavailable ('' otherwise),
         localRows:   localBoardRows output ([] when no local best),
       }
       -> { title, rows, notice, noticeKind, local } | null
       rows === null means: leave the slots as already painted (the
       self-stats fill). notice is the visible provenance line;
       noticeKind is 'warn' | 'ok' | 'info' (styling only). */
    function boardPresentation(s) {
        if (!s || !s.victory) return null;
        var name = s.boardName || '';
        function short(e) {
            e = String(e || 'error');
            return e.length > 40 ? e.slice(0, 37) + '...' : e;
        }
        /* The submission declaration: the player must never believe an
           unsubmitted score reached the online board. */
        var notice = '', kind = 'warn';
        if (s.submit === 'alias-wait') {
            /* The POST is deliberately HELD while the alias input is
               up (new-best victories only); it always fires -- on
               confirm, on the grace timeout, or on screen exit -- so
               "submits shortly" is a promise the client keeps. */
            notice = 'set your alias - score submits shortly';
            kind = 'info';
        } else if (s.submit === 'pending') {
            notice = 'submitting score...'; kind = 'info';
        } else if (s.submit === 'ok') {
            notice = 'score submitted'; kind = 'ok';
        } else if (s.submit === 'offline') {
            notice = 'offline - score not submitted';
        } else if (s.submit === 'signed-out') {
            notice = 'not signed in - score not submitted';
        } else if (s.submit === 'failed') {
            notice = 'score not submitted (' + short(s.submitError) + ')';
        }
        /* submit 'none': nothing was submittable (AI-only run) -- the
           panel makes no claim, so no declaration is needed. */

        if (s.board === 'ok' && s.online && s.online.length) {
            /* Real fetched board. The player's own score appears as a
               PROJECTED row only when the POST is known to have
               succeeded (the CSV commit may lag); otherwise only a row
               genuinely fetched from the board may be marked. */
            var onBoard = !!(s.player && s.player.sub &&
                s.online.some(function(r) {
                    return r.sub === s.player.sub;
                }));
            var arg = s.player ? {
                sub: s.player.sub, name: s.player.name,
                gems: (s.submit === 'ok' && !onBoard)
                    ? s.playerBest : undefined,
            } : null;
            var rows = boardWindow(s.online, arg);
            /* State 1 (submitted and really on the fetched board):
               unchanged -- real rows, plain title, no notice. */
            if (s.submit === 'ok' && onBoard) notice = '';
            return { title: name, rows: rows, notice: notice,
                     noticeKind: kind, local: false };
        }
        if (s.board === 'pending') {
            /* Fetch unresolved: leave the painted self-stats; the
               submission declaration still shows. */
            return { title: name, rows: null, notice: notice,
                     noticeKind: kind, local: false };
        }
        /* Online board unavailable or empty: the LOCAL board -- and it
           must unambiguously say so (title suffix + declaration). */
        if (s.localRows && s.localRows.length) {
            if (s.submit === 'ok')
                notice = 'score submitted - online board unavailable';
            return { title: name ? name + ' - LOCAL BEST' : 'LOCAL BEST',
                     rows: s.localRows, notice: notice,
                     noticeKind: kind, local: true };
        }
        /* No board of any kind: the self-stats fill stays. */
        return { title: name, rows: null, notice: notice,
                 noticeKind: kind, local: false };
    }

    /* ---- Async browser glue (fire-and-forget; cb(err, ...)) ------
       Both are no-ops reporting 'unconfigured' unless the config block
       enables them -- the game never touches the network otherwise. */

    /* GET the public board CSV. cb(err, csvText). */
    function fetchBoard(cfg, cb) {
        if (!cfg || !cfg.enabled || !cfg.boardUrl)
            return cb('unconfigured', null);
        try {
            fetch(cfg.boardUrl, { cache: 'no-store' })
                .then(function(res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.text();
                })
                .then(function(text) { cb(null, text); })
                .catch(function(err) {
                    cb(String((err && err.message) || err), null);
                });
        } catch (e) { cb(String(e.message || e), null); }
    }

    /* POST { googleIdToken, category, gems, alias? } to the Worker.
       cb(err). The alias field is included ONLY when the payload
       carries a non-empty string alias (a confirmed alias-input value);
       omitting it tells the Worker to keep the player's existing alias
       (or default a first row to the Google display name). */
    function submitScore(cfg, payload, cb) {
        cb = cb || function() {};
        if (!cfg || !cfg.enabled || !cfg.workerUrl)
            return cb('unconfigured');
        if (!payload || !payload.googleIdToken)
            return cb('not signed in');
        var body = {
            googleIdToken: payload.googleIdToken,
            category: payload.category,
            gems: payload.gems,
        };
        if (typeof payload.alias === 'string' && payload.alias)
            body.alias = payload.alias;
        try {
            fetch(cfg.workerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }).then(function(res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                cb(null);
            }).catch(function(err) {
                cb(String((err && err.message) || err));
            });
        } catch (e) { cb(String(e.message || e)); }
    }

    return {
        CATEGORIES: CATEGORIES,
        KIND_EAGLE: KIND_EAGLE,
        KIND_FROG: KIND_FROG,
        categoryFor: categoryFor,
        shouldRecord: shouldRecord,
        keepBest: keepBest,
        scoreMessage: scoreMessage,
        matchResult: matchResult,
        store: store,
        config: config,
        parseCsv: parseCsv,
        aliasFor: aliasFor,
        sanitizeAlias: sanitizeAlias,
        rankedRows: rankedRows,
        boardWindow: boardWindow,
        localBoardRows: localBoardRows,
        boardPresentation: boardPresentation,
        fetchBoard: fetchBoard,
        submitScore: submitScore,
    };
})();
