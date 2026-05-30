export const meta = {
  name: 'cache-prefix-probe-A',
  description: 'Structure A probe: shared text at the FRONT of each lane prompt + a pre-warm pass, then fan out. Measures whether sibling lanes share the cached USER-MESSAGE prefix.',
  phases: [
    { title: 'Prewarm', detail: 'one agent writes the shared prefix to cache' },
    { title: 'Lanes', detail: 'three identical-prefix lanes; measure cache create vs read' },
  ],
}

// Build a large, deterministic, byte-identical shared prefix (~14k tokens) via
// pure concatenation. Workflow scripts forbid Math.random / Date.now / argless
// new Date (they break resume), so the filler varies only by loop index.
const para = 'CACHE PROBE FILLER. This paragraph is repeated verbatim to form a large, stable, byte-identical cacheable prefix shared across every lane. It carries no per-lane information; it exists only to occupy a big span of input tokens so the cached-versus-created split is measurable in the transcript. '
let block = ''
for (let i = 0; i < 200; i++) {
  block += para + 'Segment ' + i + '. '
}
const SHARED_PREFIX = 'You are part of a caching probe. Below is a large shared document. Read it silently; do not summarize it.\n\n===BEGIN SHARED DOCUMENT===\n' + block + '\n===END SHARED DOCUMENT===\n'

phase('Prewarm')
await agent(
  SHARED_PREFIX + '\n\nThis is the PRE-WARM pass. Reply with exactly the single word: WARMED. Do not use any tools.',
  { label: 'prewarm', phase: 'Prewarm' }
)

phase('Lanes')
const N = 3
const lanes = await parallel(
  Array.from({ length: N }, (_, i) => () =>
    agent(
      SHARED_PREFIX + '\n\nLANE TASK ' + i + ': reply with exactly the single word: DONE. Do not use any tools.',
      { label: 'lane-' + i, phase: 'Lanes' }
    )
  )
)
log('A probe complete: ' + lanes.filter(Boolean).length + '/' + N + ' lanes returned')
return { lanes: lanes }
