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
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'

/** Above this much linear radiance, a surface starts to spill. At 1 it means literally "brighter
 *  than white", which lands where it should: the daylight sky tops out around 0.64 after
 *  `SKY_INTENSITY`, so an ordinary afternoon spills nothing, while the sun's own disc and the night
 *  emissives (scaled past 1 on purpose) do. */
const THRESHOLD = 1

/** How much of the over-bright is added back. Restrained: the job is a halo around a floodlight,
 *  not a soft-focus filter over the whole race. Matched by eye to the hand-written chain so the
 *  comparison is about artifacts rather than tuning. */
const STRENGTH = 0.46

/** How far it spreads, across the pass's own five mip levels. */
const RADIUS = 0.4

/** Multisampling on the composer's target, replacing what `antialias: true` gave the canvas. */
const SAMPLES = 4

/** The brightest a pixel may count as when it goes INTO the blur.
 *
 *  three's bright pass passes the whole texel through above the threshold, unbounded, so the spill
 *  is proportional to the peak: a pixel at 30 throws thirty times the light of a pixel at 1. That
 *  was harmless while the sharpest lobe in the world was `ROUGH.gloss` and nothing could return more
 *  than a diffuse highlight. Car paint has a clear coat now (`LACQUER`), and a near-mirror pointed at
 *  the sun's own disc is a different order of number entirely.
 *
 *  MEASURED, over one frame of Britain at racing zoom, as peak linear radiance:
 *
 *      afternoon, no clear coat     1.32     nothing in frame past 2
 *      afternoon, clear coat        35.2     7 pixels past 8
 *      night, floodlights in shot   2.12     the halo this pass exists for
 *
 *  So the glint spills seventeen times what the strength above was ever tuned against, and it eats
 *  the car it is supposed to be sliding across. Turning STRENGTH down instead would have taken the
 *  night halo with it in the same proportion, and the night halo is the whole point of the pass:
 *  one global scalar cannot separate a 2 from a 35. A ceiling can. Set above the floodlights, so
 *  night is untouched to the pixel, and well under the glint, which now spills like a very bright
 *  thing rather than like the sun. Luminance-preserving: the texel is scaled, not clipped per
 *  channel, so a clamped white highlight cannot drift toward a hue. */
const BLOOM_CEILING = 2.6

/** The line in three's bright pass that this module rewrites. Kept as an exact string so a three
 *  upgrade that moves it is caught by unit test rather than by someone noticing the sun went off. */
export const BRIGHT_PASS_LINE = 'gl_FragColor = mix( outputColor, texel, alpha );'

/** Rewrite it to hold the ceiling. Warns rather than throws, the way the sky's cloud patch does: a
 *  bloom that is too hot is worse than one that is right and better than no picture at all. */
function patchBloomCeiling(pass: UnrealBloomPass): void {
  const material = pass.materialHighPassFilter
  if (!material.fragmentShader.includes(BRIGHT_PASS_LINE)) {
    console.warn('three bright pass changed: bloom runs unbounded, highlights will flare')
    return
  }
  material.uniforms.bloomCeiling = { value: BLOOM_CEILING }
  material.fragmentShader = material.fragmentShader
    .replace('uniform float smoothWidth;', 'uniform float smoothWidth;\nuniform float bloomCeiling;')
    .replace(
      BRIGHT_PASS_LINE,
      'texel.rgb *= min( 1.0, bloomCeiling / max( v, 0.0001 ) );\n\t'
      + 'gl_FragColor = mix( outputColor, texel, alpha );',
    )
}

/** Ground-truth ambient occlusion: the contact shading a shadow map cannot give.
 *
 *  A directional light answers one question, "is the sun blocked", and everything else in the scene
 *  is lit by an unoccluded sky. So a column meets grass with no darkening at its foot, a truss floats
 *  over the deck it stands on, and a stand's underside is as bright as its roof. Those creases are
 *  most of what tells you two surfaces are touching.
 *
 *  The radius is a PHYSICAL distance, and that matters here: world units are metres divided by a
 *  circuit's own scale, so a radius in units would be a different size at every track. Half a metre
 *  is the crease at the foot of a wall, which is what this is for.
 *
 *  It costs a second geometry pass, because the effect needs depth and normals and takes them by
 *  drawing the scene again. That is the price of it being screen-space and applying to everything,
 *  rather than being baked into one model. */
const AO_RADIUS_M = 0.5
const AO_PARAMS = {
  distanceExponent: 1,
  thickness: 1,
  scale: 1,
  samples: 16,
  distanceFallOff: 1,
  screenSpaceRadius: false,
} as const

export interface Post {
  /** Draw the world through the chain. Replaces `renderer.render(scene, camera)`. */
  render(): void
  setSize(width: number, height: number, pixelRatio: number): void
  /** Switch one pass off. Occlusion is a whole second draw of the scene and bloom is a mip pyramid
   *  over the frame, so what either costs is a question the chain can only answer by being asked
   *  without it. Absent on a chain that never built the pass. */
  setPass(name: 'ao' | 'bloom', on: boolean): void
  dispose(): void
}

export function buildPost(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  /** World units per metre, for sizing the occlusion radius. Absent, the AO pass is left out
   *  entirely rather than run at a guessed scale. */
  unitsPerMetre?: number,
): Post {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: SAMPLES,
  })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new RenderPass(scene, camera))
  // Before the bloom, because occlusion belongs to the scene's own radiance: darkening a crease
  // after the spill has been taken off it leaves the crease glowing.
  const ao = unitsPerMetre !== undefined && camera instanceof THREE.PerspectiveCamera
    ? new GTAOPass(scene, camera, 1, 1)
    : null
  if (ao) {
    ao.updateGtaoMaterial({ ...AO_PARAMS, radius: AO_RADIUS_M * unitsPerMetre! })
    // The occlusion buffer has to be drawn with the same sidedness as the picture.
    //
    // GTAO builds depth and normals by redrawing the scene under one override material, and an
    // override brings its own `side`, which defaults to front faces only. Half this world is sheets
    // and every material it owns is DOUBLE sided, so the beauty pass draws back faces that the
    // occlusion pass does not: the inside of a wall, the underside of a roof, the far side of a
    // barrier. Those pixels then have no depth of their own in the buffer and inherit whatever
    // front-facing geometry stands behind them, so they are shaded as if they were that surface.
    // What it looks like is occlusion cast onto walls from things on the other side of them, which
    // reads as the wall having gone transparent.
    ao.normalMaterial.side = THREE.DoubleSide
    // Anything marked `noAO` sits out the pass entirely, by being invisible while it runs. Hiding
    // rather than filtering by layer on purpose: a layer has to be enabled on every camera that ever
    // looks at the scene, and the failure mode when one is missed is an invisible crowd. The worst a
    // missed flag can do here is put an object back into the occlusion it should have skipped.
    const draw = ao.render.bind(ao)
    ao.render = (r, write, read, delta, mask) => {
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => {
        if (o.userData.noAO === true && o.visible) {
          o.visible = false
          hidden.push(o)
        }
      })
      draw(r, write, read, delta, mask)
      for (const o of hidden) o.visible = true
    }
    composer.addPass(ao)
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), STRENGTH, RADIUS, THRESHOLD)
  patchBloomCeiling(bloom)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  return {
    render: () => composer.render(),
    setSize: (width, height, pixelRatio) => {
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
      ao?.setSize(width * pixelRatio, height * pixelRatio)
    },
    setPass: (name, on) => {
      const pass = name === 'ao' ? ao : bloom
      if (pass) pass.enabled = on
    },
    dispose: () => {
      ao?.dispose()
      composer.dispose()
      target.dispose()
    },
  }
}
