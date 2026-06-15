import { TRAFFIC } from './engine'

// How hard it is to overtake at a circuit, derived from its `straightness` and the ENGINE's own pass
// sensitivity (so the UI can never drift from the sim). The qualitative tier/label is public knowledge (a
// manager knows Monaco is processional); the precise pace-delta estimate is god-mode-only detail.

export type OvertakingTier = 0 | 1 | 2 | 3 | 4 // 0 = very hard … 4 = very easy

const LABELS = ['Very hard', 'Hard', 'Moderate', 'Easy', 'Very easy'] as const
// Red → green, hard → easy. Indexed by tier.
export const OVERTAKING_TIER_COLORS = ['#DC143C', '#F97316', '#EAB308', '#84CC16', '#10B981'] as const

export interface OvertakingRating {
  tier: OvertakingTier
  label: (typeof LABELS)[number]
  color: string   // the tier's red→green colour
  paceEdge: number // estimated s/lap pace delta a pass needs here (god-mode detail)
}

export function overtakingRating(straightness: number | undefined): OvertakingRating {
  const s = Math.max(0, Math.min(1, straightness ?? 0.5))
  const tier: OvertakingTier = s < 0.18 ? 0 : s < 0.38 ? 1 : s < 0.58 ? 2 : s < 0.78 ? 3 : 4
  // The engine's actual per-lap pass chance per second of pace edge at this straightness; invert it for a
  // representative ~10%/lap "you'll get through with persistence" edge.
  const sens = TRAFFIC.OVERTAKE_SENS_MIN * (TRAFFIC.OVERTAKE_SENS_MAX / TRAFFIC.OVERTAKE_SENS_MIN) ** s
  const paceEdge = 0.1 / sens
  return { tier, label: LABELS[tier], color: OVERTAKING_TIER_COLORS[tier], paceEdge }
}
