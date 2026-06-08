import { calendarForYear } from '@/data/calendars'
import { raceDate, toISODate, fromISODate, addDays } from './calendar-dates'

// Real-date schedule for the off-season + a season's pre-season run-up, so the day-by-day Continue loop
// can stop on each like a race weekend (#126). The off-season splits at the New Year: the finishing
// season's wind-down (retirements, Signing Day) hangs off its finale and runs under year Y; the roster
// swaps live on 1 Jan, then the new season's run-up (launches, testing) hangs off its opener under Y+1.

// Days from the finale that the post-season beats drop on (review = a soft feature; the rest below).
const RETIREMENTS_AFTER_FINALE = 7
const SIGNING_DAY_AFTER_FINALE = 14
// Days before the opener that the pre-season beats land on.
const LAUNCHES_BEFORE_OPENER = 35
const TESTING_BEFORE_OPENER = 10

// The new season's run-up dates (launches / testing / opener), hung off `year`'s opener. Used while a
// season is in pre-season (no rounds run yet) — including the very first season of a save.
export interface PreSeasonDates { launches: string; testing: string; opener: string }
export function preSeasonDates(year: number): PreSeasonDates | null {
  const cal = calendarForYear(year)
  if (cal.length === 0) return null
  const opener = raceDate(year, cal[0])
  return {
    launches: toISODate(addDays(opener, -LAUNCHES_BEFORE_OPENER)),
    testing: toISODate(addDays(opener, -TESTING_BEFORE_OPENER)),
    opener: toISODate(opener),
  }
}

// The finishing season's wind-down dates, hung off its finale. The roster swap is the New Year boundary;
// retirements + Signing Day are clamped to stay strictly before it so order can never invert on a late finale.
export interface PostSeasonDates { retirements: string; signingDay: string; rosterSwap: string }
export function postSeasonDates(finishedYear: number): PostSeasonDates | null {
  const cal = calendarForYear(finishedYear)
  if (cal.length === 0) return null
  const finale = raceDate(finishedYear, cal[cal.length - 1])
  const rosterSwap = `${finishedYear + 1}-01-01`
  const dayBeforeSwap = toISODate(addDays(fromISODate(rosterSwap), -1))
  const beforeSwap = (d: string) => (d >= rosterSwap ? dayBeforeSwap : d)
  return {
    retirements: beforeSwap(toISODate(addDays(finale, RETIREMENTS_AFTER_FINALE))),
    signingDay: beforeSwap(toISODate(addDays(finale, SIGNING_DAY_AFTER_FINALE))),
    rosterSwap,
  }
}
