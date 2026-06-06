// Era-accurate F1 championship points (issue #63). The system the sport used changed several times;
// the table — and whether a fastest-lap point exists — is selected by season year.
//
// Boundaries (real F1 history):
//   1996-2002: top 6           10-6-4-3-2-1
//   2003-2009: top 8           10-8-6-5-4-3-2-1
//   2010-2018: top 10          25-18-15-12-10-8-6-4-2-1
//   2019-2024: top 10 + 1 for fastest lap (only if the FL setter finishes in the top 10)
//   2025-:     top 10, fastest-lap point dropped
type Era = { from: number; to: number; table: number[]; fastestLapPoint: boolean }

const TOP10 = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]

// Ordered; `from` of the first era is 0 so any pre-1996 year falls into the earliest system.
const ERAS: Era[] = [
  { from: 0,    to: 2002, table: [10, 6, 4, 3, 2, 1],       fastestLapPoint: false },
  { from: 2003, to: 2009, table: [10, 8, 6, 5, 4, 3, 2, 1], fastestLapPoint: false },
  { from: 2010, to: 2018, table: TOP10,                      fastestLapPoint: false },
  { from: 2019, to: 2024, table: TOP10,                      fastestLapPoint: true  },
  { from: 2025, to: 9999, table: TOP10,                      fastestLapPoint: false },
]

function eraFor(year: number): Era {
  return ERAS.find((e) => year >= e.from && year <= e.to) ?? ERAS[ERAS.length - 1]
}

// Base championship points for a finishing position under `year`'s system (DNF / 0 = no points).
export function getPoints(finishPosition: number | null, year: number): number {
  if (finishPosition === null) return 0
  return eraFor(year).table[finishPosition - 1] ?? 0
}

// Whether `year`'s system awards the +1 fastest-lap point.
export function hasFastestLapPoint(year: number): boolean {
  return eraFor(year).fastestLapPoint
}
