# Hue layered scene framework

A small, dependency-light tool for describing Philips Hue scenes as an ordered
stack of **layers** over a minimal, reusable vocabulary of light groups -- and
for syncing that description bi-directionally with your bridge.

**Live example:** open [`index.html`](index.html) -- a rendered report of a real
12-scene home (42 lights). Its "View config & source" button embeds the whole
system (this config + these scripts), so the single HTML file is a
self-contained, buildable spec: you can hand it to Claude and say "build it for
me", or run the scripts here directly on your own bridge.

## The idea

A scene = a default of **OFF** plus an ordered stack of layers; each layer paints
one **meta-group** (a named set of lights) a single colour + brightness, and the
**topmost** layer covering a light wins. A lower layer's group may be a superset
that higher layers overpaint, so "everything-except-X" groups never need to
exist. A solver finds the **smallest** group vocabulary that can express all your
scenes (a certified minimum), and every scene becomes a short, readable stack.

See [`scene-layers.md`](scene-layers.md) for the full model + command reference.

## Requirements

- Python 3.10+
- `pip install -r requirements.txt` (requests, pyyaml, urllib3)

## Setup (point it at your bridge)

1. **Find your bridge IP** -- the Hue app, your router, or
   <https://discovery.meethue.com>.
2. **Create an application key** -- press the round link button on the bridge,
   then within 30s:
   ```bash
   curl -k -X POST https://<BRIDGE_IP>/api \
     -H 'Content-Type: application/json' \
     -d '{"devicetype":"hue-scenes#tool","generateclientkey":true}'
   ```
   The response contains `"username":"<KEY>"` -- that string is your key.
3. **Export both:**
   ```bash
   export HUE_BRIDGE_IP=<BRIDGE_IP>
   export HUE_APP_KEY=<KEY>
   ```
   (Alternatively put the key in a file and set `HUE_KEY_FILE=/path/to/key`.)

## Bootstrap your own scenes

Run these from this directory:

```bash
# 1. See the minimal group family + your scenes as layer stacks (read-only)
python scene-layers.py

# 2. Generate a starter registry from that family (placeholder names G1..)
python scene-layers.py --export-groups scene-groups.yaml
#    -> then edit scene-groups.yaml: rename the groups to something meaningful

# 3. Materialise the layered design from your live scenes + the registry
python scene-layers.py --export-designs        # writes scene-designs.yaml

# 4. Render the browsable report (config + source embedded)
python scene-layers.py --html                  # writes tmp/scene-layers.html
```

## Author + apply changes

Edit `scene-designs.yaml` (a scene's layers -- `xy` colour is authoritative, the
`# hsl(...)` is a readable note; `bri` is percent) and/or `scene-groups.yaml`
(the group vocabulary), then:

```bash
python scene-layers.py --validate-design       # diff your edits vs the bridge
python scene-layers.py --apply                 # DRY-RUN (shows what would change)
python scene-layers.py --apply --yes           # actually write to the bridge
```

`--apply` backs up each scene to `tmp/` before it writes, updates only lights
that differ beyond tolerance, and verifies by re-reading. It changes scene
*definitions* only -- nothing actuates until you next activate the scene.

## The two config files

- **`scene-groups.yaml`** -- the meta-group registry: each group is a `name` +
  the bridge `zones` (or explicit `lights`) it unions. Optionally a `templates:`
  block names each distinct layer-stack sequence.
- **`scene-designs.yaml`** -- per scene, the ordered `layers:` stack. The source
  of truth for `--apply`; regenerate with `--export-designs`.

## Environment variables

| var | meaning | default |
|---|---|---|
| `HUE_BRIDGE_IP` | your bridge's IP | `192.168.0.246` (the example home) |
| `HUE_APP_KEY` | the application key (value) | -- |
| `HUE_KEY_FILE` | path to a file holding the key | `secrets/hue-bridge-key.txt` |
| `HUE_GROUPS_FILE` | path to the registry | `scene-groups.yaml` here |
| `HUE_DESIGNS_FILE` | path to the design | `scene-designs.yaml` here |

The scripts are read-only against the bridge except `--apply` (and only with
`--yes`). `scene-meta-groups.py` is an imported primitives library, not run
directly.
