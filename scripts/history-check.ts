// Sanity check for the historical-world infra (run: npx tsx scripts/history-check.ts).
// Exercises the pure projection curve, the driver dataset, and graceful handling of the (still
// empty) per-year grids.

import { overall } from '../src/lib/sim/progression'
import { projectToYear, composeSeason, historyYears, lastDriverEntryYear, rookiesForYear } from '../src/lib/history/compose'
import { realWorldTransition } from '../src/lib/history/transitions'
import { historicalDrivers } from '../src/data/history/drivers'
import type { HistoricalDriver } from '../src/data/history/types'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'OK ' : 'XX '}${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

// A young, high-ceiling driver entering at 2006 should be markedly stronger by 2010.
const young: HistoricalDriver = {
  id: 'test-young', name: 'Test Young', nationality: 'GB', gender: 'male',
  marketEntryYear: 2006, ageAtEntry: 21, primeEnd: 32,
  pace: 80, wetWeatherPace: 80, overtaking: 78, smoothness: 74, peakPotential: 92, narrativeModifier: 4,
}
const entry = projectToYear(young, 2006)
const later = projectToYear(young, 2010)
check('young driver develops toward potential', overall(later.stats) > overall(entry.stats),
  `${overall(entry.stats).toFixed(1)} -> ${overall(later.stats).toFixed(1)}`)
check('development does not exceed potential', overall(later.stats) <= (young.peakPotential ?? 0) + 0.5,
  `overall ${overall(later.stats).toFixed(1)} vs cap ${young.peakPotential}`)
check('age advances with the years', later.age === entry.age + 4, `age ${later.age}`)

// A past-prime veteran declines over time.
const old: HistoricalDriver = {
  id: 'test-old', name: 'Test Old', nationality: 'DE', gender: 'male',
  marketEntryYear: 2000, ageAtEntry: 34, primeEnd: 33,
  pace: 88, wetWeatherPace: 86, overtaking: 84, smoothness: 88, peakPotential: 90, narrativeModifier: 0,
}
const oldEntry = projectToYear(old, 2000)
const oldLater = projectToYear(old, 2004)
check('past-prime veteran declines', overall(oldLater.stats) < overall(oldEntry.stats),
  `${overall(oldEntry.stats).toFixed(1)} -> ${overall(oldLater.stats).toFixed(1)}`)

// Driver dataset (148 encoded; ratings to follow).
check('driver dataset populated', historicalDrivers.length === 148, `${historicalDrivers.length} drivers`)
check('Hamilton enters the market in 2006', historicalDrivers.find((d) => d.id === 'lewis-hamilton')?.marketEntryYear === 2006)
check('rookiesForYear(2006) includes Hamilton', rookiesForYear(2006).some((d) => d.id === 'lewis-hamilton'))
check('lastDriverEntryYear reflects the dataset', lastDriverEntryYear() >= 2025, `${lastDriverEntryYear()}`)

// Per-year grids are still empty (provided later): season helpers must not crash.
check('composeSeason returns null with no grid', composeSeason(2005) === null)
check('realWorldTransition reports no grid data', realWorldTransition(2005, []).hasData === false)
check('historyYears empty until grids added', historyYears().length === 0)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
