// Night dressing (#3d-port increment 6): floodlight towers down both sides of the circuit, each
// with an additive pool of light on the tarmac beneath its heads. The pools are paint, not real
// lights: sixty spotlights would drown any renderer, and what a night race READS as from these
// cameras is bright ribbon, dark world, towers striding along it.

import * as THREE from 'three'
import type { TrackLayout } from '@/data/tracks'
import { TRACK_WIDTH_M, densifyTrace } from '@/lib/ui/track-path'
import { GeometrySink, v3 } from './solids3d'
import { DECAL_PULL } from './materials3d'

/** One tower roughly every this many metres, alternating sides. */
const TOWER_SPACING_M = 130
/** Mast height and setback off the tarmac's edge. */
const TOWER_H_M = 16
const TOWER_SETBACK_M = 9
/** The lit pool's radius on the road. */
const POOL_R_M = 16

const MAST = '#3A4049'
const HEAD_GLOW = '#F2EBD4'

export function buildNightLights3D(
  layout: TrackLayout, glowPool: THREE.Texture | null,
): THREE.Group {
  const group = new THREE.Group()
  const u = (m: number) => m / layout.metresPerUnit
  const pts = densifyTrace(layout.trace, 6).map(([x, y]) => ({ x, y }))
  // Arc-walk the centreline, planting alternately left and right.
  const spacing = u(TOWER_SPACING_M)
  const offset = u(TRACK_WIDTH_M / 2 + TOWER_SETBACK_M)
  const masts = new GeometrySink()
  const heads = new GeometrySink()
  const pools: Array<{ x: number; y: number }> = []
  let travelled = 0
  let side = 1
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const seg = Math.hypot(q.x - p.x, q.y - p.y)
    travelled += seg
    if (travelled < spacing) continue
    travelled = 0
    side = -side
    const nx = (-(q.y - p.y) / (seg || 1)) * side
    const nz = ((q.x - p.x) / (seg || 1)) * side
    const bx = p.x + nx * offset
    const bz = p.y + nz * offset
    const w = u(0.5)
    const h = u(TOWER_H_M)
    // Mast: a slim square post; head: a wide shallow bar cantilevered toward the track, glowing.
    masts.quad(v3(bx - w, 0, bz - w), v3(bx + w, 0, bz + w), v3(bx + w, h, bz + w), v3(bx - w, h, bz - w))
    masts.quad(v3(bx - w, 0, bz + w), v3(bx + w, 0, bz - w), v3(bx + w, h, bz - w), v3(bx - w, h, bz + w))
    const hx = bx - nx * u(2.4)
    const hz = bz - nz * u(2.4)
    const across = u(3.4)
    const tx = ((q.x - p.x) / (seg || 1)) * across
    const tz = ((q.y - p.y) / (seg || 1)) * across
    heads.quad(
      v3(hx - tx, h, hz - tz), v3(hx + tx, h, hz + tz),
      v3(hx + tx, h + u(1.1), hz + tz), v3(hx - tx, h + u(1.1), hz - tz),
    )
    // The pool falls between the tower and the ribbon's middle.
    pools.push({ x: p.x + nx * offset * 0.25, y: p.y + nz * offset * 0.25 })
  }
  const mastMesh = new THREE.Mesh(masts.build(), new THREE.MeshLambertMaterial({
    color: MAST, side: THREE.DoubleSide,
  }))
  mastMesh.castShadow = true
  group.add(mastMesh)
  // The heads are LIT, not lit-upon: flat emissive white, the one thing night leaves at full level.
  group.add(new THREE.Mesh(heads.build(), new THREE.MeshBasicMaterial({
    color: HEAD_GLOW, side: THREE.DoubleSide,
  })))
  if (glowPool) {
    const poolGeo = new THREE.PlaneGeometry(2 * u(POOL_R_M), 2 * u(POOL_R_M)).rotateX(-Math.PI / 2)
    const poolMat = new THREE.MeshBasicMaterial({
      map: glowPool, transparent: true, opacity: 0.32, depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -DECAL_PULL, polygonOffsetUnits: -2 * DECAL_PULL,
    })
    for (const p of pools) {
      const pool = new THREE.Mesh(poolGeo, poolMat)
      pool.position.set(p.x, u(0.05), p.y)
      pool.renderOrder = 950
      group.add(pool)
    }
  }
  return group
}
