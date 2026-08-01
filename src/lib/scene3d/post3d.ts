// The output chain (#photoreal): render the world to a float target, bloom what is brighter than
// white, then tone map on the way to the screen.
//
// Bloom is the point. A floodlight head and a lit window are emissive materials at full level, which
// means they are bright RECTANGLES: nothing in a renderer without a post pass can make a surface
// spill light past its own edges, so a night circuit reads as a dark field with bright stickers on
// it. Bloom is the whole of the difference, and the same path later carries brake glow and sparks.
//
// Two things that used to happen for free now have to be arranged, and both are easy to lose:
//
//  - MSAA. `antialias: true` on the renderer applies to the DEFAULT framebuffer, and the composer
//    does not render there. `EffectComposer`'s own target has no samples, so the world would come
//    out aliased with no error anywhere; the multisampled target below is what keeps the edges.
//  - Tone mapping. three only applies the curve when rendering to the canvas, so a composer chain
//    renders raw radiance into its target, which is exactly what bloom needs to threshold against.
//    `OutputPass` puts the curve back at the end, reading it off the renderer, so `applyToneMapping`
//    stays the one place that decides it.

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/** Above this much linear radiance, a surface starts to spill. At 1 it means literally "brighter
 *  than white", which is the honest reading and lands where it should: the daylight sky tops out
 *  around 0.64 after `SKY_INTENSITY`, so an ordinary afternoon blooms nothing at all, while the
 *  sun's own disc and the night emissives (which are scaled past 1 on purpose) do. */
const BLOOM_THRESHOLD = 1

/** How much of the over-bright spills. Restrained: bloom is the most over-used effect there is, and
 *  the job here is a halo around a floodlight, not a soft-focus filter over the whole race. */
const BLOOM_STRENGTH = 0.26

/** How far it spreads. */
const BLOOM_RADIUS = 0.32

/** Multisampling on the composer's own target, since the canvas is no longer what gets drawn to.
 *  Four is the usual sweet spot and what `antialias: true` would have asked for anyway. */
const SAMPLES = 4

export interface Post {
  /** Draw the world through the chain. Replaces `renderer.render(scene, camera)`. */
  render(): void
  setSize(width: number, height: number, pixelRatio: number): void
  dispose(): void
}

export function buildPost(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
): Post {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: SAMPLES,
  })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD,
  )
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  return {
    render: () => composer.render(),
    setSize: (width, height, pixelRatio) => {
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
    },
    dispose: () => {
      composer.dispose()
      target.dispose()
    },
  }
}
