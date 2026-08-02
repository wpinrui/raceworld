import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { BRIGHT_PASS_LINE } from './post3d'

describe('the bloom ceiling patch', () => {
  it('still finds the line in three\'s bright pass that it rewrites', () => {
    // The guard against a three upgrade moving it. Without this the patch silently no-ops and the
    // bloom goes back to unbounded, which is a sun glint flaring across the whole car.
    const pass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.4, 1)
    const shader = pass.materialHighPassFilter.fragmentShader
    expect(shader).toContain(BRIGHT_PASS_LINE)
    expect(shader).toContain('uniform float smoothWidth;')
    pass.dispose()
  })

  it('passes the whole texel through, which is why a ceiling is needed at all', () => {
    // three's bright pass does NOT subtract the threshold: above it the full value goes into the
    // blur, so the spill is proportional to the peak. Pinned because the ceiling's entire
    // justification rests on it.
    const pass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.4, 1)
    const shader = pass.materialHighPassFilter.fragmentShader
    expect(shader).toContain('mix( outputColor, texel, alpha )')
    expect(shader).not.toContain('texel - luminosityThreshold')
    pass.dispose()
  })
})
