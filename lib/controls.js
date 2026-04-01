/**
 * Game controls: play/pause, step, rewind, hold behavior, button states.
 *
 * Usage:
 *   const ctrl = GameControls.init({
 *       btnPlay, btnStep, btnRewind, btnNew,
 *       onStep: () => { ... },
 *       onRewind: () => { ... },
 *       onNewGame: () => { ... },
 *       onPlay: () => { ... },
 *       canStep: () => boolean,
 *       canRewind: () => boolean,
 *   });
 *   // Call ctrl.updateButtons() after state changes
 *   // Call ctrl.isPlaying() to check play state
 */
var GameControls = (function() {
    function init(cfg) {
        var playing = false;
        var holdTimeout = null;
        var holdInterval = null;
        var heldKey = null;

        function updateButtons() {
            cfg.btnRewind.disabled = !cfg.canRewind();
            cfg.btnStep.disabled = !cfg.canStep();
        }

        function startHold(action) {
            stopHold();
            action();
            holdTimeout = setTimeout(function() {
                holdInterval = setInterval(action, 100);
            }, 300);
        }

        function stopHold() {
            if (holdTimeout) { clearTimeout(holdTimeout); holdTimeout = null; }
            if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
        }

        function togglePlay() {
            if (!playing && cfg.isGameOver && cfg.isGameOver()) {
                cfg.onNewGame();
            }
            playing = !playing;
            cfg.btnPlay.textContent = playing ? 'Pause' : 'Play';
            cfg.btnPlay.classList.toggle('active', playing);
            if (playing && cfg.onPlay) cfg.onPlay();
            updateButtons();
        }

        function doStep() {
            if (playing) togglePlay();
            cfg.onStep();
            updateButtons();
        }

        function doRewind() {
            if (playing) togglePlay();
            cfg.onRewind();
            updateButtons();
        }

        function doNewGame() {
            stopHold();
            if (playing) togglePlay();
            cfg.onNewGame();
            updateButtons();
        }

        /* Button events */
        cfg.btnPlay.addEventListener('click', togglePlay);
        cfg.btnNew.addEventListener('click', doNewGame);
        cfg.btnStep.addEventListener('mousedown', function() { startHold(doStep); });
        cfg.btnRewind.addEventListener('mousedown', function() { startHold(doRewind); });
        document.addEventListener('mouseup', stopHold);

        /* Keyboard */
        document.addEventListener('keydown', function(e) {
            if (e.repeat) return;
            if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
            else if (e.code === 'ArrowRight') {
                e.preventDefault();
                heldKey = 'right';
                startHold(doStep);
            }
            else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                heldKey = 'left';
                startHold(doRewind);
            }
        });
        document.addEventListener('keyup', function(e) {
            if (e.code === 'ArrowRight' && heldKey === 'right') { stopHold(); heldKey = null; }
            else if (e.code === 'ArrowLeft' && heldKey === 'left') { stopHold(); heldKey = null; }
        });

        updateButtons();

        return {
            updateButtons: updateButtons,
            isPlaying: function() { return playing; },
            togglePlay: togglePlay,
        };
    }

    return { init: init };
})();
