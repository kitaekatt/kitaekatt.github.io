/**
 * SashimiAudio — WebAudio playback layer for the sashimi client.
 *
 * Pure presentation: the engine stays headless; every sound is driven by
 * the per-tick event exports (wasm_get_event_*) plus client-observed
 * transitions (ability-stage edges, game over, join). The event -> clip
 * mapping is the GENERATED manifest lib/sashimi-audio-data.js, extracted
 * from the Unity project's AudioEventSO / pickup / projectile /
 * MusicController data by clients/tools/extract-audio.py.
 *
 * Behaviors mirroring the Unity audio stack:
 *   - random clip per event when the data assigns several (Unity's
 *     PlayAudioSystem picks randomly among matching buffer rows)
 *   - per-clip cooldown (audioConfig.AudioCooldown = 0.1 s in the shipped
 *     GameConfig) + a global polyphony cap so 50 slimes cannot stack a
 *     cacophony
 *   - looping adventure music (audioConfig.MusicOn = 1 in the Adventure
 *     scene instance), switching to the victory / defeat loops at game
 *     over. The wanted track is fetched+decoded as soon as it is
 *     requested (decode works on a suspended context, same as
 *     preloadSfx), so the menu loop is ready to start at the first
 *     gesture; other music files stay lazy (they are ~2-3 MB each).
 *   - Unity MusicController.FadeIn volume ramp on every track start:
 *     0 -> max over fadeInTime (Title.unity overrides 2.0 s for the
 *     Start loop; the prefab default 2.5 s applies elsewhere).
 *
 * Browser constraints: an AudioContext starts suspended until a user
 * gesture — unlock() is bound to the first pointerdown/touchstart/keydown
 * (the join gesture) and resumes the context + starts the music. Volume
 * and mute persist in localStorage.
 */
var SashimiAudio = (function() {
    var LS_MUTED = 'sashimi.audio.muted';
    var LS_VOLUME = 'sashimi.audio.volume';

    var POLYPHONY = 10;        /* simultaneous SFX voices */
    var CLIP_COOLDOWN = 0.1;   /* s, audioConfig.AudioCooldown */
    var MUSIC_GAIN = 0.45;     /* music under SFX; data ships no mix level */

    function init(opts) {
        opts = opts || {};
        var data = (typeof SashimiAudioData !== 'undefined')
            ? SashimiAudioData : null;
        var ctx = null;
        var sfxGain = null, musicGain = null;
        var buffers = {};        /* clip key -> AudioBuffer */
        var pending = {};        /* clip key -> true while fetching */
        var lastPlayed = {};     /* clip key -> ctx.currentTime */
        var voices = 0;
        var decoded = 0, failed = 0, played = 0;
        var musicSrc = null, musicTrack = null, wantTrack = null;
        var unlocked = false;

        var muted = localStorage.getItem(LS_MUTED) === '1';
        var volume = parseFloat(localStorage.getItem(LS_VOLUME));
        if (!(volume >= 0 && volume <= 1)) volume = 1;

        function ensureCtx() {
            if (ctx || !data) return ctx;
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
            sfxGain = ctx.createGain();
            sfxGain.connect(ctx.destination);
            musicGain = ctx.createGain();
            musicGain.connect(ctx.destination);
            applyGains();
            return ctx;
        }

        function applyGains() {
            if (!ctx) return;
            var v = muted ? 0 : volume;
            sfxGain.gain.value = v;
            musicGain.gain.value = v * MUSIC_GAIN;
            if (opts.muteBtn)
                opts.muteBtn.textContent = muted ? '🔇' : '🔊';
        }

        function url(file) {
            return file + '?v=' + (data ? data.version : '0');
        }

        function fetchClip(key, file, store, done) {
            if (store[key] || pending[key] || !ensureCtx()) return;
            pending[key] = true;
            fetch(url(file))
                .then(function(r) {
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return r.arrayBuffer();
                })
                .then(function(ab) { return ctx.decodeAudioData(ab); })
                .then(function(buf) {
                    store[key] = buf;
                    decoded++;
                    delete pending[key];
                    if (done) done();
                })
                .catch(function(e) {
                    failed++;
                    delete pending[key];
                    console.warn('sashimi-audio: ' + key + ' failed', e);
                });
        }

        function preloadSfx() {
            if (!data) return;
            Object.keys(data.clips).forEach(function(key) {
                fetchClip(key, data.clips[key].file, buffers);
            });
        }

        /* ── SFX playback ── */

        function playClip(key) {
            if (!data || muted || !ctx || ctx.state !== 'running') return;
            var clip = data.clips[key];
            var buf = buffers[key];
            if (!clip || !buf) return;
            var now = ctx.currentTime;
            if (lastPlayed[key] !== undefined &&
                now - lastPlayed[key] < CLIP_COOLDOWN) return;
            if (voices >= POLYPHONY) return;
            lastPlayed[key] = now;
            voices++;
            played++;
            var src = ctx.createBufferSource();
            src.buffer = buf;
            var g = ctx.createGain();
            g.gain.value = clip.volume;
            src.connect(g);
            g.connect(sfxGain);
            src.onended = function() { voices--; };
            src.start();
        }

        function playEvent(table, kind) {
            if (!data) return;
            var byKind = data.events[table];
            var keys = byKind && byKind[String(kind)];
            if (!keys || !keys.length) return;
            playClip(keys[(Math.random() * keys.length) | 0]);
        }

        /* ── Music ── */

        var musicBuffers = {};

        /* MusicController.FadeIn ramp (linear 0 -> max over fadeInTime):
         * the Title scene overrides fadeInTime to 2.0 s for the Start
         * loop (Title.unity fadeInTime override); every other FadeIn
         * uses the MusicController.prefab default 2.5 s. */
        var FADE_IN_S = { start: 2.0 };
        var FADE_IN_DEFAULT_S = 2.5;

        function setMusic(track) {
            wantTrack = track;
            /* Prefetch immediately, even before the unlock gesture:
             * decodeAudioData works on a suspended context (preloadSfx
             * relies on the same), so the track is ready to start the
             * moment unlock() runs instead of beginning a ~2-3 MB
             * download at the first click. */
            var m = data && data.music[track];
            if (m) fetchClip(track, m.file, musicBuffers, startMusicIfReady);
            startMusicIfReady();
        }

        function startMusicIfReady() {
            if (!data || !unlocked || !wantTrack) return;
            var m = data.music[wantTrack];
            if (!m || !musicBuffers[wantTrack]) return;
            if (musicTrack === wantTrack && musicSrc) return;
            if (musicSrc) {
                try { musicSrc.stop(); } catch (e) { /* already done */ }
                musicSrc = null;
            }
            musicTrack = wantTrack;
            musicSrc = ctx.createBufferSource();
            musicSrc.buffer = musicBuffers[wantTrack];
            musicSrc.loop = !!m.loop;
            var fade = ctx.createGain();
            var t = (FADE_IN_S[wantTrack] !== undefined)
                ? FADE_IN_S[wantTrack] : FADE_IN_DEFAULT_S;
            fade.gain.setValueAtTime(0, ctx.currentTime);
            fade.gain.linearRampToValueAtTime(1, ctx.currentTime + t);
            musicSrc.connect(fade);
            fade.connect(musicGain);
            musicSrc.start();
        }

        /* ── Unlock (iOS/mobile: resume inside the join gesture) ── */

        function unlock() {
            if (unlocked || !ensureCtx()) return;
            ctx.resume().then(function() {
                unlocked = true;
                startMusicIfReady();
            });
        }
        ['pointerdown', 'touchstart', 'keydown'].forEach(function(ev) {
            window.addEventListener(ev, unlock, { passive: true });
        });

        /* ── Mute / volume UI ── */

        function setMuted(m) {
            muted = m;
            localStorage.setItem(LS_MUTED, m ? '1' : '0');
            applyGains();
        }
        function setVolume(v) {
            volume = Math.max(0, Math.min(1, v));
            localStorage.setItem(LS_VOLUME, String(volume));
            applyGains();
        }
        if (opts.muteBtn) {
            opts.muteBtn.textContent = muted ? '🔇' : '🔊';
            opts.muteBtn.addEventListener('click', function() {
                setMuted(!muted);
                opts.muteBtn.blur();
            });
        }
        if (opts.volSlider) {
            opts.volSlider.value = String(volume);
            opts.volSlider.addEventListener('input', function() {
                setVolume(parseFloat(opts.volSlider.value));
            });
        }

        preloadSfx();

        /* ── Public surface (event names match the manifest tables) ── */

        return {
            available: !!data,
            /* engine per-tick events (SASHIMI_EV_* -> manifest table) */
            onEvent: function(type, kind) {
                switch (type) {
                    case 1: playEvent('weaponFired', kind); break;
                    case 2: playEvent('hit', kind); break;
                    case 3: playEvent('heroHurt', kind); break;
                    case 4: playEvent('creatureDied', kind); break;
                    case 5: playEvent('heroDied', kind); break;
                    case 6: playEvent('heroRespawn', kind); break;
                    case 7: playEvent('pickup', kind); break;
                    case 8: playEvent('levelUp', kind); break;
                    /* 9 waveStarted: no clip in the Unity data */
                }
            },
            /* client-observed ability stage edge (windup/active) */
            stageChange: function(kind, from, to) {
                if (to === 1) playEvent('windup', kind);
                else if (to === 2) {
                    if (data && data.events.active &&
                        data.events.active[String(kind)])
                        playEvent('active', kind);
                    else if (from === 0) playEvent('windup', kind);
                }
            },
            select: function(heroKind) { playEvent('select', heroKind); },
            gameOver: function(victory, heroKind) {
                playEvent(victory ? 'matchVictory' : 'matchDefeat', heroKind);
                setMusic(victory ? 'victory' : 'defeat');
            },
            startMusic: function() { setMusic('adventure'); },
            /* Unity MusicList.Start: title screen + character select */
            menuMusic: function() { setMusic('start'); },
            setMuted: setMuted,
            setVolume: setVolume,
            /* verification hooks (test/CDP): decode + context state */
            stats: function() {
                return {
                    context: ctx ? ctx.state : 'none',
                    unlocked: unlocked,
                    decoded: decoded,
                    failed: failed,
                    played: played,
                    clips: data ? Object.keys(data.clips).length : 0,
                    music: musicTrack,
                    muted: muted,
                    volume: volume,
                };
            },
        };
    }

    return { init: init };
})();
