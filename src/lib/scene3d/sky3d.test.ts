import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MOODS } from '@/lib/ui/lighting'
import { sunTravel } from './lighting3d'
import { Sky } from 'three/addons/objects/Sky.js'
import { CLOUD_SCALE_LINE, refitFog, skyParams, skySeedFor, sunDirection } from './sky3d'

describe('sunDirection', () => {
  it('is exactly the reverse of the shadow sun for every daylight mood', () => {
    // The one agreement that matters: look up at the sun, look down at the shadows, find them
    // consistent. Two hand-written trig expressions in two files is precisely how that drifts.
    for (const [name, mood] of Object.entries(MOODS)) {
      if (name === 'night') continue
      const travel = sunTravel(mood)
      const toSun = skyParams(mood).sun
      expect(toSun.x, name).toBeCloseTo(-travel.x, 9)
      expect(toSun.y, name).toBeCloseTo(-travel.y, 9)
      expect(toSun.z, name).toBeCloseTo(-travel.z, 9)
    }
  })

  it('returns a unit vector at any altitude, above or below the horizon', () => {
    for (const altitude of [-0.4, -0.03, 0, 0.5, Math.PI / 2]) {
      expect(sunDirection(1.2, altitude).length()).toBeCloseTo(1, 9)
    }
  })
})

describe('skyParams', () => {
  it('greys an overcast sky by leaning off rayleigh and onto mie, not by turbidity', () => {
    // The trap this pins: turbidity is aerosol, and winding it up to say "thick day" renders a
    // DEEPER blue away from the sun. Overcast came out the bluest mood of the five that way.
    const clear = skyParams(MOODS.afternoon)
    const overcast = skyParams(MOODS.overcast)
    expect(overcast.rayleigh).toBeLessThan(clear.rayleigh)
    expect(overcast.mieCoefficient).toBeGreaterThan(clear.mieCoefficient * 3)
    expect(overcast.cloudCoverage).toBeGreaterThan(clear.cloudCoverage * 3)
  })

  it('deepens rayleigh as the light warms, so dusk reddens rather than only dimming', () => {
    expect(skyParams(MOODS.dusk).rayleigh).toBeGreaterThan(skyParams(MOODS.midday).rayleigh)
  })

  it('keeps every knob inside the range the shader is sane over', () => {
    for (const [name, mood] of Object.entries(MOODS)) {
      const p = skyParams(mood)
      expect(p.turbidity, name).toBeGreaterThanOrEqual(1)
      expect(p.turbidity, name).toBeLessThanOrEqual(16)
      expect(p.rayleigh, name).toBeGreaterThan(0)
      expect(p.rayleigh, name).toBeLessThanOrEqual(4)
      expect(p.mieCoefficient, name).toBeGreaterThan(0)
      expect(p.mieCoefficient, name).toBeLessThanOrEqual(0.12)
      expect(p.mieDirectionalG, name).toBeGreaterThan(0)
      expect(p.mieDirectionalG, name).toBeLessThan(1)
      expect(p.cloudCoverage, name).toBeGreaterThanOrEqual(0)
      expect(p.cloudCoverage, name).toBeLessThanOrEqual(1)
      expect(p.cloudDensity, name).toBeGreaterThanOrEqual(0)
      expect(p.cloudDensity, name).toBeLessThanOrEqual(1)
    }
  })
})

describe('skySeedFor', () => {
  it('gives the calendar distinct, stable cloud fields', () => {
    const ids = ['britain', 'monaco', 'belgium', 'bahrain', 'spain', 'japan', 'brazil', 'italy']
    const seeds = ids.map(skySeedFor)
    expect(new Set(seeds).size).toBe(ids.length)
    expect(skySeedFor('britain')).toBe(skySeedFor('britain'))
    for (const seed of seeds) {
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThan(0)
      expect(seed).toBeLessThanOrEqual(97)
    }
  })
})

describe('refitFog', () => {
  /** Britain's numbers: 3.906 metres per unit, ground plane reaching 4132 units from the centre. */
  // Flat, deliberately: these pin the haze's fit to the framing, not to any landform.
  const ground = { x: 0, z: 0, radius: 4132, metresPerUnit: 3.906, heightAt: () => 0 }

  /** A camera looking down at the origin from `distance` away, leant `pitch` radians off vertical,
   *  with the near and far planes `applyOrbitCam` would give it, INCLUDING the way its reach opens
   *  out as the camera leans toward the horizon. Mirrored here on purpose: the whole job of
   *  `refitFog` is to fit inside those planes, so a helper that lags them tests nothing. */
  function eye(distance: number, pitch: number): THREE.PerspectiveCamera {
    const far = distance * 60 / Math.max(0.03, Math.cos(pitch) ** 2)
    const camera = new THREE.PerspectiveCamera(35, 16 / 9, distance * 0.02, far)
    camera.position.set(0, Math.cos(pitch) * distance, Math.sin(pitch) * distance)
    camera.up.set(0, 0, -1)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    return camera
  }

  /** The three framings the map can actually reach, from its own zoom limits. */
  const FRAMINGS: Array<[name: string, distance: number]> = [
    ['whole circuit', 419], ['racing', 31], ['close up', 2.5],
  ]

  it('finishes before the world stops, at every framing and pitch', () => {
    // Whichever cuts the ground off first, the far plane or the plane's own edge, the haze has to
    // be complete by then. Anything else shows as a hard line with sky above it.
    for (const [name, distance] of FRAMINGS) {
      for (const pitch of [0, 0.7, 1.4]) {
        const camera = eye(distance, pitch)
        const fog = new THREE.Fog(0x000000, 1, 2)
        refitFog(fog, camera, ground)
        const toEdge = camera.position.length() + ground.radius
        expect(fog.far, `${name} @ ${pitch}`).toBeLessThan(Math.min(camera.far, toEdge))
        expect(fog.near, `${name} @ ${pitch}`).toBeLessThan(fog.far)
      }
    }
  })

  it('leaves the whole-circuit framing crisp', () => {
    // Every point of a 440-unit circuit is inside the clear zone from 1.6km up. A uniform wash over
    // the map view is not aerial perspective, it is a dirty lens.
    const camera = eye(419, 0)
    const fog = new THREE.Fog(0x000000, 1, 2)
    refitFog(fog, camera, ground)
    expect(fog.near).toBeGreaterThan(419 + 440)
  })

  it('holds one visibility in metres across framings and across circuits', () => {
    // The whole point of an absolute clear distance: zooming must not thicken the air. Both play
    // framings land on the same 1.5km, and Monaco's finer scale lands on the same 1.5km in units.
    const racing = new THREE.Fog(0x000000, 1, 2)
    refitFog(racing, eye(31, 1.2), ground)
    const eyeLevel = new THREE.Fog(0x000000, 1, 2)
    refitFog(eyeLevel, eye(12, 1.4), ground)
    expect(racing.near * ground.metresPerUnit).toBeCloseTo(1500, 0)
    expect(eyeLevel.near * ground.metresPerUnit).toBeCloseTo(1500, 0)

    const monaco = new THREE.Fog(0x000000, 1, 2)
    refitFog(monaco, eye(31, 1.2), { ...ground, metresPerUnit: 2.22 })
    expect(monaco.near * 2.22).toBeCloseTo(1500, 0)
  })

  it('keeps a townful of scenery out of the haze entirely at racing zoom', () => {
    // The complaint this pins: buildings a few hundred metres away were fading. Nothing inside a
    // kilometre may be touched, at any lean.
    for (const pitch of [0.7, 1.2, 1.4]) {
      const fog = new THREE.Fog(0x000000, 1, 2)
      refitFog(fog, eye(31, pitch), ground)
      expect(fog.near * ground.metresPerUnit, `pitch ${pitch}`).toBeGreaterThan(1000)
    }
  })

  it('shortens its ramp rather than overrun a far plane that really is close', () => {
    // Leaning toward the horizon opens the far plane out, so the cap no longer binds there. Looking
    // straight DOWN at a close-up it still does: 60 distances from 2.5 units is 585m of reach.
    const camera = eye(2.5, 0)
    const fog = new THREE.Fog(0x000000, 1, 2)
    refitFog(fog, camera, ground)
    expect(fog.near * ground.metresPerUnit).toBeLessThan(1500)
    expect(fog.near).toBeGreaterThan(0)
    expect(fog.far).toBeLessThan(camera.far)
  })
})

describe("three's Sky shader", () => {
  // `@types/three` declares `SkyShader` as a bare `object`, so its shape has to be asserted here.
  // That is exactly why these two tests exist: nothing in the type system is watching this seam.
  const shader = Sky.SkyShader as { fragmentShader: string; uniforms: Record<string, unknown> }

  it('still contains the cloud line the module rewrites', () => {
    // `buildSky` patches this constant into a uniform, because at its shipped value a cloud renders
    // two hundred times darker than the sky behind it. The patch is a string replacement, so an
    // upgrade that reworded the line would silently leave the sky cloudless. Fail here instead.
    const source = shader.fragmentShader
    expect(source).toContain(CLOUD_SCALE_LINE)
    expect(source).toContain('uniform float cloudScale;')
  })

  it('still exposes every cloud uniform the mood mapping drives', () => {
    for (const name of ['cloudCoverage', 'cloudDensity', 'cloudScale', 'cloudElevation']) {
      expect(shader.uniforms, name).toHaveProperty(name)
    }
  })
})
