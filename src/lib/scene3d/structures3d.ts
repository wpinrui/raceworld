// Structures (#3d-port increment 2): buildings, grandstands, marshal huts and debris fencing, stood
// up for real from the same placements and heights the 2D leans obliquely. Baked shadows, wall
// shades and depth sorting have no counterpart here: the sun, the depth buffer and real normals do
// those jobs.

import * as THREE from 'three'
import {
  FENCE_H_M, MARSHAL_D_M, MARSHAL_H_M, MARSHAL_W_M, STOREY_M, WINDOW_BAY_M, partsOf,
} from '@/lib/ui/scenery-draw'
import type { Scenery, SceneryRect, SceneryStand } from '@/lib/ui/track-scenery'
import type { SceneryFence, SceneryMarshal } from '@/lib/ui/scenery-props'
import { ribbonGeometry } from './road3d'
import { GeometrySink, partsSolidGeometry, partsWindowsGeometry, v3, wallStripGeometry } from './solids3d'
import { ROUGH, type SceneMaterials } from './materials3d'
import { faceUV, type SurfaceDetail } from './detail3d'
import type { WorldTextures } from './textures3d'
import { buildGrandstand, standSpecFor, type SeatForm, type SeatLod } from './grandstand3d'
import type { StandSkin } from './standtex3d'

/** Glazing ink, from the 2D's window fill. */
const GLASS = '#0E1319'
const GLASS_ALPHA = 0.42
const HUT = '#3A4049'
const HUT_PANEL = '#E8952B'
const FENCE_FACE = '#AEB6C2'
const FENCE_STEEL = '#79808C'

/** A mesh placed the way a `DrawGroup` places its ops: geometry in the footprint's local frame,
 *  position and yaw on the object. Local (lx, ly) maps to world exactly as `toLocal`'s inverse. */
/** Grain a standing geometry, once. `placed` is called repeatedly with the SAME geometry (every
 *  marshal hut shares one), so the projection is idempotent by being keyed on the attribute already
 *  being there: doing it per placement would redo the same work for every copy. */
function grain(geo: THREE.BufferGeometry, detail: SurfaceDetail | null, u: (m: number) => number): void {
  if (detail && !geo.getAttribute('uv')) faceUV(geo, u(detail.tileM))
}

function placed(geo: THREE.BufferGeometry, mat: THREE.Material, at: { x: number; y: number; rot: number }): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(at.x, 0, at.y)
  mesh.rotation.y = -at.rot
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function buildBuildings3D(
  buildings: readonly SceneryRect[], u: (m: number) => number, materials: SceneMaterials,
  night = false, detail: SurfaceDetail | null = null,
): THREE.Group {
  const group = new THREE.Group()
  // At night the same glazing grid turns to warm lit windows: emissive, unlit-by-design, the one
  // thing a dark town supplies its own light for.
  const nightGlass = night ? new THREE.MeshBasicMaterial({
    color: '#E8C976', side: THREE.DoubleSide,
  }) : null
  // Over white, so a lit window spills a little the way a real one does through glass. Gentler than
  // the floodlights: this is a room behind a pane, not a lamp pointed at a circuit.
  nightGlass?.color.multiplyScalar(1.3)
  for (const b of buildings) {
    const parts = partsOf(b)
    const h = u((b.storeys ?? 1) * STOREY_M)
    const shell = partsSolidGeometry(parts, 0, h)
    grain(shell, detail, u)
    group.add(placed(shell, materials.get(b.fill, { roughness: ROUGH.matte, detail }), b))
    const windows = partsWindowsGeometry(
      parts, 0, h, u(WINDOW_BAY_M), Math.max(1, b.storeys ?? 1), u(0.12),
    )
    if (windows) {
      const glass = placed(windows, nightGlass ?? materials.get(GLASS, { alpha: GLASS_ALPHA }), b)
      glass.castShadow = false
      group.add(glass)
    }
  }
  return group
}

/** The circuit's grandstands, and the crowd in them.
 *
 *  Each stand is a `buildGrandstand` fitted to the footprint the scenery reserved, built in METRES in
 *  its own frame and then scaled into world units. Its trackside face sits at z = 0 with the rake
 *  climbing +z, so placing one is a matter of putting that face on the right edge of the footprint:
 *  `facing` says the trackside edge is local +y, which is the model turned about and slid forward,
 *  and its absence is the model as built slid back.
 *
 *  The crowd is built INSIDE each stand, by the same call the probe makes, and that is deliberate.
 *  Pooling every stand's spectators into one set of instanced draws is a big saving (32 draws for a
 *  circuit instead of 32 a stand) and I had it working, but it means transforming seat positions out
 *  of the stand's frame and scaling the pool back into it by hand, and that is a second place for the
 *  units to be got wrong. It is not worth having the crowd right in the probe and arguable in the
 *  game to save draw calls. If this needs winning back, the way is to make `buildCrowd` accept a
 *  parent transform rather than to unpick one here. */
export function buildStands3D(
  stands: readonly SceneryStand[], u: (m: number) => number,
  skin: StandSkin | null = null,
  seats: { form: SeatForm; lod: SeatLod } | null = { form: 'bucket', lod: 'auto' },
  crowdFill = 0.9,
): THREE.Group {
  const group = new THREE.Group()
  const mpu = 1 / u(1)
  const perMetre = u(1)
  stands.forEach((s, i) => {
    const spec = standSpecFor(s.w * mpu, s.h * mpu)
    // Placed exactly as every other structure here is: the footprint's local (x, y) is world (x, z),
    // and the yaw is negated because a scenery rotation turns the other way round the up axis.
    const holder = new THREE.Group()
    holder.position.set(s.x, 0, s.y)
    holder.rotation.y = -s.rot
    const stand = buildGrandstand(
      spec, seats, crowdFill > 0 ? { fill: crowdFill, seed: i + 1 } : null, skin,
    )
    stand.scale.setScalar(perMetre)
    if (s.facing) {
      stand.rotation.y = Math.PI
      stand.position.z = s.h / 2
    } else {
      stand.position.z = -s.h / 2
    }
    holder.add(stand)
    group.add(holder)
  })
  return group
}

export function buildMarshals3D(
  marshals: readonly SceneryMarshal[], u: (m: number) => number, materials: SceneMaterials,
  detail: SurfaceDetail | null = null,
): THREE.Group {
  const group = new THREE.Group()
  const w = u(MARSHAL_W_M)
  const d = u(MARSHAL_D_M)
  const h = u(MARSHAL_H_M)
  const hutGeo = partsSolidGeometry([{ dx: 0, dy: 0, w, h: d }], 0, h)
  grain(hutGeo, detail, u)
  const panel = new GeometrySink()
  // The observation panel: the orange strip the 2D lays along the roof's front edge.
  panel.quad(
    v3(-w / 2, h + 0.02, -d / 2), v3(w / 2, h + 0.02, -d / 2),
    v3(w / 2, h + 0.02, -d / 2 + u(1)), v3(-w / 2, h + 0.02, -d / 2 + u(1)),
  )
  const panelGeo = panel.build()
  for (const m of marshals) {
    group.add(placed(hutGeo, materials.get(HUT, { roughness: ROUGH.paint, detail }), m))
    const p = placed(panelGeo, materials.get(HUT_PANEL), m)
    p.castShadow = false
    group.add(p)
  }
  return group
}

/** Debris fencing: a see-through cage face with steel posts and a top rail. None of it casts: a
 *  translucent cage throwing the solid black shadow of a wall is worse than no shadow, and the 2D
 *  kept its fence shadows faint for the same reason. */
export function buildFences3D(
  fences: readonly SceneryFence[], u: (m: number) => number, materials: SceneMaterials,
): THREE.Group {
  const group = new THREE.Group()
  const h = u(FENCE_H_M)
  const postGeo = new THREE.CylinderGeometry(1, 1, 1, 4)
  const postMat = materials.get(FENCE_STEEL, { alpha: 0.5 })
  const posts: THREE.Vector3[] = []
  // Fencing composites AFTER the road's ink decals (which own the low renderOrders): a cage face
  // blended before the ink underneath it would be stamped over by the ink's later draw.
  const FENCE_ORDER = 1000
  for (const f of fences) {
    const face = new THREE.Mesh(wallStripGeometry(f.pts, 0, h), materials.get(FENCE_FACE, { alpha: 0.13 }))
    face.receiveShadow = true
    face.renderOrder = FENCE_ORDER
    group.add(face)
    const rail = new THREE.Mesh(
      ribbonGeometry(f.pts, { halfW: u(0.2), y: h }), materials.get(FENCE_STEEL, { alpha: 0.6 }),
    )
    rail.renderOrder = FENCE_ORDER
    group.add(rail)
    for (let i = 0; i < f.pts.length; i += 2) posts.push(new THREE.Vector3(f.pts[i].x, 0, f.pts[i].y))
  }
  if (posts.length > 0) {
    const mesh = new THREE.InstancedMesh(postGeo, postMat, posts.length)
    const m = new THREE.Matrix4()
    const rad = u(0.18)
    posts.forEach((p, i) => {
      m.makeScale(rad, h, rad).setPosition(p.x, h / 2, p.z)
      mesh.setMatrixAt(i, m)
    })
    mesh.renderOrder = FENCE_ORDER
    group.add(mesh)
  }
  return group
}

export function buildStructures3D(
  scenery: Pick<Scenery, 'buildings' | 'stands' | 'marshals' | 'fences'>,
  u: (m: number) => number, materials: SceneMaterials, textures?: WorldTextures, night = false,
  detail: SurfaceDetail | null = null, skin: StandSkin | null = null,
): THREE.Group {
  const group = new THREE.Group()
  group.add(buildBuildings3D(scenery.buildings, u, materials, night, detail))
  group.add(buildStands3D(scenery.stands, u, skin))
  group.add(buildMarshals3D(scenery.marshals, u, materials, detail))
  group.add(buildFences3D(scenery.fences, u, materials))
  return group
}
