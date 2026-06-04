// Shared career-milestone thresholds (issue #19) — the single source of truth for both the newsroom
// (src/lib/news/engine.ts) and the World driver page (src/lib/world/milestones.ts), so the two never
// drift apart. First ever, then every step: 50 starts, 250 points, 10 podiums, 5 wins, 5 poles.
// Pure + client-safe (no DB / server imports).

export type MilestoneCat = 'starts' | 'points' | 'podiums' | 'wins' | 'poles'

export const MILESTONE_STEP: Record<MilestoneCat, number> = {
  starts: 50, points: 250, podiums: 10, wins: 5, poles: 5,
}

// The single milestone value crossed between `before` and `after`, or null. Crossing into 1 (the first
// ever) is always a milestone; thereafter each multiple of the step. A single increment crosses at most
// one threshold (steps far exceed any one-race gain), so one value suffices for the per-race newsroom.
export function milestoneCrossed(cat: MilestoneCat, before: number, after: number): number | null {
  if (before < 1 && after >= 1) return 1
  const s = MILESTONE_STEP[cat]
  if (after >= s && Math.floor(after / s) > Math.floor(before / s)) return Math.floor(after / s) * s
  return null
}

// Every milestone threshold reached at `total`: [1, step, 2·step, …] ≤ total. A caller can diff two
// totals to find ALL thresholds crossed in a single jump (e.g. several poles banked in one season).
export function milestonesReached(cat: MilestoneCat, total: number): number[] {
  if (total < 1) return []
  const out = [1]
  const s = MILESTONE_STEP[cat]
  for (let v = s; v <= total; v += s) out.push(v)
  return out
}
