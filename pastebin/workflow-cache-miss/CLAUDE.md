# workflow-cache-miss -- reproduction kit

Demonstrates a Claude Code Workflow-tool inefficiency: **parallel sibling subagents
("lanes") do not share prompt cache beyond a small fixed harness shell.** Each lane
re-creates (`cache_creation`, billed 1.25x input) the entire shared prompt prefix instead
of reading it from cache (`cache_read`, billed 0.1x). For an N-lane fan-out over a shared
instruction set this multiplies the shared-payload cost by ~N.

Filed upstream: https://github.com/anthropics/claude-code/issues/63981

## What is here

- `probe-a-prefix-sharing.js` -- shared text at the FRONT of each lane's `agent()` prompt,
  plus a pre-warm pass, then fan out. Tests whether a shared USER-MESSAGE prefix is shared
  across sibling lanes.
- `probe-b-system-prompt.js` -- relies on the large fixed SYSTEM PROMPT of a built-in agent
  type as the shared surface. Tests whether the SYSTEM PROMPT is shared across sibling lanes.
- `index.html` -- a rendered summary of the same findings.

## How to reproduce

These are native Claude Code Workflow scripts (the Workflow tool, not a plugin). The tool
requires opt-in; an explicit user request or a skill that calls it authorizes the run.

1. Launch a probe with the Workflow tool, passing the script path:
   - `Workflow({ scriptPath: "<abs path>/probe-a-prefix-sharing.js" })`
   - `Workflow({ scriptPath: "<abs path>/probe-b-system-prompt.js" })`
   Each launches 1 pre-warm agent + 3 sibling lanes (single-turn, no tools). Cheap.

2. When the workflow completes, find its subagent transcripts at:
   `<session-project-dir>/subagents/workflows/<wf-id>/agent-*.jsonl`
   where `<session-project-dir>` is `~/.claude/projects/<encoded-cwd>/<session-id>/`.
   (The launch result and the completion notification both print the transcript dir.)

3. Sum the per-agent cache token fields. Each assistant message line carries a `usage`
   object with `cache_creation_input_tokens` and `cache_read_input_tokens`:

       import json, glob, sys
       for f in sorted(glob.glob(sys.argv[1] + "/agent-*.jsonl")):
           ci = cr = 0
           for line in open(f, encoding="utf-8"):
               try: o = json.loads(line)
               except: continue
               m = o.get("message") if isinstance(o, dict) else None
               u = (m or {}).get("usage") if isinstance(m, dict) else None
               if isinstance(u, dict):
                   ci += u.get("cache_creation_input_tokens", 0)
                   cr += u.get("cache_read_input_tokens", 0)
           print(f, "cache_create=", ci, "cache_read=", cr)

   Run: `python parse.py <session-project-dir>/subagents/workflows/<wf-id>`

## What you should see (the bug)

Probe A -- shared ~14k-token prefix in the USER MESSAGE:

    prewarm   cache_create ~ 39.7k   cache_read ~ 8.7k
    lane-0    cache_create ~ 38.7k   cache_read ~ 9.7k
    lane-1    cache_create ~ 38.7k   cache_read ~ 9.7k
    lane-2    cache_create ~ 38.7k   cache_read ~ 9.7k

-> the shared block is cache-CREATED 4 times. Lanes read only ~10k (the fixed harness
   shell), NOT the shared prefix. No cross-sibling user-message sharing. Cause: `agent()`
   takes a single prompt STRING, so the shared head and the per-lane tail live in one cache
   unit that differs per lane -- no breakpoint can sit between them.

Probe B -- shared content in the built-in agent SYSTEM PROMPT:

    prewarm   cache_create ~ 18.9k   cache_read ~ 8.7k
    lane-0    cache_create ~ 17.6k   cache_read ~ 10k
    lane-1    cache_create ~ 17.6k   cache_read ~ 10k
    lane-2    cache_create ~ 17.6k   cache_read ~ 10k

-> even the SYSTEM PROMPT is re-created per sibling lane. Only the ~10k shell is shared.

Conclusion: cross-lane "create-once" is not achievable in the Workflow tool today --
neither user-message nor system-prompt content is shared across sibling lanes. Within a
single lane, multi-turn caching works fine (`cache_read` dominates across that lane's own
turns); the gap is specifically cross-sibling.

## Why it matters

`cache_creation` bills at 1.25x input, `cache_read` at 0.1x. With sharing, an N-lane
fan-out over a shared prefix would pay ~1x create + (N-1)x read; without it, ~Nx create.
In a real multi-file audit workflow each lane re-created ~200-250k tokens, much of it
identical shared criteria -- a large, avoidable usage multiplier that grows linearly with
lane count.

## Notes

- The numbers above were measured on Claude Code 2.1.158 (Windows). Exact counts vary
  slightly with harness version; the SHAPE is the reproducible signal: lane
  `cache_create` ~= prewarm `cache_create` (re-created, not shared), and lane `cache_read`
  ~= a small fixed shell.
- Workflow scripts forbid `Math.random` / `Date.now` / argless `new Date` (they break
  resume); the probe builds its filler deterministically by index.
