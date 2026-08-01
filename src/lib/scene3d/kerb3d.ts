// The kerb as a real object (#photoreal): a section lofted along the strip, rather than two sheets
// of paint lying in the road.
//
// Everything else on this ground is paint, and paint is correctly flat. A kerb is not: it is a cast
// concrete ramp standing proud of the tarmac, and drawn flat it read as a red and white stripe
// printed on the grass, with nothing to catch the sun and nothing to throw a shadow. The section is
// the whole difference: a lip at the tarmac's edge, a ramp rising away from the track, and a face
// dropping off the back into the ground.
//
// Red and white are the loft's own colour, not a decal over it. Both are built off ONE set of
// stations (`dashStations`) with one set of across-normals, so consecutive blocks meet along a
// shared cut: no seam, no z-fight, and no way for the two to disagree about where a block ends.
//
// UVs are LOFTED rather than projected down from world XZ like every other ground surface: V runs
// along the strip, U across it. That is what lets a single normal map corrugate every kerb across
// its own direction of travel, wherever on the circuit it sits and whichever way it points
// (`detail3d`'s `kerb`).

import * as THREE from 'three'
import { densifyOpen } from '@/lib/ui/track-path'
import {
  KERB_BLOCK_M, KERB_RED, KERB_WHITE, KERB_WIDTH_M, type SceneryKerb,
} from '@/lib/ui/track-scenery'
import { dashStations, type DashStation } from './road3d'
import { repairNormals } from './normals3d'
import { ROUGH, type SceneMaterials } from './materials3d'
import type { SurfaceDetail } from './detail3d'

/** The section, walked from the track edge outward: how far across the strip (0 at the tarmac, 1 at
 *  the back) and how high above the road surface, in metres.
 *
 *  A 15mm lip at the tarmac, because the edge a car climbs is a step rather than a feather, and a
 *  feathered one disappears the moment the camera is not overhead. 62mm at the back over the strip's
 *  1.3m, which is the shallow ramp a modern exit kerb actually is. The last entry drops BELOW the
 *  road surface: the skirt buries into the ground sheets so no low angle finds daylight under the
 *  kerb, which is otherwise the one place a lofted strip gives itself away. */
const SECTION: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0, 0.015], [0.22, 0.038], [0.62, 0.058], [1, 0.062], [1, -0.03],
]

/** Section corners turning more than this shade as one continuous surface; sharper ones keep their
 *  crease. `solids3d`'s CREASE applied to a 2D section: the ramp's own bends smooth into a curve,
 *  the lip and the back face stay hard edges. Held as a cosine, since that is what it is compared
 *  against. */
const CREASE = Math.cos(0.6)

/** Metres of run-in at each end of a kerb. Real ones ramp down to the tarmac rather than stopping in
 *  a 6cm step, and tapering the section to nothing is also what CLOSES the loft: at zero height the
 *  end is flat, so there is no open tube needing a cap. */
const TAPER_M = 2

/** One vertex of the section, with the normal a lit surface needs there. */
interface Rib {
  /** Across the strip from its track edge, in world units. */
  a: number
  /** Above the road surface, in world units. */
  h: number
  /** The section's outward normal: across (away from the track) and up. Unit length. */
  na: number
  nh: number
}

/** The section as bands of two ribs, with vertex normals averaged where it turns gently and split
 *  where it turns a corner. */
function sectionBands(u: (m: number) => number): Array<readonly [Rib, Rib]> {
  const width = u(KERB_WIDTH_M)
  const pt = (i: number) => ({ a: SECTION[i][0] * width, h: u(SECTION[i][1]) })
  // The section is walked from the track edge over the top and down the back, so its LEFT normal is
  // the one facing out of the solid.
  const segs = SECTION.slice(0, -1).map((_, i) => {
    const p = pt(i)
    const q = pt(i + 1)
    const len = Math.hypot(q.a - p.a, q.h - p.h) || 1
    return { na: -(q.h - p.h) / len, nh: (q.a - p.a) / len }
  })
  const normalAt = (vertex: number, band: number) => {
    const n = segs[band]
    const m = segs[vertex === band ? band - 1 : band + 1]
    if (!m || n.na * m.na + n.nh * m.nh < CREASE) return n
    const len = Math.hypot(n.na + m.na, n.nh + m.nh) || 1
    return { na: (n.na + m.na) / len, nh: (n.nh + m.nh) / len }
  }
  return segs.map((_, i) => [
    { ...pt(i), ...normalAt(i, i) },
    { ...pt(i + 1), ...normalAt(i + 1, i) },
  ] as const)
}

export interface KerbOpts {
  /** Metres to world units. */
  u: (m: number) => number
  /** The road surface the kerb stands on, in world units. */
  base: number
  /** Sign along a station's `(nx, ny)` that points AT the track. */
  inward: 1 | -1
  /** World units one tile of the kerb's grain spans, for the lofted UVs. */
  tile: number
}

/** Loft the section along every run of stations of one colour: the red blocks, or the white between
 *  them. Normals are analytic rather than differenced off the triangles, so the ramp shades as the
 *  surface it describes and no zero-area triangle can poison one. */
export function loftKerb(
  stations: readonly DashStation[], painted: boolean, o: KerbOpts,
): THREE.BufferGeometry | null {
  const bands = sectionBands(o.u)
  const half = o.u(KERB_WIDTH_M) / 2
  const taper = o.u(TAPER_M)
  const total = stations[stations.length - 1].s
  const out = -o.inward
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  /** Height scale along the run-in, smoothstepped so the taper meets the tarmac flat. */
  const rise = (s: number) => {
    const t = Math.max(0, Math.min(1, Math.min(s, total - s) / taper))
    return t * t * (3 - 2 * t)
  }
  const push = (st: DashStation, rib: Rib, k: number) => {
    const across = rib.a - half
    positions.push(st.x + out * st.nx * across, o.base + rib.h * k, st.y + out * st.ny * across)
    normals.push(out * st.nx * rib.na, rib.nh, out * st.ny * rib.na)
    // Across the strip, then along it: the ridge pattern is fixed to the kerb rather than to the
    // world, and stays continuous across a block boundary because `s` is measured from the run's
    // start, not the block's.
    uvs.push(rib.a / o.tile, st.s / o.tile)
  }

  let i = 0
  while (i + 1 < stations.length) {
    if (stations[i].painted !== painted) {
      i++
      continue
    }
    let j = i
    while (j + 1 < stations.length && stations[j].painted === painted) j++
    // Stations i..j inclusive are one unbroken block of this colour.
    for (const [lo, hi] of bands) {
      const first = positions.length / 3
      for (let k = i; k <= j; k++) {
        const scale = rise(stations[k].s)
        push(stations[k], lo, scale)
        push(stations[k], hi, scale)
      }
      // A vertical band's two ribs land on each other where the taper has run the section down to
      // nothing, so the triangle that spans them there covers no area at all. Skipped rather than
      // emitted, to keep the kerbs out of the geometry probe's degenerate count.
      const collapsed = (k: number) => lo.a === hi.a && rise(stations[k].s) === 0
      for (let k = i; k < j; k++) {
        const a = first + 2 * (k - i)
        const b = a + 2
        if (!collapsed(k)) indices.push(a, a + 1, b + 1)
        if (!collapsed(k + 1)) indices.push(a, b + 1, b)
      }
    }
    i = j
  }
  if (indices.length === 0) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  // The section's normals are unit by construction; a station's are not, if the polyline doubled
  // back on a repeated sample. Same repair as every other builder here, for the same reason.
  return repairNormals(geometry)
}

/** Every kerb on the circuit, as solids standing on the road surface. */
export function buildKerbs3D(
  kerbs: readonly SceneryKerb[], u: (m: number) => number, base: number,
  materials: SceneMaterials, detail: SurfaceDetail | null = null,
): THREE.Group {
  const group = new THREE.Group()
  // Absent a generated grain the UVs still have to mean something, so they fall back to one tile per
  // kerb width: no map samples them, and a later one gets a sane scale for nothing.
  const tile = u(detail?.tileM ?? KERB_WIDTH_M)
  const block = u(KERB_BLOCK_M)
  for (const kerb of kerbs) {
    const stations = dashStations(densifyOpen(kerb.pts), { on: block, off: block })
    if (stations.length < 2) continue
    for (const [colour, painted] of [[KERB_WHITE, false], [KERB_RED, true]] as const) {
      const geometry = loftKerb(stations, painted, { u, base, inward: kerb.inward, tile })
      if (!geometry) continue
      // `matte`, not `paint`: a kerb is painted CONCRETE, cast rough for grip, and at the sheen of
      // painted metal the sky's broad specular sat over the red hard enough to wash it out pink.
      const mesh = new THREE.Mesh(geometry, materials.get(colour, { roughness: ROUGH.matte, detail }))
      // A solid, so it casts as well as receives. A low sun raking across a corrugated kerb is most
      // of what says the thing is not paint.
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }
  }
  return group
}
