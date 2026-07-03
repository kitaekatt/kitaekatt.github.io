/**
 * RTView — persistent view units projected from engine state.
 *
 * After each simulation tick the client calls update(reader); view units are
 * keyed by stable entity id and updated incrementally (the wasm-rt "view
 * units" pattern — never rebuilt from snapshots). Each unit keeps its
 * previous-tick position so the renderer can interpolate:
 *   drawPos = prev + (curr - prev) * alpha.
 *
 * The reader is a scalar-accessor interface over the WASM exports
 * (root CLAUDE.md decision 19 — per-field accessors, no pointer reads):
 *   { count(), id(i), x(i), y(i), dirX(i), dirY(i),
 *     health(i), maxHealth(i), slot(i) }
 *
 * View unit fields:
 *   id, x, y, prevX, prevY   — tick positions (world units)
 *   dirX, dirY               — snapped InputDirection this tick
 *   faceX, faceY             — last non-zero direction (facing persists at idle)
 *   moving                   — dir non-zero this tick
 *   health, maxHealth, slot  — slot 0 = AI, 1..4 = player clientId
 */
var RTView = (function() {
    function init() {
        var units = [];
        var byId = {};

        function update(reader) {
            var n = reader.count();
            var seen = {};
            for (var i = 0; i < n; i++) {
                var id = reader.id(i);
                seen[id] = true;
                var u = byId[id];
                if (!u) {
                    u = {
                        id: id,
                        x: reader.x(i), y: reader.y(i),
                        prevX: reader.x(i), prevY: reader.y(i),
                        dirX: 0, dirY: 0,
                        faceX: 0, faceY: 1,   /* default facing: south */
                        moving: false,
                        health: 0, maxHealth: 1, slot: 0,
                        animPhase: (id % 7) * 0.13,  /* de-sync anim cycles */
                    };
                    byId[id] = u;
                    units.push(u);
                }
                u.prevX = u.x;
                u.prevY = u.y;
                u.x = reader.x(i);
                u.y = reader.y(i);
                u.dirX = reader.dirX(i);
                u.dirY = reader.dirY(i);
                u.moving = (u.dirX !== 0 || u.dirY !== 0);
                if (u.moving) { u.faceX = u.dirX; u.faceY = u.dirY; }
                u.health = reader.health(i);
                u.maxHealth = reader.maxHealth(i);
                u.slot = reader.slot(i);
                /* Optional extension point: a reader may copy additional
                   sandbox-specific fields (kind, flags, ...) onto the view
                   unit. Additive — absent for readers that don't need it. */
                if (reader.extra) reader.extra(u, i);
            }

            /* Remove despawned units */
            var removed = false;
            for (var j = 0; j < units.length; j++) {
                if (!seen[units[j].id]) { delete byId[units[j].id]; removed = true; }
            }
            if (removed) {
                units = units.filter(function(u) { return seen[u.id]; });
            }
            return units;
        }

        function find(id) { return byId[id] || null; }
        function all() { return units; }

        return { update: update, find: find, all: all };
    }

    return { init: init };
})();
