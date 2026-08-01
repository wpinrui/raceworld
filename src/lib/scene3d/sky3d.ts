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

/** Night's sky, bottom (nadir) to top (zenith), as sRGB bytes at their elevation in degrees.
 *
 *  AUTHORED, where every other mood is analytic, because Preetham is a daylight model and neither
 *  side of its sun cutoff is a night sky. Measured both: parked just inside the cutoff it bakes a
 *  sunset (0.24/0.13/0.03, warm), and past it the model falls back to a bare extinction term that
 *  reads BROWN (21/16/10 at the zenith), since a long atmospheric path scatters the blue out and
 *  leaves the red. A real night is the opposite of both, so it is written down instead: deep blue
 *  overhead, and a low warm band at the horizon where a floodlit venue throws its own light back
 *  off the air. That band is the only part the map's 80-degree pitch limit ever shows. */
const NIGHT_RAMP: Array<[elevation: number, rgb: [number, number, number]]> = [
  [-90, [16, 17, 23]],
  [-2, [30, 30, 36]],
  [0, [48, 45, 52]],
  [6, [34, 36, 52]],
  [20, [20, 26, 46]],
  [90, [9, 13, 30]],
]

/** What `scene.backgroundIntensity` scales a DAYLIT bake by, and the fog colour with it.
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
const DAY_INTENSITY = 0.16

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

/** How thick the day is, 0 clear to 1 socked in. `ambient` is the overcast knob in the 2D model, so
 *  it is the one scalar that says whether there is a lid on the sky. */
function overcastness(ambient: number): number {
  return clamp((ambient - 0.3) / 0.45, 0, 1)
}

/** The mood, as Preetham reads it.
 *
 *  Preetham is a CLEAR-sky model and cannot render an overcast one, which is the trap in the obvious
 *  mapping: turbidity is aerosol, and winding it up to say "thick day" renders a DEEPER blue away
 *  from the sun, not a grey lid. Measured, that made overcast the bluest sky of the five.
 *
 *  What greys a sky is the balance of its two scatterings, not its thickness. Rayleigh is the blue
 *  one and mie is the white one, so overcastness leans off the first and hard onto the second: a
 *  bright neutral haze, which is what a lid of cloud actually is. Taking rayleigh out ALONE only
 *  darkens it, since rayleigh is also most of a clear sky's brightness.
 *
 *  `warmth` sets rayleigh's clear-day level, which is what deepens a dusk into red rather than
 *  merely dimming it. */
export function skyParams(l: Lighting): SkyParams {
  const ambient = clamp(l.ambient, 0, 1)
  const warmth = clamp(l.warmth, -1, 1)
  const thick = overcastness(ambient)
  return {
    turbidity: clamp(2 + (ambient - 0.25) * 22, 1.6, 16),
    rayleigh: clamp(1.4 + warmth * 1.6, 0.35, 3.2) * (1 - 0.55 * thick),
    mieCoefficient: clamp(0.003 + ambient * 0.007, 0.002, 0.02) * (1 + 5 * thick),
    mieDirectionalG: clamp(0.86 - ambient * 0.22, 0.62, 0.9),
    cloudCoverage: clamp(0.12 + thick * 0.68, 0.08, 0.8),
    cloudDensity: clamp(0.35 + thick * 0.6, 0.3, 0.95),
    sun: sunDirection(l.azimuth, sunAltitude(l)),
  }
}

/** Night's sky as an equirectangular strip: one column, because `NIGHT_RAMP` varies only with
 *  elevation. Cheap, exact and needs no GPU readback, so the haze colour is simply the band the
 *  horizon is painted in rather than something sampled back out of a render. */
function buildNightSky(): SkyEnv {
  const height = 256
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context for the night sky')
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  for (const [elevation, [r, g, b]] of NIGHT_RAMP) {
    // Equirectangular v runs zenith (0) to nadir (1), so the ramp is read top-down.
    gradient.addColorStop(clamp(0.5 - elevation / 180, 0, 1), `rgb(${r}, ${g}, ${b})`)
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 1, height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.SRGBColorSpace
  const [, horizonRgb] = NIGHT_RAMP.find(([elevation]) => elevation === 0)!
  const horizon = new THREE.Color().setRGB(
    horizonRgb[0] / 255, horizonRgb[1] / 255, horizonRgb[2] / 255, THREE.SRGBColorSpace,
  )
  return { texture, intensity: 1, horizon, dispose: () => texture.dispose() }
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
  /** The cube, for `scene.background`. */
  texture: THREE.Texture
  /** What `scene.backgroundIntensity` must be for THIS bake: day and night are three orders of
   *  magnitude apart in raw radiance, so it travels with the sky rather than sitting in the caller
   *  where the two could be paired up wrongly. */
  intensity: number
  /** The sky's own radiance just above the horizon, averaged round the ring and already scaled by
   *  `intensity`: what the fog fades the world into, so ground and sky meet at one colour. */
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
function sampleHorizon(
  renderer: THREE.WebGLRenderer, skyScene: THREE.Scene, intensity: number,
): THREE.Color {
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
  return sum.multiplyScalar(intensity)
}

/** Bake the mood's sky. Browser-only (it renders), and called once per mood, not per frame.
 *
 *  `seed` freezes the shader's drifting cloud field at one offset. Passing the circuit's own number
 *  gives every venue its own weather instead of one cloud pattern stamped across the calendar. */
export function buildSky(
  renderer: THREE.WebGLRenderer, lighting: Lighting, { night = false, seed = 0 } = {},
): SkyEnv {
  if (night) return buildNightSky()
  const p = skyParams(lighting)
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
  const horizon = sampleHorizon(renderer, skyScene, DAY_INTENSITY)
  renderer.setRenderTarget(previous)

  sky.geometry.dispose()
  sky.material.dispose()
  return {
    texture: target.texture, intensity: DAY_INTENSITY, horizon, dispose: () => target.dispose(),
  }
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
