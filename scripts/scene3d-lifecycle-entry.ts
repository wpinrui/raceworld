// Browser half of the sky lifecycle probe: every build/dispose sequence the app performs, each
// against its own real GL context, each reported rather than thrown so one failure does not hide
// the rest.

import * as THREE from 'three'
import { MOODS } from '../src/lib/ui/lighting'
import { buildSky, type SkyEnv } from '../src/lib/scene3d/sky3d'

declare global {
  interface Window {
    __done?: boolean
    __cases?: Array<{ name: string; must: 'pass' | 'report'; error: string | null }>
  }
}

const cases: NonNullable<Window['__cases']> = []

function check(name: string, must: 'pass' | 'report', body: () => void) {
  try {
    body()
    cases.push({ name, must, error: null })
  } catch (err) {
    cases.push({ name, must, error: err instanceof Error ? err.message : String(err) })
  }
}

/** A fresh renderer per case: `dispose` is terminal, so cases cannot share one. */
function renderer(): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  document.body.appendChild(canvas)
  return new THREE.WebGLRenderer({ canvas })
}

// The mood-change path, and by far the most frequent: the sky is rebaked while the renderer lives.
check('rebake on a mood change', 'pass', () => {
  const gl = renderer()
  const first = buildSky(gl, MOODS.afternoon, { seed: 3 })
  first.dispose()
  const second = buildSky(gl, MOODS.dusk, { seed: 3 })
  second.dispose()
  gl.dispose()
})

// Night takes a different path entirely (an authored canvas ramp, not a baked cube), so its
// disposal is a different object and has to be exercised on its own.
check('rebake across the night boundary', 'pass', () => {
  const gl = renderer()
  const day = buildSky(gl, MOODS.afternoon, { seed: 3 })
  day.dispose()
  const night = buildSky(gl, MOODS.night, { night: true, seed: 3 })
  night.dispose()
  gl.dispose()
})

// Teardown in the correct ownership order: the sky belongs to the renderer, so it goes first.
check('teardown, sky before renderer', 'pass', () => {
  const gl = renderer()
  const env = buildSky(gl, MOODS.afternoon, { seed: 3 })
  env.dispose()
  gl.dispose()
})

// What `Scene3DCanvas` avoids by checking the context is still live before freeing. Reported, not
// asserted: it is three's behaviour, not ours, and if a release ever makes it safe we want to see
// that rather than fail on it.
check('teardown, renderer before sky (guarded against)', 'report', () => {
  const gl = renderer()
  const env = buildSky(gl, MOODS.afternoon, { seed: 3 })
  gl.dispose()
  env.dispose()
})

// The guard itself: skipping the free once the context is gone must leave nothing broken behind.
check('teardown, renderer first with the sky left alone', 'pass', () => {
  const gl = renderer()
  const env: SkyEnv = buildSky(gl, MOODS.afternoon, { seed: 3 })
  gl.dispose()
  void env.texture
})

window.__cases = cases
window.__done = true
