// #sim-2d — cutting the pit complex's outline into stretches. Each case here pins a way the cut can
// produce a ring that fills correctly but EXTRUDES wrong, which is the failure mode that matters: a
// stray vertex at a bound is invisible in the footprint and comes back out of `sweptRing` as a wall
// face standing on nothing.

import { describe, it, expect } from 'vitest'
import { runIn, subdivide, type PitNode } from './pit-profile'

/** A front profile with one recess: flat pier, step back, recess floor, step forward, flat pier. */
const RECESS: PitNode[] = [
  { s: 0, lat: 4 }, { s: 10, lat: 4 },
  { s: 10, lat: 13 }, { s: 30, lat: 13 },
  { s: 30, lat: 4 }, { s: 40, lat: 4 },
]

describe('runIn', () => {
  it('returns the whole run when the bounds hold all of it', () => {
    expect(runIn(RECESS, -1, 41)).toEqual(RECESS)
  })

  it('cuts a horizontal run at the bound', () => {
    expect(runIn(RECESS, 15, 25)).toEqual([{ s: 15, lat: 13 }, { s: 25, lat: 13 }])
  })

  it('opens at the offset the profile actually reaches there, not the one before the step', () => {
    // The cut lands inside the recess. A clamp that kept the step at s=10 would open the run at the
    // pier's offset and then jump straight back to the recess floor, which is a zero-width slit down
    // the ring and a wall face on nothing once it is swept.
    const cut = runIn(RECESS, 20, 40)
    expect(cut[0]).toEqual({ s: 20, lat: 13 })
    expect(cut.filter((n) => n.s === 20)).toHaveLength(1)
  })

  it('keeps a step that is strictly inside, with both of its offsets', () => {
    const cut = runIn(RECESS, 5, 20)
    expect(cut).toEqual([
      { s: 5, lat: 4 }, { s: 10, lat: 4 }, { s: 10, lat: 13 }, { s: 20, lat: 13 },
    ])
  })

  it('drops a step sitting exactly on a bound, which the ring supplies by closing anyway', () => {
    expect(runIn(RECESS, 10, 20)).toEqual([{ s: 10, lat: 13 }, { s: 20, lat: 13 }])
    expect(runIn(RECESS, 0, 10)).toEqual([{ s: 0, lat: 4 }, { s: 10, lat: 4 }])
  })

  it('keeps a decreasing run decreasing, so a rear profile still walks back', () => {
    const rear: PitNode[] = [{ s: 40, lat: 14 }, { s: 25, lat: 14 }, { s: 25, lat: 16 }, { s: 0, lat: 16 }]
    const cut = runIn(rear, 10, 30)
    expect(cut.map((n) => n.s)).toEqual([30, 25, 25, 10])
  })

  it('is empty when the bounds miss the run entirely', () => {
    expect(runIn(RECESS, 50, 60)).toEqual([])
  })
})

describe('subdivide', () => {
  it('inserts a vertex at every station inside a horizontal run, in that run\'s own direction', () => {
    const out = subdivide([{ s: 0, lat: 4 }, { s: 40, lat: 4 }], [30, 10])
    expect(out).toEqual([{ s: 0, lat: 4 }, { s: 10, lat: 4 }, { s: 30, lat: 4 }, { s: 40, lat: 4 }])
    const back = subdivide([{ s: 40, lat: 4 }, { s: 0, lat: 4 }], [10, 30])
    expect(back.map((n) => n.s)).toEqual([40, 30, 10, 0])
  })

  it('leaves the profile alone where a station is outside a run or on its ends', () => {
    expect(subdivide(RECESS, [10, 30, 45])).toEqual(RECESS)
  })

  it('gives a cut a vertex to land on, so the whole outline and its stretches agree', () => {
    // Without this, a cut at 20 adds a vertex the whole outline does not have, and on a curving lane
    // the two disagree by the sagitta of the chord it replaced.
    const whole = subdivide(RECESS, [20])
    expect(whole).toContainEqual({ s: 20, lat: 13 })
    expect(runIn(whole, 0, 20).every((n) => whole.some((w) => w.s === n.s && w.lat === n.lat))).toBe(true)
  })
})
