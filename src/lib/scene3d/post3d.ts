// The output chain (#photoreal): render the world to a float target, spill what is brighter than
// white, then tone map on the way to the screen.
//
// Bloom is the point. A floodlight head and a lit window are emissive materials at full level, which
// means they are bright RECTANGLES: nothing without a post pass can make a surface spill light past
// its own edges, so a night circuit reads as a dark field with bright stickers on it. The same path
// later carries brake glow and sparks.
//
// WRITTEN OUT rather than assembled from `EffectComposer` and `UnrealBloomPass`. That pairing was
// tried first and produced black rectangles in the live view that moved with zoom and rotation and
// stayed put when the camera did. It could not be reproduced here at any camera angle, canvas size
// or pixel ratio, which means the fault was in how those passes leave the renderer rather than in
// anything the probe could see, and there is no way to reason about that from outside. Six draws
// written out is less code than the debugging was, and every render target, viewport and bind in it
// is set explicitly below.
//
// The two things that stop being free once the scene no longer draws straight to the canvas:
//
//  - MSAA. `antialias: true` applies to the DEFAULT framebuffer. The scene target asks for samples
//    of its own; three resolves it when the bright pass reads it.
//  - Tone mapping. three only applies the curve when the destination is the canvas, so everything
//    up to the composite is raw radiance, which is exactly what the threshold needs. The composite
//    IS drawn to the canvas, so including three's own chunks below puts the curve back without
//    reimplementing it.

import * as THREE from 'three'

/** Above this much linear radiance, a surface starts to spill. At 1 it means literally "brighter
 *  than white", which lands where it should: the daylight sky tops out around 0.64 after
 *  `SKY_INTENSITY`, so an ordinary afternoon spills nothing, while the sun's own disc and the night
 *  emissives (scaled past 1 on purpose) do. */
const THRESHOLD = 1

/** How much of the over-bright is added back. Restrained: the job is a halo around a floodlight,
 *  not a soft-focus filter over the whole race. */
const STRENGTH = 0.55

/** The blur runs at half resolution. Bloom is the one effect with nothing to lose from it. */
const DOWNSCALE = 2

/** Multisampling on the scene target, replacing what `antialias: true` gave the canvas. */
const SAMPLES = 4

const QUAD = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/** Keep only what is over the threshold, and keep its colour: dividing by the original luminance
 *  means a barely-over-threshold red stays red instead of turning white as it brightens.
 *
 *  This is also the chain's ONE quarantine point, and it has to be, because everything downstream
 *  of it spreads. A blur tap that reads NaN returns NaN for the whole tap, so a single bad texel
 *  entering here leaves as a solid block the width of the kernel: a ~17px square through the two
 *  nine-tap passes below, and a rectangle hundreds of pixels wide through a mip chain, which is
 *  exactly what both bloom attempts put on the screen. The scene should never hand this pass a
 *  non-finite texel (`repairNormals` is why), and if it ever does again the damage stops here
 *  rather than being magnified by the kernel.
 *
 *  Both guards work by COMPARISON, which is what makes them NaN-proof without `isnan`: every
 *  comparison against NaN is false in either direction, so `min` leaves NaN alone and `l > threshold`
 *  then sends it down the branch that spills nothing. Infinity is caught by the same `min`, since
 *  the scene target is half-float and cannot hold more than this anyway. */
const BRIGHT = /* glsl */`
  uniform sampler2D tScene;
  uniform float threshold;
  varying vec2 vUv;
  void main() {
    vec3 c = min(texture2D(tScene, vUv).rgb, vec3(65504.0));
    float l = max(max(c.r, c.g), c.b);
    gl_FragColor = vec4(l > threshold ? c * ((l - threshold) / l) : vec3(0.0), 1.0);
  }
`

/** Nine-tap gaussian along one axis; run twice, across then down. */
const BLUR = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 direction;
  varying vec2 vUv;
  void main() {
    vec3 sum = texture2D(tSrc, vUv).rgb * 0.227027;
    sum += (texture2D(tSrc, vUv + direction).rgb
      + texture2D(tSrc, vUv - direction).rgb) * 0.1945946;
    sum += (texture2D(tSrc, vUv + direction * 2.0).rgb
      + texture2D(tSrc, vUv - direction * 2.0).rgb) * 0.1216216;
    sum += (texture2D(tSrc, vUv + direction * 3.0).rgb
      + texture2D(tSrc, vUv - direction * 3.0).rgb) * 0.054054;
    sum += (texture2D(tSrc, vUv + direction * 4.0).rgb
      + texture2D(tSrc, vUv - direction * 4.0).rgb) * 0.016216;
    gl_FragColor = vec4(sum, 1.0);
  }
`

/** Scene plus spill, then three's OWN curve and colour space. The chunks are included rather than
 *  reimplemented so `applyToneMapping` stays the single place that decides the curve: three injects
 *  the function and the exposure uniform whenever a material is tone-mapped and the destination is
 *  the canvas, which is exactly this draw and no other. */
const COMPOSITE = /* glsl */`
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float strength;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(
      texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * strength, 1.0
    );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface Post {
  /** Draw the world through the chain. Replaces `renderer.render(scene, camera)`. */
  render(): void
  setSize(width: number, height: number, pixelRatio: number): void
  dispose(): void
}

function hdrTarget(samples = 0): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples })
}

export function buildPost(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
): Post {
  const sceneTarget = hdrTarget(SAMPLES)
  const brightTarget = hdrTarget()
  const blurTarget = hdrTarget()

  const bright = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: sceneTarget.texture }, threshold: { value: THRESHOLD } },
    vertexShader: QUAD,
    fragmentShader: BRIGHT,
    depthTest: false,
    depthWrite: false,
  })
  const blur = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, direction: { value: new THREE.Vector2() } },
    vertexShader: QUAD,
    fragmentShader: BLUR,
    depthTest: false,
    depthWrite: false,
  })
  const composite = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: sceneTarget.texture },
      tBloom: { value: blurTarget.texture },
      strength: { value: STRENGTH },
    },
    vertexShader: QUAD,
    fragmentShader: COMPOSITE,
    depthTest: false,
    depthWrite: false,
  })

  // One quad, drawn with whichever material the step wants. The vertex shader ignores the camera
  // entirely (it writes clip space directly), so the camera passed to `render` never matters.
  const quadGeometry = new THREE.PlaneGeometry(2, 2)
  const quad = new THREE.Mesh(quadGeometry, bright)
  const quadScene = new THREE.Scene()
  quadScene.add(quad)
  const quadCamera = new THREE.Camera()

  const draw = (material: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null) => {
    quad.material = material
    renderer.setRenderTarget(to)
    renderer.render(quadScene, quadCamera)
  }

  let blurWidth = 1
  let blurHeight = 1

  return {
    render: () => {
      renderer.setRenderTarget(sceneTarget)
      renderer.render(scene, camera)

      draw(bright, brightTarget)

      blur.uniforms.tSrc.value = brightTarget.texture
      blur.uniforms.direction.value.set(1 / blurWidth, 0)
      draw(blur, blurTarget)

      blur.uniforms.tSrc.value = blurTarget.texture
      blur.uniforms.direction.value.set(0, 1 / blurHeight)
      draw(blur, brightTarget)

      composite.uniforms.tBloom.value = brightTarget.texture
      // Back to the canvas, which is what makes three apply the tone curve to this draw alone.
      draw(composite, null)
    },
    setSize: (width, height, pixelRatio) => {
      // FLOOR, matching `WebGLRenderer.setSize` exactly (`_canvas.width = Math.floor( w * dpr )`).
      // Rounding instead costs a pixel of height at any fractional device ratio (1400 CSS px at
      // 1.5 -> a 1399px canvas against a 1400px target), and the composite then samples the whole
      // scene off by a fraction of a texel, which speckles every hard edge in the frame.
      const w = Math.max(1, Math.floor(width * pixelRatio))
      const h = Math.max(1, Math.floor(height * pixelRatio))
      sceneTarget.setSize(w, h)
      blurWidth = Math.max(1, Math.round(w / DOWNSCALE))
      blurHeight = Math.max(1, Math.round(h / DOWNSCALE))
      brightTarget.setSize(blurWidth, blurHeight)
      blurTarget.setSize(blurWidth, blurHeight)
    },
    dispose: () => {
      sceneTarget.dispose()
      brightTarget.dispose()
      blurTarget.dispose()
      bright.dispose()
      blur.dispose()
      composite.dispose()
      quadGeometry.dispose()
    },
  }
}
