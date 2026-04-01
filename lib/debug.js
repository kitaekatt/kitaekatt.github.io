/**
 * Debug: copy board state as scenario YAML to clipboard.
 */
var GameDebug = (function() {
    function init(cfg) {
        cfg.btnDebug.addEventListener('click', function() {
            var size = cfg.getMapSize();
            var units = cfg.getUnits();
            var lines = ['map: ' + size[0] + ' ' + size[1], 'units:'];
            for (var i = 0; i < units.length; i++) {
                var u = units[i];
                lines.push('  - ' + u.type + ' ' + u.x + ' ' + u.y + ' health:' + u.health);
            }
            var yaml = lines.join('\n') + '\n';

            /* Try textarea approach first (most compatible) */
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
                /* Last resort: show in a prompt so user can manually copy */
                prompt('Copy this scenario YAML:', yaml);
            }
        });
    }
    return { init: init };
})();
