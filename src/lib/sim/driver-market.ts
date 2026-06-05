import type { Driver, Team } from './types'
import { sampleNormal } from './rng-utils'

// Two-phase driver market (replaces the old Gale–Shapley runDriverMarket for the ACTUAL off-season
// moves; the news rumour producers still use runDriverMarket for speculation). The media evaluation
// (computeDriverMediaScores) is the input; this module is purely the PROCESS.
//
//  Phase 1 (round 18, in-season): teams negotiate renewals with their expiring drivers. A renewal is
//  likelier the closer the driver's grid-wide media percentile is to the team's WCC percentile.
//  Phase 2 (end of season): an NBA-draft-style fill of the open seats — best seat first, each pool
//  driver weighted by a normalised geometric over the media ranking, with contract length driven by
//  how PROBABLE the realised placement was across the whole sequential draft.

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// rank 0 = best; percentile 100 = best, 0 = worst.
function rankPercentiles(orderBestFirst: string[]): Map<string, number> {
  const n = orderBestFirst.length
  const out = new Map<string, number>()
  orderBestFirst.forEach((id, i) => out.set(id, n > 1 ? ((n - 1 - i) / (n - 1)) * 100 : 50))
  return out
}

// ---------- Phase 1: round-18 renewals ----------

export interface RenewalResult {
  driverId: string
  driverName: string
  teamId: string
  teamName: string
  years: number
  driverPct: number
  teamPct: number
  diff: number
}

// Renewal probability: 75% while the percentile gap is <= 15, decaying linearly to 0% at a gap of 30.
export function renewalChance(diff: number): number {
  if (diff <= 15) return 0.75
  if (diff >= 30) return 0
  return 0.75 * ((30 - diff) / 15)
}

// Closer match => longer deal, but skewed low so 1-2 year deals dominate and 3-4 are rare (F1-realistic).
function renewalYears(diff: number, rng: () => number): number {
  const closeness = Math.max(0, 1 - diff / 30) // 1 at a perfect match, 0 at the 30-pt edge
  const meanLen = 1 + 1.5 * closeness          // <= 2.5
  return clamp(Math.round(sampleNormal(meanLen, 0.7, rng)), 1, 4)
}

export function negotiateRenewals(opts: {
  drivers: Driver[]
  teams: Team[]
  mediaScore: Map<string, number> // seated drivers' media (through round 18)
  wccOrderBestFirst: string[]     // team ids, best WCC position first (through round 18)
  currentYear: number
  rng: () => number
}): { drivers: Driver[]; renewals: RenewalResult[] } {
  const { drivers, teams, mediaScore, wccOrderBestFirst, currentYear, rng } = opts
  const seated = drivers.filter((d) => d.teamId !== '')
  const driverOrder = [...seated].sort((a, b) => (mediaScore.get(b.id) ?? 0) - (mediaScore.get(a.id) ?? 0)).map((d) => d.id)
  const driverPct = rankPercentiles(driverOrder)
  const teamPct = rankPercentiles(wccOrderBestFirst)
  const teamName = new Map(teams.map((t) => [t.id, t.name]))

  const renewals: RenewalResult[] = []
  const updated = drivers.map((d) => {
    if (d.teamId === '' || d.contractExpiresAfterSeason > currentYear) return d // not expiring this year
    const dp = driverPct.get(d.id) ?? 50
    const tp = teamPct.get(d.teamId) ?? 50
    const diff = Math.abs(dp - tp)
    if (rng() >= renewalChance(diff)) return d // talks fail -> stays expiring -> enters the draft
    const years = renewalYears(diff, rng)
    renewals.push({ driverId: d.id, driverName: d.name, teamId: d.teamId, teamName: teamName.get(d.teamId) ?? d.teamId, years, driverPct: dp, teamPct: tp, diff })
    return { ...d, contractExpiresAfterSeason: currentYear + years }
  })
  return { drivers: updated, renewals }
}

// ---------- Round-15 contract watch (the "could do better / right place / lucky" preview) ----------

export type ContractVerdict = 'could_do_better' | 'right_place' | 'lucky'

export interface ContractWatch {
  driverId: string
  driverName: string
  teamId: string
  teamName: string
  verdict: ContractVerdict
  driverPct: number // grid-wide media percentile (100 = best-rated driver)
  teamPct: number   // WCC percentile (100 = championship-leading team)
  diff: number      // driverPct - teamPct (signed): +ve = outdriving the seat, -ve = flattered by it
}

const WATCH_BAND = 15 // within this percentile gap, the driver is judged to be in the right place

// Reads the expiring contracts shortly before the renewal window and judges each, from the driver's
// perspective, against the seat: a highly-rated driver in a weak car "could do better"; a modestly-rated
// one in a strong car would be "lucky" to be kept; a close match is in the "right place".
export function assessExpiringContracts(opts: {
  drivers: Driver[]
  teams: Team[]
  mediaScore: Map<string, number>
  wccOrderBestFirst: string[]
  currentYear: number
}): ContractWatch[] {
  const { drivers, teams, mediaScore, wccOrderBestFirst, currentYear } = opts
  const seated = drivers.filter((d) => d.teamId !== '')
  const driverOrder = [...seated].sort((a, b) => (mediaScore.get(b.id) ?? 0) - (mediaScore.get(a.id) ?? 0)).map((d) => d.id)
  const driverPct = rankPercentiles(driverOrder)
  const teamPct = rankPercentiles(wccOrderBestFirst)
  const teamName = new Map(teams.map((t) => [t.id, t.name]))

  const out: ContractWatch[] = []
  for (const d of seated) {
    if (d.contractExpiresAfterSeason > currentYear) continue // not expiring this year
    const dp = driverPct.get(d.id) ?? 50
    const tp = teamPct.get(d.teamId) ?? 50
    const diff = dp - tp
    const verdict: ContractVerdict = diff > WATCH_BAND ? 'could_do_better' : diff < -WATCH_BAND ? 'lucky' : 'right_place'
    out.push({ driverId: d.id, driverName: d.name, teamId: d.teamId, teamName: teamName.get(d.teamId) ?? d.teamId, verdict, driverPct: dp, teamPct: tp, diff })
  }
  return out
}

// ---------- Phase 2: the draft ----------

export type DraftFlavour = 'statement' | 'upset' | 'rookie' | 'veteran_short' | 'chalk'

export interface DraftSeat { teamId: string; teamName: string; teamColor: string }
export interface DraftOdds { driverId: string; driverName: string; pct: number }
export interface DraftPick {
  teamId: string
  teamName: string
  teamColor: string
  driverId: string
  driverName: string
  prevTeamName: string // where they came from ('' = free agent / pool)
  faRank: number       // the driver's free-agent ranking (1 = best available)
  seatRank: number     // 0 = most desirable open seat
  pickPct: number      // marginal % for THIS seat (the headline odd)
  realizedProb: number // whole-process survival probability (drives contract length)
  years: number
  flavour: DraftFlavour
  odds: DraftOdds[]     // top 10 of the remaining pool at this seat, for the board
}

// Normalised truncated geometric over a pool of size K: rank i (0-based) gets (1/2)^(i+1) / (1-(1/2)^K),
// so the probabilities sum to exactly 1 for a finite pool (the favourite is ~1/2, tapering down).
function geometricProbs(k: number): number[] {
  const denom = 1 - Math.pow(0.5, k)
  return Array.from({ length: k }, (_, i) => Math.pow(0.5, i + 1) / denom)
}

// Contract length from the realised whole-process probability: more expected placement => longer deal,
// skewed low (1-2 common). Anchor 0.5 = the most expected single signing (favourite takes top seat).
function draftYears(realizedProb: number, rng: () => number): number {
  const meanLen = 1 + 1.5 * Math.min(1, realizedProb / 0.5)
  return clamp(Math.round(sampleNormal(meanLen, 0.7, rng)), 1, 4)
}

function isRookieDriver(d: Driver, currentYear: number): boolean {
  if (d.id.startsWith('rookie-')) return true
  if (d.debutYear != null) return d.debutYear >= currentYear
  return false
}

function flavourOf(d: Driver, seatRank: number, pickPct: number, years: number, currentYear: number): DraftFlavour {
  if (pickPct < 12) return 'upset'              // a longshot landed this seat
  if (isRookieDriver(d, currentYear)) return 'rookie'
  if (seatRank < 3 && years >= 3) return 'statement'
  if (d.age > d.primeEnd && years === 1) return 'veteran_short'
  return 'chalk'
}

// seats: open seats, MOST desirable first. pool: free agents, HIGHEST media first. Returns one pick per
// seat (until the pool runs out — the caller tops up with rookies). Deterministic given rng.
export function runDraft(opts: {
  seats: DraftSeat[]
  pool: Driver[]
  teams: Team[]
  currentYear: number
  rng: () => number
}): DraftPick[] {
  const { seats, pool, teams, currentYear, rng } = opts
  const teamName = new Map(teams.map((t) => [t.id, t.name]))
  const poolRank = new Map(pool.map((d, i) => [d.id, i + 1])) // free-agent ranking (1 = best), fixed for the window
  const remaining = [...pool]
  const survival = new Map<string, number>(remaining.map((d) => [d.id, 1]))
  const picks: DraftPick[] = []

  seats.forEach((seat, seatRank) => {
    if (remaining.length === 0) return
    const probs = geometricProbs(remaining.length)
    // sample the pick
    const roll = rng()
    let acc = 0
    let idx = remaining.length - 1
    for (let i = 0; i < probs.length; i++) { acc += probs[i]; if (roll <= acc) { idx = i; break } }
    const driver = remaining[idx]
    const pickPct = probs[idx] * 100
    const realizedProb = (survival.get(driver.id) ?? 1) * probs[idx]
    const years = draftYears(realizedProb, rng)
    // All remaining free agents, in order (not just the favourites).
    const odds: DraftOdds[] = remaining.map((d, i) => ({ driverId: d.id, driverName: d.name, pct: Math.round(probs[i] * 1000) / 10 }))

    picks.push({
      teamId: seat.teamId, teamName: seat.teamName, teamColor: seat.teamColor,
      driverId: driver.id, driverName: driver.name,
      prevTeamName: driver.teamId !== '' ? (teamName.get(driver.teamId) ?? '') : '',
      faRank: poolRank.get(driver.id) ?? seatRank + 1,
      seatRank, pickPct: Math.round(pickPct * 10) / 10, realizedProb, years,
      flavour: flavourOf(driver, seatRank, pickPct, years, currentYear),
      odds,
    })

    // every survivor's chance of NOT being taken this round compounds into their survival product
    remaining.forEach((d, i) => { if (d.id !== driver.id) survival.set(d.id, (survival.get(d.id) ?? 1) * (1 - probs[i])) })
    remaining.splice(idx, 1)
  })

  return picks
}
