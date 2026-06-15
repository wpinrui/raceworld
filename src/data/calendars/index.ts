import type { Circuit } from '@/lib/sim/types'
import { CIRCUITS } from './circuits'
import { SEASON_CALENDARS } from './seasons'

export { CIRCUITS } from './circuits'
export { SEASON_CALENDARS } from './seasons'

export const CALENDAR_YEARS = Object.keys(SEASON_CALENDARS).map(Number).sort((a, b) => a - b)
export const DEFAULT_CALENDAR_YEAR = CALENDAR_YEARS[CALENDAR_YEARS.length - 1]

// The full Circuit[] for a season — joins the per-season schedule with the circuit registry. Falls
// back to the latest season for any year without data (e.g. a future fictional season past the data).
export function calendarForYear(year: number): Circuit[] {
  const season = SEASON_CALENDARS[year] ?? SEASON_CALENDARS[DEFAULT_CALENDAR_YEAR]
  return season.map((r) => {
    const c = CIRCUITS[r.id]
    return { id: r.id, name: r.name, code: c.code, location: c.location, country: c.country, laps: r.laps, flatModifier: c.flatModifier, sundayOfYear: r.sundayOfYear, straightness: c.straightness }
  })
}
