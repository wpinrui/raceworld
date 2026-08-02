import { describe, expect, it } from 'vitest'
import { TRACK_LAYOUTS } from '@/data/tracks'
import { VENUES, venueFor } from '@/data/tracks/venues'
import {
  RACE_HOURS, azimuthFromBearing, isFloodlit, lightingAt, raceClock, solarHour, solarNoon,
  sunPosition,
} from './sun'
import { lightDir, shadowReach } from './lighting'
import { sunTravel as travel3d } from '@/lib/scene3d/lighting3d'

const DEG = 180 / Math.PI
const hungary = VENUES.hungary
const britain = VENUES.britain
const altAt = (v: typeof hungary, h: number) => sunPosition(v, h).altitude * DEG
const bearingAt = (v: typeof hungary, h: number) => sunPosition(v, h).bearing * DEG

describe('sunPosition', () => {
  it('puts the sun due south at solar noon in the northern hemisphere', () => {
    expect(bearingAt(hungary, solarNoon(hungary))).toBeCloseTo(180, 4)
  })

  it('puts it due north at solar noon in the southern hemisphere', () => {
    // And says so as 0 rather than 360: the arctangent lands on pi here and the half turn carries it
    // all the way round, which is the same bearing and a trap for anything comparing them.
    expect(bearingAt(VENUES.brazil, solarNoon(VENUES.brazil))).toBeCloseTo(0, 4)
  })

  it('runs east through south to west across the day', () => {
    expect(bearingAt(britain, 8)).toBeLessThan(180)
    expect(bearingAt(britain, 8)).toBeGreaterThan(60)
    expect(bearingAt(britain, 18)).toBeGreaterThan(180)
  })

  it('never lifts the sun above what the latitude allows', () => {
    // The astronomical ceiling: 90 - |lat| + 23.44, reached only at the solstice. The old constant
    // `MOODS.afternoon` asked for 67.5 degrees at every venue, which Hungary cannot reach at all.
    for (const [id, v] of Object.entries(VENUES)) {
      const ceiling = 90 - Math.abs(v.lat) + 23.44
      for (let h = 0; h <= 24; h += 0.25) {
        expect(altAt(v, h), `${id} at ${h}h`).toBeLessThanOrEqual(ceiling + 0.5)
      }
    }
  })

  it('places Hungary where the real race runs, not where the constant put it', () => {
    // Measured against the venue's own geometry: 47.58N, late July. The old light was 67.5 degrees,
    // above the 65.9 the sun can EVER reach there.
    const start = altAt(hungary, hungary.startHour)
    expect(start).toBeGreaterThan(50)
    expect(start).toBeLessThan(62)
    expect(start).toBeLessThan(65.9)
    // And the shadow it throws is roughly two thirds of a caster's height, where the constant gave
    // four tenths.
    const reach = shadowReach(lightingAt(hungary, hungary.startHour))
    expect(reach).toBeGreaterThan(0.55)
    expect(reach).toBeLessThan(0.9)
  })

  it('corrects the clock for where the venue sits inside its zone', () => {
    // Budapest keeps UTC+2, whose meridian is 30 east, and stands ten degrees west of it. The sun
    // reaches it about three quarters of an hour LATE, so at twelve on the clock it is not yet noon.
    expect(solarHour(hungary, 12)).toBeLessThan(12)
    expect(solarNoon(hungary)).toBeGreaterThan(12.5)
    expect(solarNoon(hungary)).toBeLessThan(13)
  })
})

describe('azimuthFromBearing', () => {
  it('sends the light north when the sun is in the south', () => {
    const az = azimuthFromBearing(Math.PI)
    // The 2D plan bearing, and the 3D travel vector, must agree that the light runs to -y / -z,
    // which on this north-up map is UP the screen.
    const plan = lightDir({ azimuth: az, elevation: 0.5, warmth: 0, ambient: 0 })
    expect(plan.x).toBeCloseTo(0, 10)
    expect(plan.y).toBeCloseTo(-1, 10)
    const world = travel3d({ azimuth: az, elevation: 0.5, warmth: 0, ambient: 0 })
    expect(world.x).toBeCloseTo(0, 10)
    expect(world.z).toBeLessThan(0)
  })

  it('sends it northeast when the sun is in the southwest', () => {
    const plan = lightDir({
      azimuth: azimuthFromBearing(225 / DEG), elevation: 0.5, warmth: 0, ambient: 0,
    })
    expect(plan.x).toBeGreaterThan(0)
    expect(plan.y).toBeLessThan(0)
  })

  it('sends it south for a southern-hemisphere sun standing in the north', () => {
    const plan = lightDir({ azimuth: azimuthFromBearing(0), elevation: 0.5, warmth: 0, ambient: 0 })
    expect(plan.y).toBeGreaterThan(0)
  })
})

describe('lightingAt', () => {
  it('reddens and flattens the light as the sun drops', () => {
    const high = lightingAt(britain, 13)
    const low = lightingAt(britain, 20)
    expect(low.elevation).toBeLessThan(high.elevation)
    expect(low.warmth).toBeGreaterThan(high.warmth)
    expect(low.ambient).toBeGreaterThan(high.ambient)
  })

  it('ramps into the night rig through twilight rather than switching', () => {
    const singapore = VENUES.singapore
    const day = lightingAt(singapore, 12)
    const dusk = lightingAt(singapore, 19)
    const night = lightingAt(singapore, 21)
    expect(day.level ?? 1).toBeCloseTo(1, 6)
    expect(dusk.level ?? 1).toBeLessThan(1)
    expect(dusk.level ?? 1).toBeGreaterThan(night.level ?? 1)
    expect(night.level ?? 1).toBeCloseTo(0.5, 2)
  })

  it('fills the shadows in and cools the cast under cloud', () => {
    const clear = lightingAt(britain, 15, { cloud: 0 })
    const wet = lightingAt(britain, 15, { cloud: 1 })
    expect(wet.ambient).toBeGreaterThan(clear.ambient)
    expect(wet.warmth).toBeLessThan(clear.warmth)
    expect(wet.azimuth).toBeCloseTo(clear.azimuth, 10)
  })

  it('keeps every scalar inside the range the rig reads them in', () => {
    for (const [id, v] of Object.entries(VENUES)) {
      for (let h = 0; h <= 24; h += 0.5) {
        const l = lightingAt(v, h, { cloud: h % 2 === 0 ? 0 : 1 })
        expect(l.elevation, `${id} elevation`).toBeGreaterThanOrEqual(0)
        expect(l.elevation, `${id} elevation`).toBeLessThanOrEqual(1)
        expect(l.warmth, `${id} warmth`).toBeGreaterThanOrEqual(-1)
        expect(l.warmth, `${id} warmth`).toBeLessThanOrEqual(1)
        expect(l.ambient, `${id} ambient`).toBeGreaterThanOrEqual(0)
        expect(l.ambient, `${id} ambient`).toBeLessThanOrEqual(1)
        expect(Number.isFinite(l.azimuth), `${id} azimuth`).toBe(true)
      }
    }
  })
})

describe('isFloodlit', () => {
  it('calls the night races night, off the sun and not off a list', () => {
    // The venues that were hardcoded as `NIGHT_VENUES`. Each one now earns it: it starts at an hour
    // when the sun is down or nearly so, at its own latitude, on its own date.
    for (const id of ['singapore', 'qatar', 'las-vegas', 'saudi-arabia', 'bahrain']) {
      expect(isFloodlit(VENUES[id], VENUES[id].startHour), id).toBe(true)
    }
  })

  it('leaves the daytime races in daylight', () => {
    for (const id of ['britain', 'hungary', 'monaco', 'italy', 'brazil', 'japan', 'spain']) {
      expect(isFloodlit(VENUES[id], VENUES[id].startHour), id).toBe(false)
    }
  })

  it('catches Abu Dhabi going dark DURING the race, which no venue flag could say', () => {
    // The reason a venue FLAG cannot describe this race: it starts with the sun still up, a few
    // degrees off the horizon, and takes the flag well past the end of civil twilight.
    const abu = VENUES['abu-dhabi']
    expect(sunPosition(abu, raceClock(abu, 0)).altitude * DEG).toBeGreaterThan(0)
    expect(sunPosition(abu, raceClock(abu, 1)).altitude * DEG).toBeLessThan(-6)
    expect(isFloodlit(abu, raceClock(abu, 1))).toBe(true)
  })
})

describe('raceClock', () => {
  it('runs the sun down across the race distance', () => {
    expect(raceClock(britain, 0)).toBe(britain.startHour)
    expect(raceClock(britain, 1)).toBeCloseTo(britain.startHour + RACE_HOURS, 10)
    const green = lightingAt(britain, raceClock(britain, 0))
    const flag = lightingAt(britain, raceClock(britain, 1))
    expect(flag.elevation).toBeLessThan(green.elevation)
    expect(shadowReach(flag)).toBeGreaterThan(shadowReach(green))
  })

  it('clamps outside the race rather than running the sun off the sky', () => {
    expect(raceClock(britain, -1)).toBe(britain.startHour)
    expect(raceClock(britain, 5)).toBeCloseTo(britain.startHour + RACE_HOURS, 10)
  })
})

describe('coverage', () => {
  it('gives every circuit on the calendar a venue', () => {
    const missing = Object.keys(TRACK_LAYOUTS).filter((id) => !VENUES[id])
    expect(missing).toEqual([])
  })

  it('names no venue the calendar does not have', () => {
    const stray = Object.keys(VENUES).filter((id) => !TRACK_LAYOUTS[id])
    expect(stray).toEqual([])
  })

  it('falls back rather than throwing on a circuit added without one', () => {
    expect(venueFor('not-a-circuit')).toBe(VENUES.britain)
    expect(venueFor('monaco')).toBe(VENUES.monaco)
  })
})
