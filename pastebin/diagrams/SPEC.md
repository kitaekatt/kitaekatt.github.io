# Diagram spec — what every engine must depict (engine-neutral)

You are recreating ONE reference diagram using a specific diagram tool/skill. Every engine renders the
SAME content (below) so the results are comparable. The reference (archify) output is at
`D:/Dev/claude-md-audit-workflow.html`. Be faithful to this flow; do not invent steps.

**Subject:** the architecture / control-flow of the `claude-md-audit` Claude Code skill
(source of truth: `D:/Dev/plugins-kit/plugins/skills-kit/skills/claude-md-audit/SKILL.md`,
`workflow/detect.js`, `workflow/remediate.js`).

**Title:** "claude-md-audit — Skill Architecture"
**Subtitle:** resolve → fan-out DETECT per file → barrier + report → Q&A gate → fan-out REMEDIATE per file → summary

## Nodes & flow (top to bottom)

1. **resolve** (entry / accent) — parse `$ARGUMENTS` → N targets; `discover.py`; classify each file's role
   (root / ancestor / child / local) → (path, role, parentPath).
2. **DETECT — before Q&A** (branch/process) — 1 file runs inline in the main loop; **2+ files →
   Workflow `detect.js`**. Fan-out is **`parallel()`, one agent per file**. (NOT a multi-stage pipeline.)
3. **audit lanes** — a fan-out of N parallel lanes, one per file. Each lane is ONE agent that internally does:
   1. read the file (+ its parent CLAUDE.md if role=child)
   2. load the single self-contained `audit-criteria.md`
   3. apply CCP / CRP / ADP (+ Hygiene) criteria per the role-to-criteria map
   4. schema-validate IF the file has a `claude_md:` YAML block
   5. classify each finding → taxonomy (A–G, K) + remediation bucket (AUTO / DISCUSS / SPECIAL)
   Show 3 representative lanes + an ellipsis for "N files":
   - FILE 1 · root  (read root)
   - FILE 2 · child (read child + parent; CCP cross-file dup-check = taxonomy B)
   - FILE N · local (D-group criteria only; skip ADP/Hygiene)
   Detection ONLY — no file is edited in this phase.
4. **barrier: collect findings + render report** — `parallel()` join; wait for every lane; compute
   bucket totals AUTO/DISCUSS/SPECIAL; main loop renders the per-file report. (The one sync point.)
5. **Q&A GATE** (decision; human-in-the-loop) — interactive decisions per DISCUSS/SPECIAL finding;
   inferred automatically when non-interactive ('fast'). AUTO findings auto-apply (no decision needed).
6. **REMEDIATE — after Q&A** (branch/process) — 1 file inline; **2+ files → Workflow `remediate.js`**.
   Fan-out is **`parallel()`, one lane per file** (disjoint files never conflict).
7. **fix lanes** — N parallel lanes, one per file: apply the decided edits in order (Read → Edit).
8. **final summary** (exit / accent) — applied / skipped / failed counts; "re-run the audit to verify
   FAILs cleared" (detection & remediation are separate passes → idempotent re-run is the verification).

## Fidelity rules
- DETECT and REMEDIATE are BOTH `parallel()` fan-outs (one agent/lane per file). Do not depict them as
  pipelines or as three AUTO/DISCUSS/SPECIAL handler nodes — AUTO/DISCUSS/SPECIAL are *buckets* assigned
  during classify, decided at the Q&A gate.
- The Q&A gate sits BETWEEN detect and remediate and is the only human-interaction point.
- Keep it readable: no overlapping boxes/arrows; clear top→bottom flow; label the two fan-outs and the barrier.

## Output
Write your engine's output to `D:/Dev/plugins-kit/tmp/diagram-experiments/outputs/` (exact filename given
in your task). Prefer the engine's richest standalone format (self-contained HTML if the skill produces it;
otherwise SVG, plus PNG if the skill renders raster). Use a dark theme where the engine supports it.
