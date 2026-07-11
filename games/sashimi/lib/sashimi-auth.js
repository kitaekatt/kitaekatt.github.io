/**
 * SashimiAuth -- Google Identity Services (GIS) sign-in for the sashimi
 * client, entirely config-gated (window.SASHIMI_LEADERBOARD_CONFIG in
 * clients/wasm/index.html, normalized by SashimiLeaderboard.config).
 *
 * As shipped (enabled=false / no googleClientId) this module does
 * NOTHING: gate() proceeds synchronously, no script loads, no DOM is
 * touched -- the game plays exactly as before.
 *
 * When configured, the sign-in is triggered at START, after a valid
 * roster is chosen (intent before auth):
 *
 *   - authRequired=true: signing in is REQUIRED to play. The gate shows
 *     a blocking overlay with the GIS-rendered button; cancel returns
 *     to the menu without starting.
 *   - authRequired=false: the same overlay offers "play without
 *     signing in" (once per page load); signed-in players still submit
 *     scores and see their board rank.
 *
 * The session (the GIS ID-token credential + decoded name/sub/exp) is
 * PERSISTED in localStorage ('sashimi.auth.v1') so players do not
 * re-login every visit. Google ID tokens expire (~1 h): a persisted
 * session keeps the player signed in for PLAY and display
 * indefinitely, but token() only hands out an unexpired credential --
 * submissions with a stale session surface 'not signed in' on the
 * debug overlay, and the gate opportunistically refreshes the
 * credential via GIS auto-select in the background. The Worker
 * (leaderboard/worker.mjs) is the verifier of record; nothing
 * client-side is trusted.
 *
 * Pure decode/session logic is Node-tested
 * (tests/test_leaderboard.js); the GIS wiring is browser-only.
 */
var SashimiAuth = (function() {
    var SESSION_KEY = 'sashimi.auth.v1';
    var GSI_SRC = 'https://accounts.google.com/gsi/client';

    function b64urlDecode(s) {
        s = String(s).replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        return atob(s);
    }

    /* Decode (NOT verify) an ID token's claims for display/session
       purposes -- the Worker does the real verification. Returns
       { sub, name, email, exp } or null. */
    function decodeIdToken(token) {
        try {
            var parts = String(token || '').split('.');
            if (parts.length !== 3) return null;
            var p = JSON.parse(b64urlDecode(parts[1]));
            if (!p || !p.sub) return null;
            return {
                sub: String(p.sub),
                name: p.name || (p.email || '').split('@')[0] || 'player',
                email: p.email || '',
                exp: typeof p.exp === 'number' ? p.exp : 0,
            };
        } catch (e) { return null; }
    }

    function init(cfg, opts) {
        opts = opts || {};
        var storage = opts.storage ||
            (typeof localStorage !== 'undefined' ? localStorage : null);
        var onChange = opts.onChange || function() {};
        var session = null;   /* { credential, sub, name, email, exp } */
        var skipped = false;  /* optional-mode skip, once per page load */
        var gisLoading = false, gisLoaded = false;
        var overlay = null;

        function nowSec() { return Math.floor(Date.now() / 1000); }
        function publicState() {
            return session ? { name: session.name, sub: session.sub }
                           : null;
        }

        function persist() {
            try {
                if (storage)
                    storage.setItem(SESSION_KEY, JSON.stringify(session));
            } catch (e) { /* private browsing: session-only */ }
        }
        function restore() {
            try {
                var raw = storage && storage.getItem(SESSION_KEY);
                if (!raw) return;
                var s = JSON.parse(raw);
                if (s && s.credential && s.sub) session = s;
            } catch (e) { /* corrupt/absent: stay signed out */ }
        }
        function adoptCredential(credential) {
            var c = decodeIdToken(credential);
            if (!c) return false;
            session = { credential: credential, sub: c.sub, name: c.name,
                        email: c.email, exp: c.exp };
            persist();
            onChange(publicState());
            return true;
        }

        function configured() {
            return !!(cfg && cfg.enabled && cfg.googleClientId);
        }
        function required() {
            return configured() && !!cfg.authRequired;
        }

        /* ---- GIS wiring (browser-only) ---- */

        function loadGis(cb) {
            if (typeof document === 'undefined')
                return cb('no DOM');
            if (gisLoaded || (typeof google !== 'undefined' &&
                              google.accounts && google.accounts.id)) {
                gisLoaded = true;
                return cb(null);
            }
            if (gisLoading) return cb('still loading, try again');
            gisLoading = true;
            var s = document.createElement('script');
            s.src = GSI_SRC;
            s.async = true;
            s.onload = function() { gisLoaded = true; cb(null); };
            s.onerror = function() {
                gisLoading = false;
                cb('Google Sign-In failed to load (offline/blocked?)');
            };
            document.head.appendChild(s);
        }

        function gisInitialize(onCredential) {
            google.accounts.id.initialize({
                client_id: cfg.googleClientId,
                auto_select: true,
                callback: function(resp) {
                    if (resp && resp.credential &&
                        adoptCredential(resp.credential)) {
                        onCredential();
                    }
                },
            });
        }

        /* Signed in but the stored credential went stale: ask GIS for a
           fresh one in the background (auto-select; no UI when Google
           still has the session). Fire-and-forget. */
        function refreshSilently() {
            loadGis(function(err) {
                if (err) return;
                try {
                    gisInitialize(function() {});
                    google.accounts.id.prompt();
                } catch (e) { /* refresh is best-effort */ }
            });
        }

        /* ---- The sign-in overlay ---- */

        function closeOverlay() {
            if (overlay && overlay.parentNode)
                overlay.parentNode.removeChild(overlay);
            overlay = null;
        }

        function link(parent, className, text, onClick) {
            var a = document.createElement('button');
            a.className = className;
            a.textContent = text;
            a.addEventListener('click', function(e) {
                e.preventDefault();
                onClick();
            });
            parent.appendChild(a);
            return a;
        }

        function showOverlay(optional, proceed) {
            closeOverlay();
            overlay = document.createElement('div');
            overlay.className = 'auth-overlay';
            var card = document.createElement('div');
            card.className = 'auth-card';
            overlay.appendChild(card);
            var title = document.createElement('div');
            title.className = 'auth-title';
            title.textContent = optional
                ? 'Sign in for the leaderboard'
                : 'Sign in to play';
            card.appendChild(title);
            var btnHost = document.createElement('div');
            btnHost.className = 'auth-button';
            card.appendChild(btnHost);
            var msg = document.createElement('div');
            msg.className = 'auth-msg';
            card.appendChild(msg);
            if (optional) {
                link(card, 'auth-skip', 'play without signing in',
                     function() {
                         skipped = true;
                         closeOverlay();
                         proceed();
                     });
            } else {
                link(card, 'auth-cancel', 'cancel', closeOverlay);
            }
            document.body.appendChild(overlay);
            loadGis(function(err) {
                if (err) { msg.textContent = err; return; }
                try {
                    gisInitialize(function() {
                        closeOverlay();
                        proceed();
                    });
                    google.accounts.id.renderButton(btnHost, {
                        theme: 'outline', size: 'large',
                        text: 'signin_with',
                    });
                } catch (e) {
                    msg.textContent = 'Google Sign-In error: ' +
                        (e.message || e);
                }
            });
        }

        /* ---- The START gate (intent before auth) ----
           proceed() starts the match. Called by the client AFTER a
           valid roster was chosen. Synchronous pass-through whenever
           auth cannot or must not block. */
        function gate(proceed) {
            if (!configured()) return proceed();
            if (session) {
                if (session.exp <= nowSec()) refreshSilently();
                return proceed();
            }
            if (!required() && skipped) return proceed();
            if (typeof document === 'undefined') {
                /* headless: optional auth never blocks; required auth
                   cannot be satisfied without a browser */
                if (!required()) proceed();
                return;
            }
            showOverlay(!required(), proceed);
        }

        restore();
        if (session) onChange(publicState());

        return {
            signedIn: function() { return !!session; },
            name: function() { return session ? session.name : null; },
            sub: function() { return session ? session.sub : null; },
            /* unexpired credential or null (Worker enforces exp too) */
            token: function() {
                return (session && session.exp > nowSec())
                    ? session.credential : null;
            },
            required: required,
            configured: configured,
            gate: gate,
            adoptCredential: adoptCredential,   /* tests + GIS callback */
        };
    }

    return { init: init, decodeIdToken: decodeIdToken };
})();
