// Throwaway smoke test for the Signing Day social feed (run: npx tsx scripts/social-check.ts).
import { runDraft, type DraftSeat } from '../src/lib/sim/driver-market'
import { signingDaySocialPosts } from '../src/lib/news/signing-day-social'
import type { Driver, Team } from '../src/lib/sim/types'

const mkDriver = (i: number, age = 27): Driver => ({
  id: `d${i}`, name: `Driver ${i}`, teamId: i < 3 ? `s${i}` : '', nationality: 'GB', gender: 'male',
  pace: 90 - i, wetWeatherPace: 80, overtaking: 80, smoothness: 80, age, peakPotential: 90, primeEnd: 32,
  narrativeModifier: 0, contractExpiresAfterSeason: 2025, seasonsSinceF1Seat: 0,
})
const teams: Team[] = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `Team ${i}`, shortName: `T${i}`, nationality: 'GB', color: '#888', carPace: 75 - i * 5 }))
const seats: DraftSeat[] = Array.from({ length: 6 }, (_, i) => ({ teamId: `s${i % 5}`, teamName: `Team ${i % 5}`, teamColor: '#888' }))
const pool = Array.from({ length: 10 }, (_, i) => mkDriver(i))

const picks = runDraft({ seats, pool, teams, currentYear: 2026, rng: Math.random })
const posts = signingDaySocialPosts(picks)

let fail = 0
console.log(`picks: ${picks.length}, posts: ${posts.length}`)
for (const p of posts.slice(0, 12)) {
  if (!p.text || p.text.includes('TODO') || /\{[a-z_]+\}/.test(p.text)) { fail++; console.log(`XX UNFILLED: ${p.text}`) }
  console.log(`  ${p.handle.padEnd(16)} ${p.text}`)
}
if (posts.length === 0) { fail++; console.log('XX no posts generated') }
console.log(fail === 0 ? '\nSOCIAL OK' : `\n${fail} ISSUE(S)`)
process.exit(fail === 0 ? 0 : 1)
