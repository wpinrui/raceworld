import type { DraftPick } from '@/lib/sim/driver-market'
import type { Driver } from '@/lib/sim/types'
import { pick, fill, lastName, compose, chance, pronouns, plural } from './util'
import copy from './signing-day-copy.json'

// Era-neutral newsroom reaction to a free-agency signing: a headline + a dek (no body, no social-media
// framing, so it reads the same in 1955 and 2025). One reaction per signing, deterministic from the
// signings + the driver record, so a given off-season always reads the same.
//
// Each pick already carries the facts that make a signing notable (the rivals it beat for the seat, the
// seat's desirability, how coveted the driver was, the contract length); the driver record adds age and
// the season just run. We surface a SELECTION, not all of it: the headline states the move + its angle,
// the dek features the single most salient fact for that angle, plus an occasional driver-context colour.

export interface SigningReaction {
  id: string
  headline: string
  dek: string
  pickIndex: number // the signing this reacts to, so the board can reveal it alongside
}

type Angle = 'rival' | 'seat' | 'conviction' | 'coveted' | 'longshot' | 'youth' | 'veteran' | 'expected' | 'loyalty'

const YOUNG_AGE = 22   // at/below this a driver reads as "young"
const VET_AGE = 35     // at/above this a driver reads as a "veteran"
const STRONG_FORM = 3  // |seasonForm| at/above this is a notable up/down year
const COVETED_RANK = 7 // faRank at/below this is "sought-after" enough to mention

// How coveted the signed driver was, in words (no rank numbers, matching the "words not numbers" rule).
function faPhrase(rank: number): string {
  if (rank <= 1) return 'the most coveted name on the market'
  if (rank <= 3) return 'one of the most sought-after free agents'
  if (rank <= COVETED_RANK) return 'a well-regarded free agent'
  return ''
}
// Seat desirability in words (seatRank 0 = the best open seat).
function seatPhrase(seatRank: number): string {
  if (seatRank === 0) return 'the most coveted seat on the grid'
  if (seatRank <= 2) return 'one of the most sought-after seats'
  return ''
}
function commitmentPhrase(years: number): string {
  if (years >= 3) return 'a long-term commitment'
  if (years <= 1) return 'a short-term deal'
  return 'a multi-year deal'
}
// Driver-context colour, only when notable; empty otherwise so it simply doesn't appear.
function agePhrase(age: number | undefined): string {
  if (age == null) return ''
  if (age <= YOUNG_AGE) return `the ${age}-year-old`
  if (age >= VET_AGE) return `the ${age}-year-old veteran`
  return ''
}
function formPhrase(seasonForm: number | undefined): string {
  if (seasonForm == null) return ''
  if (seasonForm >= STRONG_FORM) return 'after a career-best season'
  if (seasonForm <= -STRONG_FORM) return 'after a season to forget'
  return ''
}

// The strongest contender the signed driver beat for THIS seat: the seat favourite, or the runner-up
// when the signed driver was the favourite. null when there was no real competition on the board.
function rivalOf(p: DraftPick): string | null {
  const others = p.odds.filter((o) => o.driverId !== p.driverId)
  return others.length ? others[0].driverName : null
}

// Choose the single fact the dek leads on, by signing type, falling back when the richer fact is absent.
function angleFor(p: DraftPick, isResign: boolean, rival: string | null, fa: string, seat: string): Angle {
  if (isResign) return 'loyalty' // the loyalty pool already covers a coveted driver who chose to stay
  switch (p.flavour) {
    case 'upset': return rival ? 'rival' : 'longshot'
    case 'statement': return seat ? 'seat' : fa ? 'coveted' : 'conviction'
    case 'rookie': return 'youth'
    case 'veteran_short': return 'veteran'
    case 'chalk': return 'expected'
  }
}

// Capitalise the first letter of each sentence, so a slot landing at a sentence start (e.g. {age_phrase}
// = "the 19-year-old") doesn't read as a lowercase fragment.
const sentenceCase = (s: string): string => s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre, c) => pre + c.toUpperCase())

export function signingDayReactions(picks: DraftPick[], drivers: Driver[]): SigningReaction[] {
  const byId = new Map(drivers.map((d) => [d.id, d]))
  return picks.map((p, i) => {
    const isResign = !!p.prevTeamName && p.prevTeamName === p.teamName
    const d = byId.get(p.driverId)
    const rival = rivalOf(p)
    const fa = faPhrase(p.faRank)
    const seat = seatPhrase(p.seatRank)
    const age = agePhrase(d?.age)
    const form = formPhrase(d?.seasonForm)
    const slots: Record<string, string | number> = {
      driver: p.driverName, driver_last: lastName(p.driverName), team: p.teamName,
      prev: p.flavour === 'rookie' ? 'the junior ranks' : (p.prevTeamName || 'free agency'),
      years: p.years, years_word: plural(p.years, 'year'), seasons_word: plural(p.years, 'season'),
      fa, rival: rival ?? '', rival_last: rival ? lastName(rival) : '',
      seat_phrase: seat, commitment: commitmentPhrase(p.years), age_phrase: age, form_phrase: form,
      ...pronouns(d?.gender),
    }
    const seed = `sd-${p.driverId}`
    const headlinePool = copy.headline[isResign ? 'resign' : p.flavour]
    const headline = sentenceCase(fill(pick(headlinePool, `${seed}|h`), slots))

    const angle = angleFor(p, isResign, rival, fa, seat)
    // One driver-context colour clause, gated so deks stay tight: a notable age (this is the ONLY place
    // age appears, so the dek pools never break on an absent {age_phrase}), else a notable season. Empty
    // pool -> compose drops it, leaving just the lead fact.
    const colourType: 'age' | 'form' | null = age ? 'age' : form ? 'form' : null
    const colourPool = colourType && chance(`${seed}|col`, 60) ? copy.colour[colourType] : ['']
    const dek = sentenceCase(compose(`${seed}|d`, slots, copy.dek[angle], colourPool))

    return { id: seed, headline, dek, pickIndex: i }
  })
}
