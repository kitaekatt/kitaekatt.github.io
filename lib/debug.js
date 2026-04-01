/**
 * Debug: copy board state as scenario YAML to clipboard.
 *
 * Usage:
 *   GameDebug.init({
 *       btnDebug: element,
 *       getMapSize: () => [width, height],
 *       getUnits: () => [{ type: 'Archer'|'Knight', x, y, health }, ...],
 *   });
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
            navigator.clipboard.writeText(yaml).then(function() {
                var orig = cfg.btnDebug.textContent;
                cfg.btnDebug.textContent = 'Copied!';
                setTimeout(function() { cfg.btnDebug.textContent = orig; }, 1000);
            });
        });
    }
    return { init: init };
})();
