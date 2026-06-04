import type { DraftPick } from '@/lib/sim/driver-market'
import { pick, fill, lastName, ordinal } from './util'
import copy from './signing-day-copy.json'

// Sports-analyst social reaction to a free-agency signing event (NOT fans). One post per signing, from
// whichever of the four analyst voices best fits what makes the move notable. Deterministic from the
// signings, so a given off-season always reads the same feed.

export interface SocialPost {
  id: string
  handle: string
  name: string
  text: string
  pickIndex: number // the signing this reacts to, so the board can reveal it alongside
}

type Persona = 'insider' | 'stats' | 'pundit' | 'contracts'
type Flavour = DraftPick['flavour']

// Each signing type draws from several flavour-appropriate analyst voices, for variety across a busy
// window and across seasons. Contracts is excluded from veteran deals (its copy assumes long terms).
const FLAVOUR_PERSONAS: Record<Flavour, Persona[]> = {
  upset: ['stats', 'insider', 'pundit'],
  statement: ['contracts', 'insider', 'pundit', 'stats'],
  rookie: ['pundit', 'insider', 'stats'],
  veteran_short: ['pundit', 'insider', 'stats'],
  chalk: ['insider', 'stats', 'pundit'],
}
function personaFor(p: DraftPick): Persona {
  return pick(FLAVOUR_PERSONAS[p.flavour], `sd-persona-${p.driverId}`)
}

function poolFor(persona: Persona, f: Flavour): string[] {
  switch (persona) {
    case 'insider': return copy.insider[f]
    case 'pundit': return copy.pundit[f]
    case 'stats': return copy.stats[f]
    case 'contracts': return copy.contracts
  }
}

// How coveted the signed driver was, in words (no numbers), matching the board's "best" badge wording.
function faPhrase(rank: number): string {
  return rank === 1 ? 'the best free agent on the market' : `the ${ordinal(rank)} best free agent`
}

function slotsFor(p: DraftPick): Record<string, string | number> {
  const prev = p.flavour === 'rookie' ? 'the junior ranks' : (p.prevTeamName || 'free agency')
  return { driver: p.driverName, driver_last: lastName(p.driverName), team: p.teamName, prev, years: p.years, fa: faPhrase(p.faRank) }
}

// Capitalise the first letter of each sentence, so a slot that lands at a sentence start (e.g. {fa} =
// "the most sought-after free agent") doesn't read as a lowercase fragment.
const sentenceCase = (s: string): string => s.replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre, c) => pre + c.toUpperCase())

export function signingDaySocialPosts(picks: DraftPick[]): SocialPost[] {
  return picks.map((p, i) => {
    const persona = personaFor(p)
    const meta = copy.personas[persona]
    const seed = `sd-${p.driverId}-${persona}`
    return { id: seed, handle: meta.handle, name: meta.name, text: sentenceCase(fill(pick(poolFor(persona, p.flavour), seed), slotsFor(p))), pickIndex: i }
  })
}
