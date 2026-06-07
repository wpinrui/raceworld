import type { Driver, Team } from '@/lib/sim/types'
import { overall, OVERALL_WEIGHTS, DEVELOP_RATES, DECLINE_RATES } from '@/lib/sim/progression'
import { historicalDrivers } from '@/data/history/drivers'
import { historicalGrids } from '@/data/history/grids'
import type { HistoricalDriver } from '@/data/history/types'

// Builds a season's Driver[]/Team[] from the real-world timeline. Mid-career drivers are
// fast-forwarded to the chosen start year by a deterministic (RNG-free) projection that mirrors the
// engine's race-by-race development curve (src/lib/sim/progression.ts), so the same start year always
// composes the same grid. From the start year on, the live engine takes over and history diverges.

const RACES_PER_SEASON = 22 // rough average 1996-2026; only used to pace the deterministic projection
type Stats = { pace: number; wetWeatherPace: number; overtaking: number; smoothness: number; consistency: number }
const STAT_KEYS: (keyof Stats)[] = ['pace', 'wetWeatherPace', 'overtaking', 'smoothness', 'consistency']
const round1 = (n: number) => Math.round(n * 10) / 10

// Expected-value (no-RNG) version of one applyRaceProgression tick for a single driver.
// Keep the 15 here in step with progression.ts (races-to-potential pacing of the development curve).
function stepRace(stats: Stats, age: number, peakPotential: number, primeEnd: number): Stats {
  // Mirror the live plateau check: all five rated stats (consistency included) grow until overall
  // reaches peakPotential, the same point applyRaceProgression would stop (issue #59).
  const ov = overall(stats)
  const next = { ...stats }
  if (age < primeEnd) {
    if (ov >= peakPotential) return stats
    const yearsTillPrime = Math.max(0.001, primeEnd - age)
    const racesToPotential = Math.max(1, 15 * yearsTillPrime)
    const gap = peakPotential - ov
    const gain = Math.min(gap, (gap / racesToPotential) * 1.5) // per-race median
    // Per-attribute develop rates (#66), shared with live progression so composed grids match.
    for (const k of STAT_KEYS) next[k] = Math.min(100, round1(stats[k] + gain * DEVELOP_RATES[k]))
  } else {
    const declineMedian = 0.04 * (age - primeEnd + 1)
    for (const k of STAT_KEYS) next[k] = Math.max(20, round1(stats[k] - declineMedian * DECLINE_RATES[k]))
  }
  return next
}

// Neutral placeholders for any rating not yet signed off, so bios can be encoded before the ratings
// pass. A driver with no ratings projects as a generic midfielder.
const DEFAULTS = { pace: 70, wetWeatherPace: 70, overtaking: 70, smoothness: 70, consistency: 70, peakPotential: 78, primeEnd: 31, narrativeModifier: 0 }
const peakOf = (h: HistoricalDriver) => h.peakPotential ?? DEFAULTS.peakPotential
const primeEndOf = (h: HistoricalDriver) => h.primeEnd ?? DEFAULTS.primeEnd

// A seated driver's initial contract length (1-3 years), spread by a stable hash of the id so a
// composed grid's seats DON'T all expire in the same year (which would dump the whole field onto the
// market at once). Deterministic, so the same start year always composes the same grid.
function initialContractYears(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  // 0-3 years, weighted to 0-2 (each ~30%) with the occasional 3-year deal (~10%). Crucially this INCLUDES
  // 0 (expires after the first season), so a chunk of the grid reaches the market each off-season, the very
  // first one included. Otherwise no deal expires in year one and silly season / the market never fire then.
  const r = h % 10
  return r < 9 ? Math.floor(r / 3) : 3
}

// Per-attribute develop rates (#66) make pace climb far more than wet/smoothness over a career, which
// would skew composed drivers' PRIME profiles — the authored entry ratings were balanced for the OLD
// uniform curve. Re-balance each driver's ENTRY so the SAME prime is reached under the new differential
// curve: spread the development headroom across attributes by their rate. Fast-developing stats (pace)
// start lower; slow ones (wet, smoothness) start nearer their prime. The shift is overall-neutral at
// entry, and because that leaves the headroom D unchanged it EXACTLY preserves the prime the old uniform
// curve produced (prime[s] = entry[s] + D). adj[s] = D * (1 - devRate[s] / W); a plain 1/devRate scaling
// would overshoot wildly since development is additive on the headroom, not multiplicative on the rating.
const DEV_W = STAT_KEYS.reduce((sum, k) => sum + OVERALL_WEIGHTS[k] * DEVELOP_RATES[k], 0)
function retuneEntry(stats: Stats, peakPotential: number, primeEnd: number, ageAtEntry: number): Stats {
  if (ageAtEntry >= primeEnd) return stats // enters already in decline — no development to compensate for
  const headroom = Math.max(0, peakPotential - overall(stats))
  const out = { ...stats }
  for (const k of STAT_KEYS) {
    out[k] = round1(Math.max(0, Math.min(100, stats[k] + headroom * (1 - DEVELOP_RATES[k] / DEV_W))))
  }
  return out
}

// Project a driver's ratings + age from market entry forward to `targetYear`.
export function projectToYear(h: HistoricalDriver, targetYear: number): { stats: Stats; age: number } {
  let stats: Stats = {
    pace: h.pace ?? DEFAULTS.pace, wetWeatherPace: h.wetWeatherPace ?? DEFAULTS.wetWeatherPace,
    overtaking: h.overtaking ?? DEFAULTS.overtaking, smoothness: h.smoothness ?? DEFAULTS.smoothness,
    consistency: h.consistency ?? DEFAULTS.consistency,
  }
  // Re-balance the authored entry for the per-attribute curve before projecting forward (#66).
  stats = retuneEntry(stats, peakOf(h), primeEndOf(h), h.ageAtEntry)
  let age = h.ageAtEntry
  for (let y = h.marketEntryYear; y < targetYear; y++) {
    for (let r = 0; r < RACES_PER_SEASON; r++) stats = stepRace(stats, age, peakOf(h), primeEndOf(h))
    age += 1
  }
  return { stats, age }
}

function toDriver(h: HistoricalDriver, teamId: string, year: number): Driver {
  const { stats, age } = projectToYear(h, year)
  const seated = teamId !== ''
  return {
    id: h.id, name: h.name, teamId, nationality: h.nationality, gender: h.gender,
    pace: stats.pace, wetWeatherPace: stats.wetWeatherPace, overtaking: stats.overtaking, smoothness: stats.smoothness,
    consistency: stats.consistency,
    age, peakPotential: peakOf(h), primeEnd: primeEndOf(h), narrativeModifier: h.narrativeModifier ?? DEFAULTS.narrativeModifier,
    // Seated drivers carry a staggered 0-3 year contract, mostly 0-2 (see initialContractYears), so the
    // market churns only part of the grid each off-season but ALWAYS has some seats open, the first season
    // included; free agents are already out of contract (year - 1).
    contractExpiresAfterSeason: seated ? year + initialContractYears(h.id) : year - 1,
    seasonsSinceF1Seat: 0,
    debutYear: h.marketEntryYear, // real debut, so the newsroom never calls an established driver a rookie
  }
}

// Constructors-championship order (best first) -> the engine's 75/70/65/... pace ranking.
function carPaceForRank(rank: number): number {
  return Math.max(5, 75 - rank * 5)
}

export function historyYears(): number[] {
  return historicalGrids.map((g) => g.year).sort((a, b) => a - b)
}

// The default new-game start year: the most recent season with real-world data. Nothing is special
// about any single year — add a later grid and this moves forward on its own.
export const DEFAULT_START_YEAR = Math.max(...historicalGrids.map((g) => g.year))

// The default new-game grid: the latest season, composed from the timeline via the same path as any
// other year (replaces the old bespoke 2026-grid.ts).
export function composeDefaultSeason(): { drivers: Driver[]; teams: Team[] } {
  return composeSeason(DEFAULT_START_YEAR)!
}

export function hasHistoryYear(year: number): boolean {
  return historicalGrids.some((g) => g.year === year)
}

// The last year for which the real-world driver dataset still feeds the market. Past this, there are
// no more real rookies, so the game falls back to generating fictional free agents.
export function lastDriverEntryYear(): number {
  return historicalDrivers.reduce((max, d) => Math.max(max, d.marketEntryYear), 0)
}

// The real drivers entering the market in `year`, as free agents (projected to that year). Used to
// feed the pool each season instead of generating fictional drivers, while the timeline has data.
export function rookiesForYear(year: number): Driver[] {
  return historicalDrivers.filter((d) => d.marketEntryYear === year).map((d) => toDriver(d, '', year))
}

// Build the full grid (seated drivers + that year's incoming rookies as free agents) and teams for a
// historical season. Returns null if there's no data for that year.
export function composeSeason(year: number): { drivers: Driver[]; teams: Team[] } | null {
  const grid = historicalGrids.find((g) => g.year === year)
  if (!grid) return null

  const byId = new Map(historicalDrivers.map((d) => [d.id, d]))
  // De-dupe teams by id defensively (a stray duplicate in the source must not double a constructor).
  const seenTeam = new Set<string>()
  const teams: Team[] = grid.teams
    .filter((t) => (seenTeam.has(t.id) ? false : (seenTeam.add(t.id), true)))
    .map((t, i) => ({ id: t.id, name: t.name, shortName: t.shortName, nationality: t.nationality, color: t.color, carPace: carPaceForRank(i) }))

  const seatedIds = new Set<string>()
  const drivers: Driver[] = []
  for (const seat of grid.lineup) {
    if (seatedIds.has(seat.driverId)) continue // never seat the same driver twice
    const h = byId.get(seat.driverId)
    if (!h) continue // unknown driver id in the lineup; skipped (data not yet filled)
    seatedIds.add(h.id)
    drivers.push(toDriver(h, seat.teamId, year))
  }
  // Real rookies who enter the market this exact year but aren't seated start as free agents.
  for (const h of historicalDrivers) {
    if (h.marketEntryYear === year && !seatedIds.has(h.id)) drivers.push(toDriver(h, '', year))
  }

  return { drivers, teams }
}
