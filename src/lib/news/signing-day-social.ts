import type { DraftPick } from '@/lib/sim/driver-market'
import { pick, fill, lastName, ordinal } from './util'
import copy from './signing-day-copy.json'

// Sports-analyst social reaction to Signing Day (NOT fan/hype/banter). Four personas: an insider with
// the scoop, a stats account that posts the REAL draft numbers, a tactical pundit, and a contracts
// specialist. Deterministic from the picks (no RNG), so a given draft always reads the same feed.

export interface SocialPost {
  id: string
  handle: string
  name: string
  text: string
  pickIndex: number // the pick this reacts to, so the UI can reveal it alongside its pick
}

type Persona = 'insider' | 'stats' | 'pundit' | 'contracts'

const PERSONA_ORDER: Persona[] = ['insider', 'stats', 'pundit', 'contracts']

// Where the driver came from, as a phrase the analysts can drop into a post.
function prevPhrase(p: DraftPick): string {
  if (p.flavour === 'rookie') return 'the junior ranks'
  return p.prevTeamName ? p.prevTeamName : 'free agency'
}

function slotsFor(p: DraftPick): Record<string, string | number> {
  return {
    driver: p.driverName,
    driver_last: lastName(p.driverName),
    team: p.teamName,
    prev: prevPhrase(p),
    pct: Math.round(p.pickPct),
    realized: Math.round(p.realizedProb * 100),
    rank: p.seatRank + 1,
    seat_ord: ordinal(p.seatRank + 1),
    years: p.years,
  }
}

// Which personas weigh in on a given pick. The insider scoops every signing; the others pick their
// spots so the feed stays varied rather than four near-identical posts per seat.
function personasFor(p: DraftPick): Persona[] {
  const out: Persona[] = ['insider']
  if (p.flavour === 'upset' || p.seatRank < 3) out.push('stats')
  if (p.flavour !== 'chalk') out.push('pundit')
  if (p.years >= 3 || p.flavour === 'veteran_short') out.push('contracts')
  return out
}

function poolFor(persona: Persona, p: DraftPick): string[] {
  if (persona === 'insider') return copy.insider[p.flavour]
  if (persona === 'pundit') return copy.pundit[p.flavour]
  if (persona === 'stats') return copy.stats
  return copy.contracts
}

export function signingDaySocialPosts(picks: DraftPick[]): SocialPost[] {
  const out: SocialPost[] = []
  picks.forEach((p, i) => {
    const slots = slotsFor(p)
    for (const persona of personasFor(p)) {
      const pool = poolFor(persona, p)
      if (!pool || pool.length === 0) continue
      const seed = `sd-${p.driverId}-${persona}`
      const meta = copy.personas[persona]
      out.push({
        id: seed,
        handle: meta.handle,
        name: meta.name,
        text: fill(pick(pool, seed), slots),
        pickIndex: i,
      })
    }
  })
  // Stable order: by pick, then by persona order within a pick.
  const rank = (h: string) => {
    const idx = PERSONA_ORDER.findIndex((k) => copy.personas[k].handle === h)
    return idx < 0 ? 99 : idx
  }
  return out.sort((a, b) => a.pickIndex - b.pickIndex || rank(a.handle) - rank(b.handle))
}
