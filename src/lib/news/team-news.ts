import teamnewsCopy from './teamnews-copy.json'

// Bespoke, historically-grounded copy for known lineage transitions (keyed by lineage id + the year the
// change takes effect, in teamnews-copy.json). Shared by the team-transitions producer and market()'s
// "skip the bespoke key" guard, so it lives in its own module to avoid a producer<->engine import cycle.
export const TEAMNEWS = teamnewsCopy as Record<string, { h: string[]; d: string[]; b: string[][] }>
