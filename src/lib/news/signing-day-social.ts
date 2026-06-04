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

// One voice per signing, chosen for the angle that makes the move interesting.
function personaFor(f: Flavour): Persona {
  switch (f) {
    case 'upset': return 'stats'          // the long odds are the story
    case 'statement': return 'contracts'  // the multi-year commitment is the story
    case 'rookie': return 'pundit'        // an unknown quantity to weigh up
    case 'veteran_short': return 'contracts' // a one-year stopgap
    default: return 'insider'             // chalk: confirmed, as expected
  }
}

function poolFor(persona: Persona, f: Flavour): string[] {
  switch (persona) {
    case 'insider': return copy.insider[f]
    case 'pundit': return copy.pundit[f]
    case 'stats': return copy.stats[f]
    case 'contracts': return copy.contracts
  }
}

// How coveted the signed driver was, in words (no numbers), from their free-agent ranking.
function faPhrase(rank: number): string {
  return rank === 1 ? 'the most sought-after free agent' : rank <= 3 ? 'a top free agent' : `the ${ordinal(rank)}-rated free agent`
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
    const persona = personaFor(p.flavour)
    const meta = copy.personas[persona]
    const seed = `sd-${p.driverId}-${persona}`
    return { id: seed, handle: meta.handle, name: meta.name, text: sentenceCase(fill(pick(poolFor(persona, p.flavour), seed), slotsFor(p))), pickIndex: i }
  })
}
