import type { HistoricalSeasonGrid } from './types'

// One entry per real season (1996-2026). `teams` in constructors' championship order (best first);
// `lineup` maps each seat that year. Filled from the real-world data being pasted in.
//
// Example shape:
//   {
//     year: 2005,
//     teams: [
//       { id: 'renault', name: 'Renault', shortName: 'REN', nationality: 'FR', color: '#FFF500' },
//       { id: 'mclaren', name: 'McLaren', shortName: 'MCL', nationality: 'GB', color: '#FF8000' },
//       // ...in WCC order
//     ],
//     lineup: [
//       { driverId: 'fernando-alonso', teamId: 'renault' },
//       { driverId: 'giancarlo-fisichella', teamId: 'renault' },
//       // ...
//     ],
//   },
export const historicalGrids: HistoricalSeasonGrid[] = [
]
