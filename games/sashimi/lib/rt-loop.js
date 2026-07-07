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
 *   loop.stats — { fps, tickMs, renderMs, frameMs, steps, droppedMs,
 *                  rafFps, simHz, totalFrames, slow20, slow33,
 *                  winWorstMs }
 *
 * fps is an EMA of instantaneous frame rate (smooth but laggy); rafFps and
 * simHz are exact counts over the last stats window: frames actually
 * rendered per second and simulation ticks actually executed per second.
 * simHz < tickHz means the loop is dropping sim time (game slower than
 * real time); rafFps < display rate means rendering is the bottleneck.
 *
 * Consistency counters (for "consistent 60fps" verdicts — medians hide
 * stutter): totalFrames/slow20/slow33 count CUMULATIVELY since start()
 * how many frames ran and how many exceeded 20ms / 33ms of raw frame
 * delta, so a monitor can diff two snapshots across any window;
 * winWorstMs is the worst raw frame delta within the last stats window.
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
        var stats = { fps: 0, tickMs: 0, renderMs: 0, frameMs: 0, steps: 0, droppedMs: 0,
                      rafFps: 0, simHz: 0,
                      totalFrames: 0, slow20: 0, slow33: 0, winWorstMs: 0 };
        var EMA = 0.1;
        function ema(prev, v) { return prev === 0 ? v : prev + (v - prev) * EMA; }

        /* Exact per-window counters behind rafFps/simHz/winWorstMs */
        var winFrames = 0;
        var winTicks = 0;
        var winWorst = 0;

        function frame(now) {
            if (!running) return;
            requestAnimationFrame(frame);

            if (last === 0) { last = now; lastStats = now; }
            var rawDt = now - last;
            last = now;
            /* Consistency counters use the RAW delta (a 40ms hitch must
               count even though the sim clamps it). The very first frame
               (rawDt 0) still counts as a frame. */
            stats.totalFrames++;
            if (rawDt > 20) stats.slow20++;
            if (rawDt > 33) stats.slow33++;
            if (rawDt > winWorst) winWorst = rawDt;
            var frameDt = rawDt;
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
            winFrames++;
            winTicks += steps;

            if (now - lastStats >= statsEvery) {
                var winMs = now - lastStats;
                stats.rafFps = winFrames * 1000 / winMs;
                stats.simHz = winTicks * 1000 / winMs;
                stats.winWorstMs = winWorst;
                winFrames = 0;
                winTicks = 0;
                winWorst = 0;
                lastStats = now;
                if (cfg.onStats) cfg.onStats(stats);
            }
        }

        function start() {
            if (running) return;
            running = true;
            last = 0;
            acc = 0;
            winFrames = 0;
            winTicks = 0;
            winWorst = 0;
            stats.totalFrames = 0;
            stats.slow20 = 0;
            stats.slow33 = 0;
            stats.winWorstMs = 0;
            requestAnimationFrame(frame);
        }

        function stop() { running = false; }

        return { start: start, stop: stop, stats: stats, tickMs: tickMs };
    }

    return { init: init };
})();
