// Era-dependent pit-lane time loss (issue #101). A SINGLE year-driven source so the runtime penalty
// (race.ts) and the strategy planner (pit-ai.ts) read the same value instead of diverging. The game
// runs 1996+; refuelling is not modelled, so this is a pure tyre-change loss. Modern stops are
// dominated by the pit-lane transit at the speed limit (in place since 1994), so the loss is ~22s and
// fairly flat; the late-90s/2000s lose a few seconds more on slower crews and equipment. Mirrors the
// era approach of perRaceTechnicalDNF(year) in reliability.ts.
//
// Anchors: 1996 ~30s, 2000 ~27s, 2009 ~24s, 2014 ~23s, 2026 ~22s.
export function pitLaneLoss(year: number): number {
  if (!Number.isFinite(year)) year = 2026 // defensive: never NaN-out the curve
  return Math.max(22, Math.min(32, 22 + 8 * Math.exp(-(year - 1996) / 10)))
}

// Extra time the LATTER of two double-stacking teammates loses: they pit the same lap within a
// pit-stop's worth of each other on track, so the crew is still busy and the second car waits. This is
// the "crew busy" / stationary portion, which shrank most over the era. Anchors: 1996 ~11s, 2026 ~3s.
export function doubleStackPenalty(year: number): number {
  if (!Number.isFinite(year)) year = 2026
  return Math.max(3, Math.min(12, 3 + 8 * Math.exp(-(year - 1996) / 10)))
}
