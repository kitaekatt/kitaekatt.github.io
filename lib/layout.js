/**
 * Responsive canvas layout with aspect ratio preservation.
 *
 * Usage:
 *   const lay = GameLayout.init({
 *       canvas: canvasEl,
 *       headerEl: headerEl,    // optional: element above canvas
 *       footerEl: footerEl,    // optional: element below canvas
 *       middleEl: middleEl,    // optional: canvas container
 *       aspect: 16 / 9,
 *       headerMin: 40, headerMax: 60,
 *       footerMin: 40, footerMax: 60,
 *       gameMin: 240,
 *       onResize: (cw, ch) => { ... },  // optional callback after layout
 *   });
 *   lay.resize();  // force re-layout
 */
var GameLayout = (function() {
    function init(cfg) {
        var canvas = cfg.canvas;
        var aspect = cfg.aspect || 16 / 9;
        var headerMin = cfg.headerMin || 40;
        var headerMax = cfg.headerMax || 60;
        var footerMin = cfg.footerMin || 40;
        var footerMax = cfg.footerMax || 60;
        var gameMin = cfg.gameMin || 240;

        function resize() {
            var totalH = window.innerHeight, totalW = window.innerWidth;
            var chromeMin = headerMin + footerMin;
            var headerH, footerH, gameH;

            if (totalH <= chromeMin) {
                headerH = totalH / 2; footerH = totalH / 2; gameH = 0;
            } else if (totalH < chromeMin + gameMin) {
                headerH = headerMin; footerH = footerMin; gameH = totalH - chromeMin;
            } else {
                var avail = totalH - chromeMin - gameMin;
                var extra = (headerMax - headerMin) + (footerMax - footerMin);
                var t = Math.min(1, avail / extra);
                headerH = headerMin + (headerMax - headerMin) * t;
                footerH = footerMin + (footerMax - footerMin) * t;
                gameH = totalH - headerH - footerH;
            }

            if (cfg.headerEl) cfg.headerEl.style.height = Math.floor(headerH) + 'px';
            if (cfg.footerEl) cfg.footerEl.style.height = Math.floor(footerH) + 'px';
            if (cfg.middleEl) cfg.middleEl.style.height = Math.floor(gameH) + 'px';

            var cw = gameH * aspect, ch = gameH;
            if (cw > totalW) { cw = totalW; ch = cw / aspect; }
            canvas.style.width = Math.floor(cw) + 'px';
            canvas.style.height = Math.floor(ch) + 'px';

            if (cfg.onResize) cfg.onResize(Math.floor(cw), Math.floor(ch));
        }

        resize();
        window.addEventListener('resize', resize);

        return { resize: resize };
    }

    return { init: init };
})();
