/* Renders one engine's LIVE diagram into a container. Shared by both models.
   The key idea that kills the old sizing bugs: the diagram is the sole content of
   a full-width column, never a cell in a card grid. So:
     - image       → <img> at natural size; the page scrolls. Deterministic.
     - html        → full-width iframe auto-fit ONCE to its content height (stable
                     because width is fixed at full column width, not reflowing in a grid);
                     the page scrolls, the iframe doesn't.
     - interactive → fixed-height live iframe; pan/zoom or click happens INSIDE it
                     (correct + expected for these two engines). */
(function () {
  function autofit(ifr) {
    var apply = function () {
      try {
        var d = ifr.contentDocument || ifr.contentWindow.document;
        var h = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0);
        if (h > 60) ifr.style.height = (h + 4) + "px";
      } catch (_) { /* cross-origin: keep fallback height */ }
    };
    ifr.addEventListener("load", function () {
      apply(); setTimeout(apply, 300); setTimeout(apply, 1000); setTimeout(apply, 2200);
    });
    window.addEventListener("resize", apply);
  }

  // Render into `el` (an element). Returns nothing.
  window.renderDiagram = function (e, el) {
    el.innerHTML = "";
    if (e.disp === "image") {
      var img = document.createElement("img");
      img.className = "diagram-image";
      img.src = e.src; img.alt = e.name + " diagram";
      img.onerror = function () {
        el.innerHTML = '<div class="diagram-missing">preview unavailable — use the file links above</div>';
      };
      el.appendChild(img);
    } else if (e.disp === "interactive") {
      var fi = document.createElement("iframe");
      fi.className = "diagram-frame interactive";
      fi.title = e.name; fi.src = e.src;
      el.appendChild(fi);
    } else { // html
      var ifr = document.createElement("iframe");
      ifr.className = "diagram-frame html";
      ifr.title = e.name; ifr.src = e.src;
      el.appendChild(ifr);
      autofit(ifr);
    }
  };
})();
