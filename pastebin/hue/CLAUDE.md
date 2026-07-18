# CLAUDE.md -- Hue layered scene framework

Guidance for an AI agent (Claude) working in this directory. This is a
published, self-contained snapshot of a working Philips Hue scene tool. Someone
may drop you here and say **"set this up on my bridge"** or **"change my scenes"**
-- this file tells you how, and `scene-layers.md` is the full model + verb spec.
`README.md` is the human quickstart.

## What this is

A tool that models Hue scenes as the **LAYERED** (painter's-algorithm) model: a
scene = a default of OFF plus an ordered stack of **layers**, each painting one
**meta-group** (a named light-subset) a colour + brightness; the **topmost**
layer covering a light wins. A lower layer's group may be a superset that higher
layers overpaint, so complement groups vanish. A solver computes the **smallest**
group vocabulary that expresses every scene (a certified minimum).

## The files here

- `scene-layers.py` -- THE tool: the solver + the bi-directional sync (report,
  export, validate, apply). Run this.
- `scene-meta-groups.py` -- a READ-ONLY primitives library imported by the above
  (bridge I/O, colour math, the HTML renderer). Not run directly.
- `scene-groups.yaml` -- the meta-group registry (name -> zones/lights) + an
  optional `templates:` block naming layer-stack sequences. **Example data.**
- `scene-designs.yaml` -- per-scene layer stacks; source of truth for `--apply`.
  **Example data.**
- `scene-layers.md` -- the model + full command reference. Read it before edits.
- `index.html` -- a rendered report of the example home (open in a browser).
- `requirements.txt`, `README.md`.

The two YAML files hold the **author's** home (42 lights, 12 scenes). Treat them
as a worked example; a new user regenerates their own (below).

## First: environment

```bash
pip install -r requirements.txt
export HUE_BRIDGE_IP=<their bridge IP>     # Hue app / router / discovery.meethue.com
export HUE_APP_KEY=<their key>             # see README 'Setup' for the curl to create one
```
Never commit a user's key. If `HUE_APP_KEY` is unset the scripts fall back to
`HUE_KEY_FILE` then `secrets/hue-bridge-key.txt`.

## Setting it up on a NEW bridge (do this in order)

1. `python scene-layers.py` -- read-only; prints the certified-minimum group
   family + each scene as a layer stack. Confirms the bridge is reachable.
2. `python scene-layers.py --export-groups scene-groups.yaml` -- writes a
   starter registry with placeholder names (`G1..`, `ALL`). **Then help the user
   rename** the groups to meaningful names by editing `scene-groups.yaml`
   (optionally add a `templates:` block naming each stack sequence).
3. `python scene-layers.py --export-designs` -- materialises
   `scene-designs.yaml` from their live scene colours + the registry. It
   verifies the family expresses AND bakes every scene before writing.
4. `python scene-layers.py --html` -- renders `tmp/scene-layers.html`.

## Making scene changes from a conversation

This is the core loop. When the user asks for a change ("make Reading warmer",
"dim the bar in Movie night"):

1. **Edit the YAML**, not the bridge directly:
   - a scene's look -> edit its `layers:` in `scene-designs.yaml`. Colour is
     `xy: [x, y]` (authoritative, exact Hue gamut) with a `# hsl(...)` note;
     `ct: <mirek>` is tunable white; `bri` is percent. To shift a hue, edit the
     `xy` (regenerate the `# hsl` note on the next export).
   - the vocabulary (add/rename/re-scope a group) -> edit `scene-groups.yaml`.
2. `python scene-layers.py --validate-design` -- show the user the exact
   per-light diff vs the bridge.
3. `python scene-layers.py --apply` -- DRY-RUN. Show what would change.
4. `python scene-layers.py --apply --yes` -- write it. Backs each scene up to
   `tmp/` first, writes only beyond-tolerance lights, verifies by re-read.

## Safety rules

- **Only `--apply --yes` writes to the bridge.** Everything else is read-only.
  Always dry-run and show the diff before `--yes`.
- Scene edits change *definitions* only -- visible on the scene's next
  activation, nothing actuates live.
- `--apply` writes per-scene JSON backups to `tmp/scene-backup-*-layered-*.json`
  (the revert path).
- Colour is **xy-authoritative**; do not hand-edit the `# hsl(...)` annotations
  expecting them to take effect -- edit `xy`.
- After changing scenes, re-run the solver (`scene-layers.py`) -- if the group
  vocabulary is no longer minimal, or a template's stack order flipped (the
  solver orders layers by brightness), update `scene-groups.yaml` accordingly
  (see scene-layers.md 'Template names').

## Provenance

This is a snapshot published to `kitaekatt.github.io/pastebin/hue`. The living
source is the author's home-automation skill; this copy is standalone and
runnable on any bridge via the environment variables above.
