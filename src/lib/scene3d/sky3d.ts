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
  /** Noise frequency of the cloud field. Higher packs more, smaller clouds into the same sky. */
  cloudScale: number
  /** How low the cloud layer hangs. Drives the shader's own horizon fade, which is the whole reason
   *  it is here rather than left at its default. */
  cloudElevation: number
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
type Ramp = Array<[elevation: number, rgb: [number, number, number]]>

const NIGHT_RAMP: Ramp = [
  [-90, [16, 17, 23]],
  [-2, [30, 30, 36]],
  [0, [48, 45, 52]],
  [6, [34, 36, 52]],
  [20, [20, 26, 46]],
  [90, [9, 13, 30]],
]

/** The daylight fallback, for a machine that cannot bake a Preetham sky at all (the model needs a
 *  float render target to read its own horizon back out of).
 *
 *  It exists because of METAL. A metal surface has no diffuse term, so it is nothing but a
 *  reflection of its environment, and with no environment at all a wheel rim renders pure black.
 *  Falling back to no sky was survivable while every material was Lambert; it is not now. A plain
 *  gradient is a poor sky and a perfectly adequate thing to reflect. */
const DAY_RAMP: Ramp = [
  [-90, [92, 96, 92]],
  [-2, [150, 156, 156]],
  [0, [198, 210, 214]],
  [12, [150, 184, 214]],
  [40, [104, 150, 200]],
  [90, [86, 134, 192]],
]

/** What `scene.backgroundIntensity` scales a DAYLIT bake by, and the fog colour with it.
 *
 *  Preetham's output is authored against its own exposure, while the light rig is calibrated at 1 (a
 *  horizontal surface renders close to its authored albedo). Rendering both under one exposure
 *  therefore needs the sky brought down to the world rather than the world up to the sky: the
 *  alternative re-tunes every mood, every material and every shadow to suit the background.
 *
 *  MEASURED by reading the rendered CANVAS bytes across a sweep, which is the only honest way to set
 *  it: three's ACES divides by 0.6 before its fit, so reasoning about the curve on paper lands far
 *  too bright, and the first attempt shipped a white ceiling at 0.16.
 *
 *  The band under 8 degrees is the ONLY sky the map's pitch limit ever shows, and it has to carry
 *  the whole gradient from pale horizon to blue. Two knobs that look like they should help do not:
 *  raising rayleigh makes that band LESS blue, not more (a horizon path is long, and the long path
 *  is exactly what extinguishes blue), and turbidity and mie move it by a couple of bytes. The wash
 *  is in the tone curve, not the atmosphere, which is why `applyToneMapping` picks the curve it
 *  does. Under that curve, bytes at 0 / 4 / 8 degrees:
 *
 *      0.110    226,237,241   156,200,213    95,148,177
 *      0.080    205,216,219   132,172,183    76,125,151
 *      0.055    171,180,184   107,142,152    54,100,123
 *
 *  0.08: a horizon still pale enough to read as distance, and real blue by four degrees up. */
const DAY_INTENSITY = 0.08

/** ...and what the same sky is worth as LIGHT, which is a separate question with its own answer.
 *
 *  The background's scale is chosen on how the sky LOOKS. This one is chosen on how much the sky
 *  ILLUMINATES, and nothing says the two agree: an environment map delivers whatever irradiance its
 *  own pixels add up to, while the rig is calibrated so that sky plus sun on a horizontal surface
 *  lands near 1.05, of which the sky owes 0.625.
 *
 *  Solved off the SHADOW RATIO, which is the one measurement that needs no assumption about what a
 *  surface's albedo is: a shadowed patch is lit by sky alone and a lit one by sky plus sun, so their
 *  ratio is `A / (A + S)` with the rig's sun fixed at S = 0.425. The target ratio is therefore 0.60,
 *  and the measurement reads it straight off two pixels of the same grass.
 *
 *      env = 0.080   ratio 0.588   ->  sky delivering 0.607
 *      env = 0.039   ratio 0.434   ->  sky delivering 0.326, shadows far too deep
 *
 *  So the two scales very nearly do coincide here, and the correction is a few percent rather than
 *  the halving an earlier reading suggested. That reading compared rendered pixels against authored
 *  albedo directly, which cannot work: it takes the tone curve for an identity and assumes the
 *  grass renders one flat colour. The ratio method is immune to both. */
const ENV_INTENSITY = DAY_INTENSITY * 0.98

/** The line in three's cloud composite that this module rewrites, and the uniform it rewrites it
 *  into. Kept as an exact string so a three upgrade that moves it is caught, by unit test rather
 *  than by someone noticing the sky went cloudless. */
export const CLOUD_SCALE_LINE = 'cloudColor *= vSunE * 0.00002;'

/** How far up that constant has to come.
 *
 *  MEASURED against the sky it sits in. The shader's cloud radiance works out at about 0.022, while
 *  the sky behind it renders between 3.4 and 10.4, so a cloud is two hundred times DARKER than the
 *  sky it is drawn on: the layer reads as faint dirty smudges, and turning `cloudDensity` up drives
 *  it toward black rather than toward white. The constant is simply calibrated for a far dimmer sky
 *  than this one. Multiplying by `vSunE` keeps it tracking the sun across moods. */
const CLOUD_BRIGHTNESS = 450

/** Rewrite that constant into a uniform. Warns rather than throws: a sky with dark clouds is worse
 *  than a sky without them, but either beats no sky at all, and the caller treats a throw as no
 *  sky. The unit test is what makes this loud. */
function patchCloudBrightness(material: THREE.ShaderMaterial): void {
  if (!material.fragmentShader.includes(CLOUD_SCALE_LINE)) {
    console.warn('three Sky shader changed: clouds cannot be brightened, rendering without them')
    material.uniforms.cloudCoverage.value = 0
    return
  }
  material.uniforms.cloudBrightness = { value: CLOUD_BRIGHTNESS }
  material.fragmentShader = material.fragmentShader
    .replace('uniform float cloudScale;', 'uniform float cloudScale;\nuniform float cloudBrightness;')
    .replace(CLOUD_SCALE_LINE, 'cloudColor *= vSunE * 0.00002 * cloudBrightness;')
}

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
 *  framing-relative, and zooming in visibly thickens the air, which no weather does.
 *
 *  1500, not the 400 this started at. 400m of clear air is a misty morning, and it was chosen only
 *  because the far plane used to cut the ground off at 3km, leaving no room for a longer ramp that
 *  still finished before the cut. `applyOrbitCam` now opens the far plane out when the camera leans
 *  toward the horizon, so the ramp can run to the ground plane's real edge and everything a player
 *  would call "not that far" stays crisp. */
export const FOG_CLEAR_M = 1500

/** ...but never nearer than this many camera distances, which is what keeps the whole-circuit
 *  framing crisp. From 1.6km up, every point of the circuit is past any fixed clear distance, and a
 *  uniform wash over the map is not aerial perspective, it is a dirty lens. */
const FOG_NEAR_DIST = 2.5

/** ...and never past this fraction of the far, or the ramp cannot finish before the world stops.
 *  Binds at the closest zoom, where the far plane is only 585m out on Britain. */
export const FOG_NEAR_CAP = 0.55

/** The ground plane as everything that has to stop before its edge addresses it: the haze, and the
 *  reflection probe. `radius` is the INSCRIBED reach, the nearest distance at which the world can
 *  stop, so no bearing is left uncovered. Built once by `buildWorld3D`, which is the thing that
 *  actually lays the plane down. */
export interface GroundExtent {
  x: number
  z: number
  radius: number
  metresPerUnit: number
}

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
    // Coverage is how much of the sky is under cloud, and it has to stay LOW for a clear day, or
    // there is no blue left between them. Low reads as sparse only because the clouds are visible
    // now: at the shader's own brightness they were 200x darker than the sky, so this used to be
    // the difference between no clouds and no clouds.
    cloudCoverage: clamp(0.14 + thick * 0.5, 0.1, 0.7),
    cloudDensity: clamp(0.7 + thick * 0.25, 0.65, 0.95),
    // Hung LOW, against the shader's default of 0.5. It fades cloud out toward the horizon over
    // `smoothstep(0, 0.1 + 0.2 * cloudElevation, dir.y)`, and at the default that fade only finishes
    // at 11.5 degrees of elevation, which is ABOVE the 7.7 the map's pitch limit can reach. Measured
    // there: 0.00 of a cloud at the horizon, 0.28 at 4 degrees. The layer was masked out of the only
    // band anyone can see. At 0.05 the fade finishes at 6.3 degrees instead.
    cloudElevation: 0.05,
    // Five times the shader's 0.0002 default. It needs to be up here at all because hanging the
    // layer low (above) pushes `elevation` toward 1, which DIVIDES the sampling frequency by about
    // 0.58 and blows the clouds up on its own, and because the band under 8 degrees is steeply
    // foreshortened: a field coarse enough to look right overhead arrives down there as a few vast
    // smears. It should not go much past this, though. At 0.003 the same field breaks up into
    // speckle, which reads as noise on the sky rather than as weather.
    cloudScale: 0.0011,
    sun: sunDirection(l.azimuth, sunAltitude(l)),
  }
}

/** A ramp sky as an equirectangular strip: one column, because a ramp varies only with elevation.
 *  Cheap, exact and needs no GPU readback, so the haze colour is simply the band the horizon is
 *  painted in rather than something sampled back out of a render. Serves as its own environment
 *  without a prefilter, since there is nothing in it sharper than a gradient. */
function buildRampSky(ramp: Ramp): SkyEnv {
  const height = 256
  // WIDE, though the ramp varies only with elevation and one column would draw it. A background
  // samples the texture directly and would not care, but the same texture goes into
  // `scene.environment`, and three converts an equirect environment to its cubeUV form before any
  // material reads irradiance out of it. That conversion cannot do anything sensible with a
  // one-pixel-wide source: measured, night grass rendered 27/27/33 against a correct 31/63/9, its
  // green more than halved, because the diffuse it was reading back was garbage rather than sky.
  const width = 64
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context for the night sky')
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  for (const [elevation, [r, g, b]] of ramp) {
    // Equirectangular v runs zenith (0) to nadir (1), so the ramp is read top-down.
    gradient.addColorStop(clamp(0.5 - elevation / 180, 0, 1), `rgb(${r}, ${g}, ${b})`)
  }
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.SRGBColorSpace
  const [, horizonRgb] = ramp.find(([elevation]) => elevation === 0)!
  const horizon = new THREE.Color().setRGB(
    horizonRgb[0] / 255, horizonRgb[1] / 255, horizonRgb[2] / 255, THREE.SRGBColorSpace,
  )
  return {
    texture, environment: texture, intensity: 1, lightsScene: false, lightIntensity: 1, horizon,
    dispose: () => texture.dispose(),
  }
}

/** The output curve, applied to every renderer that draws this world. The old pipeline had no curve
 *  at all, so everything above 1 simply clipped to white, the sky worst of all.
 *
 *  Khronos PBR Neutral rather than the obvious ACES. ACES desaturates hard in its shoulder, and the
 *  sky lives entirely in that shoulder: measured against each other at matched horizon brightness,
 *  Neutral is both brighter and bluer across the whole visible band, and it holds authored colour
 *  instead of shifting it, which the team liveries will want too.
 *
 *  It belongs on the renderer, which is why it is a function and not a constant: the live canvas and
 *  the probe must never drift apart on it. */
export function applyToneMapping(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = THREE.NeutralToneMapping
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
  /** Whether this environment carries enough light to REPLACE the rig's hemisphere.
   *
   *  True only for a real Preetham bake, whose scale was solved against the rig's own ambient share.
   *  A ramp sky (night, and the daylight fallback) is a backdrop and a thing for metal to reflect,
   *  not a light: measured, the night ramp delivers about 0.02 where the night rig owes 0.674, so
   *  standing the hemisphere down for it renders a floodlit circuit as black ground with windows
   *  floating over it. */
  lightsScene: boolean
  /** What `scene.environmentIntensity` must be, which is NOT the same number. See `ENV_INTENSITY`:
   *  how bright the sky should look and how much it should light the world are separate questions,
   *  and answering them with one scalar overlit the whole scene by two thirds. */
  lightIntensity: number
  /** The same sky prefiltered for image-based lighting, for `scene.environment`. This is what puts
   *  sky IN the world rather than only behind it: a roughness-mipped cube that every standard
   *  material reads its ambient and its reflections out of. Scale it with the same `intensity`,
   *  through `scene.environmentIntensity`. */
  environment: THREE.Texture
  /** The sky's own radiance just above the horizon, averaged round the ring and already scaled by
   *  `intensity`: what the fog fades the world into, so ground and sky meet at one colour. */
  horizon: THREE.Color
  /** Free the bake. MUST be called while the renderer that made it is still alive, the same
   *  ownership contract every three resource carries. Disposing a renderer empties the per-target
   *  property map, and freeing a cube after that reads six framebuffer handles out of nothing and
   *  throws. There is no need to call it in that case anyway: the context took the cube with it.
   *  `scene3d-lifecycle-check` holds both orders against a real GL context. */
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
  if (night) return buildRampSky(NIGHT_RAMP)
  const p = skyParams(lighting)
  const sky = new Sky()
  sky.scale.setScalar(1000)
  patchCloudBrightness(sky.material)
  const u = sky.material.uniforms
  u.turbidity.value = p.turbidity
  u.rayleigh.value = p.rayleigh
  u.mieCoefficient.value = p.mieCoefficient
  u.mieDirectionalG.value = p.mieDirectionalG
  u.cloudCoverage.value = p.cloudCoverage
  u.cloudDensity.value = p.cloudDensity
  u.cloudElevation.value = p.cloudElevation
  u.cloudScale.value = p.cloudScale
  u.sunPosition.value.copy(p.sun)
  u.time.value = seed

  const skyScene = new THREE.Scene()
  skyScene.add(sky)

  const target = new THREE.WebGLCubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType })
  const previous = renderer.getRenderTarget()
  let pmrem: THREE.PMREMGenerator | null = null
  let irradiance: THREE.WebGLRenderTarget | null = null
  try {
    new THREE.CubeCamera(1, 1e4, target).update(renderer, skyScene)
    const horizon = sampleHorizon(renderer, skyScene, DAY_INTENSITY)
    // Prefiltered off the SAME cube, so the sky a surface reflects is the sky behind it. The sun
    // disc is left in deliberately: three's docs suggest hiding it when baking an environment, but
    // a disc is exactly what puts a moving glint down a car's flank, and prefiltering spreads it
    // across the roughness chain rather than leaving it a hard dot.
    pmrem = new THREE.PMREMGenerator(renderer)
    irradiance = pmrem.fromCubemap(target.texture)
    return {
      texture: target.texture,
      environment: irradiance.texture,
      intensity: DAY_INTENSITY,
      lightsScene: true,
      lightIntensity: ENV_INTENSITY,
      horizon,
      dispose: () => {
        target.dispose()
        irradiance?.dispose()
      },
    }
  } catch (err) {
    // A machine without float render targets fails inside `sampleHorizon`, AFTER the cube is
    // allocated, so it is freed here while it is still reachable. The scene then gets the plain
    // gradient rather than nothing: something has to be in `scene.environment` or every metal in
    // the world renders black.
    irradiance?.dispose()
    target.dispose()
    console.warn(`sky bake failed, falling back to a plain gradient: ${String(err)}`)
    return buildRampSky(DAY_RAMP)
  } finally {
    pmrem?.dispose()
    renderer.setRenderTarget(previous)
    sky.geometry.dispose()
    sky.material.dispose()
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
 *  past a fraction of the far (the close-up, whose far plane arrives too soon for a long ramp). */
export function refitFog(
  fog: THREE.Fog, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, ground: GroundExtent,
): void {
  const toEdge = Math.hypot(camera.position.x - ground.x, camera.position.z - ground.z) + ground.radius
  fog.far = Math.min(camera.far, toEdge) * FOG_FAR
  fog.near = Math.min(
    Math.max(FOG_CLEAR_M / ground.metresPerUnit, groundDistance(camera) * FOG_NEAR_DIST),
    fog.far * FOG_NEAR_CAP,
  )
}
