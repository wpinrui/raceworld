import type { TechnicalFailure } from './types'

// Per-era technical (mechanical) reliability for the race sim (issue #61, absorbs the per-year
// reliability item). The chance of a technical DNF is FLAT across all cars and varies only by year.
//
// RESEARCH SPIKE — real F1 mechanical-DNF trend, ~1996-2026 (sources in the PR):
//   - 1990s: very fragile. ~35-40% of cars DNF'd, the majority mechanical. Engine + gearbox alone
//     were ~50% of all failures (areppim F1 failure-cause histogram, 1990-2013).
//   - mid-2000s: a small reliability dip during the late V10 era.
//   - 2014: the 1.6L V6 turbo-hybrid debut spiked retirements to 20.8% (RaceFans), ~12% mechanical.
//   - 2020s: most reliable ever — 2024 finished ~91.5% of starts, and most of those DNFs were
//     crashes/driver error, so mechanical attrition was only ~3% (RaceFans 2024 reliability report).
//
// Chosen curve — per-car, per-RACE probability of a technical DNF as a smooth function of year:
//   base exponential decay (1996 ~0.27 -> modern ~0.034) + a Gaussian bump at the 2014 turbo-hybrid
//   intro + a smaller mid-2000s bump. Anchors it produces: '96 ~0.27, '00 ~0.19, '05 ~0.14,
//   '10 ~0.078, '14 ~0.12 (spike), '16 ~0.074, '20 ~0.042, '24 ~0.036, '26 ~0.034.
export function perRaceTechnicalDNF(year: number): number {
  const base = 0.025 + 0.25 * Math.exp(-(year - 1996) / 9)
  const turboHybrid2014 = 0.06 * Math.exp(-(((year - 2014) / 2) ** 2)) // V6 turbo intro fragility
  const midV10 = 0.02 * Math.exp(-(((year - 2005) / 2.5) ** 2))        // smaller late-V10 dip
  return Math.max(0.02, Math.min(0.45, base + turboHybrid2014 + midV10))
}

// Convert the per-race probability to a per-lap probability for a race of `laps` laps, so the
// season-long attrition is independent of circuit length: 1 - (1 - pLap)^laps = pRace.
export function perLapTechnicalDNF(year: number, laps: number): number {
  const perRace = perRaceTechnicalDNF(year)
  return 1 - (1 - perRace) ** (1 / Math.max(1, laps))
}

// Flat-weighted failure pool (issue #61): pick uniformly on a technical DNF.
const FAILURE_POOL: TechnicalFailure[] = [
  'engine', 'gearbox', 'hydraulics', 'electrical', 'suspension', 'brakes', 'clutch', 'overheating',
]

export function sampleTechnicalFailure(rng: () => number = Math.random): TechnicalFailure {
  return FAILURE_POOL[Math.floor(rng() * FAILURE_POOL.length)]
}
