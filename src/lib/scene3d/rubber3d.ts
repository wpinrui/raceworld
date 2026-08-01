// What a tyre is MADE OF (#photoreal): the distance between a black torus and a racing slick, and
// almost none of it is shape. Shared by the car's own wheels (`car-mesh`) and the crew's props
// (`crew3d`), so the invisible swap at the hub stays invisible.
//
// Three things, in the order they matter.
//
// ONE MATERIAL PER ZONE. A slick's contact band polishes glossy inside a lap; the sidewall never
// touches anything and stays dead matte. A single roughness for the whole torus can only average
// the two into a finish that neither zone has, and it is that average, far more than the geometry,
// that reads as plastic. Splitting it is most of the job on its own.
//
// WARM, NOT BLACK. Near-black IS what plastic looks like. Real rubber is a warm dark grey, and a
// sidewall wears a film of track dust on top of that which pushes it browner and lighter still. The
// tread stays darker than the wall for the same reason it is glossier: the road scrubs it clean
// every lap and nothing settles on it.
//
// SHADED TOWARD THE RIM. The bead sits down in the well the rim flange makes and is in shadow there
// whatever the sun is doing, and the wall lifts out of it toward the shoulder. A per-vertex ramp
// buys that depth for nothing: no texture, no UVs, no extra triangles.

import * as THREE from 'three'
import { rubberDetail } from './detail3d'
import { surface } from './materials3d'

export const RUBBER = {
  /** The contact band. */
  tread: '#37322B',
  /** The sidewall: warmer and a step lighter, for the dust it carries and the tread does not. */
  wall: '#494036',
  /** Polished by the road, and the only part of a tyre that picks up the environment at all. Just
   *  off `ROUGH.gloss`: it should hold the horizon as a soft band down the shoulder, never as a
   *  reflection you could read. */
  treadRough: 0.35,
  /** Moulded, untouched, dusty. Past `ROUGH.matte` and nearly at chalk. */
  wallRough: 0.9,
  /** What the wall's radial ramp is worth at the bead, against 1 out at the shoulder. */
  beadShade: 0.52,
} as const

/** The contact band: polished, and wearing the fine graining that breaks its silhouette highlight.
 *  Falls back to a plain polished rubber wherever the grain cannot be rasterised. */
export const treadSurface = (): THREE.MeshStandardMaterial =>
  surface(RUBBER.tread, { roughness: RUBBER.treadRough, detail: rubberDetail() })

/** The sidewall. Every geometry wearing this MUST have been through `radialShade` first: the
 *  material reads vertex colours, and a mesh without them renders black rather than unshaded. */
export const wallSurface = (): THREE.MeshStandardMaterial =>
  surface(RUBBER.wall, { roughness: RUBBER.wallRough, vertexColors: true })

/** Ramp a sidewall's vertex colours from `beadShade` at `rInner` up to full at its outer edge.
 *
 *  The far end of the ramp is the geometry's OWN widest point rather than a number passed in, so the
 *  whole range always lands on rubber you can see. A wall lathed off a filleted tyre stops a little
 *  short of the rolling radius, and aiming the ramp at that radius spends its last third on a
 *  shoulder that does not exist.
 *
 *  Call it BEFORE the geometry is turned onto the axle: radius is measured about Y, which is the
 *  axis every lathe and cylinder in three is born on. Safe to run over a whole wheel rather than
 *  just its walls, since anything out at the full radius simply comes out unshaded. */
export function radialShade(geometry: THREE.BufferGeometry, rInner: number): void {
  const position = geometry.getAttribute('position')
  const colour = new Float32Array(position.count * 3)
  let rOuter = rInner
  for (let i = 0; i < position.count; i++) {
    rOuter = Math.max(rOuter, Math.hypot(position.getX(i), position.getZ(i)))
  }
  const span = rOuter - rInner || 1
  for (let i = 0; i < position.count; i++) {
    const radius = Math.hypot(position.getX(i), position.getZ(i))
    const t = Math.min(1, Math.max(0, (radius - rInner) / span))
    // Smoothstepped: a linear ramp creases visibly where it starts and stops, and on a wall this
    // dark a crease reads as a moulded step in the rubber rather than as shading.
    const shade = RUBBER.beadShade + (1 - RUBBER.beadShade) * t * t * (3 - 2 * t)
    colour[i * 3] = shade
    colour[i * 3 + 1] = shade
    colour[i * 3 + 2] = shade
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colour, 3))
}

/** How much of a wheel's own geometry one repeat of the tread grain should cover, in that
 *  geometry's units. Zero where there is no grain to tile, which is the whole test of whether a
 *  caller needs to touch its UVs at all.
 *
 *  Callers scale by (circumference / tile) round the axis and (span / tile) across it, so a front
 *  tyre and a rear one come out grained at the same physical size off one shared map. */
export function grainTile(unitsPerMetre: number): number {
  return (rubberDetail()?.tileM ?? 0) * unitsPerMetre
}
