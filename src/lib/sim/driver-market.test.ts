import { describe, it, expect } from 'vitest'
import { runDriverDraft, type DraftSeat } from './driver-market'
import { applyMarketAttrition } from './free-agency'
import type { Driver } from './types'

// A free-agent pool driver (no seat). Order in the pool array IS the media ranking (best first).
function fa(id: string, over = 70): Driver {
  return {
    id, name: id, teamId: '', nationality: 'GB', gender: 'male',
    pace: over, wetWeatherPace: over, overtaking: over, smoothness: over, consistency: over,
    age: 25, peakPotential: 85, primeEnd: 30, narrativeModifier: 0, contractExpiresAfterSeason: 2024,
  }
}

const seat = (id: string): DraftSeat => ({ teamId: id, teamName: id.toUpperCase(), teamColor: '#fff' })

// roll 0 always lands on rank 0 (the geometric's favourite), so the highest-ranked candidate wins each seat.
const rollTop = () => 0

describe('runDriverDraft', () => {
  it('pauses with an offer when the roll lands the player a seat', () => {
    const pool = [fa('you'), fa('rivalA'), fa('rivalB')] // player ranked best
    const step = runDriverDraft({ seats: [seat('redbull'), seat('ferrari')], pool, teams: [], currentYear: 2024, playerId: 'you', rng: rollTop })
    expect(step.kind).toBe('offer')
    if (step.kind !== 'offer') return
    expect(step.offer.seatRank).toBe(0)
    expect(step.offer.teamId).toBe('redbull')
    expect(step.offer.offeredYears).toBeGreaterThanOrEqual(1)
    expect(step.cursor.picks).toHaveLength(0) // no seats filled above the top one
    expect(step.cursor.remainingIds).toContain('you') // player still in the pool until they accept
  })

  it('decline re-fills that seat with a rival and offers the player a later seat', () => {
    const pool = [fa('you'), fa('rivalA'), fa('rivalB')]
    const first = runDriverDraft({ seats: [seat('redbull'), seat('ferrari')], pool, teams: [], currentYear: 2024, playerId: 'you', rng: rollTop })
    if (first.kind !== 'offer') throw new Error('expected first offer')
    // Decline: re-roll the SAME seat without the player, then continue.
    const next = runDriverDraft({ seats: [seat('redbull'), seat('ferrari')], pool, teams: [], currentYear: 2024, playerId: 'you', rng: rollTop, cursor: first.cursor, skipPlayerThisSeat: true })
    expect(next.kind).toBe('offer')
    if (next.kind !== 'offer') return
    expect(next.offer.seatRank).toBe(1)            // held out, now offered the second seat
    expect(next.offer.teamId).toBe('ferrari')
    expect(next.cursor.picks).toHaveLength(1)       // the declined seat went to a rival
    expect(next.cursor.picks[0].teamId).toBe('redbull')
    expect(next.cursor.picks[0].driverId).not.toBe('you')
  })

  it('finishes without the player when the roll never lands on them', () => {
    const pool = [fa('rivalA'), fa('rivalB'), fa('you')] // player ranked last; rollTop always takes a rival
    const step = runDriverDraft({ seats: [seat('redbull'), seat('ferrari')], pool, teams: [], currentYear: 2024, playerId: 'you', rng: rollTop })
    expect(step.kind).toBe('done')
    if (step.kind !== 'done') return
    expect(step.picks).toHaveLength(2)
    expect(step.picks.some((p) => p.driverId === 'you')).toBe(false)
  })
})

describe('applyMarketAttrition exemption', () => {
  const seatless = (id: string): Driver => ({ ...fa(id), seasonsSinceF1Seat: 4 }) // 4 -> 5 this run = the cutoff

  it('drops a free agent who has timed out', () => {
    const { retiredDriverIds } = applyMarketAttrition([seatless('washed')])
    expect(retiredDriverIds).toContain('washed')
  })

  it('never drops the exempt player, however long they wait', () => {
    const { drivers, retiredDriverIds } = applyMarketAttrition([seatless('you'), seatless('washed')], 'you')
    expect(retiredDriverIds).toContain('washed')
    expect(retiredDriverIds).not.toContain('you')
    expect(drivers.find((d) => d.id === 'you')?.seasonsSinceF1Seat).toBe(5) // keeps accruing, just not retired
  })
})
