// The ground stack (#3d-port increment 2): relief bands, the field quilt, terrain patches, run-off
// aprons, lakes and the garage floors, as flat fills at painter lifts — the same order `groundOps`
// paints them in. The organic shapes arrive as path strings and are sampled back to polygons here.

import * as THREE from 'three'
import { shade } from '@/lib/color'
import type { PitZone } from '@/lib/ui/pit-zone'
import type { Scenery } from '@/lib/ui/track-scenery'
import { ringsToPolys, samplePathRings } from './paths3d'
import { GeometrySink, addPolyCap } from './solids3d'
import type { SceneMaterials } from './materials3d'
import { planarUV, type SurfaceDetail } from './detail3d'
import { GROUND_CELL_M, NORMAL_STEP_M, drape, levelTo, lowestOn, subdivide } from './terrain3d'

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
  /** A team's colour lands on its own garage floor, exactly as `pitFloorOps` paints it. */
  garageColors?: (i: number) => string | undefined,
  /** The ground's generated grain, projected per fill. Null leaves every patch smooth. */
  detail: SurfaceDetail | null = null,
): THREE.Group {
  const group = new THREE.Group()
  const { elevation } = scenery
  // Every fill is cut down to the ground sheet's own pitch before it is draped: at its authored
  // resolution a run-off apron is a handful of triangles spanning forty metres, and moving only
  // their corners leaves a flat plate through the bank it is meant to lie on.
  const cell = u(GROUND_CELL_M)
  const normalStep = u(NORMAL_STEP_M)
  const add = (geo: THREE.BufferGeometry | null, colour: string, layer: number, alpha = 1) => {
    if (!geo) return
    const fitted = subdivide(geo, cell)
    drape(fitted, elevation, normalStep)
    if (detail) planarUV(fitted, u(detail.tileM))
    const mesh = new THREE.Mesh(fitted, materials.get(colour, { alpha, layer, detail }))
    mesh.receiveShadow = true
    group.add(mesh)
  }
  for (const b of scenery.bands) {
    add(pathFillGeometry(b.d, lift(layers.bands)), b.fill, layers.bands)
  }
  for (const f of scenery.fields) {
    add(pathFillGeometry(f.d, lift(layers.fields)), f.fill, layers.fields, 0.75)
    add(ringStrokeGeometry(f.d, u(HEDGEROW_HALF_M), lift(layers.fields) + 0.001), HEDGE, layers.fields, 0.35)
  }
  // Water is LEVEL, which no other fill on this ground is. A lake draped like grass would climb the
  // bank it sits against, so it takes ONE height for its whole surface: the lowest ground its own
  // outline touches, which is where water in a basin actually stands. No subdivision either, since a
  // flat sheet is exactly flat however few triangles describe it.
  for (const t of scenery.terrain) {
    const geo = pathFillGeometry(t.d, lift(layers.terrain))
    if (!geo) continue
    if (!t.water) {
      add(geo, t.fill, layers.terrain)
      continue
    }
    levelTo(geo, lowestOn(geo, elevation))
    if (detail) planarUV(geo, u(detail.tileM))
    const mesh = new THREE.Mesh(geo, materials.get(t.fill, { layer: layers.terrain, detail }))
    mesh.receiveShadow = true
    group.add(mesh)
  }
  for (const r of scenery.runoffs) add(pathFillGeometry(r.d, lift(layers.runoffs)), r.fill, layers.runoffs)
  if (pitZone) {
    // A garage floor sits in the building's own shade in the 2D; the albedo carries that darkening
    // because the recess is too shallow for the real shadow map to supply it.
    const byColour = new Map<string, GeometrySink>()
    pitZone.garageFloors.forEach((r, i) => {
      const team = garageColors?.(i)
      const colour = team ? shade(team, 0.55) : '#2A2F38'
      let s = byColour.get(colour)
      if (!s) {
        s = new GeometrySink()
        byColour.set(colour, s)
      }
      addPolyCap(s, r, [], lift(layers.floors))
    })
    for (const [colour, s] of byColour) add(s.empty ? null : s.build(), colour, layers.floors)
  }
  return group
}
