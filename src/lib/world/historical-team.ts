import type { Team } from '@/lib/sim/types'
import { historicalGrids } from '@/data/history/grids'
import { composeDefaultSeason } from '@/lib/history/compose'

// Resolve a team's nationality / colour by id, including teams that have dropped off the live grid (Arrows,
// Prost, Footwork, …). The live grid wins (current truth); otherwise fall back to the historical datasets,
// which carry every team's nationality and colour. Built once and cached — the historical data is static.

let natCache: Map<string, string> | null = null
let colorCache: Map<string, string> | null = null

function build() {
  natCache = new Map()
  colorCache = new Map()
  // Later grids overwrite earlier, so each id ends on its most-recent historical name/colour.
  for (const g of historicalGrids) for (const t of g.teams) {
    if (t.nationality) natCache.set(t.id, t.nationality)
    if (t.color) colorCache.set(t.id, t.color)
  }
  for (const t of composeDefaultSeason().teams) {
    if (t.nationality) natCache.set(t.id, t.nationality)
    if (t.color) colorCache.set(t.id, t.color)
  }
}

export function resolveTeamNationality(id: string, liveTeams: Team[]): string {
  const live = liveTeams.find((t) => t.id === id)?.nationality
  if (live) return live
  if (!natCache) build()
  return natCache!.get(id) ?? ''
}

export function resolveTeamColor(id: string, liveTeams: Team[]): string {
  const live = liveTeams.find((t) => t.id === id)?.color
  if (live) return live
  if (!colorCache) build()
  return colorCache!.get(id) ?? '#6B7280'
}
