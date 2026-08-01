// The WORLD in the reflections (#photoreal). `buildSky` bakes the sky into an environment map, and a
// sky-only environment is most of why car paint reads as vinyl: on television a race car's flanks are
// almost entirely horizon, i.e. tarmac, pit wall, grandstand and trees, with open sky across nothing
// but the top surfaces. Reflecting a blank gradient at every angle is the look of a decal.
//
// So the built world goes into a second cube, shot from a point a couple of metres over a plain
// stretch of the lap, and THAT is what gets prefiltered into `scene.environment`. Static, exactly
// the way a PS3-era racer's reflection probe was static: one render per circuit build, nothing per
// frame, and every metal and gloss surface in the scene sharpens up for it, the wheel rims included.
//
// The bake is a photograph of the scene as it will ship, not a separate lighting model: the sky is
// still mounted while it runs, so the world in the cube is lit by the sky it is standing under. That
// is one bounce, which is one more than there was.

import * as THREE from 'three'
import { FOG_CLEAR_M, FOG_NEAR_CAP, type GroundExtent } from './sky3d'

/** How high the probe stands over the road, in metres. Roughly a car's own height: what a flank
 *  reflects is the world seen from a flank, and a probe up at camera height would put the reflected
 *  horizon under the car instead of through it. */
export const PROBE_HEIGHT_M = 2

/** Resolution of the world cube. A QUARTER of the sky's 512, and it can be, for two reasons: the
 *  prefilter blurs everything past the sharpest lobe in the scene anyway, and this cube costs six
 *  full renders of the circuit where the sky's costs six renders of one shader. What a car flank
 *  needs off it is a horizon BAND in the right colours, not a legible photograph. */
const CUBE_SIZE = 256

/** The cube's near plane, in metres. Well under the probe's own height, or the road directly
 *  beneath it clips away and the lower hemisphere reflects a hole. */
const NEAR_M = 0.25

/** How far past the ground's own edge the far plane sits: the haze finishes at the edge, so this
 *  only has to be past it, never tight to it. */
const FAR_SLACK = 1.5

/** A baked world, ready to mount as `scene.environment`. */
export interface WorldEnv {
  /** The prefiltered cube: a roughness-mipped map every standard material reads its ambient and its
   *  reflections out of. */
  environment: THREE.Texture
  /** What `scene.environmentIntensity` must be for it, which is 1 and not the sky's own scale.
   *
   *  A sky bake holds RAW Preetham radiance (single digits to tens), so it is mounted at a fraction
   *  of a unit; this bake holds the scene's FINAL linear radiance, because the sky's own
   *  `backgroundIntensity` is already in the pixels and the world in front of it is lit at the
   *  rig's calibration. three skips tone mapping when the destination is a render target, so what
   *  lands in the cube is the linear light itself and nothing has to be undone.
   *
   *  It DOES deliver less light than the sky bake did, and the numbers are worth writing down.
   *  MEASURED on Britain at racing zoom, mean linear radiance, mounting one environment against the
   *  other on the same frame:
   *
   *      whole frame          -15%
   *      up-facing tarmac     -13%
   *      up-facing grass      -26%     (ambient alone, sun off: -33%)
   *
   *  An up-facing surface should barely have moved, since the upper hemisphere is still the same
   *  sky. It moved because three's prefiltered irradiance lobe is far broader than a cosine
   *  hemisphere and mixes the lower half in, and the SKY cube's lower half was bright: Preetham
   *  renders everything below the horizon at the horizon's own colour, so the old environment was
   *  quietly lighting the world off a ground made of sky. The new one has the actual ground down
   *  there. Left uncorrected on purpose: scaling this past 1 would restore the ambient by making
   *  every reflection brighter than the thing it reflects, and handing the shortfall back to the
   *  rig's hemisphere (`AMBIENT_KEPT_WITH_ENV`) would put back exactly the flat unoccluded ambient
   *  the probe was baked to replace. The scene is a little contrastier, which is the correct
   *  direction, and how deep shadows should sit is a look decision rather than an arithmetic one. */
  intensity: number
  /** Free the bake, under the same ownership contract `SkyEnv.dispose` carries: only while the
   *  renderer that made it is still alive. */
  dispose(): void
}

export interface WorldEnvInput {
  /** Where the probe stands, in world units. `probePoint` picks it off the lap. */
  at: THREE.Vector3
  /** The ground plane, so the bake's haze finishes before the world's edge shows in it. */
  ground: GroundExtent
  /** Movers kept OUT of the bake. The cars and the pit crew are posed for one instant, and a static
   *  probe would burn that instant into every reflection for the rest of the race. */
  hide?: Array<THREE.Object3D | null | undefined>
}

/** How far round the lap the probe stands, as a fraction of its length.
 *
 *  NOT the S/F line, which was the obvious place and the wrong one. Everything singular about a
 *  circuit is parked there: the chequered start line, the grid boxes, the pit wall. Bake from there
 *  and every car wears the chequer down its flank for the whole race, which is a thing that is
 *  actually true for about a second a lap. A third of the way round is ordinary track on any
 *  layout, which is what a flank should be reflecting: tarmac, its edge lines, kerb, grass and
 *  trees, with the sky over the top. It clears the pit lane at both ends too, since that runs from
 *  roughly 0.93 round to 0.07. */
const PROBE_LAP = 0.35

/** Where the probe stands for a circuit, in world units: on the track's own centreline a third of
 *  the way round, `PROBE_HEIGHT_M` up. `lap` is the centreline as a closed polyline in world units
 *  (x, y), walked by ARC LENGTH rather than by index, because a trace's samples are not evenly
 *  spaced and counting them lands somewhere different on every circuit. */
export function probePoint(
  lap: ReadonlyArray<{ x: number; y: number }>, metresPerUnit: number,
): THREE.Vector3 {
  const y = PROBE_HEIGHT_M / metresPerUnit
  if (lap.length === 0) return new THREE.Vector3(0, y, 0)
  let total = 0
  for (let i = 0; i < lap.length; i++) {
    const a = lap[i]
    const b = lap[(i + 1) % lap.length]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  let walked = 0
  const want = total * PROBE_LAP
  for (let i = 0; i < lap.length; i++) {
    const a = lap[i]
    const b = lap[(i + 1) % lap.length]
    const step = Math.hypot(b.x - a.x, b.y - a.y)
    if (walked + step >= want && step > 0) {
      const t = (want - walked) / step
      return new THREE.Vector3(a.x + (b.x - a.x) * t, y, a.y + (b.y - a.y) * t)
    }
    walked += step
  }
  return new THREE.Vector3(lap[0].x, y, lap[0].y)
}

/** Shoot the scene into a cube from `at` and prefilter it. Browser-only (it renders), and called
 *  once per circuit build and once per mood change, never per frame.
 *
 *  Returns null rather than throwing on any failure: the caller then keeps the sky env it already
 *  mounted, which is what this world shipped with and still a perfectly good thing for a rim to
 *  reflect. Losing the reflections is not worth losing the race over. */
export function bakeWorldEnv(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, { at, ground, hide = [] }: WorldEnvInput,
): WorldEnv | null {
  // From where the probe STANDS, not from the middle of the map: the nearest edge of the ground is
  // its inscribed reach less however far off centre the start straight happens to sit.
  const reach = Math.max(1, ground.radius - Math.hypot(at.x - ground.x, at.z - ground.z))
  // Only what is on now, so restoring cannot switch something back on that was already hidden.
  const hidden = hide.filter((o): o is THREE.Object3D => !!o && o.visible)
  // The haze is fitted to the live CAMERA, which is hundreds of units up and pointed down; from a
  // probe standing on the road it would be the wrong ramp entirely, and between paints it is still
  // on its placeholder span, which renders the whole cube as one flat wash of fog colour. Refitted
  // to the probe for the bake and put straight back: the day's own visibility, then the edge.
  const fog = scene.fog instanceof THREE.Fog ? scene.fog : null
  const span = fog ? { near: fog.near, far: fog.far } : null
  const previous = renderer.getRenderTarget()
  const target = new THREE.WebGLCubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType })
  let pmrem: THREE.PMREMGenerator | null = null
  let irradiance: THREE.WebGLRenderTarget | null = null
  try {
    for (const o of hidden) o.visible = false
    if (fog) {
      fog.far = reach
      fog.near = Math.min(FOG_CLEAR_M / ground.metresPerUnit, reach * FOG_NEAR_CAP)
    }
    const camera = new THREE.CubeCamera(NEAR_M / ground.metresPerUnit, reach * FAR_SLACK, target)
    camera.position.copy(at)
    camera.update(renderer, scene)
    pmrem = new THREE.PMREMGenerator(renderer)
    irradiance = pmrem.fromCubemap(target.texture)
    const map = irradiance
    return { environment: map.texture, intensity: 1, dispose: () => map.dispose() }
  } catch (err) {
    irradiance?.dispose()
    console.warn(`world environment bake failed, reflecting the sky alone: ${String(err)}`)
    return null
  } finally {
    pmrem?.dispose()
    // The raw cube is an INTERMEDIATE: the prefilter copied it into its own target, and nothing
    // downstream reads it. Unlike the sky's cube, which stays mounted as the background.
    target.dispose()
    if (fog && span) {
      fog.near = span.near
      fog.far = span.far
    }
    for (const o of hidden) o.visible = true
    renderer.setRenderTarget(previous)
  }
}
