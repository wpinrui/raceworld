// The output chain (#photoreal): render the world to a float target, spill what is brighter than
// white, then tone map on the way to the screen.
//
// Bloom is the point. A floodlight head and a lit window are emissive materials at full level, which
// means they are bright RECTANGLES: nothing without a post pass can make a surface spill light past
// its own edges, so a night circuit reads as a dark field with bright stickers on it. The same path
// later carries brake glow and sparks.
//
// BACK ON three's OWN PASSES, after a spell hand-written. The hand-written chain was written because
// this pairing put black rectangles in the live view, and it was a reasonable response at the time.
// It is very probably not why: `repairNormals` landed afterwards and found the real cause, which was
// zero-length vertex normals reaching `normalize()` as NaN and a blur spreading each one across its
// whole kernel. That fault was in the geometry, and it poisoned any blur, hand-written or not.
//
// So this is the experiment that settles it, and it can only be settled in the LIVE VIEW: the
// artifact never reproduced in the probe at any camera angle, canvas size or pixel ratio. If the
// rectangles are gone, the addons were innocent and this is less code to own. If they are back, the
// hand-written chain was load-bearing after all and this reverts in one command.
//
// What is knowingly given up either way: the hand-written bright pass carried a NaN quarantine, so a
// single bad texel could never again become a block. three's high pass has no such guard.
//
// The two things that stop being free once the scene no longer draws straight to the canvas:
//
//  - MSAA. `antialias: true` applies to the DEFAULT framebuffer, which the composer does not draw
//    to, and `EffectComposer`'s own target carries no samples. The target below is passed in for
//    exactly that reason: without it the world comes out aliased with nothing reported anywhere.
//  - Tone mapping. three only applies the curve when the destination is the canvas, so the chain
//    renders raw radiance, which is what the threshold needs. `OutputPass` puts the curve back at
//    the end, reading it off the renderer, so `applyToneMapping` stays the one place deciding it.

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/** Above this much linear radiance, a surface starts to spill. At 1 it means literally "brighter
 *  than white", which lands where it should: the daylight sky tops out around 0.64 after
 *  `SKY_INTENSITY`, so an ordinary afternoon spills nothing, while the sun's own disc and the night
 *  emissives (scaled past 1 on purpose) do. */
const THRESHOLD = 1

/** How much of the over-bright is added back. Restrained: the job is a halo around a floodlight,
 *  not a soft-focus filter over the whole race. Matched by eye to the hand-written chain so the
 *  comparison is about artifacts rather than tuning. */
const STRENGTH = 0.55

/** How far it spreads, across the pass's own five mip levels. */
const RADIUS = 0.4

/** Multisampling on the composer's target, replacing what `antialias: true` gave the canvas. */
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
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(1, 1), STRENGTH, RADIUS, THRESHOLD,
  ))
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
