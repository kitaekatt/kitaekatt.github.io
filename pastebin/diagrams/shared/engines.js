/* Single source of truth for both navigation models.
   `disp` decides how the live artifact is shown:
     - "html"        : standalone HTML diagram → full-width iframe, page scrolls
     - "image"       : SVG/PNG → <img> at natural size, page scrolls (deterministic)
     - "interactive" : pan/zoom or clickable widget → fixed-height live iframe
   No screenshots — every entry points at the engine's real output file. */
window.ENGINES = [
  { id:"archify", name:"archify", stars:547, lic:"MIT", who:"tt-a1i", ver:"", kind:"HTML + SVG",
    ref:true, disp:"html", src:"outputs/archify.html?theme=dark",
    how:"Reference baseline. Hand-authored standalone HTML + inline SVG with a CSS dark/light toggle and a 4× PNG/JPEG/WebP/SVG export menu. Five diagram modes; semantic component color classes.",
    repo:"https://github.com/tt-a1i/archify",
    files:[["open standalone ↗","outputs/archify.html"]] },

  { id:"cocoon", name:"architecture-diagram-generator", stars:5427, lic:"MIT", who:"Cocoon-AI", ver:"v1.1", kind:"HTML + SVG",
    disp:"html", src:"outputs/cocoon.html",
    how:"A design-system spec (not a generator) — copy a template, hand-author one self-contained HTML/SVG file in a fixed slate-950 + JetBrains Mono language with a 7-type palette. Export via html2canvas + jsPDF. Closest peer to archify.",
    repo:"https://github.com/Cocoon-AI/architecture-diagram-generator",
    files:[["open standalone ↗","outputs/cocoon.html"]] },

  { id:"diagram-design", name:"diagram-design", stars:2494, lic:"MIT", who:"cathrynlavery", ver:"v1.0", kind:"HTML + SVG",
    disp:"html", src:"outputs/diagram-design.html",
    how:"Progressive-disclosure skill — lean index + per-type reference docs (14 editorial types). Shape carries meaning; focal accent held to ≤2 nodes; 4px grid. Three variants; dark shown here.",
    repo:"https://github.com/cathrynlavery/diagram-design",
    files:[["open standalone ↗","outputs/diagram-design.html"]] },

  { id:"walkthrough", name:"walkthrough", stars:104, lic:"no license", who:"alexanderop", ver:"v1.1", kind:"interactive HTML",
    disp:"interactive", src:"outputs/walkthrough.html",
    how:"Generates a self-contained INTERACTIVE HTML — a full-screen pan/zoom Mermaid canvas (React + Tailwind + Mermaid + Shiki via CDN). Click a node to open a detail panel with description, code snippet, and file paths. Snippets here come from the real detect.js / remediate.js.",
    repo:"https://github.com/alexanderop/walkthrough",
    files:[["open standalone ↗","outputs/walkthrough.html"]] },

  { id:"mermaid", name:"mermaid-skill", stars:56, lic:"MIT", who:"Agents365-ai", ver:"", kind:"mmdc → SVG/PNG",
    disp:"image", src:"outputs/mermaid.svg",
    how:"CLI wrapper — Claude writes a .mmd file, validates syntax, then shells to mmdc (mermaid-cli + Puppeteer) for PNG/SVG/PDF, with a Kroki HTTP fallback. Stateless, text-in/files-out. Dagre auto-layout.",
    repo:"https://github.com/Agents365-ai/mermaid-skill",
    files:[["SVG ↗","outputs/mermaid.svg"],["PNG ↗","outputs/mermaid.png"],[".mmd ↗","outputs/mermaid.mmd"]] },

  { id:"claude-mermaid", name:"claude-mermaid", stars:153, lic:"MIT", who:"veelenga", ver:"MCP", kind:"same mmdc engine",
    disp:"image", src:"outputs/mermaid.svg",
    how:"An MCP server exposing mermaid_preview / mermaid_save with a local live-reload web server (browser auto-refresh over WebSocket as you iterate), pan/zoom, versioned files. SAME render output as mermaid-skill — both drive mmdc; the difference is DX (live preview vs one-shot). Render shown is shared.",
    repo:"https://github.com/veelenga/claude-mermaid",
    files:[["SVG ↗","outputs/mermaid.svg"]] },

  { id:"drawio", name:"drawio-skill", stars:1980, lic:"MIT", who:"Agents365-ai", ver:"v1.5", kind:".drawio XML",
    disp:"interactive", src:"outputs/drawio-view.html",
    how:"Turns text into draw.io/diagrams.net <mxfile> XML (swimlanes, orthogonal edges, 7-color palette, grid-snapped) then exports via the native draw.io desktop CLI with a 2-round vision self-check. No CLI here, so it delivered XML only — rendered in-browser via the diagrams.net viewer.",
    repo:"https://github.com/Agents365-ai/drawio-skill",
    files:[["viewer ↗","outputs/drawio-view.html"],[".drawio ↗","outputs/drawio.drawio"]] },

  { id:"excalidraw-coleam", name:"excalidraw-diagram-skill", stars:3368, lic:"no license", who:"coleam00", ver:"", kind:".excalidraw → PNG",
    disp:"image", src:"outputs/excalidraw-coleam.png",
    how:"Hand-authored Excalidraw JSON (descriptive IDs, no generator) with a MANDATORY render-view-fix loop: render to PNG via Playwright, Read the image, fix overlaps/clipping, repeat. Self-correcting visual validation is the headline. (Had to work around an upstream esm.sh CDN 404 to render.)",
    repo:"https://github.com/coleam00/excalidraw-diagram-skill",
    files:[["PNG ↗","outputs/excalidraw-coleam.png"],[".excalidraw ↗","outputs/excalidraw-coleam.excalidraw"]] },

  { id:"hand-drawn", name:"hand-drawn-diagrams", stars:35, lic:"MIT", who:"muthuishere", ver:"", kind:"Excalidraw + animated SVG",
    disp:"image", src:"outputs/hand-drawn.png",
    how:"Monochrome hand-drawn (sketch-style) Excalidraw scenes with AI-assigned non-overlapping coordinates; validate → render PNG → fix loop, plus a stroke-by-stroke animated SVG that draws itself. (Its bundled animator hit the same esm.sh CDN break, so the animation here was produced via a CSS-keyframes fallback.)",
    repo:"https://github.com/muthuishere/hand-drawn-diagrams",
    files:[["PNG ↗","outputs/hand-drawn.png"],["animated SVG ↗","outputs/hand-drawn.animated.svg"],[".excalidraw ↗","outputs/hand-drawn.excalidraw"]] },
];
