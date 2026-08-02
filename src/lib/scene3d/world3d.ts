// The 3D world (#3d-port): composed from the same sources the 2D scene builds from — the densified
// trace, the pit lane's `fastPts`, the pit zone's rings, the scenery's placements — so both
// renderers describe one circuit while they coexist.
//
// The ground is a painter's stack: coplanar paint layers keep their 2D order as centimetre lifts,
// because that order is what the picture IS down there. Everything standing gets real height, and
// one sun with one sky replaces every baked shadow, wall shade and bevel the 2D carries.

import * as THREE from 'three'
import type { TrackLayout } from '@/data/tracks'
import type { PitSlot, PitZone } from '@/lib/ui/pit-zone'
import { shadowFill, type Lighting } from '@/lib/ui/lighting'
import {
  ROAD_CASING, ROAD_TARMAC, roadInkOver, roadInkUnder, type RoadOpts,
} from '@/lib/ui/road-ops'
import { MARK_WHITE, startLineRects, startPose } from '@/lib/ui/road-marks'
import type { Scenery } from '@/lib/ui/track-scenery'
import type { DrawOp } from '@/lib/ui/scenery-draw'
import {
  LANE_LINE_M, LANE_TARMAC_M, LANE_WIDTH_M, TARMAC_WIDTH_M, TRACK_WIDTH_M, densifyTrace,
} from '@/lib/ui/track-path'
import { parseViewBox, type ViewBox3D } from './camera3d'
import { probePoint } from './env3d'
import type { GroundExtent } from './sky3d'
import { localRectsGeometry, ribbonGeometry, ringGeometry } from './road3d'
import { DECAL_PULL, ROUGH, SceneMaterials } from './materials3d'
import { addGround3D, buildGroundStack3D } from './ground3d'
import { buildFarLand3D } from './farland3d'
import { buildKerbs3D } from './kerb3d'
import { buildLightRig } from './lighting3d'
import { buildStructures3D } from './structures3d'
import type { StandSkin } from './standtex3d'
import { buildTrees3D, type Trees3D } from './trees3d'
import type { TreePack } from './treepack3d'
import { buildNightLights3D } from './night3d'
import { buildOpsDecals } from './ops3d'
import { buildPitComplex3D, buildPitPaint3D } from './pit3d'
import type { WorldTextures } from './textures3d'
import { planarUV, type SurfaceDetail, type WorldDetail } from './detail3d'

/** Ground reach beyond the viewBox, in units: the same margin the 2D preview clears to the wash.
 *  Exported because it is where the world STOPS, and the fog has to have finished by then. */
export const GROUND_PAD = 4000

/** One painter's layer sits this far above the one below, in metres. MILLIMETRES, deliberately: the
 *  camera can lie nearly flat now, and a stack tall enough to read as height floats every car that
 *  has to clear it. Depth separation does not ride on these lifts: each opaque layer also carries a
 *  polygonOffset bias (materials3d), which holds at any buffer precision and any glancing angle. */
const LIFT_M = 0.002
const LAYER = {
  bands: 1, fields: 2, terrain: 3, runoffs: 4, floors: 5, inkUnder: 6,
  casing: 7, tarmac: 8, inkOver: 9, lanePaint: 10, kerbs: 11, marks: 12,
} as const

/** The stack's top, in metres: what anything RIDING the road (the cars) must clear. */
export const STACK_TOP_M = LIFT_M * LAYER.marks

/** How much of the standard 4% dielectric reflection the tarmac returns.
 *
 *  A quarter, where every other surface out here returns the whole thing. This is the fix for the
 *  road reading blue, and the number is worth its reasoning because the obvious levers all failed.
 *
 *  MEASURED on Britain, as the ratio of a surface's rendered blue-over-red to its authored
 *  blue-over-red in linear light. The grass came out at x1.62 and the white lines at x1.53: that is
 *  the cast of the light itself, which is mostly skylight, and everything standing under it carries
 *  it. The tarmac came out at x3.44, more than twice as far. Turning its specular off collapsed
 *  that to x1.31, i.e. the whole excess is one term: the reflection a dielectric returns whatever
 *  colour it is painted. It is the sky's colour, not the road's, and it was doing about four fifths
 *  of the road's brightness at a racing camera angle.
 *
 *  Roughness was tried first and made it WORSE (x3.98). The sharp lobe was reflecting the horizon,
 *  which is tarmac and grass and pit wall; blurring it out swapped that for the open sky above.
 *  Warming `ROAD_TARMAC` cannot fix it either, because the sky term is added rather than multiplied:
 *  no albedo, not even a pure red one, gets past the floor it sets.
 *
 *  So the road returns less of it, and `ROAD_TARMAC` was lightened to carry the surface on its own
 *  diffuse instead. A quarter rather than none: asphalt is porous and sooty and a poor mirror, but
 *  it is not a void, and at zero the road loses the sun's own sheen along with the sky's. */
const TARMAC_SPECULAR = 0.25

export interface World3DInput {
  layout: TrackLayout
  scenery: Scenery
  pitZone: PitZone | null
  pitSlots: PitSlot[]
  /** The solved racing line, once there is one; before that the tarmac carries no ink, exactly as
   *  the 2D draws its first frame. */
  lap: RoadOpts['lap']
  lighting: Lighting
  /** Tile textures, browser-built; absent (in tests) the patterned surfaces fall back to flat. */
  textures?: WorldTextures
  /** Generated surface grain, browser-built; absent, every surface stays smooth. */
  detail?: WorldDetail
  /** The extent actually in shot, for fitting the sun's shadow map. Defaults to the whole viewBox,
   *  which is only the right answer for a whole-circuit framing. */
  frame?: ViewBox3D
  /** Extra road paint over everything on the ground: the live view's grid boxes. */
  overlay?: DrawOp[]
  /** A team's colour on its own garage floor and lintel, as the 2D pit complex wears it. */
  garageColors?: (i: number) => string | undefined
  /** Browser-side pieces mounted with the world (the garage boards), BUILT PER CALL. A prebuilt
   *  shared instance is a StrictMode trap: dev double-invokes the memoised build and keeps the
   *  FIRST world, but `add()` re-parents a shared object into the SECOND, discarded one, and the
   *  boards silently leave the scene. A builder gives every invocation its own copy. */
  extras?: () => THREE.Object3D[]
  /** Night dressing: floodlight towers with their pooled light, and the town's windows lit. */
  night?: boolean
  /** The imported tree pack, browser-loaded; absent (in tests, and before the download lands) the
   *  trees fall back to the old spheres so the world is never bare. */
  treePack?: TreePack | null
  /** Scanned surfaces for the grandstands, browser-loaded; absent (in tests, and until the maps
   *  decode) they render in their authored flat colours, which is a whole stand either way. */
  standSkin?: StandSkin | null
}

export interface World3D {
  group: THREE.Group
  /** The rig's one shadow-casting sun, held out so a live camera can refit its map per move. */
  sun: THREE.DirectionalLight
  /** The rig's hemisphere, held out so a mounted environment map can turn it down. The two are the
   *  SAME quantity by two routes (sky light arriving on a surface), and running both at full is a
   *  straight double count that flattens every shadow. */
  sky: THREE.HemisphereLight
  /** The wood, held out so a moving camera can repack its detail tiers. `THREE.LOD` cannot compose
   *  with instancing, so the ladder is driven by hand from wherever the shadow map is refitted. */
  trees: Trees3D
  /** Where this world's ground plane actually stops. The ONE answer, because two things have to
   *  finish before that edge (the haze and the reflection bake) and three places used to work it
   *  out for themselves off whichever viewBox they happened to be holding. */
  ground: GroundExtent
  /** Where a reflection probe stands in this world: a couple of metres over a plain stretch of the
   *  lap, which is what a car flank spends its race actually reflecting. */
  probe: THREE.Vector3
  /** What this scene costs, for the probe's console line. */
  stats: { meshes: number; triangles: number }
}

export function buildWorld3D(
  { layout, scenery, pitZone, pitSlots, lap, lighting, textures, detail, frame, overlay, garageColors, extras, night, treePack, standSkin }: World3DInput,
): World3D {
  const u = (m: number) => m / layout.metresPerUnit
  const lift = (layer: number) => u(LIFT_M) * layer
  const group = new THREE.Group()
  const materials = new SceneMaterials()
  // Flat layers receive shadow and never cast: they ARE the ground. Each carries its painter layer
  // as a depth bias, so millimetre lifts never fight.
  //
  // `grain` picks which generated detail the surface wears, and projects the UVs it needs down the
  // Y axis. Projected in WORLD space, so the road and the grass it runs through share one continuous
  // grain and their join carries no seam.
  const add = (
    geometry: THREE.BufferGeometry, colour: string, layer = 0,
    grain: SurfaceDetail | null = detail?.ground ?? null, roughness: number = ROUGH.chalk,
    specular = 1,
  ) => {
    if (grain) planarUV(geometry, u(grain.tileM))
    const mesh = new THREE.Mesh(
      geometry, materials.get(colour, { layer, roughness, detail: grain, specular }),
    )
    mesh.receiveShadow = true
    group.add(mesh)
  }

  const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)
  const ground = new THREE.PlaneGeometry(vw + 2 * GROUND_PAD, vh + 2 * GROUND_PAD)
  ground.rotateX(-Math.PI / 2)
  ground.translate(vx + vw / 2, 0, vy + vh / 2)
  addGround3D(group, ground, {
    skin: standSkin ?? null, biome: layout.biome, u, fallback: () => add(ground, scenery.base),
  })

  // Hills and wood past everything built. The plane above runs kilometres out and everything that
  // stands on it is scattered inside the viewBox plus 260 m, so from a low camera looking up the
  // road the far half of the world is empty and ends in a dead-straight line under the haze. This
  // puts a landform in front of that line. It stays entirely outside the built world, so nothing
  // below this point has to know it is there.
  const farLand = buildFarLand3D({
    view: { x: vx, y: vy, w: vw, h: vh },
    pad: GROUND_PAD,
    metresPerUnit: layout.metresPerUnit,
    circuitId: layout.circuitId,
    biome: layout.biome,
    skin: standSkin ?? null,
    base: scenery.base,
  })
  group.add(farLand.group)

  group.add(buildGroundStack3D(scenery, pitZone, u, materials, lift, LAYER, garageColors, detail?.ground ?? null))

  // The ink, compiled from the same ops the 2D strokes: the edge fades under the road, the driven-in
  // surface over it, each stack at one lift with renderOrder carrying the painter.
  const roadOpts: RoadOpts = {
    layout, u, pitZone, pitSlots, lap, ground: scenery.base, shadow: shadowFill(lighting),
  }
  // The ink IS the road, so it takes the road's grain and the road's finish alike.
  const inkSurface = {
    detail: detail?.tarmac ?? null,
    metresPerUnit: layout.metresPerUnit,
    specular: TARMAC_SPECULAR,
  }
  const under = buildOpsDecals(
    roadInkUnder(roadOpts),
    { y: lift(LAYER.inkUnder), order: 1, bias: LAYER.inkUnder, ...inkSurface },
    materials,
  )
  group.add(under.group)
  const over = buildOpsDecals(
    roadInkOver(roadOpts),
    { y: lift(LAYER.inkOver), order: under.nextOrder, bias: LAYER.inkOver, ...inkSurface },
    materials,
  )
  group.add(over.group)

  // The roads, layer-major exactly as `roadOps` strokes them: every white casing goes down before
  // any dark tarmac, across the circuit, the lane and the apron alike.
  const circuit = densifyTrace(layout.trace, 6).map(([x, y]) => ({ x, y }))
  const lane = layout.pit.fastPts
  for (const [colour, layer, trackW, laneW] of [
    [ROAD_CASING, LAYER.casing, TRACK_WIDTH_M, LANE_WIDTH_M],
    [ROAD_TARMAC, LAYER.tarmac, TARMAC_WIDTH_M, LANE_TARMAC_M],
  ] as const) {
    // The tarmac wears the aggregate grain, at `matte` rather than `chalk`: it is the one big
    // surface out here that returns a coherent sheen, and the roughness map breaks that sheen up
    // across the ribbon instead of sliding it along as one sheet. What it does NOT do is return the
    // sky at full dielectric strength, which is what had it rendering blue (`TARMAC_SPECULAR`).
    //
    // The CASING is the boundary line, so it wears the paint grain and a full specular instead.
    // Handing it the road's maps mottled it from a fifth brightness to full and corrugated it with
    // chippings, which is a strip of aggregate where the circuit's edge is supposed to be; and paint
    // really is the smooth sealed surface the road around it is not.
    const isPaint = colour === ROAD_CASING
    const road = (isPaint ? detail?.paint : detail?.tarmac) ?? null
    const spec = isPaint ? 1 : TARMAC_SPECULAR
    add(ribbonGeometry(circuit, { halfW: u(trackW / 2), y: lift(layer), closed: true }), colour, layer, road, ROUGH.matte, spec)
    add(ribbonGeometry(lane, { halfW: u(laneW / 2), y: lift(layer), roundCaps: true }), colour, layer, road, ROUGH.matte, spec)
    if (pitZone) {
      add(ringGeometry(pitZone.work, lift(layer)), colour, layer, road, ROUGH.matte, spec)
      // The apron carries the same white edge line: a stroke round the ring in 2D, a ribbon here.
      if (isPaint) {
        add(ribbonGeometry(pitZone.work, { halfW: u(LANE_LINE_M), y: lift(layer), closed: true }), colour, layer, road, ROUGH.matte, spec)
      }
    }
  }
  if (pitZone) group.add(buildPitPaint3D(pitZone, u, lift(LAYER.lanePaint), materials, LAYER.lanePaint))

  // Kerbs, the one thing on this ground that is not paint: lofted solids standing on the road
  // surface, red and white blocks alike, wearing their own corrugation (kerb3d).
  group.add(buildKerbs3D(
    scenery.kerbs, u, { base: lift(LAYER.kerbs), layer: LAYER.kerbs }, materials, detail?.kerb ?? null,
  ))

  // The start line is paint on the road, so it takes the road's paint grain. `add` defaults to the
  // GROUND's, which had the grid's white blocks wearing grass clump at a nine metre tile.
  add(localRectsGeometry(
    startPose(layout.start, layout.metresPerUnit), startLineRects(u), lift(LAYER.marks),
  ), MARK_WHITE, LAYER.marks, detail?.paint ?? null, ROUGH.matte)
  if (overlay && overlay.length > 0) {
    group.add(buildOpsDecals(
      overlay, { y: lift(LAYER.marks), order: over.nextOrder, bias: DECAL_PULL }, materials,
    ).group)
  }

  // The standing world, and the light it all agrees under.
  const trees = buildTrees3D(scenery.trees, u, {
    pack: treePack, metresPerUnit: layout.metresPerUnit, far: farLand.trees,
  })
  group.add(trees.group)
  group.add(buildStructures3D(
    scenery, u, materials, textures, night, detail?.wall ?? null, standSkin ?? null,
  ))
  if (pitZone) group.add(buildPitComplex3D(pitZone, u, materials, garageColors))
  if (night) group.add(buildNightLights3D(layout, textures?.glowPool ?? null))
  for (const extra of extras?.() ?? []) group.add(extra)
  const rig = buildLightRig(lighting, frame ?? parseViewBox(layout.viewBox), {
    unitsPerMetre: 1 / layout.metresPerUnit,
  })
  group.add(rig)
  const sun = rig.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight)!
  const sky = rig.children.find((o): o is THREE.HemisphereLight => o instanceof THREE.HemisphereLight)!

  let meshes = 0
  let triangles = 0
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes++
      const g = o.geometry as THREE.BufferGeometry
      const per = (g.index ? g.index.count : g.attributes.position.count) / 3
      triangles += o instanceof THREE.InstancedMesh ? per * o.count : per
    }
  })
  return {
    group,
    sun,
    sky,
    trees,
    // The plane laid down at the top of this function, described: its centre, and the nearest
    // distance at which it can stop. Inscribed rather than circumscribed, so no bearing runs off it.
    ground: {
      x: vx + vw / 2,
      z: vy + vh / 2,
      radius: Math.min(vw, vh) / 2 + GROUND_PAD,
      metresPerUnit: layout.metresPerUnit,
    },
    // Off the densified centreline built above, so the probe stands on the road rather than at
    // whatever the raw trace's nearest sample happened to be.
    probe: probePoint(circuit, layout.metresPerUnit),
    stats: { meshes, triangles: Math.round(triangles) },
  }
}
