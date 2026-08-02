// The real light (#3d-port increment 2), derived from the same four scalars `lighting.ts` holds.
// The 2D fakes this agreement with baked shadow polygons, wall shades and bevels; here it is one sun
// with a shadow map and one sky, and every derived helper the 2D needed (shadowFill, tintFace,
// shadeFace, the sweeps) simply has no 3D counterpart to write.
//
// Calibration rule: sky + sun-on-a-horizontal ≈ 1, so an upward-facing surface renders close to its
// authored albedo and the flat layers of the ground stack keep looking like the 2D picture. A shadow
// removes only the sun's share, which leaves it lit by the sky — the exact insight `shadowFill`
// encoded, now emergent.

import * as THREE from 'three'
import type { Lighting } from '@/lib/ui/lighting'
import type { ViewBox3D } from './camera3d'

/** Sun altitude in radians: `elevation` 0..1 maps horizon..overhead, floored like `shadowReach`. */
export function sunAltitude(l: Lighting): number {
  return Math.max(0.05, Math.min(1, l.elevation)) * (Math.PI / 2)
}

/** Unit vector the sunlight TRAVELS along: the 2D azimuth in plan, pitched down by the altitude. */
export function sunTravel(l: Lighting): THREE.Vector3 {
  const alt = sunAltitude(l)
  return new THREE.Vector3(
    Math.cos(l.azimuth) * Math.cos(alt),
    -Math.sin(alt),
    Math.sin(l.azimuth) * Math.cos(alt),
  )
}

/** The sky's share of a horizontal surface's light. Overcast pushes it toward 1 and the sun toward
 *  nothing, which is what makes shadows fade exactly as `shadowOpacity` faded them. */
export function skyShare(l: Lighting): number {
  return Math.min(0.95, 0.55 + l.ambient * 0.3)
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** The sun's shadow map, per side.
 *
 *  TRIED AT 2048 AND PUT BACK. 4096 is 16.8 million texels rasterised every frame regardless of the
 *  window size, eight times a 1080p viewport, and it looked like the obvious explanation for why
 *  shrinking the window never moved the frame. It is not: halving it changed the frame time by
 *  nothing measurable, while switching shadows off entirely was worth 2.5 ms AND dropped the
 *  submission figure with it.
 *
 *  So the shadow pass costs what it costs because of the GEOMETRY drawn into it, not the texels it
 *  fills. Fewer casters is the lever here; a smaller map is only lost quality.
 *
 *  Both biases below are derived from this, so it is one number and not three. */
export const SHADOW_MAP = 4096

/** How far from the camera's target the sun's shadow box may reach, in metres.
 *
 *  Pitching the camera toward the horizon multiplies the framed extent by 1/cos(pitch), which at the
 *  map's limit is nearly six, so a low camera asks the sun to cover most of a circuit. That costs
 *  twice: every caster inside it is drawn into the map, and the map's texels are spread over ground
 *  the player cannot resolve a shadow on anyway. What the cap costs is shadows past it, which at
 *  that distance are a few pixels of haze-washed grey.
 *
 *  Lives here rather than beside the one camera that applies it, because the preview probe drives
 *  the same orbit and has to fit the same box or it is not previewing what ships. */
export const SHADOW_REACH_M = 250

/** The tallest thing that can stand OUTSIDE a frame and still throw a shadow into it, in metres.
 *  The night floodlight towers are 16 (`night3d`), a grove's biggest tree about 15
 *  (`track-scenery`), a grandstand less than either. Thirty is an upper bound with room in it, and
 *  an upper bound is all this has to be: it only ever widens the box.
 *
 *  Overridable, because it is a fact about the SCENE and not about shadows. The car preview stands
 *  one car on an empty plane at a hundredth of this scale, and handing it a thirty-metre ceiling
 *  would pad its box by a kilometre of nothing and take its texels with it. */
const TALLEST_CASTER_M = 30

/** How soft a shadow edge is, in metres. The sun subtends about half a degree, so an edge cast from
 *  ten metres up is soft over roughly nine centimetres, and a canopy is about ten metres up.
 *
 *  Held in WORLD units rather than texels, which is the whole point of it. The filter's own radius
 *  is a count of texels, so a fixed one gave a blur that grew and shrank with the box: the same tree
 *  wore a different penumbra at every zoom. Converting through the texel each refit pins it to the
 *  world instead, and where the texels are coarser than this the texel is already the wider of the
 *  two and the clamp below simply lets it be. */
const PENUMBRA_M = 0.1

/** Widest the filter may spread, in texels. The kernel is five taps whatever the radius, rotated per
 *  pixel by a screen-space noise, so a wide one costs nothing and buys grain instead. Six is as far
 *  as the dither stays under the grass. */
const RADIUS_MAX = 6

/** Depth bias, in TEXELS of the map. In texels because that is the unit the error is in: a shadow
 *  map quantises depth across a texel's footprint, so what it takes to clear the self-shadow scales
 *  with the texel and with nothing else. It used to be a constant in NDC, which is a constant
 *  fraction of the frustum's DEPTH, and the frustum was floored at two hundred units deep however
 *  close the camera came: half a metre of bias on Britain at full zoom, which is what was sliding
 *  every shadow off the foot of the thing casting it. */
const BIAS_TEXELS = 1.5

/** Sunlight's own colour: cream under a warm sun, blue-white under a cool one — `litWhite`'s ramp. */
export function sunColor(l: Lighting): THREE.Color {
  const w = clamp(l.warmth, -1, 1)
  return new THREE.Color(
    (255 - Math.max(0, -w) * 18) / 255,
    (255 - Math.abs(w) * 8) / 255,
    (255 - Math.max(0, w) * 34) / 255,
  )
}

/** The sky against it: always cooler than the sun, bluer as the sun warms, so shadowed ground takes
 *  the desaturated blue-violet cast every shadow in the 2D world was filled with. */
export function skyColor(l: Lighting): THREE.Color {
  const t = clamp((l.warmth + 1) / 2, 0, 1)
  return new THREE.Color(
    (206 - t * 14) / 255,
    (212 - t * 8) / 255,
    (228 + t * 8) / 255,
  )
}

/** Sun intensity that lands sky + sun ≈ 1.05 on a horizontal surface, whatever the altitude. */
export function sunIntensity(l: Lighting): number {
  return Math.max(0, 1.05 - skyShare(l)) / Math.max(0.2, Math.sin(sunAltitude(l)))
}

/** The rig: one hemisphere sky, one shadow-casting sun fitted over the FRAMED extent.
 *
 *  Fitted to what is in shot, not to the circuit: an afternoon sun throws two-metre shadows, and
 *  spread over a whole circuit the map's texels are a metre wide, which rounds every one of them to
 *  nothing. The probe fits the crop it renders; the live view refits per camera move the same way
 *  (#3d-port increment 5). The box carries slack for what tall solids cast in from outside it. */
/** What the shadow box needs to know about the scene it is being fitted to. Both are facts about the
 *  WORLD, not about shadows, which is why neither can be a constant in here: the same rig lights a
 *  circuit at four metres to the unit and a car preview at a hundredth of that. */
export interface ShadowFit {
  /** The scene's scale, for reading this file's metre-denominated constants in world units. */
  unitsPerMetre?: number
  /** The tallest caster standing in it, in metres. */
  tallestM?: number
}

export function buildLightRig(l: Lighting, vb: ViewBox3D, fit: ShadowFit = {}): THREE.Group {
  const rig = new THREE.Group()
  // Physically-based lighting folds a 1/pi into the diffuse BRDF, so hitting "a horizontal surface
  // renders its albedo" takes pi times the share. Measured against the 2D stills, not assumed: the
  // first render came out at a quarter of the reference's linear luminance, which is exactly pi off
  // an intended 0.78.
  const level = l.level ?? 1
  const hemi = new THREE.HemisphereLight(
    skyColor(l), new THREE.Color('#8A8677'), skyShare(l) * Math.PI * level,
  )
  const sun = new THREE.DirectionalLight(sunColor(l), sunIntensity(l) * Math.PI * level)
  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP)
  // The sun's BEARING, which is the one thing `refitShadow` reads off the rig and never sets: it
  // slides the box under the sky rather than moving the sun across it. Everything else about the
  // box (where it sits, how wide, how deep, both biases, the filter) is fitted there, so the build
  // and the per-move refit cannot drift apart.
  sun.position.copy(sunTravel(l)).negate()
  sun.target.position.set(0, 0, 0)
  refitShadow(sun, vb, fit)
  rig.add(hemi, sun, sun.target)
  return rig
}

/** Refit an existing sun's shadow box onto a new framed extent: the live camera moved, and the map
 *  has to follow or its texels are spent on circuit nobody is looking at. The sun's own BEARING is
 *  kept: this slides the box under the sky, it does not move the sun across it.
 *
 *  The box is the FRAME plus what can reach into it, and no more. It used to be the frame plus sixty
 *  units, a constant that reads as a modest margin and is not one: units are metres-per-unit apart
 *  from metres, so on Belgium those sixty were 282 m of slack wrapped around a frame the camera was
 *  showing 4.6 m of. Measured on Britain at full zoom, the box came out 478 m across and one of its
 *  4096 texels 11.7 cm, which is the size of the leaf gaps it was being asked to resolve, and it did
 *  not shrink as the player came closer because the pad was the whole of it. A canopy's shadow could
 *  only ever be the blurred lobes that survived that sampling. Derived, the same box is 34 m and the
 *  texel 8 mm. */
export function refitShadow(
  sun: THREE.DirectionalLight, vb: ViewBox3D, fit: ShadowFit = {},
): void {
  const { unitsPerMetre = 1, tallestM = TALLEST_CASTER_M } = fit
  const cx = vb.x + vb.w / 2
  const cz = vb.y + vb.h / 2
  const travel = sun.target.position.clone().sub(sun.position).normalize()
  const casters = tallestM * unitsPerMetre
  // What a caster standing outside the frame throws into it: its height by the cotangent of the
  // sun's altitude, which the travel vector already carries as its run over its drop. Clamped at
  // the 3 `shadowReach` clamps at, so a near-horizon sun cannot ask for a box the size of a county.
  const pad = casters * Math.min(3, Math.hypot(travel.x, travel.z) / Math.max(0.05, -travel.y))
  const half = Math.max(vb.w, vb.h) / 2 + pad
  // The depth the map has to cover: every caster's height, plus the box's own extent raked across
  // the light. Standing the sun one and a half of those back makes the frustum exactly two of them
  // deep, which is what holds the depth bias below to a few texels of world instead of leaving it a
  // fixed fraction of a frustum that was floored at two hundred units however close the camera came.
  const span = casters + half * 1.5
  sun.position.set(cx, 0, cz).addScaledVector(travel, -span * 1.5)
  sun.target.position.set(cx, 0, cz)
  sun.shadow.camera.left = -half
  sun.shadow.camera.right = half
  sun.shadow.camera.top = half
  sun.shadow.camera.bottom = -half
  sun.shadow.camera.near = span * 0.5
  sun.shadow.camera.far = span * 2.5
  // The frustum above is only real after this: a light's shadow camera keeps its constructed
  // projection until told, and the untold default is a ten-unit box hanging in the sky, which
  // renders as no shadows anywhere.
  sun.shadow.camera.updateProjectionMatrix()
  // Acne relief scaled to the map's own texel, both halves of it. A constant is a trap here: at a
  // high sun a diorama building's whole shadow is two metres, and a bias fixed in absolute terms
  // ATE it on the coarse-scaled circuits while barely registering on the fine ones.
  const texel = (2 * half) / SHADOW_MAP
  sun.shadow.normalBias = texel
  // Orthographic depth is linear, so NDC's -1..1 is `span` units either side of the middle and a
  // bias of one texel of world is one texel over that span.
  sun.shadow.bias = -(BIAS_TEXELS * texel) / span
  // The filter, spread to a fixed width of WORLD rather than a fixed count of texels. At the coarse
  // end this clamps to 1, which is not a compromise: out there a texel is already wider than the
  // penumbra it would be standing in for.
  sun.shadow.radius = Math.min(RADIUS_MAX, Math.max(1, (PENUMBRA_M * unitsPerMetre) / texel))
}

/** What fraction of the rig's hemisphere survives once an environment map is mounted.
 *
 *  The two are the SAME physical quantity by two routes: sky light arriving on a surface. The
 *  hemisphere is the cheap analytic version the rig used when there was nothing else; the
 *  environment is the real one, with the sky's own gradient and its clouds in it. Running both at
 *  full counts that light twice, which lifts every shadow toward its lit value and flattens the
 *  scene. Zero, then: the environment does the whole job, and this exists only so the number is
 *  written down with its reason rather than hidden in a deleted line. */
const AMBIENT_KEPT_WITH_ENV = 0

/** Balance the rig's hemisphere against a mounted environment map. `lighting` is the environment's
 *  own claim to carry the sky's share (`SkyEnv.lightsScene`); a backdrop that merely gives metal
 *  something to reflect does not qualify. Idempotent: the rig's own intensity is stashed on first
 *  call, so re-running this never compounds. */
export function balanceAmbient(sky: THREE.HemisphereLight, lighting: boolean): void {
  const data = sky.userData as { rigIntensity?: number }
  data.rigIntensity ??= sky.intensity
  sky.intensity = data.rigIntensity * (lighting ? AMBIENT_KEPT_WITH_ENV : 1)
}
