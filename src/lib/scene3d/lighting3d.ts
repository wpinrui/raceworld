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
export function buildLightRig(l: Lighting, vb: ViewBox3D): THREE.Group {
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
  const cx = vb.x + vb.w / 2
  const cz = vb.y + vb.h / 2
  const reach = Math.max(vb.w, vb.h)
  sun.position.copy(sunTravel(l).multiplyScalar(-reach)).add(new THREE.Vector3(cx, 0, cz))
  sun.target.position.set(cx, 0, cz)
  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP)
  const half = Math.max(vb.w, vb.h) / 2 + 60
  sun.shadow.camera.left = -half
  sun.shadow.camera.right = half
  sun.shadow.camera.top = half
  sun.shadow.camera.bottom = -half
  sun.shadow.camera.near = reach * 0.2
  sun.shadow.camera.far = reach * 2.2
  // The frustum above is only real after this: a light's shadow camera keeps its constructed
  // projection until told, and the untold default is a ten-unit box hanging in the sky, which
  // renders as no shadows anywhere.
  sun.shadow.camera.updateProjectionMatrix()
  // Acne relief scaled to the map's own texel. A constant here is a trap: at a high sun a diorama
  // building's whole shadow is two metres, and a normal bias fixed at a third of a unit ATE it on
  // the coarse-scaled circuits while barely registering on the fine ones.
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = (2 * half) / SHADOW_MAP
  rig.add(hemi, sun, sun.target)
  return rig
}

/** Refit an existing sun's shadow box onto a new framed extent: the live camera moved, and the map
 *  has to follow or its texels are spent on circuit nobody is looking at. The sun's own BEARING is
 *  kept: this slides the box under the sky, it does not move the sun across it. */
export function refitShadow(sun: THREE.DirectionalLight, vb: ViewBox3D): void {
  const cx = vb.x + vb.w / 2
  const cz = vb.y + vb.h / 2
  const travel = sun.target.position.clone().sub(sun.position).normalize()
  const reach = Math.max(200, Math.max(vb.w, vb.h) * 2)
  sun.position.set(cx, 0, cz).addScaledVector(travel, -reach)
  sun.target.position.set(cx, 0, cz)
  const half = Math.max(vb.w, vb.h) / 2 + 60
  sun.shadow.camera.left = -half
  sun.shadow.camera.right = half
  sun.shadow.camera.top = half
  sun.shadow.camera.bottom = -half
  sun.shadow.camera.near = reach * 0.2
  sun.shadow.camera.far = reach * 2.2
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.normalBias = (2 * half) / SHADOW_MAP
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
