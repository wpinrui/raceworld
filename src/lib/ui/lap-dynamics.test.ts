import { describe, expect, it } from 'vitest'
import { lapDynamics, sampleLap, type LapPhysics } from './lap-dynamics'

const PHYS: LapPhysics = { vTop: 90, vFloor: 10, aLat: 14, aAccel: 12.75, aBrake: 41 }

/** A closed circle, sampled at equal arc intervals. `dir` +1 winds clockwise on screen (y down). */
function circle(r: number, n: number, dir: 1 | -1 = 1) {
  return Array.from({ length: n }, (_, i) => {
    const th = (dir * i * 2 * Math.PI) / n
    return { x: r * Math.cos(th), y: r * Math.sin(th) }
  })
}

/** Resample any closed parametric curve to `n` points of equal arc length, which is what the physics
 *  assumes it is being given. */
function equalArc(at: (t: number) => { x: number; y: number }, n: number) {
  const fine = 20000
  const pts = Array.from({ length: fine + 1 }, (_, i) => at(i / fine))
  const cum = [0]
  for (let i = 1; i <= fine; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const len = cum[fine]
  const out: { x: number; y: number }[] = []
  let j = 0
  for (let i = 0; i < n; i++) {
    const target = (i / n) * len
    while (j < fine && cum[j + 1] < target) j++
    out.push(pts[j])
  }
  return { pts: out, len }
}

describe('lapDynamics', () => {
  it('turns lap time into a monotonic 0..1 curve', () => {
    const n = 256
    const { time } = lapDynamics(circle(300, n), 2 * Math.PI * 300, PHYS)
    expect(time.length).toBe(n + 1)
    expect(time[0]).toBe(0)
    expect(time[n]).toBeCloseTo(1, 12)
    for (let i = 0; i < n; i++) expect(time[i + 1]).toBeGreaterThan(time[i])
  })

  it('holds a constant-radius corner at the grip limit, in both directions', () => {
    const r = 120
    const n = 256
    const right = lapDynamics(circle(r, n), 2 * Math.PI * r, PHYS)
    const left = lapDynamics(circle(r, n, -1), 2 * Math.PI * r, PHYS)
    // Curvature is measured between two chord midpoints two stations apart but divided by four, so
    // the profile has always seen HALF the true 1/r. Corner speeds are therefore sqrt(2) higher than
    // aLat alone would give. It is what the shipped animation was tuned around: pinned here so that
    // if it is ever corrected, every car's cornering speed is known to have moved with it.
    for (let i = 0; i < n; i++) {
      expect(right.speed[i]).toBeCloseTo(Math.sqrt(PHYS.aLat * 2 * r), 4)
      expect(right.lat[i]).toBeCloseTo(1, 6) // saturated: this IS the limit
      expect(left.lat[i]).toBeCloseTo(-1, 6) // same corner the other way
      expect(right.long[i]).toBeCloseTo(0, 6) // nothing to gain or lose at a steady speed
    }
  })

  it('reports a fraction of the limit on a corner taken below it', () => {
    // Wide enough that top speed binds first, so the car is nowhere near the grip limit.
    const r = 6000
    const n = 256
    const { speed, lat } = lapDynamics(circle(r, n), 2 * Math.PI * r, PHYS)
    expect(speed[0]).toBeCloseTo(PHYS.vTop, 6)
    expect(lat[0]).toBeCloseTo((PHYS.vTop * PHYS.vTop) / (2 * r) / PHYS.aLat, 6)
    expect(lat[0]).toBeGreaterThan(0)
    expect(lat[0]).toBeLessThan(0.5)
  })

  it('brakes into a corner and accelerates out of it', () => {
    // An ellipse: tightest at the ends of the major axis, so a car has to slow for them.
    const n = 256
    const { pts, len } = equalArc((t) => ({
      x: 900 * Math.cos(2 * Math.PI * t),
      y: 260 * Math.sin(2 * Math.PI * t),
    }), n)
    const { lat, long } = lapDynamics(pts, len, PHYS)
    expect(Math.min(...long)).toBeLessThan(-0.2) // genuinely on the brakes somewhere
    expect(Math.max(...long)).toBeGreaterThan(0.2) // and back on the throttle somewhere
    // Station n/2 is an end of the major axis, so it is the tightest point on that side of the lap
    // (station 0 is the other one). Braking has to land in the approach to it and traction in the
    // exit -- not the other way round, which is what a sign error in the two passes would give.
    const window = (from: number, to: number) => Array.from(long.slice(from, to))
    expect(lat[n / 2]).toBeGreaterThan(Math.max(...Array.from(lat.slice(n / 4, n / 4 + 8))))
    expect(Math.min(...window(n / 2 - n / 8, n / 2))).toBeLessThan(-0.2)
    expect(Math.max(...window(n / 2, n / 2 + n / 8))).toBeGreaterThan(0.2)
  })

  it('never exceeds the limits it was given', () => {
    const n = 256
    const { pts, len } = equalArc((t) => ({
      x: 700 * Math.cos(2 * Math.PI * t),
      y: 300 * Math.sin(4 * Math.PI * t), // a figure of eight: curvature swings hard and changes sign
    }), n)
    const { speed, lat, long } = lapDynamics(pts, len, PHYS)
    for (let i = 0; i < n; i++) {
      expect(speed[i]).toBeGreaterThanOrEqual(PHYS.vFloor - 1e-9)
      expect(speed[i]).toBeLessThanOrEqual(PHYS.vTop + 1e-9)
      expect(Math.abs(lat[i])).toBeLessThanOrEqual(1)
      expect(Math.abs(long[i])).toBeLessThanOrEqual(1)
    }
    expect(Math.min(...lat)).toBeLessThan(0)
    expect(Math.max(...lat)).toBeGreaterThan(0)
  })
})

describe('sampleLap', () => {
  const arr = Float64Array.from([0, 1, 2, 3])

  it('reads stations exactly', () => {
    expect(sampleLap(arr, 0)).toBe(0)
    expect(sampleLap(arr, 0.25)).toBe(1)
    expect(sampleLap(arr, 0.75)).toBe(3)
  })

  it('interpolates between them, so a car crossing one does not pop', () => {
    expect(sampleLap(arr, 0.125)).toBeCloseTo(0.5, 12)
    expect(sampleLap(arr, 0.875)).toBeCloseTo(1.5, 12) // wraps 3 -> 0 across the lap seam
  })

  it('wraps any fraction onto the lap', () => {
    expect(sampleLap(arr, 1)).toBe(0)
    expect(sampleLap(arr, 2.25)).toBe(1)
    expect(sampleLap(arr, -0.75)).toBeCloseTo(1, 12)
  })
})
