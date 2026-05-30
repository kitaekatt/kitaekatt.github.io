export const meta = {
  name: 'cache-sysprompt-probe-B',
  description: 'Structure B probe: rely on the large fixed SYSTEM PROMPT of a built-in agent type as the shared surface. Pre-warm then fan out sibling lanes; measure whether the system prompt is shared across siblings.',
  phases: [
    { title: 'Prewarm', detail: 'one built-in agent warms its system prompt' },
    { title: 'Lanes', detail: 'three sibling lanes of the same built-in type; measure sharing' },
  ],
}

// Built-in agent types carry a large fixed system prompt. If ANY large shared
// surface were reused across sibling lanes, this is the one. We pre-warm one
// lane (creates the system-prompt cache), then fan out three more of the same
// type and measure whether they READ that system prompt or RE-CREATE it.

phase('Prewarm')
await agent('Reply with exactly the single word DONE and nothing else. Do not use any tools.',
  { label: 'prewarm', phase: 'Prewarm', agentType: 'general-purpose' })

phase('Lanes')
const N = 3
const lanes = await parallel(
  Array.from({ length: N }, (_, i) => () =>
    agent('Task ' + i + ': reply with exactly the single word DONE and nothing else. Do not use any tools.',
      { label: 'lane-' + i, phase: 'Lanes', agentType: 'general-purpose' })
  )
)
log('B probe complete: ' + lanes.filter(Boolean).length + '/' + N + ' lanes returned')
return { lanes: lanes }
