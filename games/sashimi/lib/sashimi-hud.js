/**
 * SashimiHUD — DOM HUD layer for the sashimi client: status panel (HP,
 * XP/level, wave, survival timer, perf counters, signed-in player with
 * their board alias in brackets when known + current-category high
 * score) and the join/pause banner.
 * Pure presentation: every number displayed is read from the engine through
 * the WASM bridge. The game-over overlay this module used to own is now the
 * results screen (sashimi-screens.js, the Unity VictoryVT/DefeatVT port).
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
        var hudEl = els.hud, bannerEl = els.banner;

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
                '\nrender   ' + d.rafFps.toFixed(0) + ' fps' +
                '\nsim      ' + d.simHz.toFixed(0) + '/' + d.simTarget +
                    ' Hz' + (d.simHz < d.simTarget - 2
                        ? ' (SLOW x' + (d.simHz / d.simTarget).toFixed(2) + ')'
                        : '') +
                '\ntick ms  ' + d.tickMs.toFixed(2) +
                    ' (engine ' + d.engineMs.toFixed(2) + ')' +
                '\ndraw ms  ' + d.drawMs.toFixed(2) +
                '\nentities ' + d.entities +
                '\nplayers  ' + (d.players || 'none') +
                '\nheroes   ' + (d.heroes || '-') +
                '\nsigned   ' + (d.playerName || 'guest') +
                    (d.playerAlias ? ' [' + d.playerAlias + ']' : '') +
                '\nbest     ' + (typeof d.bestGems === 'number'
                    ? d.bestGems + ' gems (' + d.bestCategory + ')'
                    : (d.bestCategory ? '- (' + d.bestCategory + ')' : '-')) +
                (d.lbNote ? '\nboard    ' + d.lbNote : '');
        }

        function setBanner(text) { bannerEl.textContent = text; }

        return {
            update: update,
            setBanner: setBanner,
        };
    }

    return { init: init };
})();
