// Server-side assembly for the "remember this driver?" legends series (#93). Runs ONLY where the
// archive DB is reachable (the news actions, the archived-snapshot build, the playthrough script) —
// never on the client. It selects which retired drivers to feature this year and builds each one's
// fact profile from per-race / per-season / all-time queries. The engine's `legends` producer then
// renders prose from these facts; it does no DB work and degrades to nothing when the data is absent.

import { mulberry32 } from './util'
import type { LegendDataset, LegendFeature, LegendProfile } from './engine'
import { RETIREMENT_SEASONS_OUT } from '@/lib/sim/free-agency'
import { calendarForYear } from '@/data/calendars'
import { historicalDrivers } from '@/data/history/drivers'
import {
  getAllTimeDriverStats,
  getAllSeasonChampions,
  getDriverCareerBySeason,
  getDriverArchivedRaces,
  getDriverTeammateRaces,
  getDriverFinishInSeason,
  getArchivedSeasonIdByYear,
  getSeasonDriversForTeam,
  getSeasonStandings,
  getTeamFinalPositionInSeason,
  getDriverGenders,
  type AllTimeDriverStat,
  type SeasonChampions,
} from '@/lib/db/queries'

// Gender for a retired driver, for the producer's gendered pronouns. The archive stores none, so resolve
// from the live-captured `driver_genders` table (covers generated drivers), then the static history data
// (covers a real roster), defaulting to male (the generated split is ~95% male, and history is all male).
function buildGenderResolver(): (id: string) => string {
  const table = getDriverGenders()
  const history = new Map(historicalDrivers.map((d) => [d.id, d.gender as string]))
  return (id) => table[id] ?? history.get(id) ?? 'male'
}

// Three legends drop per year, on a fixed 4-month grid. The dates are ordering keys for the feed and
// the Continue-loop interrupt; colliding with a race weekend is harmless (the feed sorts by date).
const SLOT_DATES = ['02-14', '06-14', '10-14'] as const

// A legend candidate is a driver who RACED and then stopped for at least RETIREMENT_SEASONS_OUT seasons.
// This is read PURELY FROM THE ARCHIVE (lastYear is their final race), never from the live roster. Tying
// it to s.drivers (an earlier mistake) made selection depend on a mutable, lumpy input: the game removes
// seatless drivers from the pool erratically via applyMarketAttrition, which both starved the series for
// years at a stretch and — because the roster shifts every season — reshuffled past picks and re-featured
// drivers already shown. An archive-only test is stable: a retired driver's lastYear never moves, so the
// whole schedule replays identically every season. (An active driver's lastYear is recent, so the distance
// guard already excludes them; there is no need to consult the live pool.)
function eligibleAsOf(stats: AllTimeDriverStat[], year: number): AllTimeDriverStat[] {
  return stats.filter((s) => s.races > 0 && s.lastYear <= year - RETIREMENT_SEASONS_OUT)
}

// Deterministic, replayable selection. Walk every year from the series' first eligible year up to
// `throughYear`, picking one fresh legend per 4-month slot and never repeating across the whole save.
// Only `throughYear`'s picks are returned (past years live in their own archived snapshots). The same
// (saveSeed, archive) always yields identical picks, so regenerating the feed is stable.
export function selectLegendPicks(
  stats: AllTimeDriverStat[],
  throughYear: number,
  saveSeed: string,
): { driverId: string; date: string }[] {
  // Sort by id FIRST: getAllTimeDriverStats() has no ORDER BY, so SQLite's GROUP BY row order is not
  // stable as seasons archive. The seeded index pick below indexes into this order, so without a fixed
  // sort a past year's pick could change after more seasons archive — diverging from the stored snapshot
  // and breaking the never-repeat invariant. A stable id sort makes selection fully replayable.
  const ordered = [...stats].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const everEligible = eligibleAsOf(ordered, throughYear)
  if (everEligible.length === 0) return []
  const firstYear = Math.min(...everEligible.map((s) => s.lastYear)) + RETIREMENT_SEASONS_OUT
  const featured = new Set<string>()
  let thisYear: { driverId: string; date: string }[] = []
  for (let y = firstYear; y <= throughYear; y++) {
    const yearPicks: { driverId: string; date: string }[] = []
    for (let slot = 0; slot < SLOT_DATES.length; slot++) {
      const pool = eligibleAsOf(ordered, y).filter((s) => !featured.has(s.id))
      if (pool.length === 0) break
      const rng = mulberry32(`${saveSeed}|legend|${y}|${slot}`)
      const chosen = pool[Math.floor(rng() * pool.length)]
      featured.add(chosen.id)
      yearPicks.push({ driverId: chosen.id, date: `${y}-${SLOT_DATES[slot]}` })
    }
    if (y === throughYear) thisYear = yearPicks
  }
  return thisYear
}

// Aggregate one driver's archived seasons into a per-year view (a season may hold >1 row when they
// switched teams mid-year; sum the stats and credit the year's team to wherever they scored most).
function perYear(rows: ReturnType<typeof getDriverCareerBySeason>) {
  const byYear = new Map<number, { seasonId: number; teamId: string; team: string; teamPoints: number; wins: number; points: number }>()
  for (const row of rows) {
    const e = byYear.get(row.seasonYear) ?? { seasonId: row.seasonId, teamId: row.teamId, team: row.teamName, teamPoints: -1, wins: 0, points: 0 }
    e.wins += row.wins
    e.points += row.points
    if (row.points > e.teamPoints) { e.team = row.teamName; e.teamId = row.teamId; e.teamPoints = row.points }
    byYear.set(row.seasonYear, e)
  }
  return byYear
}

function buildLegendProfile(
  s: AllTimeDriverStat,
  statsById: Map<string, AllTimeDriverStat>,
  champions: SeasonChampions[],
  championByYear: Map<number, SeasonChampions>,
  gender: string,
): LegendProfile {
  const titleYears = champions.filter((c) => c.driverChampionId === s.id).map((c) => c.year).sort((a, b) => a - b)
  const seasonRows = getDriverCareerBySeason(s.id) // year DESC, id DESC -> [0] is their most recent season+team
  const byYear = perYear(seasonRows)
  // Championship finish per season, memoised (each call rebuilds the whole season's standings).
  const wdcCache = new Map<number, number | null>()
  const wdcOf = (seasonId: number): number | null => {
    if (!wdcCache.has(seasonId)) wdcCache.set(seasonId, getDriverFinishInSeason(seasonId, s.id))
    return wdcCache.get(seasonId)!
  }

  // Distinct teams driven for, most-raced first — so even a thin career names the team(s).
  const teamRaces = new Map<string, number>()
  for (const row of seasonRows) teamRaces.set(row.teamName, (teamRaces.get(row.teamName) ?? 0) + row.races)
  const teams = [...teamRaces.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)

  // Best season: most wins (points break ties). The defining year for the brilliance beat.
  let bestSeason: LegendProfile['bestSeason']
  let bestY = -1
  let bestKey = { wins: -1, points: -1 }
  for (const [y, e] of byYear) {
    if (e.wins > bestKey.wins || (e.wins === bestKey.wins && e.points > bestKey.points)) {
      bestKey = { wins: e.wins, points: e.points }
      bestY = y
    }
  }
  if (bestY > 0) {
    const e = byYear.get(bestY)!
    bestSeason = { year: bestY, team: e.team, wins: e.wins, points: Math.round(e.points), wccPos: wdcOf(e.seasonId) }
  }

  // Signature win: a victory from the furthest back on the grid (the biggest charge); latest breaks ties.
  let signatureWin: LegendProfile['signatureWin']
  const wins = getDriverArchivedRaces(s.id).filter((r) => r.finishPosition === 1 && r.gridPosition > 0)
  if (wins.length) {
    const top = wins.reduce((a, b) => (b.gridPosition >= a.gridPosition ? b : a))
    const circuit = calendarForYear(top.year)[top.round - 1]?.name ?? ''
    signatureWin = { year: top.year, circuit, fromGrid: top.gridPosition }
  }

  // Near-misses: seasons finished championship runner-up without taking the crown that year.
  const runnerUpYears: number[] = []
  for (const [y, e] of byYear) {
    if (titleYears.includes(y)) continue
    if (wdcOf(e.seasonId) === 2) runnerUpYears.push(y)
  }
  runnerUpYears.sort((a, b) => a - b)

  // Teammate head-to-head against their most-shared teammate (the merit reference for the ousting beat).
  const tmRaces = getDriverTeammateRaces(s.id)
  const tmGroups = new Map<string, typeof tmRaces>()
  for (const r of tmRaces) { const g = tmGroups.get(r.teammateId) ?? []; g.push(r); tmGroups.set(r.teammateId, g) }
  let teammateH2H: LegendProfile['teammateH2H']
  if (tmGroups.size) {
    let main: typeof tmRaces = []
    for (const g of tmGroups.values()) if (g.length > main.length) main = g
    let qualWins = 0, qualLosses = 0, raceWins = 0, raceLosses = 0
    const years = new Set<number>()
    for (const r of main) {
      years.add(r.year)
      if (r.myGrid && r.mateGrid) { if (r.myGrid < r.mateGrid) qualWins++; else if (r.myGrid > r.mateGrid) qualLosses++ }
      const meOut = r.myDnf || r.myFinish == null, mateOut = r.mateDnf || r.mateFinish == null
      if (!meOut && !mateOut) { if (r.myFinish! < r.mateFinish!) raceWins++; else if (r.myFinish! > r.mateFinish!) raceLosses++ }
    }
    const ys = [...years].sort((a, b) => a - b)
    teammateH2H = { teammate: main[0].teammateName, years: ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : `${ys[0]}`, qualWins, qualLosses, raceWins, raceLosses }
  }

  // Successor: whoever took their last seat the next season, and what they made of it.
  let successor: LegendProfile['successor']
  if (seasonRows.length) {
    const last = seasonRows[0]
    const nextId = getArchivedSeasonIdByYear(last.seasonYear + 1)
    if (nextId != null) {
      const taken = getSeasonDriversForTeam(nextId, last.teamId)
        .filter((d) => d.driverId !== s.id)
        .map((d) => statsById.get(d.driverId))
        .filter((x): x is AllTimeDriverStat => !!x)
        .sort((a, b) => (b.wdc - a.wdc) || (b.wins - a.wins))
      if (taken.length) successor = { name: taken[0].name, wins: taken[0].wins, titles: taken[0].wdc }
    }
  }

  // Rivals: the people who defined their era — title rivals in their strong seasons, their main
  // teammates, and (failing those) the drivers they finished alongside at their peak. Ranked
  // title > teammate > peer, deduped, capped. Stature comes from each rival's own all-time totals.
  const rivals: LegendProfile['rivals'] = []
  const seen = new Set<string>([s.id])
  const addRival = (id: string | null, relation: 'teammate' | 'title' | 'peer') => {
    if (!id || seen.has(id) || rivals.length >= 6) return
    const r = statsById.get(id)
    if (!r) return
    seen.add(id)
    rivals.push({ name: r.name, relation, titles: r.wdc, wins: r.wins })
  }
  for (const [y, e] of byYear) {
    const finish = wdcOf(e.seasonId)
    if (finish != null && finish <= 3) {
      const champ = championByYear.get(y)
      if (champ && champ.driverChampionId !== s.id) addRival(champ.driverChampionId, 'title')
    }
  }
  const mates = [...tmGroups.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [id] of mates) addRival(id, 'teammate')
  if (rivals.length < 2 && bestSeason) {
    const order = getSeasonStandings(byYear.get(bestSeason.year)!.seasonId).driverStandings
    const i = order.findIndex((d) => d.driverId === s.id)
    if (i >= 0) for (const j of [i - 1, i + 1, i - 2, i + 2]) if (order[j]) addRival(order[j].driverId, 'peer')
  }

  // Peak championship finish (lower = better) with the car's WCC level that year — the "fought for Nth"
  // position story plus the machinery read (a high driver finish in a weak car means they dragged it up).
  let peak: LegendProfile['peak'] = null
  for (const [y, e] of byYear) {
    const wdc = wdcOf(e.seasonId)
    if (wdc != null && (!peak || wdc < peak.wdc)) peak = { wdc, year: y, team: e.team, teamWcc: getTeamFinalPositionInSeason(e.seasonId, e.teamId) }
  }

  // The most-shared team-mate head-to-head WITHIN one year — used for the final-season read.
  const tmH2HForYear = (yr: number): { name: string; qual: string; race: string; beaten: boolean } | null => {
    const races = tmRaces.filter((r) => r.year === yr)
    if (!races.length) return null
    const grp = new Map<string, typeof races>()
    for (const r of races) { const g = grp.get(r.teammateId) ?? []; g.push(r); grp.set(r.teammateId, g) }
    let main: typeof races = []
    for (const g of grp.values()) if (g.length > main.length) main = g
    let qW = 0, qL = 0, rW = 0, rL = 0
    for (const r of main) {
      if (r.myGrid && r.mateGrid) { if (r.myGrid < r.mateGrid) qW++; else if (r.myGrid > r.mateGrid) qL++ }
      const mo = r.myDnf || r.myFinish == null, bo = r.mateDnf || r.mateFinish == null
      if (!mo && !bo) { if (r.myFinish! < r.mateFinish!) rW++; else if (r.myFinish! > r.mateFinish!) rL++ }
    }
    return { name: main[0].teammateName, qual: `${qW}–${qL}`, race: `${rW}–${rL}`, beaten: qL + rL > (qW + rW) * 1.5 + 1 }
  }

  // Final season: the team, where they finished, the car's level, and that year's team-mate battle —
  // for the "still had it" vs "outshone by the team-mate, time to go" close.
  let lastSeason: LegendProfile['lastSeason'] = null
  if (seasonRows.length) {
    const lr = seasonRows[0]
    // Who took the seat: a genuinely NEW face at the same team the following season (present then, absent in
    // the driver's final year), and not the driver. Pick deterministically; null if the team folded or kept
    // its line-up. Lets the close name the replacement instead of "the seat went elsewhere".
    let replacedBy: string | null = null
    const nextId = getArchivedSeasonIdByYear(lr.seasonYear + 1)
    if (nextId != null) {
      const before = new Set(getSeasonDriversForTeam(lr.seasonId, lr.teamId).map((d) => d.driverId))
      const arrivals = getSeasonDriversForTeam(nextId, lr.teamId)
        .filter((d) => d.driverId !== s.id && !before.has(d.driverId))
        .sort((a, b) => (a.driverId < b.driverId ? -1 : 1))
      replacedBy = arrivals[0]?.driverName ?? null
    }
    lastSeason = {
      year: lr.seasonYear, team: lr.teamName, wdc: wdcOf(lr.seasonId),
      teamWcc: getTeamFinalPositionInSeason(lr.seasonId, lr.teamId),
      wins: byYear.get(lr.seasonYear)?.wins ?? 0, replacedBy, tm: tmH2HForYear(lr.seasonYear),
    }
  }

  // The rival who matters most, and WHY — for an attributed quote. Prefer the rival who beat the driver
  // to a crown they chased, paired with the YEAR it happened (their closest near-miss they did NOT win, and
  // whoever took it). Falls back to the toughest team-mate, then a points-order peer.
  let marqueeRival: LegendProfile['marqueeRival'] = null
  let lostFin = 99, lostYear = -1, lostChampName: string | null = null
  for (const [y, e] of byYear) {
    if (titleYears.includes(y)) continue
    const fin = wdcOf(e.seasonId)
    if (fin == null || fin > 3) continue
    const champ = championByYear.get(y)
    if (!champ?.driverChampionId || champ.driverChampionId === s.id || !champ.driverChampionName) continue
    if (fin < lostFin) { lostFin = fin; lostYear = y; lostChampName = champ.driverChampionName }
  }
  if (lostChampName) {
    marqueeRival = { name: lostChampName, kind: 'title', detail: String(lostYear) }
  } else if (teammateH2H) {
    marqueeRival = { name: teammateH2H.teammate, kind: 'teammate', detail: teammateH2H.years }
  } else if (rivals.length) {
    marqueeRival = { name: rivals[0].name, kind: 'peer', detail: peak ? String(peak.wdc) : '' }
  }

  // All-time standing per marquee metric — both the single best (for a one-line callout) and the full
  // set (wins/poles/podiums/points) for the "as of <date>, ranks Nth in …" conclusion.
  const rankIn = (key: 'wins' | 'poles' | 'podiums' | 'points' | 'wdc') => {
    const value = s[key]
    if (value <= 0) return null
    const rank = [...statsById.values()].filter((o) => o[key] > value).length + 1
    return { rank, value: Math.round(value) }
  }
  let allTimeRank: LegendProfile['allTimeRank'] = null
  for (const metric of ['titles', 'wins', 'podiums', 'points'] as const) {
    const key = metric === 'titles' ? 'wdc' : metric
    const r = rankIn(key)
    if (r && (!allTimeRank || r.rank < allTimeRank.rank)) allTimeRank = { metric, rank: r.rank, value: r.value }
  }
  const allTimeRanks = { wins: rankIn('wins'), poles: rankIn('poles'), podiums: rankIn('podiums'), points: rankIn('points') }

  return {
    driverId: s.id,
    name: s.name,
    gender,
    teams,
    firstYear: s.firstYear,
    lastYear: s.lastYear,
    seasons: s.seasons,
    starts: s.races,
    wins: s.wins,
    podiums: s.podiums,
    poles: s.poles,
    points: Math.round(s.points),
    titles: titleYears.length,
    titleYears,
    bestSeason,
    signatureWin,
    runnerUpYears,
    teammateH2H,
    successor,
    rivals,
    allTimeRank,
    allTimeRanks,
    peak,
    lastSeason,
    marqueeRival,
  }
}

// Build this year's legends features: pick the retired drivers, then profile each. Empty until the
// save has a driver who has been gone RETIREMENT_SEASONS_OUT years.
export function buildLegendData(throughYear: number, saveSeed: string | undefined): LegendDataset {
  if (!saveSeed) return { features: [] }
  const stats = getAllTimeDriverStats()
  const picks = selectLegendPicks(stats, throughYear, saveSeed)
  if (picks.length === 0) return { features: [] }
  const statsById = new Map(stats.map((s) => [s.id, s]))
  const champions = getAllSeasonChampions()
  const championByYear = new Map(champions.map((c) => [c.year, c]))
  const genderOf = buildGenderResolver()
  const features: LegendFeature[] = []
  for (const p of picks) {
    const s = statsById.get(p.driverId)
    if (!s) continue
    features.push({ driverId: p.driverId, date: p.date, profile: buildLegendProfile(s, statsById, champions, championByYear, genderOf(p.driverId)) })
  }
  return { features }
}
