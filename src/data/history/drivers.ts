import type { HistoricalDriver } from './types'

// Every driver who raced 1996-2026, each defined once at market entry. Ratings (pace/wet/overtaking/
// smoothness/peakPotential/narrative) are filled last; the rest (id, name, nationality, gender,
// marketEntryYear, ageAtEntry, primeEnd) comes from the real-world data being pasted in.
//
// Example shape (Lewis Hamilton: enters the market in 2006, debuts 2007 as an instant contender):
//   {
//     id: 'lewis-hamilton', name: 'Lewis Hamilton', nationality: 'GB', gender: 'male',
//     marketEntryYear: 2006, ageAtEntry: 21, primeEnd: 33,
//     pace: 88, wetWeatherPace: 90, overtaking: 86, smoothness: 82, peakPotential: 95, narrativeModifier: 6,
//   },
export const historicalDrivers: HistoricalDriver[] = [
]
