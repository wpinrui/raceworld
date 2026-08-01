// Structures (#3d-port increment 2): buildings, grandstands, marshal huts and debris fencing, stood
// up for real from the same placements and heights the 2D leans obliquely. Baked shadows, wall
// shades and depth sorting have no counterpart here: the sun, the depth buffer and real normals do
// those jobs.

import * as THREE from 'three'
import {
  FENCE_H_M, MARSHAL_D_M, MARSHAL_H_M, MARSHAL_W_M, STAND_FRONT_M, STAND_REAR_M, STAND_ROOF_FRAC,
  STOREY_M, WINDOW_BAY_M, partsOf,
} from '@/lib/ui/scenery-draw'
import type { Scenery, SceneryRect, SceneryStand } from '@/lib/ui/track-scenery'
import type { SceneryFence, SceneryMarshal } from '@/lib/ui/scenery-props'
import { ribbonGeometry } from './road3d'
import { GeometrySink, partsSolidGeometry, partsWindowsGeometry, v3, wallStripGeometry } from './solids3d'
import { ROUGH, surface, type SceneMaterials } from './materials3d'
import { faceUV, type SurfaceDetail } from './detail3d'
import type { WorldTextures } from './textures3d'

/** Glazing ink, from the 2D's window fill. */
const GLASS = '#0E1319'
const GLASS_ALPHA = 0.42
/** The flat blend of the 2D's seat tile: base rows with a lighter seat band. */
const DECK = '#474E5C'
const ROOF = '#7B8494'
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
  const nightGlass = night
    ? new THREE.MeshBasicMaterial({ color: '#E8C976', side: THREE.DoubleSide })
    : null
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

/** The seating deck as one sloped quad with UVs in METRES, so the seat and crowd tiles repeat at
 *  their authored sizes whatever the stand's dimensions. */
function deckGeometry(
  x0: number, x1: number, zF: number, zR: number, hF: number, hR: number, mpu: number,
): THREE.BufferGeometry {
  const wM = (x1 - x0) * mpu
  const dM = Math.hypot(zR - zF, hR - hF) * mpu
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, hF, zF, x1, hF, zF, x1, hR, zR,
    x0, hF, zF, x1, hR, zR, x0, hR, zR,
  ], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, wM, 0, wM, dM,
    0, 0, wM, dM, 0, dM,
  ], 2))
  g.computeVertexNormals()
  return g
}

/** A grandstand raked like real seating: low front wall trackside, tall rear, a sloped deck between,
 *  and a canopy over the rear rows. The deck's own tilt is what the 2D's rake gradient faked; the
 *  seat rows and the crowd are the same tiles the 2D patterns with, when a document is on hand. */
export function buildStands3D(
  stands: readonly SceneryStand[], u: (m: number) => number, materials: SceneMaterials,
  textures?: WorldTextures, detail: SurfaceDetail | null = null,
): THREE.Group {
  const group = new THREE.Group()
  const hF = u(STAND_FRONT_M)
  const hR = u(STAND_REAR_M)
  const mpu = 1 / u(1)
  const seatsMat = textures?.seats
    ? surface('#FFFFFF', { map: textures.seats, roughness: ROUGH.paint })
    : materials.get(DECK)
  const crowdMat = textures?.crowd
    ? surface('#FFFFFF', { map: textures.crowd, alpha: 1, decal: true, roughness: ROUGH.chalk })
    : null
  for (const s of stands) {
    const zF = s.facing ? s.h / 2 : -s.h / 2
    const zR = -zF
    const x0 = -s.w / 2
    const x1 = s.w / 2
    const hull = new GeometrySink()
    // Front wall, rear wall, and the two raked side trapezoids.
    hull.quad(v3(x0, 0, zF), v3(x1, 0, zF), v3(x1, hF, zF), v3(x0, hF, zF))
    hull.quad(v3(x0, 0, zR), v3(x1, 0, zR), v3(x1, hR, zR), v3(x0, hR, zR))
    for (const x of [x0, x1]) {
      hull.quad(v3(x, 0, zF), v3(x, 0, zR), v3(x, hR, zR), v3(x, hF, zF))
    }
    const hullGeo = hull.build()
    grain(hullGeo, detail, u)
    group.add(placed(hullGeo, materials.get(s.fill, { roughness: ROUGH.paint, detail }), s))

    const deck = deckGeometry(x0, x1, zF, zR, hF, hR, mpu)
    group.add(placed(deck, seatsMat, s))
    if (crowdMat) {
      const crowd = placed(deck, crowdMat, s)
      crowd.castShadow = false
      group.add(crowd)
    }

    // The canopy floats over the rear rows on the deck's own slope, a parasol rather than a box.
    const roof = new GeometrySink()
    const lift = u(0.9)
    const zEdge = zR + (zF - zR) * STAND_ROOF_FRAC
    const hEdge = hR + (hF - hR) * STAND_ROOF_FRAC
    roof.quad(
      v3(x0, hR + lift, zR), v3(x1, hR + lift, zR),
      v3(x1, hEdge + lift, zEdge), v3(x0, hEdge + lift, zEdge),
    )
    const roofGeo = roof.build()
    grain(roofGeo, detail, u)
    group.add(placed(roofGeo, materials.get(ROOF, { roughness: ROUGH.paint, detail }), s))
  }
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
  detail: SurfaceDetail | null = null,
): THREE.Group {
  const group = new THREE.Group()
  group.add(buildBuildings3D(scenery.buildings, u, materials, night, detail))
  group.add(buildStands3D(scenery.stands, u, materials, textures, detail))
  group.add(buildMarshals3D(scenery.marshals, u, materials, detail))
  group.add(buildFences3D(scenery.fences, u, materials))
  return group
}
