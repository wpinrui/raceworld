import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MOODS, shadowReach, type Lighting } from '@/lib/ui/lighting'
import {
  SHADOW_MAP, buildLightRig, refitShadow, skyShare, sunAltitude, sunIntensity, sunTravel,
} from './lighting3d'

describe('sunTravel', () => {
  it('points straight down under an overhead sun', () => {
    const t = sunTravel({ azimuth: 1, elevation: 1, warmth: 0, ambient: 0 })
    expect(t.y).toBeCloseTo(-1, 6)
    expect(Math.hypot(t.x, t.z)).toBeCloseTo(0, 6)
  })

  it('runs along the 2D azimuth in plan', () => {
    const t = sunTravel({ azimuth: 0, elevation: 0.5, warmth: 0, ambient: 0 })
    expect(t.x).toBeCloseTo(Math.cos(Math.PI / 4), 6)
    expect(t.y).toBeCloseTo(-Math.sin(Math.PI / 4), 6)
    expect(t.z).toBeCloseTo(0, 6)
  })
})

describe('calibration', () => {
  it('lands sky + sun-on-a-horizontal at 1.05 for every mood', () => {
    for (const mood of Object.values(MOODS)) {
      const total = skyShare(mood) + sunIntensity(mood) * Math.sin(sunAltitude(mood))
      expect(total).toBeGreaterThan(0.99)
      expect(total).toBeLessThan(1.12)
    }
  })
})

/** The sun out of a rig, which is the only thing every test below is after. */
function sunOf(rig: THREE.Group): THREE.DirectionalLight {
  return rig.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight)!
}

/** The pad `refitShadow` derives: the tallest caster's height by the cotangent of the sun's
 *  altitude, which is exactly `shadowReach` (the 2D's own answer to the same question). */
function padFor(l: Lighting, tallestM: number, unitsPerMetre: number): number {
  return tallestM * unitsPerMetre * shadowReach(l)
}

describe('buildLightRig', () => {
  const vb = { x: 0, y: 0, w: 100, h: 60 }
  const rig = buildLightRig(MOODS.afternoon, vb)
  const sun = sunOf(rig)

  it('carries one shadowed sun and one hemisphere sky', () => {
    expect(sun.castShadow).toBe(true)
    expect(rig.children.some((o) => o instanceof THREE.HemisphereLight)).toBe(true)
  })

  it('applies the fitted frustum to the projection, not just to the camera fields', () => {
    // The regression: setting left/right/top/bottom without updateProjectionMatrix leaves the
    // constructed ten-unit box, and every shadow in the world silently vanishes.
    const half = 100 / 2 + padFor(MOODS.afternoon, 30, 1)
    expect(sun.shadow.camera.left).toBeCloseTo(-half, 10)
    expect(sun.shadow.camera.projectionMatrix.elements[0]).toBeCloseTo(1 / half, 10)
  })

  it('sits the sun against the light travel, aimed at the frame centre', () => {
    expect(sun.target.position.x).toBe(50)
    expect(sun.target.position.z).toBe(30)
    expect(sun.position.y).toBeGreaterThan(0)
  })

  it('fits the same box the build does when refitted onto its own frame', () => {
    // The two used to be separate copies of the fit and drifted: the build stood the sun at one
    // reach and the refit at another, floored. One is now written in terms of the other.
    const fresh = sunOf(buildLightRig(MOODS.afternoon, vb))
    refitShadow(fresh, vb)
    expect(fresh.shadow.camera.left).toBeCloseTo(sun.shadow.camera.left, 10)
    expect(fresh.shadow.camera.near).toBeCloseTo(sun.shadow.camera.near, 10)
    expect(fresh.shadow.camera.far).toBeCloseTo(sun.shadow.camera.far, 10)
    expect(fresh.position.distanceTo(sun.position)).toBeLessThan(1e-6)
  })

  it('refits the shadow box onto a new frame without moving the sun across the sky', () => {
    const s = sunOf(buildLightRig(MOODS.afternoon, vb))
    const bearingBefore = s.target.position.clone().sub(s.position).normalize()
    refitShadow(s, { x: 200, y: 300, w: 40, h: 20 })
    expect(s.target.position.x).toBe(220)
    expect(s.target.position.z).toBe(310)
    expect(s.shadow.camera.left).toBeCloseTo(-(20 + padFor(MOODS.afternoon, 30, 1)), 10)
    const bearingAfter = s.target.position.clone().sub(s.position).normalize()
    expect(bearingAfter.distanceTo(bearingBefore)).toBeLessThan(1e-6)
  })
})

describe('refitShadow', () => {
  const fit = { unitsPerMetre: 1 / 3.906, tallestM: 30 }
  /** A sun on the afternoon bearing, ready to be fitted onto anything. */
  const sun = () => sunOf(buildLightRig(MOODS.afternoon, { x: 0, y: 0, w: 1, h: 1 }, fit))
  /** A square frame of `w` units about the origin. */
  const frame = (w: number) => ({ x: -w / 2, y: -w / 2, w, h: w })
  const halfOf = (s: THREE.DirectionalLight) => s.shadow.camera.right
  const texelOf = (s: THREE.DirectionalLight) => (2 * halfOf(s)) / SHADOW_MAP

  it('pads the frame by what a caster outside it can throw in, and no more', () => {
    // The regression this replaces: a flat `+ 60` UNITS, which on Britain is 234 m of slack round a
    // frame the camera is showing 4.6 m of, and which never shrank however close the player came.
    const s = sun()
    refitShadow(s, frame(2.34), fit)
    expect(halfOf(s)).toBeCloseTo(1.17 + padFor(MOODS.afternoon, 30, fit.unitsPerMetre), 10)
    // Measured: 34 m across, where the constant gave 478.
    expect(2 * halfOf(s) * 3.906).toBeGreaterThan(30)
    expect(2 * halfOf(s) * 3.906).toBeLessThan(40)
  })

  it('shrinks the box as the frame does, so zooming in sharpens the shadow', () => {
    const wide = sun()
    const close = sun()
    refitShadow(wide, frame(128), fit)
    refitShadow(close, frame(2.34), fit)
    expect(texelOf(close)).toBeLessThan(texelOf(wide) / 10)
  })

  it('widens the pad for a low sun, which throws further for the same caster', () => {
    const high = sun()
    const low = sun()
    refitShadow(high, frame(4), { ...fit, tallestM: 0 })
    refitShadow(low, frame(4), fit)
    // Same frame, and every unit of difference is the pad the raking sun asked for.
    expect(halfOf(low)).toBeGreaterThan(halfOf(high))
    expect(halfOf(low) - halfOf(high))
      .toBeCloseTo(padFor(MOODS.afternoon, 30, fit.unitsPerMetre), 10)
  })

  it('keeps every caster and the whole box between the near and far planes', () => {
    const s = sun()
    refitShadow(s, frame(2.34), fit)
    const travel = s.target.position.clone().sub(s.position).normalize()
    const half = halfOf(s)
    const casters = 30 * fit.unitsPerMetre
    // The extremes: the top of the tallest caster (nearest the light) and the box's far corner
    // along the light (furthest). Both have to be inside, or shadows clip against the frustum.
    const depth = (p: THREE.Vector3) => p.clone().sub(s.position).dot(travel)
    const near = depth(new THREE.Vector3(0, casters, 0))
    const far = depth(new THREE.Vector3(half, 0, half).addScaledVector(travel, half))
    expect(near).toBeGreaterThan(s.shadow.camera.near)
    expect(far).toBeLessThan(s.shadow.camera.far)
  })

  it('holds the depth bias to a few texels of world at every zoom', () => {
    // What used to slide a shadow off the foot of its caster: a bias fixed in NDC over a frustum
    // floored at 200 units, i.e. half a metre of world on Britain however close the camera came.
    for (const w of [2.34, 32, 128]) {
      const s = sun()
      refitShadow(s, frame(w), fit)
      // Orthographic depth is linear, so NDC's half-range is (far - near) / 2 units of world.
      const span = (s.shadow.camera.far - s.shadow.camera.near) / 2
      const worldM = Math.abs(s.shadow.bias) * span * 3.906
      expect(worldM).toBeLessThan(0.4)
      expect(s.shadow.normalBias).toBeCloseTo(texelOf(s), 10)
    }
  })

  it('spreads the filter to a fixed width of world, not a fixed count of texels', () => {
    // The default radius is 1 texel, which is a penumbra that grows and shrinks with the box: the
    // same tree wore a different softness at every zoom.
    const close = sun()
    const wide = sun()
    refitShadow(close, frame(2.34), fit)
    refitShadow(wide, frame(128), fit)
    // Close in, the texels are finer than the penumbra, so the filter spreads to cover it.
    expect(close.shadow.radius).toBeGreaterThan(1)
    expect(close.shadow.radius * texelOf(close) * 3.906).toBeGreaterThan(0.02)
    // Far out, one texel is already wider than the penumbra and the filter has nothing to add.
    expect(wide.shadow.radius).toBe(1)
    expect(texelOf(wide) * 3.906).toBeGreaterThan(0.1)
  })

  it('reads the caster ceiling in metres, so a car preview is not padded for floodlight towers', () => {
    const circuit = sun()
    const turntable = sun()
    refitShadow(circuit, frame(600), { unitsPerMetre: 94 })
    refitShadow(turntable, frame(600), { unitsPerMetre: 94, tallestM: 1.5 })
    expect(halfOf(turntable)).toBeLessThan(halfOf(circuit) / 4)
  })
})
