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

// Per-year grids (1996-2026).
check('historyYears spans 1996-2026', historyYears().length === 31 && historyYears()[0] === 1996 && historyYears().at(-1) === 2026, `${historyYears().length} seasons`)
const s1996 = composeSeason(1996)
check('composeSeason(1996) builds the grid', !!s1996 && s1996.teams.length === 11 && s1996.drivers.filter((d) => d.teamId !== '').length === 22)
check('1996 seats Schumacher at Ferrari', !!s1996 && s1996.drivers.some((d) => d.id === 'michael-schumacher' && d.teamId === 'ferrari'))
const s2007 = composeSeason(2007)
check('2007 seats Hamilton at McLaren', !!s2007 && s2007.drivers.some((d) => d.id === 'lewis-hamilton' && d.teamId === 'mclaren'))
// 2005 -> 2006 real-world transition: Super Aguri joins, Jordan rebrands to MF1.
const s2005 = composeSeason(2005)
const tr = s2005 ? realWorldTransition(2005, s2005.teams) : null
check('realWorldTransition(2005) has data', !!tr && tr.hasData)
check('  Super Aguri joins for 2006', !!tr && tr.teamJoins.some((t) => t.id === 'superaguri'))
check('  Jordan rebrands to MF1', !!tr && tr.teamRebrands.some((r) => r.id === 'silverstone' && r.to.name.includes('MF1')))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
