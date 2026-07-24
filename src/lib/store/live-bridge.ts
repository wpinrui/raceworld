import type { LiveRace } from '@/lib/sim/live'

// The live-engine bridge (#live-engine): the race page's hook parks the running LiveRace here so the
// race store's command actions (push, pit wall, god mode) can write straight into the engine — one
// source of truth, no queues. Null whenever no played race is live (headless sims never set it).
export const liveBridge: { current: LiveRace | null } = { current: null }
