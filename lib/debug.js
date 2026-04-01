/**
 * Debug: copy board state as scenario YAML to clipboard.
 */
var GameDebug = (function() {
    function copyText(text) {
        /* Try clipboard API first, fall back to textarea hack */
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function(resolve, reject) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
                resolve();
            } catch (e) {
                reject(e);
            } finally {
                document.body.removeChild(ta);
            }
        });
    }

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
            copyText(yaml).then(function() {
                var orig = cfg.btnDebug.textContent;
                cfg.btnDebug.textContent = 'Copied!';
                setTimeout(function() { cfg.btnDebug.textContent = orig; }, 1000);
            }, function() {
                cfg.btnDebug.textContent = 'Failed';
                setTimeout(function() { cfg.btnDebug.textContent = 'Debug'; }, 1000);
            });
        });
    }
    return { init: init };
})();
