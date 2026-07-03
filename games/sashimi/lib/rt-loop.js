/**
 * RTLoop — fixed-timestep simulation loop driven by a single rAF render loop.
 *
 * The simulation is stepped at a fixed tick rate (default 60Hz) from an
 * accumulator; rendering runs at display rate and receives an interpolation
 * alpha (accumulator remainder / tick length). A spiral-of-death guard caps
 * catch-up steps per frame and drops the remaining debt.
 *
 * Usage:
 *   var loop = RTLoop.init({
 *       tickHz: 60,              // simulation rate (default 60)
 *       maxCatchUp: 5,           // max ticks per frame before dropping debt
 *       tick: function() {},     // advance simulation exactly one tick
 *       render: function(alpha, frameDtMs) {},
 *       onStats: function(stats) {},  // optional, called every statsEvery ms
 *       statsEvery: 250,
 *   });
 *   loop.start(); loop.stop();
 *   loop.stats — { fps, tickMs, renderMs, frameMs, steps, droppedMs }
 */
var RTLoop = (function() {
    function init(cfg) {
        var tickMs = 1000 / (cfg.tickHz || 60);
        var maxCatchUp = cfg.maxCatchUp || 5;
        var statsEvery = cfg.statsEvery || 250;

        var running = false;
        var acc = 0;
        var last = 0;
        var lastStats = 0;

        /* Exponential moving averages for the HUD */
        var stats = { fps: 0, tickMs: 0, renderMs: 0, frameMs: 0, steps: 0, droppedMs: 0 };
        var EMA = 0.1;
        function ema(prev, v) { return prev === 0 ? v : prev + (v - prev) * EMA; }

        function frame(now) {
            if (!running) return;
            requestAnimationFrame(frame);

            if (last === 0) last = now;
            var frameDt = now - last;
            last = now;
            /* Tab-switch / long-stall guard: never try to simulate more
               than 250ms of wall time. */
            if (frameDt > 250) frameDt = 250;
            acc += frameDt;

            /* Fixed-timestep catch-up with spiral-of-death guard */
            var steps = 0;
            var t0 = performance.now();
            while (acc >= tickMs && steps < maxCatchUp) {
                cfg.tick();
                acc -= tickMs;
                steps++;
            }
            if (acc >= tickMs) {
                /* Still behind after maxCatchUp steps: drop the debt so the
                   loop recovers instead of spiraling. */
                stats.droppedMs += acc;
                acc = acc % tickMs;
            }
            var t1 = performance.now();

            var alpha = acc / tickMs;
            cfg.render(alpha, frameDt);
            var t2 = performance.now();

            /* Stats */
            if (steps > 0) stats.tickMs = ema(stats.tickMs, (t1 - t0) / steps);
            stats.renderMs = ema(stats.renderMs, t2 - t1);
            stats.frameMs = ema(stats.frameMs, frameDt);
            stats.fps = stats.frameMs > 0 ? 1000 / stats.frameMs : 0;
            stats.steps = steps;

            if (cfg.onStats && now - lastStats >= statsEvery) {
                lastStats = now;
                cfg.onStats(stats);
            }
        }

        function start() {
            if (running) return;
            running = true;
            last = 0;
            acc = 0;
            requestAnimationFrame(frame);
        }

        function stop() { running = false; }

        return { start: start, stop: stop, stats: stats, tickMs: tickMs };
    }

    return { init: init };
})();
