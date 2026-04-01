/**
 * Debug: toggleable profiling overlay + board state YAML copy.
 *
 * If cfg.getTiming is provided, the Debug button toggles a live overlay.
 * Otherwise, clicking Debug copies board YAML to clipboard (legacy behavior).
 */
var GameDebug = (function() {
    var overlay = null;
    var showing = false;
    var rafId = null;

    function init(cfg) {
        if (cfg.getTiming) {
            cfg.btnDebug.addEventListener('click', function() {
                if (showing) close(); else open(cfg);
            });
        } else {
            /* Legacy: click = copy YAML */
            cfg.btnDebug.addEventListener('click', function() { copyYaml(cfg); });
        }
    }

    function open(cfg) {
        if (overlay) overlay.remove();
        overlay = document.createElement('pre');
        overlay.id = 'debug-overlay';
        overlay.style.cssText = [
            'position:fixed', 'bottom:28px', 'right:4px',
            'background:rgba(10,10,25,0.88)', 'color:#aaa',
            'font:11px/1.5 monospace', 'padding:8px 10px',
            'border:1px solid #333', 'border-radius:4px',
            'z-index:20', 'pointer-events:auto',
            'min-width:220px', 'max-width:360px',
            'margin:0', 'user-select:text'
        ].join(';');
        document.body.appendChild(overlay);
        showing = true;
        cfg.btnDebug.classList.add('active');
        tick(cfg);
    }

    function close() {
        if (overlay) overlay.remove();
        overlay = null;
        showing = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
    }

    function tick(cfg) {
        if (!showing) return;
        renderOverlay(cfg);
        rafId = requestAnimationFrame(function() { tick(cfg); });
    }

    function renderOverlay(cfg) {
        var d = cfg.getTiming();
        var c = d.current;
        var a = d.avg;
        var lines = [];

        lines.push('Turn ' + d.turn + '  |  ' + d.unitCount + ' units');
        lines.push('\x1b--- Turn (last / avg' + d.historySize + ') ---');
        lines.push('engine:  ' + fmt(c.engine) + ' / ' + fmt(a.engine) + ' ms');

        /* Per-system breakdown */
        if (d.systems.length > 0) {
            var othersMs = 0;
            for (var i = 0; i < d.systems.length; i++) {
                var s = d.systems[i];
                var pct = d.wasmTotal > 0 ? (s.time / d.wasmTotal * 100) : 0;
                if (pct >= 3) {
                    lines.push('  ' + pad(s.name, 14) + fmt(s.time) + ' ms  (' + pct.toFixed(0) + '%)');
                } else {
                    othersMs += s.time;
                }
            }
            if (othersMs > 0.001) {
                lines.push('  ' + pad('others', 14) + fmt(othersMs) + ' ms');
            }
            lines.push('  ' + pad('collect', 14) + fmt(d.collectTime) + ' ms');
        }

        lines.push('view:    ' + fmt(c.view) + ' / ' + fmt(a.view) + ' ms');
        lines.push('anim:    ' + fmt(c.anim) + ' / ' + fmt(a.anim) + ' ms (' + (d.animFrames || 0) + 'f)');
        lines.push('total:   ' + fmt(c.total) + ' / ' + fmt(a.total) + ' ms');
        lines.push('--- Render ---------------------');
        lines.push('draw:    ' + fmt(d.render.draw) + ' ms');

        overlay.innerHTML = lines.join('\n')
            + '\n<a href="#" id="debug-copy-yaml" style="color:#4dabf7;text-decoration:none;font-size:10px;">Copy board YAML</a>';

        var link = document.getElementById('debug-copy-yaml');
        if (link) link.onclick = function(e) { e.preventDefault(); copyYaml(cfg); };
    }

    function fmt(v) {
        if (v === undefined || v === null || isNaN(v)) return '   ---';
        return v < 10 ? v.toFixed(2).padStart(6) : v.toFixed(0).padStart(6);
    }

    function pad(s, n) {
        return (s + ':').padEnd(n);
    }

    function copyYaml(cfg) {
        var size = cfg.getMapSize();
        var units = cfg.getUnits();
        var lines = ['map: ' + size[0] + ' ' + size[1], 'units:'];
        for (var i = 0; i < units.length; i++) {
            var u = units[i];
            lines.push('  - ' + u.type + ' ' + u.x + ' ' + u.y + ' health:' + u.health);
        }
        var yaml = lines.join('\n') + '\n';

        var ta = document.createElement('textarea');
        ta.value = yaml;
        ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(ta);

        if (ok) {
            cfg.btnDebug.textContent = 'Copied!';
            setTimeout(function() { cfg.btnDebug.textContent = 'Debug'; }, 1500);
        } else {
            prompt('Copy this scenario YAML:', yaml);
        }
    }

    return {
        init: init,
        close: close,
        isShowing: function() { return showing; },
    };
})();
