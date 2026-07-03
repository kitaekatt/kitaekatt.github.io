/**
 * SashimiHUD — DOM HUD layer for the sashimi client: status panel (HP,
 * XP/level, wave, survival timer, perf counters), join/pause banner, and the
 * game-over / victory overlay. Pure presentation: every number displayed is
 * read from the engine through the WASM bridge.
 */
var SashimiHUD = (function() {
    function pad2(n) { return n < 10 ? '0' + n : '' + n; }
    function mmss(sec) {
        sec = Math.max(0, Math.floor(sec));
        return Math.floor(sec / 60) + ':' + pad2(sec % 60);
    }
    function bar(pct, width) {
        pct = Math.max(0, Math.min(1, pct));
        var full = Math.round(pct * width);
        var out = '';
        for (var i = 0; i < width; i++) out += i < full ? '#' : '.';
        return out;
    }

    function init(els) {
        var hudEl = els.hud, bannerEl = els.banner, overlayEl = els.overlay;

        function update(d) {
            var hpPct = d.maxHp > 0 ? d.hp / d.maxHp : 0;
            var xpSpan = d.xpNext < 0 ? 0 : d.xpNext - d.xpFloor;
            var xpPct = d.xpNext < 0 ? 1
                : (xpSpan > 0 ? (d.gems - d.xpFloor) / xpSpan : 0);
            hudEl.textContent =
                'HP    [' + bar(hpPct, 14) + '] ' +
                    Math.max(0, Math.round(d.hp)) + '/' + Math.round(d.maxHp) +
                    (d.down ? '  DOWN' : '') +
                '\nLV ' + d.level + ' [' + bar(xpPct, 14) + '] ' +
                    (d.xpNext < 0 ? 'MAX' : d.gems + '/' + d.xpNext + ' gems') +
                '\nwave  ' + d.wave + '/' + d.waveCount +
                '\ntime  ' + mmss(d.timeSec) + ' / ' + mmss(d.victorySec) +
                '\nkills ' + d.kills + '   gems ' + d.gems +
                '\n' +
                '\nfps      ' + d.fps.toFixed(0) +
                '\ntick ms  ' + d.tickMs.toFixed(2) +
                    ' (engine ' + d.engineMs.toFixed(2) + ')' +
                '\ndraw ms  ' + d.drawMs.toFixed(2) +
                '\nentities ' + d.entities +
                '\nplayers  ' + (d.players || 'none') +
                (d.paused ? '\n\n== PAUSED (P to resume) ==' : '');
        }

        function setBanner(text) { bannerEl.textContent = text; }

        function showGameOver(d) {
            overlayEl.innerHTML = '';
            var h1 = document.createElement('div');
            h1.className = 'go-title ' + (d.victory ? 'go-victory' : 'go-defeat');
            h1.textContent = d.victory ? 'VICTORY' : 'DEFEAT';
            var msg = document.createElement('div');
            msg.className = 'go-msg';
            msg.textContent = d.message;
            var stats = document.createElement('div');
            stats.className = 'go-stats';
            stats.textContent =
                'survived  ' + mmss(d.timeSec) +
                '\nwave      ' + d.wave + '/' + d.waveCount +
                '\nlevel     ' + d.level +
                '\ngems      ' + d.gems +
                '\nkills     ' + d.kills;
            overlayEl.appendChild(h1);
            overlayEl.appendChild(msg);
            overlayEl.appendChild(stats);
            if (d.onRestart) {
                var btn = document.createElement('button');
                btn.className = 'go-restart';
                btn.textContent = 'PLAY AGAIN';
                btn.addEventListener('click', d.onRestart);
                overlayEl.appendChild(btn);
            }
            var hint = document.createElement('div');
            hint.className = 'go-hint';
            hint.textContent = d.onRestart ? 'or press R' : 'Press R to play again';
            overlayEl.appendChild(hint);
            overlayEl.style.display = 'flex';
        }

        function hideGameOver() { overlayEl.style.display = 'none'; }

        return {
            update: update,
            setBanner: setBanner,
            showGameOver: showGameOver,
            hideGameOver: hideGameOver,
        };
    }

    return { init: init };
})();
