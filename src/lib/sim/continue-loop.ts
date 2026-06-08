import type { NewsArticle } from '@/lib/news/engine'
import { calendarForYear } from '@/data/calendars'
import { raceDate, toISODate, addDays } from './calendar-dates'
import { postSeasonDates, preSeasonDates } from './offseason-dates'

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

// Dated off-season beats the Continue loop stops on. The state + news for each are computed organically
// when the clock arrives (not pre-baked). 'roster-swap' is a silent New-Year boundary (no modal); the
// rest present (retirements/signing-day/testing). Launches + the season review are soft news, not stops.
export type OffSeasonEvent = 'retirements' | 'signing-day' | 'roster-swap' | 'testing'

export type NextStop =
  | { reason: 'race'; date: string; round: number }
  | { reason: 'news'; date: string; articles: NewsArticle[] }
  | { reason: 'offseason'; date: string; event: OffSeasonEvent }
  | { reason: 'idle'; date: string } // genuinely nothing scheduled (e.g. no calendar) — a safety terminal

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

  // Dated off-season beats (#126): the finishing season's wind-down once its rounds are done, and the new
  // season's pre-season run-up before round 1. Each is a date the loop stops on; its sim/news are run on
  // arrival, so they aren't in `articles` yet — hence they're scheduled by date, not discovered as news.
  const events: { date: string; event: OffSeasonEvent }[] = []
  if (total > 0 && completedRounds >= total) {
    const p = postSeasonDates(year)
    if (p) events.push({ date: p.retirements, event: 'retirements' }, { date: p.signingDay, event: 'signing-day' }, { date: p.rosterSwap, event: 'roster-swap' })
  }
  if (completedRounds === 0) {
    const p = preSeasonDates(year)
    if (p) events.push({ date: p.testing, event: 'testing' })
  }
  const nextEvent = events.filter((e) => e.date > currentDate).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null

  // Interrupting stories strictly after today, before whichever comes first of the next race / next event
  // (those win ties). Already-read stories are skipped, so Continue never halts on a seen story (#114).
  const ceiling = [nextRaceDate, nextEvent?.date].filter((d): d is string => !!d).sort((a, b) => a.localeCompare(b))[0] ?? null
  const read = new Set(readIds)
  const interrupting = articles
    .filter((a) => !!a.date && a.date > currentDate && (ceiling ? a.date < ceiling : true))
    .filter((a) => !read.has(a.id))
    .filter((a) => articleInterrupts(a, settings))
    .sort((a, b) => (a.date as string).localeCompare(b.date as string))

  if (interrupting.length > 0) {
    const stopDate = interrupting[0].date as string
    return { reason: 'news', date: stopDate, articles: interrupting.filter((a) => a.date === stopDate) }
  }
  if (nextEvent && (!nextRaceDate || nextEvent.date <= nextRaceDate)) return { reason: 'offseason', date: nextEvent.date, event: nextEvent.event }
  if (nextRaceDate) return { reason: 'race', date: nextRaceDate, round: nextRaceRound }
  return { reason: 'idle', date: currentDate }
}
