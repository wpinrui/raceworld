// The 3D world, increment 1 (#3d-port): the road on the ground, composed from the same sources the
// 2D scene builds from — the densified trace, the pit lane's `fastPts`, the pit zone's apron ring,
// the scenery's kerbs — so both renderers describe one circuit while they coexist.
//
// The ground is a painter's stack: coplanar paint layers keep their 2D order as centimetre lifts,
// because that order is what the picture IS down there. Real height starts with the structures in
// increment 2; nothing on the road ever gets any.

import * as THREE from 'three'
import type { TrackLayout } from '@/data/tracks'
import type { PitZone } from '@/lib/ui/pit-zone'
import { ROAD_CASING, ROAD_TARMAC } from '@/lib/ui/road-ops'
import { MARK_WHITE, startLineRects, startPose } from '@/lib/ui/road-marks'
import { KERB_BLOCK_M, KERB_RED, KERB_WHITE, KERB_WIDTH_M, type Scenery } from '@/lib/ui/track-scenery'
import {
  LANE_LINE_M, LANE_TARMAC_M, LANE_WIDTH_M, TARMAC_WIDTH_M, TRACK_WIDTH_M, densifyOpen, densifyTrace,
} from '@/lib/ui/track-path'
import { dashGeometry, localRectsGeometry, ribbonGeometry, ringGeometry } from './road3d'

/** Ground reach beyond the viewBox, in units: the same margin the 2D preview clears to the wash. */
const GROUND_PAD = 4000

/** One painter's layer sits this far above the one below, in metres: comfortably separated in a
 *  24-bit depth buffer at any framing, far too little for any camera to read as height. */
const LIFT_M = 0.04
const LAYER = { casing: 1, tarmac: 2, kerbWhite: 3, kerbRed: 4, marks: 5 } as const

export interface World3DInput {
  layout: TrackLayout
  scenery: Scenery
  pitZone: PitZone | null
}

export interface World3D {
  group: THREE.Group
  /** What this scene costs, for the probe's console line. */
  stats: { meshes: number; triangles: number }
}

export function buildWorld3D({ layout, scenery, pitZone }: World3DInput): World3D {
  const u = (m: number) => m / layout.metresPerUnit
  const lift = (layer: number) => u(LIFT_M) * layer
  const group = new THREE.Group()
  // Unlit flat colour is increment 1's whole material model: the 2D world is opaque pre-blended
  // fills, and parity comes before light. DoubleSide because every ribbon here is a sheet.
  const materials = new Map<string, THREE.MeshBasicMaterial>()
  const add = (geometry: THREE.BufferGeometry, colour: string) => {
    let mat = materials.get(colour)
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide })
      materials.set(colour, mat)
    }
    group.add(new THREE.Mesh(geometry, mat))
  }

  const [vx, vy, vw, vh] = layout.viewBox.split(' ').map(Number)
  const ground = new THREE.PlaneGeometry(vw + 2 * GROUND_PAD, vh + 2 * GROUND_PAD)
  ground.rotateX(-Math.PI / 2)
  ground.translate(vx + vw / 2, 0, vy + vh / 2)
  add(ground, scenery.base)

  // The roads, layer-major exactly as `roadOps` strokes them: every white casing goes down before
  // any dark tarmac, across the circuit, the lane and the apron alike.
  const circuit = densifyTrace(layout.trace, 6).map(([x, y]) => ({ x, y }))
  const lane = layout.pit.fastPts
  for (const [colour, layer, trackW, laneW] of [
    [ROAD_CASING, LAYER.casing, TRACK_WIDTH_M, LANE_WIDTH_M],
    [ROAD_TARMAC, LAYER.tarmac, TARMAC_WIDTH_M, LANE_TARMAC_M],
  ] as const) {
    add(ribbonGeometry(circuit, { halfW: u(trackW / 2), y: lift(layer), closed: true }), colour)
    add(ribbonGeometry(lane, { halfW: u(laneW / 2), y: lift(layer), roundCaps: true }), colour)
    if (pitZone) {
      add(ringGeometry(pitZone.work, lift(layer)), colour)
      // The apron carries the same white edge line: a stroke round the ring in 2D, a ribbon here.
      if (colour === ROAD_CASING) {
        add(ribbonGeometry(pitZone.work, { halfW: u(LANE_LINE_M), y: lift(layer), closed: true }), colour)
      }
    }
  }

  // Kerbs: the white base under the red blocks, sampled off the same smoothed curve the 2D strokes.
  for (const kerb of scenery.kerbs) {
    const pts = densifyOpen(kerb.pts)
    add(ribbonGeometry(pts, { halfW: u(KERB_WIDTH_M / 2), y: lift(LAYER.kerbWhite), roundCaps: true }), KERB_WHITE)
    add(dashGeometry(pts, {
      halfW: u(KERB_WIDTH_M / 2), y: lift(LAYER.kerbRed), on: u(KERB_BLOCK_M), off: u(KERB_BLOCK_M),
    }), KERB_RED)
  }

  add(localRectsGeometry(
    startPose(layout.start, layout.metresPerUnit), startLineRects(u), lift(LAYER.marks),
  ), MARK_WHITE)

  let meshes = 0
  let triangles = 0
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes++
      const g = o.geometry as THREE.BufferGeometry
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3
    }
  })
  return { group, stats: { meshes, triangles: Math.round(triangles) } }
}
