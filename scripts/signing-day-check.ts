// Drive several off-seasons and exercise the Signing Day reactions (headline + dek). Prints a sample
// across signing types and asserts the copy is well-formed: no unresolved {slots}, no gendered
// pronouns (the grid has female drivers), no double articles / spaces, and no social-media framing
// (era-neutral). Run: tsx scripts/signing-day-check.ts [--seasons N]

import { mulberry32 } from '@/lib/news/util'

const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear(),
  key: (i: number) => Array.from(mem.keys())[i] ?? null, get length() { return mem.size },
} as unknown as Storage
const realWarn = console.warn.bind(console)
console.warn = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].includes('persist middleware')) return; realWarn(...a) }

const argv = process.argv.slice(2)
const sArg = argv.indexOf('--seasons')
const SEASONS = sArg >= 0 ? parseInt(argv[sArg + 1], 10) || 6 : 6

interface Tagged { flavour: string; resign: boolean; gender: string; headline: string; dek: string }
let pass = 0, fail = 0
const fails: string[] = []
function assert(cond: boolean, msg: string) { if (cond) pass++; else { fail++; fails.push(msg) } }

async function main() {
  const { useSeasonStore } = await import('@/lib/store/season-store')
  const { useRaceStore } = await import('@/lib/store/race-store')
  const { calendarForYear } = await import('@/data/calendars')
  const { composeSeason } = await import('@/lib/history/compose')
  const { buildRaceResults } = await import('@/lib/sim/race-results')
  const { isOffSeason } = await import('@/lib/sim/types')
  const { signingDayReactions } = await import('@/lib/news/signing-day-reactions')

  const rng = mulberry32('signingday'); Math.random = () => rng()
  const season = () => useSeasonStore.getState()
  const all: Tagged[] = []

  for (let si = 0; si < SEASONS; si++) {
    if (si === 0) {
      const composed = composeSeason(2026)!
      season().initSeason(composed.drivers, composed.teams, 2026)
    } else {
      season().runPreSeasonTesting(); season().startNewSeason()
    }
    useSeasonStore.setState({ phase: 'pre-race' })
    const year = season().year
    const cal = calendarForYear(year)

    let guard = 0
    while (guard++ < cal.length + 2) {
      const s = season()
      if (s.phase === 'idle' || isOffSeason(s.phase)) break
      const circuit = cal[s.currentRound - 1]
      if (!circuit) break
      const grid = s.drivers.filter((d) => d.teamId !== '')
      const race = useRaceStore.getState()
      race.loadFromSeason(grid, s.teams, circuit); race.initSession()
      const rs0 = useRaceStore.getState().raceState; if (!rs0) break
      useRaceStore.setState({ raceState: { ...rs0, phase: 'racing' } })
      let lg = 0
      while (useRaceStore.getState().raceState?.phase === 'racing' && lg++ < 5000) useRaceStore.getState().tickLap()
      const fin = useRaceStore.getState().raceState; if (!fin) break
      season().recordRaceResult(buildRaceResults(fin, grid, s.teams, year))
      season().advanceRound(); useRaceStore.getState().resetSession()
    }

    season().runContractNegotiations() // builds seasonDraft + pendingNextSeasonState
    const s = season()
    const picks = s.seasonDraft
    const reactionDrivers = [...(s.pendingNextSeasonState?.drivers ?? []), ...s.drivers]
    const reactions = signingDayReactions(picks, reactionDrivers)
    const genderOf = new Map(reactionDrivers.map((d) => [d.id, d.gender]))
    for (const r of reactions) {
      const p = picks[r.pickIndex]
      all.push({
        flavour: p.flavour, resign: !!p.prevTeamName && p.prevTeamName === p.teamName,
        gender: genderOf.get(p.driverId) ?? 'male', headline: r.headline, dek: r.dek,
      })
    }
    season().runDriverRetirements()
  }

  // ---- assertions over every reaction ----
  // Pronouns must match the signed driver's gender (the whole point: gender is known, so use it).
  const MALE = /\b(he|him|his|himself)\b|he's/i
  const FEMALE = /\b(she|her|hers|herself)\b|she's/i
  for (const r of all) {
    const text = `${r.headline} || ${r.dek}`
    assert(r.headline.length > 0 && r.dek.length > 0, `empty: ${text}`)
    assert(!/\{[a-z_]+\}/.test(text), `unresolved slot: ${text}`)
    assert(!/ {2}| ,|,,/.test(text), `spacing/comma: ${text}`)
    assert(!/\b(a a|an an|the the|a an)\b/i.test(text), `double article: ${text}`)
    if (r.gender === 'female') assert(!MALE.test(text), `male pronoun for female driver: ${text}`)
    else assert(!FEMALE.test(text), `female pronoun for male driver: ${text}`)
    assert(!/@|Confirmed\.|Breaking\.|Done deal|#\w/.test(text), `social framing: ${text}`)
    assert(!text.includes('—'), `em dash: ${text}`)
    assert(!/\b1 (years|seasons)\b/.test(text), `plural: ${text}`)
  }

  // ---- coverage + sample ----
  const flavours = new Set(all.map((r) => (r.resign ? 'resign' : r.flavour)))
  const withColour = all.filter((r) => /[.!?]\s+[A-Z]/.test(r.dek)).length // dek has a 2nd sentence (colour)
  console.log(`Signing Day reactions: ${all.length} across ${SEASONS} off-seasons`)
  console.log(`flavours seen: ${[...flavours].sort().join(', ')}`)
  console.log(`deks with a driver-context colour clause: ${withColour}`)
  console.log('')
  // One example per flavour/resign bucket.
  for (const key of ['upset', 'statement', 'rookie', 'veteran_short', 'chalk', 'resign']) {
    const ex = all.find((r) => (r.resign ? 'resign' : r.flavour) === key)
    if (ex) console.log(`[${key}]\n  ${ex.headline}\n  ${ex.dek}\n`)
  }
  // A couple of colour examples.
  const colourEx = all.filter((r) => /[.!?]\s+[A-Z]/.test(r.dek)).slice(0, 3)
  if (colourEx.length) { console.log('-- with driver-context colour --'); for (const r of colourEx) console.log(`  ${r.headline}\n  ${r.dek}\n`) }

  console.log(`\n${pass} passed, ${fail} failed`)
  for (const f of fails.slice(0, 15)) console.log(`  FAIL ${f}`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
