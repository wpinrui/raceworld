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
import { KERB_BLOCK_M, KERB_RED, KERB_WHITE, KERB_WIDTH_M, type Scenery } from '@/lib/ui/track-scenery'
import type { DrawOp } from '@/lib/ui/scenery-draw'
import {
  LANE_LINE_M, LANE_TARMAC_M, LANE_WIDTH_M, TARMAC_WIDTH_M, TRACK_WIDTH_M, densifyOpen, densifyTrace,
} from '@/lib/ui/track-path'
import { parseViewBox, type ViewBox3D } from './camera3d'
import { dashGeometry, localRectsGeometry, ribbonGeometry, ringGeometry } from './road3d'
import { SceneMaterials } from './materials3d'
import { buildGroundStack3D } from './ground3d'
import { buildLightRig } from './lighting3d'
import { buildStructures3D } from './structures3d'
import { buildTrees3D } from './trees3d'
import { buildOpsDecals } from './ops3d'
import { buildPitComplex3D, buildPitPaint3D } from './pit3d'
import type { WorldTextures } from './textures3d'

/** Ground reach beyond the viewBox, in units: the same margin the 2D preview clears to the wash. */
const GROUND_PAD = 4000

/** One painter's layer sits this far above the one below, in metres. MILLIMETRES, deliberately: the
 *  camera can lie nearly flat now, and a stack tall enough to read as height floats every car that
 *  has to clear it. Depth separation does not ride on these lifts: each opaque layer also carries a
 *  polygonOffset bias (materials3d), which holds at any buffer precision and any glancing angle. */
const LIFT_M = 0.002
const LAYER = {
  bands: 1, fields: 2, terrain: 3, runoffs: 4, floors: 5, inkUnder: 6,
  casing: 7, tarmac: 8, inkOver: 9, lanePaint: 10, kerbWhite: 11, kerbRed: 12, marks: 13,
} as const

/** The stack's top, in metres: what anything RIDING the road (the cars) must clear. */
export const STACK_TOP_M = LIFT_M * LAYER.marks

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
  /** The extent actually in shot, for fitting the sun's shadow map. Defaults to the whole viewBox,
   *  which is only the right answer for a whole-circuit framing. */
  frame?: ViewBox3D
  /** Extra road paint over everything on the ground: the live view's grid boxes. */
  overlay?: DrawOp[]
  /** A team's colour on its own garage floor and lintel, as the 2D pit complex wears it. */
  garageColors?: (i: number) => string | undefined
  /** Prebuilt browser-side pieces mounted with the world: the garage boards. */
  extras?: THREE.Object3D[]
}

export interface World3D {
  group: THREE.Group
  /** The rig's one shadow-casting sun, held out so a live camera can refit its map per move. */
  sun: THREE.DirectionalLight
  /** What this scene costs, for the probe's console line. */
  stats: { meshes: number; triangles: number }
}

export function buildWorld3D(
  { layout, scenery, pitZone, pitSlots, lap, lighting, textures, frame, overlay, garageColors, extras }: World3DInput,
): World3D {
  const u = (m: number) => m / layout.metresPerUnit
  const lift = (layer: number) => u(LIFT_M) * layer
  const group = new THREE.Group()
  const materials = new SceneMaterials()
  // Flat layers receive shadow and never cast: they ARE the ground. Each carries its painter layer
  // as a depth bias, so millimetre lifts never fight.
  const add = (geometry: THREE.BufferGeometry, colour: string, layer = 0) => {
    const mesh = new THREE.Mesh(geometry, materials.get(colour, 1, false, layer))
    mesh.receiveShadow = true
    group.add(mesh)
  }

  const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)
  const ground = new THREE.PlaneGeometry(vw + 2 * GROUND_PAD, vh + 2 * GROUND_PAD)
  ground.rotateX(-Math.PI / 2)
  ground.translate(vx + vw / 2, 0, vy + vh / 2)
  add(ground, scenery.base)

  group.add(buildGroundStack3D(scenery, pitZone, u, materials, lift, LAYER, garageColors))

  // The ink, compiled from the same ops the 2D strokes: the edge fades under the road, the driven-in
  // surface over it, each stack at one lift with renderOrder carrying the painter.
  const roadOpts: RoadOpts = {
    layout, u, pitZone, pitSlots, lap, ground: scenery.base, shadow: shadowFill(lighting),
  }
  const under = buildOpsDecals(roadInkUnder(roadOpts), { y: lift(LAYER.inkUnder), order: 1 }, materials)
  group.add(under.group)
  const over = buildOpsDecals(roadInkOver(roadOpts), { y: lift(LAYER.inkOver), order: under.nextOrder }, materials)
  group.add(over.group)

  // The roads, layer-major exactly as `roadOps` strokes them: every white casing goes down before
  // any dark tarmac, across the circuit, the lane and the apron alike.
  const circuit = densifyTrace(layout.trace, 6).map(([x, y]) => ({ x, y }))
  const lane = layout.pit.fastPts
  for (const [colour, layer, trackW, laneW] of [
    [ROAD_CASING, LAYER.casing, TRACK_WIDTH_M, LANE_WIDTH_M],
    [ROAD_TARMAC, LAYER.tarmac, TARMAC_WIDTH_M, LANE_TARMAC_M],
  ] as const) {
    add(ribbonGeometry(circuit, { halfW: u(trackW / 2), y: lift(layer), closed: true }), colour, layer)
    add(ribbonGeometry(lane, { halfW: u(laneW / 2), y: lift(layer), roundCaps: true }), colour, layer)
    if (pitZone) {
      add(ringGeometry(pitZone.work, lift(layer)), colour, layer)
      // The apron carries the same white edge line: a stroke round the ring in 2D, a ribbon here.
      if (colour === ROAD_CASING) {
        add(ribbonGeometry(pitZone.work, { halfW: u(LANE_LINE_M), y: lift(layer), closed: true }), colour, layer)
      }
    }
  }
  if (pitZone) group.add(buildPitPaint3D(pitZone, u, lift(LAYER.lanePaint), materials, LAYER.lanePaint))

  // Kerbs: the white base under the red blocks, sampled off the same smoothed curve the 2D strokes.
  for (const kerb of scenery.kerbs) {
    const pts = densifyOpen(kerb.pts)
    add(ribbonGeometry(pts, { halfW: u(KERB_WIDTH_M / 2), y: lift(LAYER.kerbWhite), roundCaps: true }), KERB_WHITE, LAYER.kerbWhite)
    add(dashGeometry(pts, {
      halfW: u(KERB_WIDTH_M / 2), y: lift(LAYER.kerbRed), on: u(KERB_BLOCK_M), off: u(KERB_BLOCK_M),
    }), KERB_RED, LAYER.kerbRed)
  }

  add(localRectsGeometry(
    startPose(layout.start, layout.metresPerUnit), startLineRects(u), lift(LAYER.marks),
  ), MARK_WHITE, LAYER.marks)
  if (overlay && overlay.length > 0) {
    group.add(buildOpsDecals(overlay, { y: lift(LAYER.marks), order: over.nextOrder }, materials).group)
  }

  // The standing world, and the light it all agrees under.
  group.add(buildTrees3D(scenery.trees, u))
  group.add(buildStructures3D(scenery, u, materials, textures))
  if (pitZone) group.add(buildPitComplex3D(pitZone, u, materials, garageColors))
  for (const extra of extras ?? []) group.add(extra)
  const rig = buildLightRig(lighting, frame ?? parseViewBox(layout.viewBox))
  group.add(rig)
  const sun = rig.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight)!

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
  return { group, sun, stats: { meshes, triangles: Math.round(triangles) } }
}
