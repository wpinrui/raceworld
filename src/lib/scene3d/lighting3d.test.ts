import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { MOODS } from '@/lib/ui/lighting'
import { buildLightRig, skyShare, sunAltitude, sunIntensity, sunTravel } from './lighting3d'

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

describe('buildLightRig', () => {
  const vb = { x: 0, y: 0, w: 100, h: 60 }
  const rig = buildLightRig(MOODS.afternoon, vb)
  const sun = rig.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight)!

  it('carries one shadowed sun and one hemisphere sky', () => {
    expect(sun.castShadow).toBe(true)
    expect(rig.children.some((o) => o instanceof THREE.HemisphereLight)).toBe(true)
  })

  it('applies the fitted frustum to the projection, not just to the camera fields', () => {
    // The regression: setting left/right/top/bottom without updateProjectionMatrix leaves the
    // constructed ten-unit box, and every shadow in the world silently vanishes.
    const half = 100 / 2 + 60
    expect(sun.shadow.camera.left).toBe(-half)
    expect(sun.shadow.camera.projectionMatrix.elements[0]).toBeCloseTo(1 / half, 10)
  })

  it('scales the acne bias to the map texel, so coarse circuits keep their two-metre shadows', () => {
    expect(sun.shadow.normalBias).toBeCloseTo((2 * 110) / 4096, 10)
  })

  it('sits the sun against the light travel, aimed at the frame centre', () => {
    expect(sun.target.position.x).toBe(50)
    expect(sun.target.position.z).toBe(30)
    expect(sun.position.y).toBeGreaterThan(0)
  })
})
