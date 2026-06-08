import type { NewsArticle } from '@/lib/news/engine'
import { calendarForYear } from '@/data/calendars'
import { raceDate, toISODate, addDays } from './calendar-dates'

// The brain of the FM-style "Continue" loop. Pure + UI-agnostic: given today's clock, how many
// rounds have been run, and the dated news feed, it decides the next date the sim should stop and
// why. The UI advances the clock to that date and then either opens the race (raceday) or shows the
// interrupting story. Raceday is the hard ceiling — Continue never advances past the next race, and a
// story landing on race day yields to the race (which always interrupts).

export interface ContinueSettings {
  interruptCategories: string[]
  followedDriverIds: string[]
  followedTeamIds: string[]
  interruptOnFollowed: boolean
}

export type NextStop =
  | { reason: 'race'; date: string; round: number }
  | { reason: 'news'; date: string; articles: NewsArticle[] }
  | { reason: 'season-end'; date: string } // racing season done; the off-season flow takes over

// Does this dated article interrupt the sim under the player's settings?
export function articleInterrupts(a: NewsArticle, s: ContinueSettings): boolean {
  if (s.interruptCategories.includes(a.category)) return true
  if (s.interruptOnFollowed && a.entities) {
    if (a.entities.driverIds.some((id) => s.followedDriverIds.includes(id))) return true
    if (a.entities.teamIds.some((id) => s.followedTeamIds.includes(id))) return true
  }
  return false
}

export function computeNextStop(args: {
  currentDate: string
  completedRounds: number
  year: number
  articles: NewsArticle[]
  settings: ContinueSettings
  readIds?: string[] // already-read stories never re-interrupt (issue #114)
}): NextStop {
  const { currentDate, completedRounds, year, articles, settings, readIds = [] } = args
  const calendar = calendarForYear(year)
  const total = calendar.length
  const nextRaceRound = completedRounds + 1
  // The sim halts at the race WEEKEND (Friday = race Sunday minus 2), not the race itself, so the player
  // enters the weekend on Friday with the mid-week pre-race preview already dropped.
  const nextRaceDate = nextRaceRound <= total
    ? toISODate(addDays(raceDate(year, calendar[nextRaceRound - 1]), -2))
    : null

  // Interrupting stories strictly after today and strictly before the next race (raceday wins ties).
  // Already-read stories are skipped, so Continue never halts on something the player has seen (#114).
  const read = new Set(readIds)
  const interrupting = articles
    .filter((a) => !!a.date && a.date > currentDate && (nextRaceDate ? a.date < nextRaceDate : true))
    .filter((a) => !read.has(a.id))
    .filter((a) => articleInterrupts(a, settings))
    .sort((a, b) => (a.date as string).localeCompare(b.date as string))

  if (interrupting.length > 0) {
    const stopDate = interrupting[0].date as string
    return { reason: 'news', date: stopDate, articles: interrupting.filter((a) => a.date === stopDate) }
  }
  if (nextRaceDate) return { reason: 'race', date: nextRaceDate, round: nextRaceRound }
  return { reason: 'season-end', date: currentDate }
}
