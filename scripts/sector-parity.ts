// Sector-vs-lap statistical parity probe (#sector-engine). The played-race sector engine must be a
// finer-grained rendering of the SAME race, not a rebalance — this measures it. Paired seeding: per
// race index the global RNG is seeded identically for a full lap-engine race and a full sector-engine
// race (same grid, forms, car form, weather via saveSeed), so divergence starts at the first tick and
// setup variance cancels. Two circuits bracket the overtaking model: Monaco (straightness 0.05) and
// Monza (0.95). Weather is NOT forced dry — wet races exercise the blow-past path.
//
// ROUND-BASED + STREAMING: each round runs `--round` paired races per circuit, then reprints the full
// running side-by-side table, so an answer is available after round 1 and Ctrl-C keeps it usable.
// Acceptance (at >=200 races/circuit): overtake events ±10% rel, DNFs ±0.15 abs, pit stops ±5% rel,
// first-pit lap ±1.0, finish-position sigma ±7% rel, winner time ±2s, top-3 team win shares ±3pt.
// Run: npx tsx scripts/sector-parity.ts [--round 10] [--rounds 20]

import type { Driver, Team, Circuit, RaceState } from '@/lib/sim/types'
import { initRaceState, simulateLap } from '@/lib/sim/race'
import { simulateSector, SECTORS_PER_LAP } from '@/lib/sim/sector'
import { runQualifying } from '@/lib/sim/qualifying'
import { calendarForYear } from '@/data/calendars'
import { mulberry32 } from '@/lib/news/util'

const argv = process.argv.slice(2)
const argN = (flag: string, def: number) => { const i = argv.indexOf(flag); return i >= 0 ? parseInt(argv[i + 1], 10) || def : def }
const ROUND = argN('--round', 10)
const ROUNDS = argN('--rounds', 20)
const YEAR = 2026
const N_DRIVERS = 20
const N_TEAMS = 10

const cal = calendarForYear(YEAR)
const CIRCUITS: Circuit[] = ['monaco', 'italy']
  .map((id) => cal.find((c) => c.id === id))
  .filter((c): c is Circuit => !!c)

// A realistic fixed field: team pace 95 down to 60, drivers loosely tied to machinery with a
// deterministic scatter on the other attributes. Identical for every race and both engines.
const teams: Team[] = Array.from({ length: N_TEAMS }, (_, i) => ({
  id: `t${i}`, name: `Team ${i}`, shortName: `T${i}`, nationality: 'GB', color: '#888',
  carPace: Math.round(95 - (i * 35) / (N_TEAMS - 1)),
}))
const drivers: Driver[] = Array.from({ length: N_DRIVERS }, (_, i) => ({
  id: `d${i}`, name: `Driver ${i}`, teamId: `t${Math.floor(i / 2)}`, nationality: 'GB', gender: 'male' as const,
  pace: Math.round(92 - (i * 28) / (N_DRIVERS - 1)),
  wetWeatherPace: 60 + ((i * 11) % 33),
  overtaking: 62 + ((i * 7) % 31),
  smoothness: 63 + ((i * 13) % 30),
  consistency: 65 + ((i * 17) % 28),
  confidence: 5, age: 27, peakPotential: 90, primeEnd: 32, narrativeModifier: 0, contractExpiresAfterSeason: 2030,
}))
const forms: Record<string, number> = Object.fromEntries(drivers.map((d) => [d.id, 5]))

interface Agg {
  races: number
  overtakes: number
  dnfs: number
  dnfTech: number
  dnfCollision: number
  pitStops: number
  firstPitSum: number
  firstPitN: number
  winTimeSum: number
  finSum: number[]   // per-driver finish-position sums, for the cross-race sigma
  finSq: number[]
  winsByTeam: number[]
}
const newAgg = (): Agg => ({
  races: 0, overtakes: 0, dnfs: 0, dnfTech: 0, dnfCollision: 0, pitStops: 0, firstPitSum: 0, firstPitN: 0, winTimeSum: 0,
  finSum: new Array(N_DRIVERS).fill(0), finSq: new Array(N_DRIVERS).fill(0), winsByTeam: new Array(N_TEAMS).fill(0),
})

function runRace(engine: 'lap' | 'sector', circuit: Circuit, raceIdx: number, agg: Agg): void {
  const seedStr = `parity:${circuit.id}:${raceIdx}`
  const rng = mulberry32(seedStr)
  Math.random = () => rng()
  const { results: qr, sessions } = runQualifying(drivers, teams, circuit, forms)
  let state: RaceState = { ...initRaceState(drivers, teams, circuit, qr, sessions, forms, YEAR, 0.35, seedStr), phase: 'racing' }

  let overtakes = 0
  let guard = 0
  const maxTicks = (circuit.laps + 2) * (engine === 'sector' ? SECTORS_PER_LAP : 1)
  while (state.phase === 'racing' && guard++ < maxTicks) {
    const prev = state
    state = engine === 'sector'
      ? simulateSector(state, drivers, teams, circuit, YEAR)
      : simulateLap(state, drivers, teams, circuit, YEAR)
    // PLACES gained by running cars outside their own pit tick — granularity-invariant (a two-place
    // gain counts 2 whether it happened in one lap tick or across two sector ticks), unlike event
    // counts, which inflate mechanically under finer diffing.
    const prevPos = new Map(prev.drivers.map((d) => [d.driverId, d.position]))
    for (const d of state.drivers) {
      if (d.retired) continue
      const pp = prevPos.get(d.driverId) ?? d.position
      if (d.position < pp && d.lastPitLap !== prev.currentLap) overtakes += pp - d.position
    }
  }

  agg.races++
  agg.overtakes += overtakes
  for (const d of state.drivers) {
    if (d.retired) {
      agg.dnfs++
      if (d.retirementReason === 'collision-damage') agg.dnfCollision++
      else agg.dnfTech++
    }
    agg.pitStops += d.pitStops
    if (d.stintHistory.length > 0) { agg.firstPitSum += d.stintHistory[0].laps; agg.firstPitN++ }
    const i = drivers.findIndex((dr) => dr.id === d.driverId)
    agg.finSum[i] += d.position
    agg.finSq[i] += d.position * d.position
    if (d.position === 1) agg.winsByTeam[teams.findIndex((t) => t.id === drivers[i].teamId)]++
  }
  agg.winTimeSum += Math.min(...state.drivers.filter((d) => !d.retired).map((d) => d.totalTime))
}

function meanSigma(agg: Agg): number {
  let s = 0
  for (let i = 0; i < N_DRIVERS; i++) {
    const m = agg.finSum[i] / agg.races
    s += Math.sqrt(Math.max(0, agg.finSq[i] / agg.races - m * m))
  }
  return s / N_DRIVERS
}

function report(circuit: Circuit, lap: Agg, sec: Agg): void {
  const rows: Array<[string, number, number, string]> = []
  const rel = (a: number, b: number) => (a === 0 ? '—' : `${(((b - a) / a) * 100).toFixed(1)}%`)
  const push = (label: string, a: number, b: number, mode: 'rel' | 'abs' | 's' = 'rel') =>
    rows.push([label, a, b, mode === 'rel' ? rel(a, b) : mode === 's' ? `${(b - a).toFixed(2)}s` : (b - a).toFixed(3)])
  push('places gained/race', lap.overtakes / lap.races, sec.overtakes / sec.races)
  push('DNFs/race', lap.dnfs / lap.races, sec.dnfs / sec.races, 'abs')
  push('  technical', lap.dnfTech / lap.races, sec.dnfTech / sec.races, 'abs')
  push('  collision', lap.dnfCollision / lap.races, sec.dnfCollision / sec.races, 'abs')
  push('pit stops/race (per car)', lap.pitStops / lap.races / N_DRIVERS, sec.pitStops / sec.races / N_DRIVERS)
  push('mean first-pit lap', lap.firstPitSum / Math.max(1, lap.firstPitN), sec.firstPitSum / Math.max(1, sec.firstPitN), 'abs')
  push('finish-position sigma', meanSigma(lap), meanSigma(sec))
  push('winner race time', lap.winTimeSum / lap.races, sec.winTimeSum / sec.races, 's')
  const top3 = (a: Agg) => a.winsByTeam.slice(0, 3).map((w) => ((w / a.races) * 100).toFixed(0) + '%').join('/')
  console.log(`\n== ${circuit.name} (straightness ${circuit.straightness}) — ${lap.races} paired races ==`)
  console.log('metric'.padEnd(26) + 'lap'.padStart(10) + 'sector'.padStart(10) + 'delta'.padStart(10))
  for (const [label, a, b, d] of rows) {
    console.log(label.padEnd(26) + a.toFixed(2).padStart(10) + b.toFixed(2).padStart(10) + d.padStart(10))
  }
  console.log('top-3 team win shares'.padEnd(26) + top3(lap).padStart(10) + top3(sec).padStart(10))
}

async function main() {
  console.log(`sector-parity: ${ROUNDS} rounds x ${ROUND} paired races x ${CIRCUITS.map((c) => c.id).join(', ')}`)
  const aggs = new Map(CIRCUITS.map((c) => [c.id, { lap: newAgg(), sec: newAgg() }]))
  let raceIdx = 0
  for (let round = 1; round <= ROUNDS; round++) {
    for (const circuit of CIRCUITS) {
      const a = aggs.get(circuit.id)!
      for (let r = 0; r < ROUND; r++) {
        const idx = raceIdx++
        runRace('lap', circuit, idx, a.lap)
        runRace('sector', circuit, idx, a.sec)
        process.stderr.write('.')
      }
    }
    console.log(`\n──── after round ${round}/${ROUNDS} ────`)
    for (const circuit of CIRCUITS) {
      const a = aggs.get(circuit.id)!
      report(circuit, a.lap, a.sec)
    }
    await new Promise((res) => setImmediate(res))
  }
}

main()
