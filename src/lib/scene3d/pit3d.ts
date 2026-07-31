// The pit complex in 3D (#3d-port increment 2): the tallest structure on any circuit, stood up from
// the same surveyed rings the 2D extrudes obliquely. The authored outline is the BASE and the mass
// rises off it; the garages are real recesses because the ring is really concave.

import * as THREE from 'three'
import { GARAGE_H_M, PIT_BUILDING_H_M, PIT_WHITE, PLANT_H_M } from '@/components/race/PitBuilding'
import type { PitZone } from '@/lib/ui/pit-zone'
import { ribbonGeometry } from './road3d'
import { GeometrySink, ringSolidGeometry, v3, wallStripGeometry } from './solids3d'
import type { SceneMaterials } from './materials3d'

const DOOR = '#161A21'
const LINTEL = '#9AA3B2'
/** The 2D's derived tones, frozen as albedo: terrace a step darker than the roof, plant and parapet
 *  a step darker still. The light differentiates the planes; these keep the authored contrast. */
const TERRACE = '#CDCBC6'
const PLANT = '#D5D3CD'
const RAIL = '#C4C2BC'
/** Parapet railing height above the roof. The 2D drew the rail as a line ON the roof; a real roof
 *  edge carries a rail you can see from a tilted camera. */
const RAIL_H_M = 0.9

export function buildPitComplex3D(
  zone: PitZone, u: (m: number) => number, materials: SceneMaterials,
  /** A team's colour bands the lintel over its own garage, as the 2D complex paints it. */
  garageColors?: (i: number) => string | undefined,
): THREE.Group {
  const group = new THREE.Group()
  const mid = u(GARAGE_H_M)
  const top = u(PIT_BUILDING_H_M)
  const solid = (geo: THREE.BufferGeometry, colour: string) => {
    const mesh = new THREE.Mesh(geo, materials.get(colour))
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }

  // Ground floor: walls to the garage lintel, capped so the recess ceiling reads as the upper
  // storey's underside. Then the storey above, on the overhanging outline, capped as the roof.
  solid(ringSolidGeometry(zone.buildingPts, 0, mid, true), PIT_WHITE)
  solid(ringSolidGeometry(zone.upperPts, mid, top, true), PIT_WHITE)

  // Each garage door on the back wall of its bay, floated a hair off it: shutter, then lintel band
  // in the resident team's colour where one is known.
  const doors = new GeometrySink()
  const lintels = new Map<string, GeometrySink>()
  const doorH = mid * 0.82
  zone.garageFloors.forEach((r, i) => {
    if (r.length < 4) return
    const inX = r[0].x - r[3].x
    const inY = r[0].y - r[3].y
    const inL = Math.hypot(inX, inY) || 1
    const off = { x: (inX / inL) * 0.05, y: (inY / inL) * 0.05 }
    const a = { x: r[3].x + off.x, y: r[3].y + off.y }
    const b = { x: r[2].x + off.x, y: r[2].y + off.y }
    doors.quad(v3(a.x, 0, a.y), v3(b.x, 0, b.y), v3(b.x, doorH, b.y), v3(a.x, doorH, a.y))
    const colour = garageColors?.(i) ?? LINTEL
    let sink = lintels.get(colour)
    if (!sink) {
      sink = new GeometrySink()
      lintels.set(colour, sink)
    }
    sink.quad(
      v3(a.x, doorH * 0.82, a.y), v3(b.x, doorH * 0.82, b.y),
      v3(b.x, doorH, b.y), v3(a.x, doorH, a.y),
    )
  })
  if (!doors.empty) solid(doors.build(), DOOR).castShadow = false
  for (const [colour, sink] of lintels) {
    if (!sink.empty) solid(sink.build(), colour).castShadow = false
  }

  // Roof furniture: the viewing terrace, its parapet with a flat top rail, and the plant boxes.
  const deck = new GeometrySink()
  const deckPts = zone.roofDeck.map((p) => new THREE.Vector2(p.x, p.y))
  const tris = THREE.ShapeUtils.triangulateShape(deckPts, [])
  for (const [i, j, k] of tris) {
    deck.tri(
      v3(zone.roofDeck[i].x, top + 0.02, zone.roofDeck[i].y),
      v3(zone.roofDeck[j].x, top + 0.02, zone.roofDeck[j].y),
      v3(zone.roofDeck[k].x, top + 0.02, zone.roofDeck[k].y),
    )
  }
  if (!deck.empty) solid(deck.build(), TERRACE).castShadow = false
  if (zone.roofRail.length >= 2) {
    const railTop = top + u(RAIL_H_M)
    solid(wallStripGeometry(zone.roofRail, top, railTop), RAIL).castShadow = false
    solid(ribbonGeometry(zone.roofRail, { halfW: u(0.18), y: railTop }), RAIL).castShadow = false
  }
  for (const r of zone.plant) solid(ringSolidGeometry(r, top, top + u(PLANT_H_M), true), PLANT)

  return group
}

/** The lane's own paint: the separator stripe down the box row and its two limiter lines, laid at
 *  the ground stack's lane-paint lift. */
export function buildPitPaint3D(
  zone: PitZone, u: (m: number) => number, y: number, materials: SceneMaterials,
): THREE.Group {
  const group = new THREE.Group()
  const lay = (pts: readonly { x: number; y: number }[], halfW: number, colour: string, lift: number, caps: boolean) => {
    if (pts.length < 2) return
    const mesh = new THREE.Mesh(
      ribbonGeometry(pts, { halfW, y: y + lift, roundCaps: caps }), materials.get(colour),
    )
    mesh.receiveShadow = true
    group.add(mesh)
  }
  lay(zone.sep, u(0.3), '#F2F2F2', 0, true)
  lay(zone.sep, u(0.17), '#2E62C9', 0.01, true)
  lay(zone.limiterIn, u(0.175), '#F2F2F2', 0, false)
  lay(zone.limiterOut, u(0.175), '#F2F2F2', 0, false)
  return group
}
