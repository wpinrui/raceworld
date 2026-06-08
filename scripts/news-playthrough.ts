// Organic news playthrough (headless CLI).
//
// Drives a full season (or several) of the real game engine in memory — generating the grid,
// simulating every race, advancing through the off-season market — with NO database, then runs
// the news engine over the resulting state and dumps every generated article to a markdown file
// for analysis.
//
// Faithfulness: news is captured in two passes per season — once at pre-season (round 0, for
// launches/previews/rookie watch) and once after the off-season market (rounds 1..N plus the
// transfer/retirement stories). The off-season phases stage their changes into
// `pendingNextSeasonState`, so the live drivers/teams the engine reads stay the season's data —
// no post-market reshuffle corrupts the in-season analysis.
//
// Usage:
//   npm run news:play -- [--seasons N] [--year YYYY] [--seed STRING] [--out FILE]
//   tsx scripts/news-playthrough.ts --seasons 3 --seed demo --out news.md

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NewsArticle, NewsContext, DriverCareer, TeamCareer, RecordsContext } from '@/lib/news/engine'
import type { RaceResult } from '@/lib/sim/types'

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2)
function opt(name: string, def: string): string {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def
}
const SEASONS = Math.max(1, parseInt(opt('seasons', '1'), 10) || 1)
const START_YEAR = parseInt(opt('year', '2026'), 10) || 2026
const SEED = opt('seed', '')
const OUT = opt('out', 'news-playthrough.md')

// Silence zustand's persist "storage unavailable" warning — expected and harmless under Node,
// where we run entirely in memory.
const realWarn = console.warn.bind(console)
console.warn = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].includes('persist middleware')) return; realWarn(...a) }

// ---- localStorage shim so zustand's persist middleware is an in-memory no-op under Node ----
const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  get length() { return mem.size },
} as unknown as Storage

interface Captured { art: NewsArticle; year: number }

function roundLabel(round: number, n: number): string {
  if (round <= 0) return 'Pre-season'
  if (round > n) return 'Off-season'
  return `Round ${round}`
}

async function main() {
  // Dynamic imports so the localStorage shim above is installed before the stores are created.
  const { useSeasonStore } = await import('@/lib/store/season-store')
  const { useRaceStore } = await import('@/lib/store/race-store')
  const { calendarForYear } = await import('@/data/calendars')
  const { composeSeason } = await import('@/lib/history/compose')
  const { buildRaceResults } = await import('@/lib/sim/race-results')
  const { isOffSeason } = await import('@/lib/sim/types')
  const { generateNews, CATEGORY_LABELS } = await import('@/lib/news/engine')
  const { mulberry32 } = await import('@/lib/news/util')

  // Optional reproducibility: seed the global RNG the whole sim + generators draw from.
  if (SEED) { const rng = mulberry32(SEED); Math.random = () => rng() }

  const season = () => useSeasonStore.getState()

  // Cross-season F1 career totals, accumulated as the run progresses (no DB here, so we tally
  // straight from the race results). Mirrors what the DB career queries give the live/archived
  // paths. Passed into every NewsContext so career-driven producers (retirement, driver-to-watch)
  // see real numbers — never a guess from age.
  const careers: Record<string, DriverCareer> = {}
  const teamCareers: Record<string, TeamCareer> = {}
  const seasonsSeen: Record<string, Set<number>> = {}
  const teamSeasonsSeen: Record<string, Set<number>> = {}
  const tally = (year: number, results: RaceResult[]) => {
    const teamsThisRace = new Set<string>()
    for (const res of results) {
      const tid = res.teamId
      let tc = teamCareers[tid]
      if (!tc) { tc = teamCareers[tid] = { teamId: tid, races: 0, seasons: 0, wins: 0, podiums: 0, poles: 0, points: 0, bestConstructorsFinish: null, constructorTitles: 0 }; teamSeasonsSeen[tid] = new Set() }
      const fp = res.finishPosition
      tc.points += res.points
      if (res.gridPosition === 1) tc.poles++
      if (fp != null && fp === 1) tc.wins++
      if (fp != null && fp <= 3) tc.podiums++
      teamsThisRace.add(tid)
    }
    for (const tid of teamsThisRace) {
      teamCareers[tid].races++
      if (!teamSeasonsSeen[tid].has(year)) { teamSeasonsSeen[tid].add(year); teamCareers[tid].seasons = teamSeasonsSeen[tid].size }
    }
    for (const res of results) {
      const id = res.driverId
      let c = careers[id]
      if (!c) {
        c = careers[id] = { driverId: id, starts: 0, wins: 0, podiums: 0, poles: 0, points: 0, seasons: 0, titles: 0, titleYears: [], debutYear: null, bestFinish: null }
        seasonsSeen[id] = new Set()
      }
      // Count by finishing position (matching the DB career query the world pages use), so the
      // CLI, archived and live paths all agree on a driver's record.
      const fp = res.finishPosition
      c.starts++
      c.points += res.points
      if (res.gridPosition === 1) c.poles++
      if (fp != null && fp === 1) c.wins++
      if (fp != null && fp <= 3) c.podiums++
      if (fp != null && (c.bestFinish == null || fp < c.bestFinish)) c.bestFinish = fp
      if (c.debutYear == null) c.debutYear = year
      if (!seasonsSeen[id].has(year)) { seasonsSeen[id].add(year); c.seasons = seasonsSeen[id].size }
    }
  }

  // Per-season tallies of COMPLETED seasons, for the records producer's baselines + history-depth gate
  // (mirrors actionGetSeasonRecords, but from the in-memory run; the live season is appended only once
  // it finishes, so captures during a season see prior seasons only).
  type DRow = { year: number; id: string; name: string; wins: number; poles: number; podiums: number; points: number; dnfs: number }
  type TRow = { year: number; id: string; name: string; wins: number; podiums: number; points: number }
  const driverRows: DRow[] = []
  const teamRows: TRow[] = []
  const recordCompletedSeason = (yr: number, rounds: RaceResult[][]) => {
    const d = new Map<string, DRow>(); const t = new Map<string, TRow>()
    for (const round of rounds) for (const r of round) {
      const fp = r.finishPosition
      const dr = d.get(r.driverId) ?? { year: yr, id: r.driverId, name: r.driverName, wins: 0, poles: 0, podiums: 0, points: 0, dnfs: 0 }
      dr.points += r.points; if (fp === 1) dr.wins++; if (r.gridPosition === 1) dr.poles++; if (fp != null && fp <= 3) dr.podiums++; if (r.dnf) dr.dnfs++
      d.set(r.driverId, dr)
      const tr = t.get(r.teamId) ?? { year: yr, id: r.teamId, name: r.teamName, wins: 0, podiums: 0, points: 0 }
      tr.points += r.points; if (fp === 1) tr.wins++; if (fp != null && fp <= 3) tr.podiums++
      t.set(r.teamId, tr)
    }
    driverRows.push(...d.values()); teamRows.push(...t.values())
  }
  const best = <T extends { year: number }>(rows: T[], val: (r: T) => number, name: (r: T) => string) => {
    let b: T | undefined; for (const r of rows) if (!b || val(r) > val(b)) b = r
    return b && val(b) >= 1 ? { value: val(b), holderName: name(b), year: b.year } : undefined
  }
  const buildRecords = (): RecordsContext => {
    const driverNames: Record<string, string> = {}; const teamNames: Record<string, string> = {}
    for (const r of driverRows) driverNames[r.id] = r.name
    for (const r of teamRows) teamNames[r.id] = r.name
    return {
      archivedSeasons: new Set(driverRows.map((r) => r.year)).size,
      seasonDriver: { wins: best(driverRows, (r) => r.wins, (r) => r.name), poles: best(driverRows, (r) => r.poles, (r) => r.name), podiums: best(driverRows, (r) => r.podiums, (r) => r.name), points: best(driverRows, (r) => r.points, (r) => r.name), dnfs: best(driverRows, (r) => r.dnfs, (r) => r.name) },
      seasonTeam: { wins: best(teamRows, (r) => r.wins, (r) => r.name), podiums: best(teamRows, (r) => r.podiums, (r) => r.name), points: best(teamRows, (r) => r.points, (r) => r.name) },
      driverNames, teamNames,
    }
  }

  const buildCtx = (): NewsContext => {
    const s = season()
    return {
      year: s.year, saveSeed: s.saveSeed, phase: s.phase, completedRounds: s.raceResults.length,
      drivers: s.drivers, teams: s.teams, raceResults: s.raceResults,
      upgradeEvents: s.allUpgradeEvents, devPlans: s.devPlans, constructorHistory: s.constructorHistory,
      endOfSeason: s.endOfSeasonSummary, calendar: calendarForYear(s.year), live: true, careers, teamCareers, records: buildRecords(),
      contractWatch: s.seasonContractWatch, renewals: s.seasonRenewals, draft: s.seasonDraft,
    }
  }

  const seen = new Map<string, Captured>()
  const capture = (year: number) => {
    for (const a of generateNews(buildCtx())) if (!seen.has(a.id)) seen.set(a.id, { art: a, year })
  }

  const summaries: { year: number; champion: string; wcc: string; races: number }[] = []

  for (let si = 0; si < SEASONS; si++) {
    if (si === 0) {
      const composed = composeSeason(START_YEAR)
      if (!composed) throw new Error(`No historical data for ${START_YEAR}`)
      season().initSeason(composed.drivers, composed.teams, START_YEAR)
    } else {
      // Roll the previous season over into the next one.
      season().runPreSeasonTesting()
      season().startNewSeason()
      useSeasonStore.setState({ phase: 'pre-race' })
    }
    const year = season().year
    const seasonCal = calendarForYear(year)
    const N = seasonCal.length
    process.stderr.write(`Simulating ${year} (${N} races)...\n`)

    capture(year) // pre-season slate (round 0): launches, season preview, rookie watch

    // Race the whole season headlessly. advanceRound() triggers endSeason() on the final round.
    let seasonGuard = 0
    while (seasonGuard++ < N + 2) {
      const s = season()
      if (s.phase === 'idle' || isOffSeason(s.phase)) break
      const round = s.currentRound
      const circuit = seasonCal[round - 1]
      if (!circuit) break
      const grid = s.drivers.filter((d) => d.teamId !== '')

      const race = useRaceStore.getState()
      race.loadFromSeason(grid, s.teams, circuit)
      race.initSession() // qualifying -> pre-race
      const rs = useRaceStore.getState().raceState
      if (!rs) break
      useRaceStore.setState({ raceState: { ...rs, phase: 'racing' } })
      let lapGuard = 0
      while (useRaceStore.getState().raceState?.phase === 'racing' && lapGuard++ < 5000) {
        useRaceStore.getState().tickLap()
      }
      const finished = useRaceStore.getState().raceState
      if (!finished) break

      const results = buildRaceResults(finished, grid, s.teams, year)
      season().recordRaceResult(results) // applies progression + upgrades, writes the round
      tally(year, results) // accumulate career totals through this round (before we capture)
      // Capture now, while endOfSeason is still null, so the producers gated on an in-progress
      // season (analysis, title fight, silly season, mid-season feature) are included for this
      // round with the correct live drivers/teams.
      capture(year)
      season().advanceRound() // triggers endSeason() on the final round
      useRaceStore.getState().resetSession()
    }

    // Credit the season's drivers' champion before the off-season capture, so a retirement
    // obituary for a title winner reflects the crown they just won.
    const champId = season().endOfSeasonSummary?.driverChampion
    if (champId && careers[champId]) { careers[champId].titles++; careers[champId].titleYears.push(year) }

    // Off-season market so transfer / retirement / signing news exists. These stage into
    // pendingNextSeasonState and only fill endOfSeasonSummary slices — the live season data the
    // engine reads is untouched.
    season().runContractNegotiations()
    season().runDriverRetirements()

    capture(year) // off-season market (round N+1)

    const eos = season().endOfSeasonSummary
    const champion = season().drivers.find((d) => d.id === eos?.driverChampion)?.name
      ?? season().driverStandings[0]?.driverName ?? '(unknown)'
    const wcc = season().teams.find((t) => t.id === eos?.constructorChampion)?.name
      ?? season().constructorStandings[0]?.teamName ?? '(unknown)'
    summaries.push({ year, champion, wcc, races: season().raceResults.length })
    process.stderr.write(`  ${year}: WDC ${champion}, WCC ${wcc}\n`)

    // Bank this completed season's tallies so next season's records baselines + depth gate see it.
    recordCompletedSeason(year, season().raceResults)
  }

  // ---- assemble markdown ----------------------------------------------------
  const all = [...seen.values()].sort((x, y) =>
    (y.year - x.year) || (y.art.round - x.art.round) || (y.art.priority - x.art.priority) || x.art.id.localeCompare(y.art.id))

  const byLabel = new Map<string, number>()
  for (const { art } of all) {
    const label = CATEGORY_LABELS[art.category] ?? art.category
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1)
  }

  const lines: string[] = []
  const lastYear = START_YEAR + SEASONS - 1
  lines.push(`# News playthrough — ${START_YEAR}${SEASONS > 1 ? `–${lastYear}` : ''}`)
  lines.push('')
  lines.push(`Headless organic simulation. Seasons: ${SEASONS}. Seed: ${SEED || '(random)'}. Articles: ${all.length}.`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  for (const s of summaries) lines.push(`- **${s.year}** (${s.races} races) — WDC ${s.champion}, WCC ${s.wcc}`)
  lines.push('')
  lines.push('### Articles by category')
  lines.push('')
  for (const [label, count] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${label}: ${count}`)
  }
  lines.push('')

  let currentYear: number | null = null
  for (const { art, year } of all) {
    if (year !== currentYear) {
      currentYear = year
      lines.push('')
      lines.push(`## ${year}`)
      lines.push('')
    }
    lines.push(`### ${art.headline}`)
    lines.push('')
    lines.push(`*${CATEGORY_LABELS[art.category] ?? art.category} · ${roundLabel(art.round, calendarForYear(year).length)}*`)
    lines.push('')
    lines.push(`_${art.dek}_`)
    lines.push('')
    lines.push(art.body)
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  const outPath = resolve(process.cwd(), OUT)
  writeFileSync(outPath, lines.join('\n'), 'utf8')
  process.stderr.write(`\nWrote ${all.length} articles to ${outPath}\n`)
  for (const [label, count] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) {
    process.stderr.write(`  ${label.padEnd(14)} ${count}\n`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
