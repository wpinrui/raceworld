// The ground stack (#3d-port increment 2): relief bands, the field quilt, terrain patches, run-off
// aprons, lakes and the garage floors, as flat fills at painter lifts — the same order `groundOps`
// paints them in. The organic shapes arrive as path strings and are sampled back to polygons here.

import * as THREE from 'three'
import type { PitZone } from '@/lib/ui/pit-zone'
import type { Scenery } from '@/lib/ui/track-scenery'
import { SOFT_BAND_ALPHA } from '@/lib/ui/terrain-field'
import { ringsToPolys, samplePathRings } from './paths3d'
import { GeometrySink, addPolyCap } from './solids3d'
import type { SceneMaterials } from './materials3d'

/** Hedgerow width, matching the 2D's stroke. */
const HEDGEROW_HALF_M = 1.1
const HEDGE = '#1F3318'

/** A path string as flat fills at a height, honouring the even-odd nesting the bands use. */
export function pathFillGeometry(d: string, y: number): THREE.BufferGeometry | null {
  const rings = samplePathRings(d)
  if (rings.length === 0) return null
  const s = new GeometrySink()
  for (const poly of ringsToPolys(rings)) addPolyCap(s, poly.contour, poly.holes, y)
  return s.empty ? null : s.build()
}

/** A closed outline stroked flat: the hedgerow round a field parcel. */
function ringStrokeGeometry(d: string, halfW: number, y: number): THREE.BufferGeometry | null {
  const rings = samplePathRings(d)
  if (rings.length === 0) return null
  const s = new GeometrySink()
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]
      const q = ring[(i + 1) % ring.length]
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
      const nx = (-(q.y - p.y) / len) * halfW
      const nz = ((q.x - p.x) / len) * halfW
      s.quad(
        { x: p.x + nx, y, z: p.y + nz }, { x: q.x + nx, y, z: q.y + nz },
        { x: q.x - nx, y, z: q.y - nz }, { x: p.x - nx, y, z: p.y - nz },
      )
    }
  }
  return s.build()
}

export function buildGroundStack3D(
  scenery: Scenery, pitZone: PitZone | null, u: (m: number) => number,
  materials: SceneMaterials, lift: (layer: number) => number,
  layers: { bands: number; fields: number; terrain: number; runoffs: number; floors: number },
): THREE.Group {
  const group = new THREE.Group()
  const add = (geo: THREE.BufferGeometry | null, colour: string, alpha = 1) => {
    if (!geo) return
    const mesh = new THREE.Mesh(geo, materials.get(colour, alpha))
    mesh.receiveShadow = true
    group.add(mesh)
  }
  for (const b of scenery.bands) {
    add(pathFillGeometry(b.d, lift(layers.bands)), b.fill, b.soft ? SOFT_BAND_ALPHA : 1)
  }
  for (const f of scenery.fields) {
    add(pathFillGeometry(f.d, lift(layers.fields)), f.fill, 0.75)
    add(ringStrokeGeometry(f.d, u(HEDGEROW_HALF_M), lift(layers.fields) + 0.005), HEDGE, 0.35)
  }
  for (const t of scenery.terrain) add(pathFillGeometry(t.d, lift(layers.terrain)), t.fill)
  for (const r of scenery.runoffs) add(pathFillGeometry(r.d, lift(layers.runoffs)), r.fill)
  if (pitZone) {
    const s = new GeometrySink()
    for (const r of pitZone.garageFloors) addPolyCap(s, r, [], lift(layers.floors))
    add(s.empty ? null : s.build(), '#2A2F38')
  }
  return group
}
