// Sanity check for the historical-world infra (run: npx tsx scripts/history-check.ts).
// The real dataset is still empty (filled later), so this exercises the pure projection curve and
// confirms the data-driven helpers handle an empty timeline gracefully.

import { overall } from '../src/lib/sim/progression'
import { projectToYear, composeSeason, historyYears, lastDriverEntryYear } from '../src/lib/history/compose'
import { realWorldTransition } from '../src/lib/history/transitions'
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
check('development does not exceed potential', overall(later.stats) <= young.peakPotential + 0.5,
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

// Empty timeline: helpers must not crash and must report no data.
check('composeSeason returns null with no data', composeSeason(2005) === null)
check('realWorldTransition reports no data', realWorldTransition(2005, []).hasData === false)
check('historyYears empty with no data', historyYears().length === 0)
check('lastDriverEntryYear is 0 with no drivers', lastDriverEntryYear() === 0)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
