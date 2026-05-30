/* Model 1 — shared header rendered on every page. Each page sets
   window.PAGE_ENGINE = "<id>" before loading this. Clicking a skill navigates
   to that skill's own page (real URL, back/forward, bookmarkable). */
(function () {
  var engines = window.ENGINES;
  var cur = engines.find(function (e) { return e.id === window.PAGE_ENGINE; }) || engines[0];

  document.title = cur.name + " — diagramming skills for Claude Code";

  var head = document.getElementById("head");
  head.innerHTML =
    '<div class="kit-title"><span class="dot"></span>Diagramming skills for Claude Code</div>' +
    '<div class="kit-sub">Each skill drew the same example — the architecture of a real skill ' +
      '(<code>claude-md-audit</code>) — so you see each tool\'s house style on identical input. ' +
      'Pick a skill; follow <b>source repo</b> to install it.</div>' +
    '<div class="skillbar">' +
      engines.map(function (e) {
        return '<a class="chip' + (e.id === cur.id ? ' active' : '') + (e.ref ? ' ref' : '') +
               '" href="' + e.id + '.html">' + e.name +
               ' <span class="st">⭐' + e.stars + '</span></a>';
      }).join("") +
    '</div>';

  var main = document.getElementById("main");
  var e = cur;
  main.innerHTML =
    '<div class="dt">' + e.name + ' <small>· ' + e.who + (e.ver ? ' · ' + e.ver : '') +
      ' · ⭐' + e.stars + (e.ref ? ' · reference baseline' : '') + '</small></div>' +
    '<div class="how">' + e.how + '</div>' +
    '<div class="meta"><span class="tag skill">skill</span>' +
      '<span class="tag lic' + (e.lic === 'MIT' ? '' : ' none') + '">' + e.lic + '</span>' +
      '<span>' + e.kind + '</span></div>' +
    '<div class="links"><a href="' + e.repo + '" target="_blank">▸ source repo</a>' +
      e.files.map(function (f) { return '<a href="' + f[1] + '" target="_blank">' + f[0] + '</a>'; }).join("") +
    '</div>' +
    '<div class="stage" id="stage"></div>';

  renderDiagram(e, document.getElementById("stage"));
})();
