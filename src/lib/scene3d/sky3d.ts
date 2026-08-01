// The sky, and the haze that joins it to the ground (#photoreal increment 1).
//
// Until now `scene.background` was the ground's OWN colour, so tilting toward the horizon showed a
// grass-green ceiling meeting a razor edge where the ground plane ran out. Both halves of that are
// fixed here: a Preetham sky baked into a cube for the background, and linear fog whose colour is
// the sky's measured radiance at the horizon, so the far ground dissolves into exactly what is
// behind it.
//
// The sky reads the SAME four mood scalars the light rig reads, and puts its sun on the same bearing
// `sunTravel` gives the shadow-caster, so a player can look up at the sun and then down at where the
// shadows point and find them agreeing. Preetham is analytic, so mood stays data: no new render path
// for dusk, no texture to ship.
//
// Bake-once, not per-frame: the sky only changes when the mood does. Clouds come from the shader's
// own noise, frozen at a per-circuit seed, so Silverstone and Monaco do not wear the same sky.

import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import type { Lighting } from '@/lib/ui/lighting'
import { sunAltitude } from './lighting3d'

/** Preetham's knobs plus the shader's cloud layer, all derived from the mood. */
export interface SkyParams {
  turbidity: number
  rayleigh: number
  mieCoefficient: number
  mieDirectionalG: number
  cloudCoverage: number
  cloudDensity: number
  /** Direction TO the sun: `sunTravel` reversed, so sky and shadows cannot disagree. */
  sun: THREE.Vector3
}

/** Where night puts its sun, in radians above the horizon. The night MOOD carries a high sun (its
 *  shadows still have to fall somewhere sensible on a floodlit circuit) and handing that elevation
 *  to Preetham renders a bright blue afternoon behind the floodlights. Under the horizon is where
 *  the sun actually is, and it is what makes the sky read as night rather than as a cool day. */
const NIGHT_SUN_RAD = -0.14

/** What `scene.backgroundIntensity` scales the baked radiance by, and the fog colour with it.
 *
 *  Preetham's output is authored against its own exposure, while the light rig is calibrated at 1 (a
 *  horizontal surface renders close to its authored albedo). Rendering both under one exposure
 *  therefore needs the sky brought down to the world rather than the world up to the sky: the
 *  alternative re-tunes every mood, every material and every shadow to suit the background.
 *
 *  MEASURED at 0.16, not chosen: Britain's afternoon horizon bakes at a raw 7.95, and ACES is within
 *  a few percent of white by an input of 3, so anything above about a fifth renders the sky as a
 *  flat white ceiling with the gradient clipped out of it. 0.16 lands the horizon at 1.3, which is
 *  the top of the curve's shoulder: bright, still coloured, still rolling off. */
export const SKY_INTENSITY = 0.16

/** Bearings sampled round the horizon for the fog colour. The sky is brighter toward the sun and
 *  duller away from it; fog is ONE colour, so it has to be the ring's average. */
const HORIZON_RAYS = 8

/** Sampled a hair above the horizon line, because that is the sky a distant ground fades into. */
const HORIZON_RISE = (1.5 * Math.PI) / 180

/** Fog's far distance as a fraction of the nearer of the far plane and the ground's own far edge.
 *  Below 1 on purpose: whichever of those two cuts the world off, the fog has to have finished
 *  before it, or the cut shows as a hard line under the sky. */
const FOG_FAR = 0.8

/** Metres of perfectly clear air before any haze at all: the day's own visibility, and the reason
 *  the same scene hazes the same way whatever the zoom. Without an absolute here the haze is purely
 *  framing-relative, and zooming in visibly thickens the air, which no weather does. */
const FOG_CLEAR_M = 400

/** ...but never nearer than this many camera distances, which is what keeps the whole-circuit
 *  framing crisp. From 1.6km up, every point of the circuit is past any fixed clear distance, and a
 *  uniform wash over the map is not aerial perspective, it is a dirty lens. */
const FOG_NEAR_DIST = 2.5

/** ...and never past this fraction of the far, or the ramp cannot finish before the world stops.
 *  Binds at the closest zoom, where the far plane is only 585m out on Britain. */
const FOG_NEAR_CAP = 0.55

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** The unit vector pointing AT the sun. Written as the negation of `sunTravel`'s three components
 *  rather than calling it, because night needs an altitude below the horizon and `sunAltitude`
 *  floors at 0.05 of a right angle. The test pins the two against each other for daylight. */
export function sunDirection(azimuth: number, altitude: number): THREE.Vector3 {
  return new THREE.Vector3(
    -Math.cos(azimuth) * Math.cos(altitude),
    Math.sin(altitude),
    -Math.sin(azimuth) * Math.cos(altitude),
  )
}

/** The mood, as Preetham reads it.
 *
 *  `ambient` is the overcast knob in the 2D model, so it drives everything about a thick sky here:
 *  aerosol turbidity, the sun's mie glow, and how far the cloud layer closes over. `warmth` drives
 *  rayleigh, which is what deepens a dusk into red rather than merely dimming it. */
export function skyParams(l: Lighting, night = false): SkyParams {
  const ambient = clamp(l.ambient, 0, 1)
  const warmth = clamp(l.warmth, -1, 1)
  const p: SkyParams = {
    turbidity: clamp(2 + (ambient - 0.25) * 22, 1.6, 16),
    rayleigh: clamp(1.4 + warmth * 1.6, 0.35, 3.2),
    mieCoefficient: clamp(0.003 + ambient * 0.007, 0.002, 0.02),
    mieDirectionalG: clamp(0.86 - ambient * 0.22, 0.62, 0.9),
    cloudCoverage: clamp(0.12 + (ambient - 0.25) * 1.1, 0.08, 0.8),
    cloudDensity: clamp(0.35 + (ambient - 0.25) * 0.8, 0.3, 0.95),
    sun: sunDirection(l.azimuth, sunAltitude(l)),
  }
  if (!night) return p
  // Night is not the mood's scalars dimmed: its elevation and ambient are both 2D-shading artifacts
  // (shadows must still fall; shade must still fill), and read literally they make a hazy afternoon.
  return {
    ...p,
    turbidity: 2.4,
    rayleigh: 0.9,
    cloudCoverage: 0.25,
    cloudDensity: 0.5,
    sun: sunDirection(l.azimuth, NIGHT_SUN_RAD),
  }
}

/** The output curve, applied to every renderer that draws this world. The sky is high dynamic range
 *  and the old pipeline had no curve at all, so its bright half simply clipped to white; ACES rolls
 *  that off into highlight instead. It belongs on the renderer, which is why it is a function and
 *  not a constant: the live canvas and the probe must never drift apart on it. */
export function applyToneMapping(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
}

/** A circuit's cloud field, as a `time` for the sky shader to freeze its drift at.
 *
 *  The shader advances its noise by `time * cloudSpeed` (0.0001) and samples the field at 1000x, so
 *  a seed has to reach into the tens before the pattern is visibly a different one. Spread over
 *  0..96, which is a hundred distinguishable skies: enough for a calendar. */
export function skySeedFor(circuitId: string): number {
  let hash = 0
  for (let i = 0; i < circuitId.length; i++) hash = (hash * 31 + circuitId.charCodeAt(i)) % 9973
  return (hash % 97) + 1
}

/** A baked sky and the haze colour that matches it. */
export interface SkyEnv {
  /** The cube, for `scene.background`. Scale it with `SKY_INTENSITY`. */
  texture: THREE.Texture
  /** The sky's own radiance just above the horizon, averaged round the ring and already scaled by
   *  `SKY_INTENSITY`: what the fog fades the world into, so ground and sky meet at one colour. */
  horizon: THREE.Color
  dispose(): void
}

/** Resolution of the baked cube. Enough that a gradient across a 4K viewport stays smooth; the sky
 *  carries no detail finer than its clouds, and they are soft. */
const CUBE_SIZE = 512

/** Read the sky's radiance round the horizon ring, in linear light.
 *
 *  MEASURED, not derived: the fog colour has to be what the shader actually puts on those pixels,
 *  and a second CPU implementation of Preetham would be one refactor away from drifting off it and
 *  putting a visible seam back on the horizon. Rendering to a target skips tone mapping (three only
 *  applies the curve on the way to the canvas), so this is raw radiance, which is the space fog
 *  mixes in. */
function sampleHorizon(renderer: THREE.WebGLRenderer, skyScene: THREE.Scene): THREE.Color {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.FloatType, colorSpace: THREE.LinearSRGBColorSpace,
  })
  const camera = new THREE.PerspectiveCamera(1, 1, 0.1, 1e5)
  const pixel = new Float32Array(4)
  const sum = new THREE.Color(0, 0, 0)
  const previous = renderer.getRenderTarget()
  for (let i = 0; i < HORIZON_RAYS; i++) {
    const bearing = (i / HORIZON_RAYS) * Math.PI * 2
    camera.position.set(0, 0, 0)
    camera.lookAt(
      Math.cos(bearing) * Math.cos(HORIZON_RISE),
      Math.sin(HORIZON_RISE),
      Math.sin(bearing) * Math.cos(HORIZON_RISE),
    )
    renderer.setRenderTarget(target)
    renderer.render(skyScene, camera)
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
    sum.r += pixel[0] / HORIZON_RAYS
    sum.g += pixel[1] / HORIZON_RAYS
    sum.b += pixel[2] / HORIZON_RAYS
  }
  renderer.setRenderTarget(previous)
  target.dispose()
  return sum.multiplyScalar(SKY_INTENSITY)
}

/** Bake the mood's sky. Browser-only (it renders), and called once per mood, not per frame.
 *
 *  `seed` freezes the shader's drifting cloud field at one offset. Passing the circuit's own number
 *  gives every venue its own weather instead of one cloud pattern stamped across the calendar. */
export function buildSky(
  renderer: THREE.WebGLRenderer, lighting: Lighting, { night = false, seed = 0 } = {},
): SkyEnv {
  const p = skyParams(lighting, night)
  const sky = new Sky()
  sky.scale.setScalar(1000)
  const u = sky.material.uniforms
  u.turbidity.value = p.turbidity
  u.rayleigh.value = p.rayleigh
  u.mieCoefficient.value = p.mieCoefficient
  u.mieDirectionalG.value = p.mieDirectionalG
  u.cloudCoverage.value = p.cloudCoverage
  u.cloudDensity.value = p.cloudDensity
  u.sunPosition.value.copy(p.sun)
  u.time.value = seed

  const skyScene = new THREE.Scene()
  skyScene.add(sky)

  const target = new THREE.WebGLCubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType })
  const previous = renderer.getRenderTarget()
  new THREE.CubeCamera(1, 1e4, target).update(renderer, skyScene)
  const horizon = sampleHorizon(renderer, skyScene)
  renderer.setRenderTarget(previous)

  sky.geometry.dispose()
  sky.material.dispose()
  return { texture: target.texture, horizon, dispose: () => target.dispose() }
}

/** How far the camera is from the ground it is pointed at: the orbit's own distance, recovered from
 *  the camera rather than passed in, so an ortho probe shot and the live perspective view fit their
 *  haze the same way. Infinite for a camera not looking down at all, which the map cannot reach. */
function groundDistance(camera: THREE.Camera): number {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  return forward.y < -1e-6 ? -camera.position.y / forward.y : Infinity
}

/** Fit the fog to what the camera can actually see, per camera move, the way the sun's shadow box is
 *  fitted (`refitShadow`).
 *
 *  Two things cut the world off and the haze has to be finished before whichever is nearer: the far
 *  plane, and the ground plane's own edge. Measured on Britain, the far plane is 585m out at the
 *  closest zoom and 273km at the widest, while the ground's edge stays put at 16.5km, so which one
 *  binds changes with the framing and the fog has to move with it.
 *
 *  Where the haze STARTS is the day's fixed visibility, so the air does not thicken when the player
 *  zooms, held off the two framings that would misuse it: never nearer than a few camera distances
 *  (the whole-circuit view, which is entirely past any fixed distance and must stay crisp), never
 *  past a fraction of the far (the close-up, whose far plane arrives too soon for a long ramp).
 *
 *  `ground` is the ground plane as a disc in world units. Pass its INSCRIBED reach, the nearest
 *  distance at which it can stop, so no bearing is left uncovered. */
export function refitFog(
  fog: THREE.Fog, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  ground: { x: number; z: number; radius: number; metresPerUnit: number },
): void {
  const toEdge = Math.hypot(camera.position.x - ground.x, camera.position.z - ground.z) + ground.radius
  fog.far = Math.min(camera.far, toEdge) * FOG_FAR
  fog.near = Math.min(
    Math.max(FOG_CLEAR_M / ground.metresPerUnit, groundDistance(camera) * FOG_NEAR_DIST),
    fog.far * FOG_NEAR_CAP,
  )
}
