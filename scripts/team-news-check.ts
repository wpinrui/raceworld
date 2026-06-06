// Smoke-test the team-transition newsroom: feed synthetic end-of-season summaries (rebrand / arrival /
// departure) through generateNews and confirm the bespoke copy renders with every slot filled.
// Run: npx tsx scripts/team-news-check.ts
import { generateNews } from '../src/lib/news/engine'
import { calendarForYear } from '../src/data/calendars'

const mk = (driverId: string, driverName: string, teamId: string, teamName: string, fp: number, pts: number) =>
  ({ driverId, driverName, teamId, teamName, finishPosition: fp, gridPosition: fp, points: pts, dnf: false, fastestLap: false, startedFrom: fp })
const round = [
  mk('leclerc', 'Charles Leclerc', 'ferrari', 'Ferrari', 1, 25),
  mk('bottas', 'Valtteri Bottas', 'hinwil', 'Sauber', 8, 4),
  mk('zhou', 'Zhou Guanyu', 'hinwil', 'Sauber', 9, 2),
  mk('kobayashi', 'Kamui Kobayashi', 'toyota', 'Toyota', 11, 0),
  mk('glock', 'Timo Glock', 'toyota', 'Toyota', 12, 0),
]
const raceResults = Array.from({ length: 24 }, () => round)
const drivers = [
  { id: 'bottas', name: 'Valtteri Bottas', teamId: 'hinwil', gender: 'male' },
  { id: 'zhou', name: 'Zhou Guanyu', teamId: 'hinwil', gender: 'male' },
  { id: 'kobayashi', name: 'Kamui Kobayashi', teamId: 'toyota', gender: 'male' },
  { id: 'glock', name: 'Timo Glock', teamId: 'toyota', gender: 'male' },
]
const careers = {
  bottas: { driverId: 'bottas', wins: 10, podiums: 67, poles: 20, points: 1797, starts: 230, seasons: 12, titles: 0, titleYears: [], debutYear: 2013, bestFinish: 1 },
  zhou: { driverId: 'zhou', wins: 0, podiums: 0, poles: 0, points: 16, starts: 60, seasons: 3, titles: 0, titleYears: [], debutYear: 2022, bestFinish: 8 },
  kobayashi: { driverId: 'kobayashi', wins: 0, podiums: 1, poles: 0, points: 125, starts: 75, seasons: 4, titles: 0, titleYears: [], debutYear: 2009, bestFinish: 3 },
  glock: { driverId: 'glock', wins: 0, podiums: 3, poles: 0, points: 150, starts: 90, seasons: 5, titles: 0, titleYears: [], debutYear: 2008, bestFinish: 2 },
}
const teamCareers = {
  hinwil: { teamId: 'hinwil', races: 500, seasons: 29, wins: 1, podiums: 60, poles: 1, points: 900, bestConstructorsFinish: 2, constructorTitles: 0 },
  toyota: { teamId: 'toyota', races: 140, seasons: 7, wins: 0, podiums: 13, poles: 3, points: 300, bestConstructorsFinish: 4, constructorTitles: 0 },
}
// Per-lineage driver tallies (the real {top_driver} source): the standout is NOT a final-season driver,
// to prove the producer reaches across the whole lineage history.
const teamDriverTallies = {
  hinwil: [
    { driverId: 'raikkonen', driverName: 'Kimi Raikkonen', wins: 1, podiums: 10, points: 200, firstYear: 2001, lastYear: 2001 },
    { driverId: 'massa', driverName: 'Felipe Massa', wins: 0, podiums: 2, points: 80, firstYear: 2002, lastYear: 2005 },
    { driverId: 'bottas', driverName: 'Valtteri Bottas', wins: 0, podiums: 0, points: 50, firstYear: 2024, lastYear: 2025 },
  ],
  toyota: [
    { driverId: 'trulli', driverName: 'Jarno Trulli', wins: 0, podiums: 3, points: 160, firstYear: 2004, lastYear: 2009 },
    { driverId: 'glock', driverName: 'Timo Glock', wins: 0, podiums: 3, points: 150, firstYear: 2008, lastYear: 2009 },
  ],
}
const baseCtx = {
  phase: 'off-season', completedRounds: 24, drivers, raceResults, upgradeEvents: [],
  constructorHistory: [], calendar: calendarForYear(2026), live: true, careers, teamCareers, teamDriverTallies,
  teams: [{ id: 'ferrari', name: 'Ferrari' }, { id: 'hinwil', name: 'Sauber' }, { id: 'toyota', name: 'Toyota' }],
}

const scenarios = [
  { year: 2025, eos: { seasonYear: 2025, constructorChampion: 'ferrari', gridRebrands: [{ teamId: 'hinwil', fromName: 'Sauber', toName: 'Audi' }], gridAdditions: [{ teamId: 'cadillac', teamName: 'Cadillac' }], gridRemovals: [] } },
  { year: 2009, eos: { seasonYear: 2009, constructorChampion: 'ferrari', gridRebrands: [], gridAdditions: [], gridRemovals: [{ teamId: 'toyota', teamName: 'Toyota', finalPosition: 5 }] } },
]

let leftoverTotal = 0
for (const s of scenarios) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = { ...baseCtx, year: s.year, endOfSeason: { progressionEvents: [], retiredDriverIds: [], marketMoves: [], droppedDrivers: [], ...s.eos } }
  const tt = generateNews(ctx).filter((a) => ['team_rebrand', 'team_entry', 'team_exit'].includes(a.category))
  for (const a of tt) {
    console.log(`\n## [${a.category}] ${a.headline}`)
    console.log(`DEK: ${a.dek}`)
    console.log(a.body)
    const leftover = (a.headline + ' ' + a.dek + ' ' + a.body).match(/\{[a-z_]+\}/g)
    if (leftover) { leftoverTotal++; console.log('  !! UNFILLED SLOTS:', leftover.join(', ')) }
  }
}
console.log(`\n=== articles with unfilled slots: ${leftoverTotal} ===`)
