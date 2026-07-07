/**
 * RTControl — CLI control channel for locally-served browser clients.
 *
 * Connects a running client to the control relay hosted by
 * tools/serve-client.py (the localhost.sh WASM-mode server), so the
 * generic CLI (tools/client.py) can query client state and drive UI
 * actions — the root CLAUDE.md "ECS Interaction Pattern" extended to
 * the client's own UI layer: every UI button is also invocable from
 * the command line, through the SAME activation path the pointer and
 * keyboard use.
 *
 * Usage:
 *   var control = RTControl.init({
 *       state: function() { return {...}; },   // JSON snapshot, polled
 *       commands: {                             // name -> handler(args)
 *           press: function(args) { ... },      // returns JSON result
 *       },
 *       pollMs: 250,                            // optional
 *   });
 *   control.stop();                             // optional teardown
 *
 * Protocol (all relative to the serving origin):
 *   GET  control/hello   -> {ok:true, ...}     probe; anything else
 *                                              disables the channel
 *   POST control/poll    {state} -> {commands:[{id, cmd, args}]}
 *   POST control/result  {id, ok, result|error}
 *
 * The channel is inert everywhere except local development: it only
 * probes on localhost/127.0.0.1, and a failed probe (plain
 * python3 -m http.server, published GitHub Pages) disables it
 * silently. Polling uses setInterval, not the rAF loop, so commands
 * still execute while the tab is hidden (browsers throttle hidden
 * intervals to ~1Hz — expect ~1s command latency there).
 */
var RTControl = (function() {
    function init(cfg) {
        var pollMs = cfg.pollMs || 250;
        var timer = null;
        var busy = false;
        var api = { active: false, stop: stop };

        function stop() {
            if (timer) clearInterval(timer);
            timer = null;
            api.active = false;
        }

        function isLocal() {
            var h = location.hostname;
            return h === 'localhost' || h === '127.0.0.1';
        }

        function postJson(url, body) {
            return fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }).then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            });
        }

        function runCommand(c) {
            var handler = cfg.commands && cfg.commands[c.cmd];
            /* Built-in: 'state' returns a FRESH snapshot through the
               command path (the polled snapshot can be pollMs stale —
               too old for press-then-inspect scripting). */
            if (!handler && c.cmd === 'state' && cfg.state) {
                handler = function() { return cfg.state(); };
            }
            /* Built-in: 'close' closes the tab (works for single-entry
               windows, e.g. one opened by `open -na Google Chrome
               --new-window <url>` for a headless-driven session). The
               result posts first; close fires after a beat. */
            if (!handler && c.cmd === 'close') {
                handler = function() {
                    setTimeout(function() {
                        stop();
                        window.close();
                    }, 150);
                    return { closing: true };
                };
            }
            var reply;
            if (!handler) {
                reply = { id: c.id, ok: false,
                          error: 'unknown command: ' + c.cmd };
            } else {
                try {
                    var result = handler(c.args || {});
                    reply = { id: c.id, ok: true,
                              result: result === undefined ? true : result };
                } catch (e) {
                    reply = { id: c.id, ok: false, error: String(e) };
                }
            }
            return postJson('control/result', reply);
        }

        function poll() {
            if (busy) return;        /* skip if the last poll is in flight */
            busy = true;
            var snapshot = null;
            try { snapshot = cfg.state ? cfg.state() : null; }
            catch (e) { snapshot = { stateError: String(e) }; }
            postJson('control/poll', { state: snapshot })
                .then(function(res) {
                    var cmds = (res && res.commands) || [];
                    var chain = Promise.resolve();
                    cmds.forEach(function(c) {
                        chain = chain.then(function() {
                            return runCommand(c);
                        });
                    });
                    return chain;
                })
                .catch(function() { /* relay gone; keep trying */ })
                .then(function() { busy = false; });
        }

        if (!isLocal() || typeof fetch !== 'function') return api;

        fetch('control/hello')
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(hello) {
                if (!hello || !hello.ok) return;   /* no relay: stay inert */
                api.active = true;
                timer = setInterval(poll, pollMs);
                /* Hidden tabs throttle the interval (1Hz, then 1/min);
                   poll immediately when visibility flips so queued
                   commands land the moment the tab is back. */
                if (typeof document !== 'undefined' &&
                    document.addEventListener) {
                    document.addEventListener('visibilitychange', poll);
                }
                poll();
            })
            .catch(function() { /* static server: stay inert */ });

        return api;
    }

    return { init: init };
})();
