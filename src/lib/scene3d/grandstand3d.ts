// A grandstand modelled as a building rather than a box with a lid. Built in METRES in its own
// local frame: +x along the track (the stand's width), +z away from the circuit (the rake climbs
// this way), +y up. The trackside face sits at z = 0, so a caller places one by putting that face
// where the barrier is and rotating about y.
//
// The section is a profile in the z-y plane, swept across the width. Every massing below is the
// SAME sweep with a different profile and a different way of meeting the ground, which is what a
// real stand is: seating geometry is fixed by row pitch and sightlines, and what varies between one
// circuit's stand and another's is the substructure holding it up.

import * as THREE from 'three'
import { GeometrySink, v3 } from './solids3d'
import { ROUGH, surface, type SurfaceOpts } from './materials3d'
import { faceUV, type SurfaceDetail } from './detail3d'
import { buildCrowd } from './standcrowd3d'
import { blendSurfaces, type SkinSurface, type StandSkin } from './standtex3d'

/** The scans in use, or nothing at all. Every builder takes one, and every one of them works with
 *  `null`: the model has to stand up as flat colour, both because the textures load asynchronously
 *  and because a test has no browser to decode a PNG in. */
type Skin = StandSkin | null
const of = (skin: Skin, part: keyof StandSkin): SkinSurface | null => (skin ? skin[part] : null)

/** The colour to multiply a scanned surface by.
 *
 *  A material's colour MULTIPLIES its albedo map, so handing a photographed concrete the same grey
 *  the flat-colour model used darkens it twice: a mid-grey scan times a 0.6 grey lands near black,
 *  and then tone mapping takes what is left. Where the scan supplies the colour, the tint has to get
 *  out of its way. `scan` exists for the surfaces that still need to read DARKER than the deck (the
 *  soffit, the rear wall, the towers), which the flat model expressed with a darker grey and which
 *  now has to come from a gentle multiply instead. */
const tinted = (skin: Skin, flat: string, scan = '#FFFFFF'): string => (skin ? scan : flat)

/** A scanned surface: tinted for whether the scan is supplying the colour, and with its tiling
 *  broken by whatever technique that surface uses.
 *
 *  Every textured surface on the stand comes through here. Three separate decisions have to agree for
 *  one to look right (which scan, what tint, how it is sampled) and they were about to be spelled out
 *  at every call site. */
function scanned(
  skin: Skin, part: keyof StandSkin, flat: string, scan?: string, opts: SurfaceOpts = {},
): THREE.MeshStandardMaterial {
  const detail = of(skin, part)
  const mat = skinned(tinted(skin, flat, scan), detail, { roughness: ROUGH.matte, ...opts })
  if (detail) blendSurfaces(mat, detail)
  return mat
}

/** How the seating deck meets the ground. */
export type StandMassing =
  /** One monolithic raked wedge of concrete, closed to the ground on every side. */
  | 'plinth'
  /** A thin raked slab lifted on a column grid, with an open concourse walking through underneath. */
  | 'columns'
  /** Lower terrace, a set-back concourse band, then an upper tier over it. */
  | 'twoTier'

export interface GrandstandSpec {
  /** Along the track. */
  widthM: number
  /** Seat rows in the lower (or only) tier. */
  rows: number
  /** Rows in the upper tier. Ignored unless `massing` is `twoTier`. */
  upperRows: number
  /** Step height, row to row. Real raked seating is 380-450 mm; the steeper the better for
   *  sightlines, and it is the single number that decides whether the stand reads as a wall of
   *  people or a gentle bank. */
  riseM: number
  /** Step depth, row to row. Seat pitch: 800 mm is tight modern, 900 mm is comfortable. */
  runM: number
  /** The trackside parapet: the wall between the front row's feet and the circuit. */
  frontWallM: number
  /** Height of the concourse band between the two tiers, and how far the upper tier sets back. */
  bandM: number
  setbackM: number
  /** The walkway across the back of the top row. Without it the rake ends on a bare riser: a
   *  vertical plane with nothing standing on it, which is not a thing any stand has. */
  topWalkM: number
  /** The wall closing the back of that walkway, above the top row's feet. */
  parapetM: number
  massing: StandMassing
  roof: RoofStyle
}

/** What covers the seats, which is the loudest thing about a stand from the far side of a circuit:
 *  the roof is its silhouette, and every one of these reads differently at a kilometre. */
export type RoofStyle =
  /** A steel truss cantilevering forward off rear masts, held by backstays. Nothing in front of the
   *  crowd, so no column ever stands between a seat and the track. */
  | 'cantilever'
  /** A pitched roof carried on two column lines, front and back. Old-school permanent stand: the
   *  front columns land on the parapet and do interrupt the view, which is why it went out of
   *  fashion and why it dates a circuit so precisely. */
  | 'pitched'
  /** A curved tensile canopy on arched ribs. The modern purpose-built circuit's signature. */
  | 'canopy'
  | 'none'

/** The pit straight stand: the biggest one at the circuit, two tiers under a tensile canopy. The one
 *  a broadcast shot is framed against, so it is the one that carries the place's identity. */
export const PIT_STAND: GrandstandSpec = {
  widthM: 64,
  rows: 20,
  upperRows: 14,
  riseM: 0.42,
  runM: 0.85,
  frontWallM: 1.1,
  bandM: 3.4,
  setbackM: 2.2,
  topWalkM: 1.6,
  parapetM: 1.15,
  massing: 'twoTier',
  roof: 'canopy',
}

/** The other permanent stands: single tier, cantilever truss, narrower. Same section, same seat,
 *  same crowd; a circuit reads as one place because its stands are variants of one stand rather than
 *  a collection of unrelated buildings. */
export const MAJOR_STAND: GrandstandSpec = {
  ...PIT_STAND,
  widthM: 42,
  rows: 18,
  upperRows: 0,
  massing: 'plinth',
  roof: 'cantilever',
}

/** The default the viewer opens on. */
export const MAIN_STAND: GrandstandSpec = {
  widthM: 64,
  rows: 20,
  upperRows: 14,
  riseM: 0.42,
  runM: 0.85,
  frontWallM: 1.1,
  bandM: 3.4,
  setbackM: 2.2,
  topWalkM: 1.6,
  parapetM: 1.15,
  massing: 'twoTier',
  roof: 'canopy',
}

const CONCRETE = '#9AA0A8'
const CONCRETE_DARK = '#6E747C'
const STEEL = '#8A929C'
const ROOF_SHEET = '#AAB1BA'
const ROOF_FASCIA = '#DCE0E5'
const MEMBRANE = '#E6E9EC'
const RAIL_STEEL = '#C6CBD2'
/** Timber cladding, for when there is no scan loaded. */
const WOOD = '#8A6A48'
const GLASS = '#8CA3B8'
const MULLION = '#7C838D'
/** Handrail height above the tread it stands on. */
const RAIL_H_M = 0.98
/** Fall protection at a tier's front edge. A metre and a bit: high enough to stop somebody going
 *  over it, low enough that the front row still sees the apex. */
const BARRIER_H_M = 1.12
const BARRIER_GLASS = '#BFD3DE'

/** How thick the rear parapet is, so its coping is a surface you could stand a cup on. */
const PARAPET_THICK_M = 0.3

/** A point on the section, front (trackside) to back. */
interface Pt { z: number; y: number }

/** One seat row: the tread it stands on, and the height of that tread. */
export interface StandRow { z: number; y: number }

/** The raked section, and the rows it puts people on. One walk of the climb produces both: deriving
 *  the rows separately would be the same stair counted twice, and the two would drift the first time
 *  a landing moved. */
export function standSection(spec: GrandstandSpec): {
  pts: Pt[]; rows: StandRow[]; band: { z: number; y0: number; y1: number } | null
} {
  const pts: Pt[] = [{ z: 0, y: spec.frontWallM }]
  const rows: StandRow[] = []
  let band: { z: number; y0: number; y1: number } | null = null
  const climb = (n: number) => {
    for (let i = 0; i < n; i++) {
      const last = pts[pts.length - 1]
      rows.push({ z: last.z, y: last.y })
      pts.push({ z: last.z + spec.runM, y: last.y })
      pts.push({ z: last.z + spec.runM, y: last.y + spec.riseM })
    }
  }
  climb(spec.rows)
  if (spec.massing === 'twoTier') {
    const last = pts[pts.length - 1]
    // The band is the concourse the upper tier stands on: a walk-through gap, then a blank face
    // (hospitality boxes and the vomitory heads live in it) before the upper rake resumes.
    pts.push({ z: last.z + spec.setbackM, y: last.y })
    pts.push({ z: last.z + spec.setbackM, y: last.y + spec.bandM })
    band = { z: last.z + spec.setbackM, y0: last.y, y1: last.y + spec.bandM }
    climb(spec.upperRows)
  }
  // The back of the house: a walkway behind the top row, then the parapet that closes it. The rake
  // has to finish on something horizontal, both because that is where people stand and because it
  // is what the roof's rear beam lands on.
  //
  // The parapet is a WALL, so the section climbs its inner face and then runs across its coping
  // before the rear wall drops away. Ending the section on the vertical instead put that face in the
  // same plane as the rear wall: a fin of zero thickness with a knife edge on top, and two coplanar
  // sheets fighting in the depth buffer down its whole length.
  const top = pts[pts.length - 1]
  const inner = top.z + spec.topWalkM
  pts.push({ z: inner, y: top.y })
  pts.push({ z: inner, y: top.y + spec.parapetM })
  pts.push({ z: inner + PARAPET_THICK_M, y: top.y + spec.parapetM })
  return { pts, rows, band }
}

export const standProfile = (spec: GrandstandSpec): Pt[] => standSection(spec).pts

/** Total depth and height of a section, which is what the caller needs to place one. */
export function standExtent(spec: GrandstandSpec): { depthM: number; heightM: number } {
  const p = standProfile(spec)
  const back = p[p.length - 1]
  return { depthM: back.z, heightM: back.y }
}

/** Sweep a section across the width: the walking surface of the whole bowl, treads and risers in
 *  one sheet. */
function sweep(pts: readonly Pt[], x0: number, x1: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    s.quad(v3(x0, a.y, a.z), v3(x1, a.y, a.z), v3(x1, b.y, b.z), v3(x0, b.y, b.z))
  }
  return s.build()
}

/** The closed end of the stand: the section, back down to the ground and along it to the front. */
function endWall(pts: readonly Pt[], x: number, flip: boolean): THREE.BufferGeometry {
  const s = new GeometrySink()
  const back = pts[pts.length - 1]
  const poly = [...pts, { z: back.z, y: 0 }, { z: 0, y: 0 }]
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.z, p.y)))
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(shape.getPoints(0), [])) {
    const t = shape.getPoints(0)
    const a = v3(x, t[i].y, t[i].x)
    const b = v3(x, t[j].y, t[j].x)
    const c = v3(x, t[k].y, t[k].x)
    if (flip) s.tri(a, c, b)
    else s.tri(a, b, c)
  }
  return s.build()
}

/** The slab under a lifted deck: the section offset down its own normal, so the underside reads as
 *  a soffit that follows the rake rather than a second floor. */
function soffit(pts: readonly Pt[], thickM: number): Pt[] {
  return pts.map((p) => ({ z: p.z, y: p.y - thickM }))
}

/** A rectangular column, cheap and square-edged: cast concrete, not a turned pillar. */
function columnGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  const [x0, x1, z0, z1] = [-w / 2, w / 2, -d / 2, d / 2]
  s.quad(v3(x0, 0, z0), v3(x1, 0, z0), v3(x1, h, z0), v3(x0, h, z0))
  s.quad(v3(x1, 0, z1), v3(x0, 0, z1), v3(x0, h, z1), v3(x1, h, z1))
  s.quad(v3(x1, 0, z0), v3(x1, 0, z1), v3(x1, h, z1), v3(x1, h, z0))
  s.quad(v3(x0, 0, z1), v3(x0, 0, z0), v3(x0, h, z0), v3(x0, h, z1))
  s.quad(v3(x0, h, z0), v3(x1, h, z0), v3(x1, h, z1), v3(x0, h, z1))
  return s.build()
}

/** A square-section bar between two points: the one primitive every piece of steel here is made of.
 *  Trusses, masts, purlins, backstays and canopy ribs are all runs of these, which is also how they
 *  are fabricated, so the model and the thing agree about what a member IS. */
function strut(s: GeometrySink, a: Pt3, b: Pt3, r: number): void {
  const d = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z)
  const len = d.length()
  if (len < 1e-6) return
  d.divideScalar(len)
  // Any perpendicular will do for a square section; picking against the axis d is least aligned
  // with keeps the cross product well-conditioned when a member runs straight up.
  const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const p = new THREE.Vector3().crossVectors(up, d).normalize().multiplyScalar(r)
  const q = new THREE.Vector3().crossVectors(d, p).normalize().multiplyScalar(r)
  const corner = (at: Pt3, sp: number, sq: number) => v3(
    at.x + p.x * sp + q.x * sq, at.y + p.y * sp + q.y * sq, at.z + p.z * sp + q.z * sq,
  )
  const signs: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]]
  for (let i = 0; i < 4; i++) {
    const [s0, t0] = signs[i]
    const [s1, t1] = signs[(i + 1) % 4]
    s.quad(corner(a, s0, t0), corner(a, s1, t1), corner(b, s1, t1), corner(b, s0, t0))
  }
  s.quad(corner(a, 1, 1), corner(a, -1, 1), corner(a, -1, -1), corner(a, 1, -1))
  s.quad(corner(b, 1, -1), corner(b, -1, -1), corner(b, -1, 1), corner(b, 1, 1))
}

interface Pt3 { x: number; y: number; z: number }
const p3 = (x: number, y: number, z: number): Pt3 => ({ x, y, z })

/** A placed mesh, with the grain's UVs projected onto it.
 *
 *  The single place UVs are set, because every geometry in this file is non-indexed and comes out of
 *  a `GeometrySink`, which is exactly the case `faceUV` exists to handle: it projects each triangle
 *  off whichever axis it most faces, so a tread reads from above and a riser from the front, with
 *  seams only where a surface turns a corner. Projected in METRES, since this model is built in
 *  metres, so a tile is the same size on a 64 m stand and a 20 m one. */
function mesh(
  geo: THREE.BufferGeometry, mat: THREE.Material, detail: SurfaceDetail | null = null,
): THREE.Mesh {
  if (detail && !geo.getAttribute('uv')) faceUV(geo, detail.tileM)
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** A material off a scanned surface, or the flat authored colour when there is no skin loaded. */
function skinned(
  colour: string, detail: SurfaceDetail | null, opts: SurfaceOpts = {},
): THREE.MeshStandardMaterial {
  return surface(colour, { ...opts, detail })
}

/** What a single seat IS. The whole stand is one of these repeated some thousands of times, so this
 *  is the shape that carries the close-up. */
export type SeatForm =
  /** The bolt-down stadium seat: a flat moulded pan and back panel on a slim pedestal. */
  | 'shell'
  /** A contoured bucket: side wings wrapping the sitter, a rolled front lip on the pan. */
  | 'bucket'
  /** A continuous bench plank with a back rail, one run per row. No individual seat at all. */
  | 'bench'

/** How much of a seat gets built. The count is fixed by the stand, so the ONLY lever on cost is what
 *  each one is made of, and the whole ladder has to hold the same silhouette or a stand visibly
 *  changes shape as the camera pulls back. */
export type SeatLod = 'high' | 'mid' | 'low' | 'auto'

/** Where the ladder switches, in metres from the camera to the stand's centre.
 *
 *  Chosen off what each tier still shows rather than off a triangle target. `high` holds until the
 *  wings and the pan rim stop being separable, `mid` until the pedestal does; past `low` a seat is a
 *  dark notch over a bright pan and there is nothing left to lose. A 64 m stand is one object to
 *  three.js, so these are distances to its middle: the far end of a stand seen down the straight
 *  switches with the near end, which is the price of one draw call for four thousand seats.
 *
 *  METRES, and they have to be converted before `THREE.LOD` sees them. LOD compares against a WORLD
 *  distance, and a world unit is `metresPerUnit` metres, which runs from 2 at the Netherlands to 6.2
 *  at Saudi Arabia. Handed over raw, as they were, "55 metres" meant 111 m at one circuit and 343 m
 *  at another, and every stand for a third of a kilometre rendered its full seat. That was 1.8M
 *  triangles on the grid at Britain, the biggest single block in the scene. `trees3d` divides its own
 *  band by the same scalar; this did not. */
const LOD_M = { mid: 55, low: 130 } as const

/** Seat pitch across the width. 500 mm is a real circuit's spacing. */
const SEAT_PITCH_M = 0.5
const SEAT_W_M = 0.44
const SEAT_H_M = 0.42
const SEAT_COLOUR = '#39506B'

/** Sweep a closed cross-section in the z-y plane along x. Every part of a seat is one of these: a
 *  pan, a back panel, a wing, a pedestal are all a profile with a width. */
function prism(s: GeometrySink, sect: readonly Pt[], x0: number, x1: number): void {
  for (let i = 0; i < sect.length; i++) {
    const a = sect[i]
    const b = sect[(i + 1) % sect.length]
    s.quad(v3(x0, a.y, a.z), v3(x1, a.y, a.z), v3(x1, b.y, b.z), v3(x0, b.y, b.z))
  }
  const poly = sect.map((p) => new THREE.Vector2(p.z, p.y))
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(poly, [])) {
    s.tri(v3(x0, sect[i].y, sect[i].z), v3(x0, sect[j].y, sect[j].z), v3(x0, sect[k].y, sect[k].z))
    s.tri(v3(x1, sect[k].y, sect[k].z), v3(x1, sect[j].y, sect[j].z), v3(x1, sect[i].y, sect[i].z))
  }
}

/** A rectangle in the z-y plane, as a closed section. */
const rect = (z0: number, y0: number, z1: number, y1: number): Pt[] => [
  { z: z0, y: y0 }, { z: z1, y: y0 }, { z: z1, y: y1 }, { z: z0, y: y1 },
]

/** One seat, origin at the tread under it, facing -z (the track). Its back sits against the riser
 *  behind, which is where a real one is bolted and what leaves the legroom in front. */
export function seatGeometry(form: SeatForm, lod: SeatLod): THREE.BufferGeometry {
  const s = new GeometrySink()
  const hw = SEAT_W_M / 2
  const t = 0.035
  // Back edge of the pan sits at the riser; it tips a couple of degrees forward so it drains and
  // reads as moulded rather than as a shelf.
  const panBack = -0.04
  const panFront = -0.46
  if (lod === 'low') {
    // Two sheets and nothing else: at the range this tier serves, a seat is a dark notch above a
    // bright pan, and every gram of geometry past that is invisible.
    s.quad(
      v3(-hw, SEAT_H_M, panBack), v3(hw, SEAT_H_M, panBack),
      v3(hw, SEAT_H_M + 0.03, panFront), v3(-hw, SEAT_H_M + 0.03, panFront),
    )
    s.quad(
      v3(-hw, SEAT_H_M, panBack), v3(hw, SEAT_H_M, panBack),
      v3(hw, SEAT_H_M + 0.46, panBack + 0.09), v3(-hw, SEAT_H_M + 0.46, panBack + 0.09),
    )
    return s.build()
  }
  prism(s, [
    { z: panBack, y: SEAT_H_M }, { z: panFront, y: SEAT_H_M + 0.03 },
    { z: panFront, y: SEAT_H_M + 0.03 - t }, { z: panBack, y: SEAT_H_M - t },
  ], -hw, hw)
  // Back panel, reclined 12 degrees.
  const lean = 0.09
  prism(s, [
    { z: panBack, y: SEAT_H_M }, { z: panBack - t, y: SEAT_H_M },
    { z: panBack - t + lean, y: SEAT_H_M + 0.46 }, { z: panBack + lean, y: SEAT_H_M + 0.46 },
  ], -hw, hw)
  // Pedestal: a single leg off the riser, which is how a tip-up seat is actually hung.
  prism(s, rect(panBack - 0.02, 0, panBack - 0.02 - 0.06, SEAT_H_M), -0.05, 0.05)
  prism(s, rect(panBack, SEAT_H_M - t, panBack - 0.16, SEAT_H_M - t - 0.05), -0.06, 0.06)
  if (lod === 'mid') return s.build()

  if (form === 'bucket') {
    // Wings: the wrap that turns a flat panel into a bucket, and the one part that reads as a
    // moulded shell rather than two boards at an angle.
    for (const x of [-hw, hw - 0.03]) {
      prism(s, [
        { z: panBack + lean, y: SEAT_H_M + 0.46 }, { z: panBack, y: SEAT_H_M },
        { z: panFront + 0.12, y: SEAT_H_M + 0.03 }, { z: panFront + 0.12, y: SEAT_H_M + 0.16 },
        { z: panBack - 0.02, y: SEAT_H_M + 0.30 },
      ], x, x + 0.03)
    }
    // Rolled front lip.
    prism(s, [
      { z: panFront, y: SEAT_H_M + 0.03 }, { z: panFront - 0.05, y: SEAT_H_M },
      { z: panFront - 0.02, y: SEAT_H_M - 0.05 }, { z: panFront, y: SEAT_H_M + 0.03 - t },
    ], -hw, hw)
  } else {
    // The shell seat's detail is its edges: a turned-up rim around the pan and a capping on the
    // back panel, which is what catches the sun on a real one.
    prism(s, rect(panFront, SEAT_H_M + 0.03, panFront + 0.04, SEAT_H_M + 0.08), -hw, hw)
    prism(s, [
      { z: panBack + lean, y: SEAT_H_M + 0.46 }, { z: panBack - t + lean, y: SEAT_H_M + 0.46 },
      { z: panBack - t + lean, y: SEAT_H_M + 0.50 }, { z: panBack + lean, y: SEAT_H_M + 0.50 },
    ], -hw, hw)
  }
  return s.build()
}

/** A gangway up through the seating, wide enough for two people to pass. */
const AISLE_W_M = 1.2
/** How much seating sits between two gangways. Nobody in a real stand climbs past more than about
 *  ten metres of knees to reach their seat, and it is the aisles more than anything that stop a
 *  bank of seating reading as a printed texture. */
const BANK_TARGET_M = 11

/** The seating banks: the spans of width left over once the gangways are taken out. There is one
 *  gangway at each end as well as between banks, because the end of a row has to reach a way down
 *  too. */
export function seatBanks(spec: GrandstandSpec): { x0: number; x1: number }[] {
  const n = Math.max(1, Math.round(spec.widthM / BANK_TARGET_M))
  const pitch = spec.widthM / n
  const half = Math.max(0.6, (pitch - AISLE_W_M) / 2)
  return Array.from({ length: n }, (_, i) => {
    const c = -spec.widthM / 2 + (i + 0.5) * pitch
    return { x0: c - half, x1: c + half }
  })
}

/** Gangway centres, which is every gap between banks plus the two ends. */
function aisleXs(spec: GrandstandSpec): number[] {
  const banks = seatBanks(spec)
  const xs = [(-spec.widthM / 2 + banks[0].x0) / 2]
  for (let i = 0; i + 1 < banks.length; i++) xs.push((banks[i].x1 + banks[i + 1].x0) / 2)
  xs.push((banks[banks.length - 1].x1 + spec.widthM / 2) / 2)
  return xs
}

/** Where every seat in the stand is. The seats and the people in them are two separate instanced
 *  draws off ONE list of positions: a crowd sitting anywhere but on the seats is the single most
 *  obvious way this comes apart, and deriving the positions twice is how that happens. */
export function seatPositions(
  spec: GrandstandSpec, rows: readonly StandRow[],
): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = []
  for (const bank of seatBanks(spec)) {
    const w = bank.x1 - bank.x0
    const n = Math.max(1, Math.floor(w / SEAT_PITCH_M))
    const pad = (w - n * SEAT_PITCH_M) / 2
    for (const row of rows) {
      for (let c = 0; c < n; c++) {
        out.push({ x: bank.x0 + pad + (c + 0.5) * SEAT_PITCH_M, y: row.y, z: row.z + spec.runM })
      }
    }
  }
  return out
}

/** The gangways themselves: half-height steps up each one, and a handrail down both sides.
 *
 *  Half steps because a row's rise is 420 mm and nobody climbs that as a stair. Two steps per row is
 *  what a real stand does, and it is also what makes a gangway read as a stair rather than as a strip
 *  of missing seats.
 *
 *  Lifted a couple of centimetres and pulled the same distance toward the track, so no face of it is
 *  ever coplanar with the deck underneath: the stair and the rake share every tread height and every
 *  riser plane otherwise, and the depth buffer cannot separate them. */
export function buildAisles(
  spec: GrandstandSpec, rows: readonly StandRow[], skin: Skin = null,
): THREE.Group {
  const group = new THREE.Group()
  const lift = 0.025
  const tiers = spec.massing === 'twoTier'
    ? [rows.slice(0, spec.rows), rows.slice(spec.rows)]
    : [rows]
  const steps = new GeometrySink()
  const rail = new GeometrySink()
  for (const xs of [aisleXs(spec)]) {
    for (const cx of xs) {
      const [ax0, ax1] = [cx - AISLE_W_M / 2, cx + AISLE_W_M / 2]
      for (const tier of tiers) {
        if (tier.length === 0) continue
        // Two half-steps per row, walked as a section and swept across the gangway. `floor` is the
        // height of the seating deck under each of those points, which is simply that row's own
        // tread: the gangway climbs at half the rake's pitch, so its second step of every pair
        // stands 210 mm clear of the deck beside it.
        const prof: Pt[] = []
        const floor: number[] = []
        for (const row of tier) {
          const [hz, hy] = [spec.runM / 2, spec.riseM / 2]
          prof.push({ z: row.z - lift, y: row.y + lift })
          prof.push({ z: row.z + hz - lift, y: row.y + lift })
          prof.push({ z: row.z + hz - lift, y: row.y + hy + lift })
          prof.push({ z: row.z + spec.runM - lift, y: row.y + hy + lift })
          prof.push({ z: row.z + spec.runM - lift, y: row.y + spec.riseM + lift })
          for (let k = 0; k < 5; k++) floor.push(row.y)
        }
        for (let i = 0; i + 1 < prof.length; i++) {
          const [a, b] = [prof[i], prof[i + 1]]
          steps.quad(v3(ax0, a.y, a.z), v3(ax1, a.y, a.z), v3(ax1, b.y, b.z), v3(ax0, b.y, b.z))
          // The cheeks. Without them the flight is a ribbon of tread surfaces with nothing holding
          // them up: every half-step that clears the deck reads as a plate floating in mid air, and
          // you can see straight under it from the side.
          steps.quad(
            v3(ax0, a.y, a.z), v3(ax0, b.y, b.z), v3(ax0, floor[i + 1], b.z), v3(ax0, floor[i], a.z),
          )
          steps.quad(
            v3(ax1, floor[i], a.z), v3(ax1, floor[i + 1], b.z), v3(ax1, b.y, b.z), v3(ax1, a.y, a.z),
          )
        }
        // And the riser at the foot of the flight, so it does not start as an open shell.
        const foot = prof[0]
        steps.quad(
          v3(ax0, floor[0], foot.z), v3(ax1, floor[0], foot.z),
          v3(ax1, foot.y, foot.z), v3(ax0, foot.y, foot.z),
        )
        // Handrail down both sides, following the nosings a metre up, on posts every few steps.
        const first = tier[0]
        const last = tier[tier.length - 1]
        const railY = (r: StandRow) => r.y + RAIL_H_M
        for (const x of [ax0 + 0.06, ax1 - 0.06]) {
          strut(rail, p3(x, railY(first), first.z), p3(x, railY(last) + spec.riseM, last.z + spec.runM), 0.035)
          for (let i = 0; i < tier.length; i += 4) {
            const r = tier[i]
            strut(rail, p3(x, r.y, r.z + 0.1), p3(x, railY(r), r.z + 0.1), 0.03)
          }
        }
      }
    }
  }
  const deck = of(skin, 'deck')
  const steel = of(skin, 'steel')
  group.add(mesh(steps.build(), scanned(skin, 'deck', CONCRETE), deck))
  const rails = mesh(
    rail.build(), skinned(RAIL_STEEL, steel, { roughness: ROUGH.paint, metalness: 0.6 }), steel,
  )
  rails.castShadow = false
  group.add(rails)
  return group
}

/** Every seat in the stand, as one instanced draw. A bench row is not instanced per seat: it is one
 *  run of plank per row, because that is what a bench is. */
export function buildSeats(
  spec: GrandstandSpec, rows: readonly StandRow[], form: SeatForm, lod: SeatLod, skin: Skin = null,
  /** Metres per WORLD unit, for converting the ladder's bands into the space LOD measures in. */
  metresPerUnit = 1,
): THREE.Object3D {
  const grain = of(skin, 'seat')
  const mat = skinned(SEAT_COLOUR, grain, { roughness: ROUGH.paint })
  if (form === 'bench') {
    const s = new GeometrySink()
    for (const row of rows) {
      const zBack = row.z + spec.runM
      prism(s, rect(zBack - 0.06, row.y + SEAT_H_M, zBack - 0.5, row.y + SEAT_H_M - 0.05),
        -spec.widthM / 2, spec.widthM / 2)
      prism(s, rect(zBack - 0.04, row.y + SEAT_H_M + 0.26, zBack - 0.1, row.y + SEAT_H_M + 0.44),
        -spec.widthM / 2, spec.widthM / 2)
    }
    const bench = mesh(s.build(), mat, grain)
    bench.name = 'seats'
    return bench
  }
  const at = seatPositions(spec, rows)
  const m = new THREE.Matrix4()
  const bank = (tier: Exclude<SeatLod, 'auto'>): THREE.InstancedMesh => {
    const geo = seatGeometry(form, tier)
    if (grain) faceUV(geo, grain.tileM)
    const inst = new THREE.InstancedMesh(geo, mat, at.length)
    inst.castShadow = true
    inst.receiveShadow = true
    at.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z)
      inst.setMatrixAt(i, m)
    })
    inst.name = `seats:${tier}`
    return inst
  }
  if (lod !== 'auto') return bank(lod)
  // Every tier is the same instance list, so a seat never moves as the ladder switches; only what a
  // seat is made of changes. The levels are built up front rather than on demand: a stand that
  // stutters the first time the camera closes in is worse than one that costs a megabyte.
  const ladder = new THREE.LOD()
  // Named on the LADDER, not on its banks: the levels' own `visible` is rewritten by `LOD.update`
  // on every render, so anything switching the seats off has to switch off the thing that owns them.
  ladder.name = 'seats'
  ladder.addLevel(bank('high'), 0)
  ladder.addLevel(bank('mid'), LOD_M.mid / metresPerUnit)
  ladder.addLevel(bank('low'), LOD_M.low / metresPerUnit)
  return ladder
}

/** The concourse band between the two tiers, glazed. That face is where the hospitality boxes look
 *  out of, and left blank it is three and a half metres of bare concrete across the middle of the
 *  stand: the one surface at eye height from the track with nothing on it.
 *
 *  The glass is pulled INTO the face rather than laid on it, with the mullions standing proud, so the
 *  band reads as a window with a frame rather than as a decal of one. */
function buildBand(
  spec: GrandstandSpec, band: { z: number; y0: number; y1: number }, skin: Skin = null,
): THREE.Group {
  const group = new THREE.Group()
  const x0 = -spec.widthM / 2
  const x1 = spec.widthM / 2
  const sill = band.y0 + 0.78
  const head = band.y1 - 0.5
  // A curtain wall hung on the FRONT of the concrete, which is how one is built and, here, the only
  // way it can be seen: the deck's own sweep already puts a solid sheet at `band.z`. The piers stand
  // proud of the glass, and that projection is the whole depth of the thing.
  const zFront = band.z - 0.26
  const zGlass = band.z - 0.1
  const piers = new GeometrySink()
  const returns = new GeometrySink()
  const glass = new GeometrySink()
  const frame = new GeometrySink()

  // Structural piers on the bay grid, standing the full height of the band and PROJECTING FORWARD
  // off it. They are what turn one 64 m ribbon of glazing into a row of window bays, and their
  // projection is where the wall's depth and its shadow come from.
  const pierW = 0.9
  const xs = bayXs(spec.widthM, 7.5)
  const spans: { a: number; b: number }[] = []
  for (let i = 0; i + 1 < xs.length; i++) spans.push({ a: xs[i] + pierW / 2, b: xs[i + 1] - pierW / 2 })
  for (const x of xs) {
    const [px0, px1] = [Math.max(x0, x - pierW / 2), Math.min(x1, x + pierW / 2)]
    piers.quad(v3(px0, band.y0, zFront), v3(px1, band.y0, zFront),
      v3(px1, band.y1, zFront), v3(px0, band.y1, zFront))
    piers.quad(v3(px0, band.y0, band.z), v3(px0, band.y1, band.z),
      v3(px0, band.y1, zFront), v3(px0, band.y0, zFront))
    piers.quad(v3(px1, band.y1, band.z), v3(px1, band.y0, band.z),
      v3(px1, band.y0, zFront), v3(px1, band.y1, zFront))
  }

  for (const span of spans) {
    if (span.b - span.a < 0.3) continue
    // Spandrel below the sill and the panel above the head: the solid parts of a curtain wall, in
    // their own darker cladding so the band is not one flat value top to bottom. Their edges turn
    // back to the concrete, which is the reveal around the glass.
    for (const [ya, yb] of [[band.y0, sill], [head, band.y1]] as const) {
      returns.quad(v3(span.a, ya, zGlass - 0.04), v3(span.b, ya, zGlass - 0.04),
        v3(span.b, yb, zGlass - 0.04), v3(span.a, yb, zGlass - 0.04))
    }
    for (const y of [sill, head]) {
      returns.quad(v3(span.a, y, zGlass - 0.04), v3(span.b, y, zGlass - 0.04),
        v3(span.b, y, band.z), v3(span.a, y, band.z))
    }
    // The pane, hung just off the concrete. It sits in FRONT of the wall, not behind it: the deck's
    // own sweep puts a solid sheet at exactly this plane, so a pane set back into the wall is a pane
    // nobody can see, which is why the band read as flat concrete however it was framed.
    glass.quad(v3(span.a, sill, zGlass), v3(span.b, sill, zGlass),
      v3(span.b, head, zGlass), v3(span.a, head, zGlass))
    // Mullions splitting each bay, standing proud of the glass.
    const bays = Math.max(1, Math.round((span.b - span.a) / 1.9))
    for (let i = 0; i <= bays; i++) {
      const x = span.a + ((span.b - span.a) * i) / bays
      strut(frame, p3(x, sill, zGlass - 0.07), p3(x, head, zGlass - 0.07), 0.05)
    }
    for (const y of [sill + 0.02, head - 0.02]) {
      strut(frame, p3(span.a, y, zGlass - 0.07), p3(span.b, y, zGlass - 0.07), 0.06)
    }
  }

  const wall = of(skin, 'wall')
  const steel = of(skin, 'steel')
  group.add(mesh(piers.build(), scanned(skin, 'wall', CONCRETE), wall))
  // The SAME material as the piers, not a variant of it. The seam here was never the join, it was the
  // tint: one scan at two brightnesses meeting at a hard edge reads as a texture error, because the
  // staining runs up to the edge and stops. Giving the spandrel its own material was the wrong fix
  // for that, and left a blank panel beside textured concrete.
  //
  // Identical material makes the wall continuous, and it genuinely is: `faceUV` projects any face
  // whose normal is mostly +/-z off the SAME x-y axes, so the piers standing proud and the spandrel
  // set behind them share one unbroken UV field despite sitting on different planes. The concrete
  // flows across the join and the window openings read as holes cut in one wall.
  group.add(mesh(returns.build(), scanned(skin, 'wall', CONCRETE), wall))
  // Sky-toned and lightly reflective, NOT a dark mirror. Glazing seen from outside in daylight is
  // mostly the sky bounced back at you, so it sits within a shade or two of the concrete around it.
  // Rendering it dark is technically what a window into an unlit room does, and it turned the band
  // into a black void slashed across the middle of the stand: the eye reads a hole, not a building.
  const pane = mesh(glass.build(), surface(GLASS, { roughness: 0.16, metalness: 0.35 }))
  pane.castShadow = false
  group.add(pane)
  group.add(mesh(
    frame.build(), skinned(MULLION, steel, { roughness: ROUGH.paint, metalness: 0.5 }), steel,
  ))
  return group
}

/** The barriers at the front edge of each tier.
 *
 *  Every tier ends in a drop and somebody's seat is in the front row of it. The trackside wall is a
 *  RETAINING wall holding the deck up, not a barrier: the front row's feet are level with its top,
 *  so without this the front row of the lower tier looks over a 1.1 m fall to the ground and the
 *  front row of the upper tier over a 3.4 m fall onto the concourse.
 *
 *  Glass on a steel top rail rather than a solid wall, because the person it protects paid to see
 *  the circuit and a metre of concrete at chest height is what they would be looking at instead. */
function buildBarriers(
  spec: GrandstandSpec, band: { z: number; y0: number; y1: number } | null, skin: Skin = null,
): THREE.Group {
  const group = new THREE.Group()
  const x0 = -spec.widthM / 2
  const x1 = spec.widthM / 2
  const edges = [{ z: 0, y: spec.frontWallM }]
  if (band) edges.push({ z: band.z, y: band.y1 })
  const glass = new GeometrySink()
  const steel = new GeometrySink()
  for (const e of edges) {
    const top = e.y + BARRIER_H_M
    // Just proud of the edge, so the panel is a thing standing at the lip rather than a sheet
    // buried in the deck's own end face.
    const z = e.z - 0.05
    glass.quad(v3(x0, e.y + 0.06, z), v3(x1, e.y + 0.06, z), v3(x1, top, z), v3(x0, top, z))
    strut(steel, p3(x0, top, z), p3(x1, top, z), 0.045)
    strut(steel, p3(x0, e.y + 0.06, z), p3(x1, e.y + 0.06, z), 0.035)
    for (const x of bayXs(spec.widthM, 2.2)) {
      strut(steel, p3(x, e.y, z), p3(x, top, z), 0.04)
    }
  }
  const pane = mesh(glass.build(), surface(BARRIER_GLASS, {
    alpha: 0.22, roughness: ROUGH.gloss, metalness: 0.1,
  }))
  pane.castShadow = false
  group.add(pane)
  const grain = of(skin, 'steel')
  const rails = mesh(
    steel.build(), skinned(RAIL_STEEL, grain, { roughness: ROUGH.paint, metalness: 0.6 }), grain,
  )
  rails.castShadow = false
  group.add(rails)
  return group
}

/** Timber cladding along the trackside face, panel by panel.
 *
 *  This is the one surface of a grandstand that a car goes past at two hundred, and left as bare
 *  concrete it is the flattest thing on the circuit. Panels rather than one continuous board, because
 *  the joints are what give the frontage a rhythm as you sweep along it.
 *
 *  Held off the wall on its own plane with a shadow gap top and bottom, which is how cladding hangs.
 *  Same timber as the stair towers, so the two read as one decision about the building rather than as
 *  two unrelated finishes. */
function buildFrontage(spec: GrandstandSpec, skin: Skin): THREE.Group {
  const group = new THREE.Group()
  const y0 = 0.14
  const y1 = spec.frontWallM - 0.12
  const z = -0.07
  const n = Math.max(2, Math.round(spec.widthM / 3))
  const w = spec.widthM / n
  const boards = new GeometrySink()
  for (let i = 0; i < n; i++) {
    const [bx0, bx1] = [-spec.widthM / 2 + i * w + 0.04, -spec.widthM / 2 + (i + 1) * w - 0.04]
    boards.quad(v3(bx0, y0, z), v3(bx1, y0, z), v3(bx1, y1, z), v3(bx0, y1, z))
    // The panel's own edge, so it reads as cladding standing off a wall rather than as paint on one.
    boards.quad(v3(bx0, y1, z), v3(bx1, y1, z), v3(bx1, y1, 0), v3(bx0, y1, 0))
    boards.quad(v3(bx1, y0, z), v3(bx0, y0, z), v3(bx0, y0, 0), v3(bx1, y0, 0))
  }
  const board = mesh(
    boards.build(), scanned(skin, 'wood', WOOD, undefined, { roughness: ROUGH.matte }),
    of(skin, 'wood'),
  )
  board.castShadow = false
  group.add(board)
  return group
}

/** An axis-aligned box, closed on all six faces. */
function boxGeometry(
  x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
): THREE.BufferGeometry {
  const s = new GeometrySink()
  s.quad(v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, y1, z0), v3(x0, y1, z0))
  s.quad(v3(x1, y0, z1), v3(x0, y0, z1), v3(x0, y1, z1), v3(x1, y1, z1))
  s.quad(v3(x1, y0, z0), v3(x1, y0, z1), v3(x1, y1, z1), v3(x1, y1, z0))
  s.quad(v3(x0, y0, z1), v3(x0, y0, z0), v3(x0, y1, z0), v3(x0, y1, z1))
  s.quad(v3(x0, y1, z0), v3(x1, y1, z0), v3(x1, y1, z1), v3(x0, y1, z1))
  s.quad(v3(x0, y0, z1), v3(x1, y0, z1), v3(x1, y0, z0), v3(x0, y0, z0))
  return s.build()
}

/** A stair tower at each end, against the rear corner.
 *
 *  Four thousand people have to GET to the top row, and until there is a way up, the stand's two ends
 *  are bare concrete triangles and its back is one flat wall sixteen metres high. A tower answers
 *  both at once, and it is what every real stand does with that corner.
 *
 *  Glazed in a vertical slot up the outer face, which is the stair landing's window and the one thing
 *  that gives the back of a stand a scale you can read a storey off. */
function buildTowers(spec: GrandstandSpec, pts: readonly Pt[], skin: Skin = null): THREE.Group {
  const group = new THREE.Group()
  const back = pts[pts.length - 1]
  const walkY = back.y - spec.parapetM
  const h = walkY + 1.4
  const d = 5.2
  const w = 4.2
  const wall = of(skin, 'wall')
  const steel = of(skin, 'steel')
  // Timber-clad box with concrete floor bands showing through the glazed slot: the tower is the one
  // piece of a stand that is a BUILDING rather than a structure, and cladding is what says so.
  const shell = scanned(skin, 'wood', WOOD, undefined, { roughness: ROUGH.matte })
  const band = scanned(skin, 'wall', CONCRETE)
  const glassMat = surface(GLASS, { roughness: ROUGH.gloss, metalness: 0.15 })
  for (const side of [-1, 1]) {
    const xOuter = side * (spec.widthM / 2 + w)
    const xInner = side * spec.widthM / 2
    const [x0, x1] = side < 0 ? [xOuter, xInner] : [xInner, xOuter]
    group.add(mesh(boxGeometry(x0, x1, 0, h, back.z - d, back.z), shell, of(skin, 'wood')))
    // The stair window: a slot up the outer face, floated clear of it.
    const gx = xOuter - side * 0.06
    const slot = new GeometrySink()
    slot.quad(
      v3(gx, 1.2, back.z - d + 1.1), v3(gx, 1.2, back.z - 1.1),
      v3(gx, h - 1.1, back.z - 1.1), v3(gx, h - 1.1, back.z - d + 1.1),
    )
    const pane = mesh(slot.build(), glassMat)
    pane.castShadow = false
    group.add(pane)
    // Floor bands across the slot, one per landing: the storeys a stair actually has.
    const bands = new GeometrySink()
    for (let y = 3.2; y < h - 1.4; y += 3.2) {
      strut(bands, p3(gx, y, back.z - d + 1.1), p3(gx, y, back.z - 1.1), 0.11)
    }
    group.add(mesh(bands.build(), band, wall))
  }
  return group
}

/** Deck height at a depth, read off the section. What decides roof clearance: the seat under the
 *  leading edge is the one whose headroom is tightest. */
function deckYAt(pts: readonly Pt[], z: number): number {
  let y = pts[0].y
  for (const p of pts) if (p.z <= z) y = Math.max(y, p.y)
  return y
}

/** A roof plane with a real thickness: top surface, soffit, and a rim closing the two long edges
 *  and the leading edge. A roof modelled as one infinitely thin quad is the single most obvious tell
 *  in a cheap stand, because the leading edge is exactly what the camera looks up at. */
function sheet(pts: readonly Pt[], x0: number, x1: number, thick: number): THREE.BufferGeometry {
  const s = new GeometrySink()
  const low = pts.map((p) => ({ z: p.z, y: p.y - thick }))
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]]
    const [c, d] = [low[i + 1], low[i]]
    s.quad(v3(x0, a.y, a.z), v3(x1, a.y, a.z), v3(x1, b.y, b.z), v3(x0, b.y, b.z))
    s.quad(v3(x1, d.y, d.z), v3(x0, d.y, d.z), v3(x0, c.y, c.z), v3(x1, c.y, c.z))
    for (const x of [x0, x1]) {
      s.quad(v3(x, a.y, a.z), v3(x, b.y, b.z), v3(x, c.y, c.z), v3(x, d.y, d.z))
    }
  }
  const [f, l] = [pts[0], pts[pts.length - 1]]
  s.quad(v3(x0, f.y, f.z), v3(x1, f.y, f.z), v3(x1, f.y - thick, f.z), v3(x0, f.y - thick, f.z))
  s.quad(v3(x1, l.y, l.z), v3(x0, l.y, l.z), v3(x0, l.y - thick, l.z), v3(x1, l.y - thick, l.z))
  return s.build()
}

/** Lift a covering clear of the steel carrying it. A roof deck laid at the same height as its own
 *  purlins has them intersecting it, so the members show through the sheet as a grid of lines and
 *  the roof reads as glazing rather than as cladding on a frame. Real decking sits ON the structure,
 *  which is what this offset is. */
const lifted = (pts: readonly Pt[], dy: number): Pt[] => pts.map((p) => ({ z: p.z, y: p.y + dy }))

/** Profiled metal decking: matte, barely metallic. Reflective enough to be metal and it mirrors the
 *  sky, at which point a roof deck reads as a pane of blue glass from anywhere above it. */
const roofDeck = (grain: SurfaceDetail | null) => skinned(ROOF_SHEET, grain, {
  roughness: ROUGH.matte, metalness: 0.12,
})

/** Bay lines across the width. Steel comes in bays, and everything structural lands on one. */
function bayXs(widthM: number, spacingM: number): number[] {
  const n = Math.max(2, Math.round(widthM / spacingM))
  return Array.from({ length: n + 1 }, (_, i) => -widthM / 2 + (widthM * i) / n)
}

/** The roof: masts, trusses and covering, in the style asked for. */
function buildRoof(spec: GrandstandSpec, pts: readonly Pt[], skin: Skin = null): THREE.Group {
  const group = new THREE.Group()
  if (spec.roof === 'none') return group
  const back = pts[pts.length - 1]
  const x0 = -spec.widthM / 2
  const x1 = spec.widthM / 2
  const grain = of(skin, 'steel')
  const deckGrain = of(skin, 'roof')
  const skinMat = of(skin, 'membrane')
  const steelMat = skinned(STEEL, grain, { roughness: ROUGH.paint, metalness: 0.55 })
  const steel = new GeometrySink()
  const xs = bayXs(spec.widthM, 8)

  if (spec.roof === 'pitched') {
    // Two column lines. The front one lands on the trackside parapet, which is exactly the sin of
    // this roof: those columns stand in somebody's sightline, and always did.
    const zF = 0.7
    const yEaveF = deckYAt(pts, zF) + 8.5
    const yEaveR = back.y + 2.4
    const zRidge = back.z * 0.5
    const yRidge = Math.max(yEaveF, yEaveR) + 3.2
    for (const x of xs) {
      strut(steel, p3(x, 0, zF), p3(x, yEaveF, zF), 0.22)
      strut(steel, p3(x, back.y - spec.parapetM, back.z), p3(x, yEaveR, back.z), 0.22)
      // Rafter over the ridge, with a collar tie: the truss a pitched roof actually needs to stop
      // its two slopes pushing the columns apart.
      strut(steel, p3(x, yEaveF, zF), p3(x, yRidge, zRidge), 0.16)
      strut(steel, p3(x, yRidge, zRidge), p3(x, yEaveR, back.z), 0.16)
      const tie = Math.min(yEaveF, yEaveR) + 0.9
      strut(steel, p3(x, tie, zF + (zRidge - zF) * 0.55), p3(x, tie, back.z - (back.z - zRidge) * 0.55), 0.11)
    }
    // Purlins along the two slopes, and an eaves beam on each column line.
    for (const t of [0.3, 0.65]) {
      strut(steel, p3(x0, yEaveF + (yRidge - yEaveF) * t, zF + (zRidge - zF) * t),
        p3(x1, yEaveF + (yRidge - yEaveF) * t, zF + (zRidge - zF) * t), 0.1)
      strut(steel, p3(x0, yRidge + (yEaveR - yRidge) * t, zRidge + (back.z - zRidge) * t),
        p3(x1, yRidge + (yEaveR - yRidge) * t, zRidge + (back.z - zRidge) * t), 0.1)
    }
    strut(steel, p3(x0, yEaveF, zF), p3(x1, yEaveF, zF), 0.2)
    strut(steel, p3(x0, yEaveR, back.z), p3(x1, yEaveR, back.z), 0.2)
    group.add(mesh(sheet(lifted([
      { z: zF - 1.2, y: yEaveF - 0.5 }, { z: zRidge, y: yRidge }, { z: back.z + 1.0, y: yEaveR - 0.4 },
    ], 0.42), x0, x1, 0.35), roofDeck(deckGrain), deckGrain))
  } else {
    // Both remaining styles hang everything off a rear mast line and reach forward over the crowd,
    // which is the whole point of them: no steel in front of a seat.
    const zLead = back.z * 0.34
    const yLead = Math.max(deckYAt(pts, zLead) + 3.4, back.y + 2.2)
    const zMast = back.z + 1.6
    const yMast = yLead + (spec.roof === 'canopy' ? 7.0 : 4.6)
    for (const x of xs) {
      strut(steel, p3(x, 0, zMast), p3(x, yMast, zMast), 0.3)
      // Backstay: the tie that makes a cantilever stand up, anchored behind the stand.
      strut(steel, p3(x, yMast, zMast), p3(x, 0.2, zMast + 7), 0.12)
    }
    strut(steel, p3(x0, yMast, zMast), p3(x1, yMast, zMast), 0.24)

    if (spec.roof === 'cantilever') {
      // A tapered truss per bay: deep at the mast, shallow at the tip, web members between the
      // chords. The taper is what makes it read as engineered rather than as a slab on sticks.
      const depthBack = 1.5
      const depthTip = 0.5
      const chordY = (t: number) => yMast + (yLead - yMast) * t
      const chordZ = (t: number) => zMast + (zLead - zMast) * t
      const web = 6
      for (const x of xs) {
        for (let i = 0; i < web; i++) {
          const [t0, t1] = [i / web, (i + 1) / web]
          strut(steel, p3(x, chordY(t0), chordZ(t0)), p3(x, chordY(t1), chordZ(t1)), 0.12)
          const d0 = depthBack + (depthTip - depthBack) * t0
          const d1 = depthBack + (depthTip - depthBack) * t1
          strut(steel, p3(x, chordY(t0) - d0, chordZ(t0)), p3(x, chordY(t1) - d1, chordZ(t1)), 0.12)
          strut(steel, p3(x, chordY(t0), chordZ(t0)), p3(x, chordY(t1) - d1, chordZ(t1)), 0.08)
          strut(steel, p3(x, chordY(t0) - d0, chordZ(t0)), p3(x, chordY(t0), chordZ(t0)), 0.08)
        }
      }
      for (const t of [0.25, 0.6, 0.95]) {
        strut(steel, p3(x0, chordY(t), chordZ(t)), p3(x1, chordY(t), chordZ(t)), 0.1)
      }
      group.add(mesh(sheet(lifted(
        [{ z: zLead, y: yLead }, { z: zMast + 0.9, y: yMast }], 0.42,
      ), x0, x1, 0.3), roofDeck(deckGrain), deckGrain))
      // The fascia band along the leading edge: the deep painted lip a stand carries its sponsor on.
      const fascia = new GeometrySink()
      fascia.quad(
        v3(x0, yLead - 0.3, zLead), v3(x1, yLead - 0.3, zLead),
        v3(x1, yLead - 1.5, zLead), v3(x0, yLead - 1.5, zLead),
      )
      group.add(mesh(
        fascia.build(), skinned(ROOF_FASCIA, grain, { roughness: ROUGH.paint }), grain,
      ))
    } else {
      // A curved rib, sagging forward off the mast head to a front cable: sampled as a quadratic
      // through a control point pulled high and back, so the arc is taut near the mast and falls
      // away over the seats the way a stressed membrane does.
      const arc: Pt[] = []
      const N = 12
      const ctrl = { z: zMast * 0.45 + zLead * 0.55, y: yMast + 0.6 }
      for (let i = 0; i <= N; i++) {
        const t = i / N
        const w = (1 - t) * (1 - t)
        const m = 2 * (1 - t) * t
        const e = t * t
        arc.push({
          z: w * zMast + m * ctrl.z + e * zLead,
          y: w * yMast + m * ctrl.y + e * yLead,
        })
      }
      for (const x of xs) {
        for (let i = 0; i + 1 < arc.length; i++) {
          strut(steel, p3(x, arc[i].y, arc[i].z), p3(x, arc[i + 1].y, arc[i + 1].z), 0.13)
        }
      }
      const edge = arc[arc.length - 1]
      strut(steel, p3(x0, edge.y, edge.z), p3(x1, edge.y, edge.z), 0.16)
      group.add(mesh(sheet(lifted(arc, 0.19), x0, x1, 0.12), skinned(MEMBRANE, skinMat, {
        roughness: ROUGH.chalk, specular: 0.4,
      }), skinMat))
    }
  }
  if (!steel.empty) group.add(mesh(steel.build(), steelMat, grain))
  return group
}

/** Fit a stand to a footprint the circuit's scenery has already reserved for it.
 *
 *  The generator places stands 45-95 m wide and 12-17 m deep, and a depth is a ROW COUNT: the rake
 *  is fixed by sightlines, so the only thing a shallower footprint can do is hold fewer rows. What it
 *  cannot do is hold two tiers, which need better than 30 m, so every stand a circuit places is a
 *  single-tier one under a cantilever roof and `PIT_STAND` stays for a footprint big enough to
 *  deserve it.
 *
 *  The back of the house is subtracted first: the top walkway and the parapet are depth the seating
 *  never gets, and rows counted against the raw footprint would push the parapet out past the
 *  ground the stand was given. */
export function standSpecFor(widthM: number, depthM: number): GrandstandSpec {
  const base = MAJOR_STAND
  const seating = depthM - base.topWalkM - PARAPET_THICK_M
  const rows = Math.max(4, Math.floor(seating / base.runM))
  return { ...base, widthM, rows, upperRows: 0, massing: 'plinth', roof: 'cantilever' }
}

/** The bowl: seating deck, ends, and whatever holds it up. No seats, no roof, no crowd yet. */
export function buildGrandstand(
  spec: GrandstandSpec, seats: { form: SeatForm; lod: SeatLod; metresPerUnit?: number } | null = null,
  crowd: { fill: number; seed?: number; scale?: number } | null = null, skin: Skin = null,
): THREE.Group {
  const group = new THREE.Group()
  const { pts, rows, band } = standSection(spec)
  const x0 = -spec.widthM / 2
  const x1 = spec.widthM / 2
  const deckGrain = of(skin, 'deck')
  const wallGrain = of(skin, 'wall')
  const deck = scanned(skin, 'deck', CONCRETE)
  const under = scanned(skin, 'wall', CONCRETE_DARK, '#D6D9DD')
  const back = pts[pts.length - 1]

  group.add(mesh(sweep(pts, x0, x1), deck, deckGrain))

  if (spec.massing === 'columns') {
    const thick = 0.55
    const low = soffit(pts, thick)
    // The slab is a closed solid: top sheet, soffit, and a rim around both ends, so the deck reads
    // as a thing with a thickness when the camera drops under it.
    group.add(mesh(sweep(low, x0, x1), under, wallGrain))
    for (const [x, flip] of [[x0, true], [x1, false]] as const) {
      const s = new GeometrySink()
      for (let i = 0; i + 1 < pts.length; i++) {
        const [a, b, c, d] = [pts[i], pts[i + 1], low[i + 1], low[i]]
        if (flip) s.quad(v3(x, a.y, a.z), v3(x, d.y, d.z), v3(x, c.y, c.z), v3(x, b.y, b.z))
        else s.quad(v3(x, a.y, a.z), v3(x, b.y, b.z), v3(x, c.y, c.z), v3(x, d.y, d.z))
      }
      group.add(mesh(s.build(), under, wallGrain))
    }
    // A column grid on the bays: one row of legs at the back where the deck is highest, one
    // mid-span. The front sits low enough to land on a plain plinth wall.
    const colW = 0.7
    const bays = Math.max(2, Math.round(spec.widthM / 9))
    const legZ = [back.z * 0.45, back.z * 0.88]
    const colMat = scanned(skin, 'wall', CONCRETE_DARK, '#D6D9DD')
    for (let i = 0; i <= bays; i++) {
      const x = x0 + (spec.widthM * i) / bays
      for (const z of legZ) {
        const yTop = spec.frontWallM + (z / back.z) * (back.y - spec.frontWallM) - thick
        const col = mesh(columnGeometry(colW, yTop, colW), colMat, wallGrain)
        col.position.set(x, 0, z)
        group.add(col)
      }
    }
    // The front edge still needs closing to the ground, or the crowd's feet float over the barrier.
    const plinth = new GeometrySink()
    plinth.quad(v3(x0, 0, 0), v3(x1, 0, 0), v3(x1, spec.frontWallM, 0), v3(x0, spec.frontWallM, 0))
    group.add(mesh(plinth.build(), deck, deckGrain))
  } else {
    group.add(mesh(endWall(pts, x0, true), deck, wallGrain))
    group.add(mesh(endWall(pts, x1, false), deck, wallGrain))
    const rear = new GeometrySink()
    rear.quad(v3(x0, 0, back.z), v3(x1, 0, back.z), v3(x1, back.y, back.z), v3(x0, back.y, back.z))
    group.add(mesh(rear.build(), under, wallGrain))
    const front = new GeometrySink()
    front.quad(v3(x0, 0, 0), v3(x1, 0, 0), v3(x1, spec.frontWallM, 0), v3(x0, spec.frontWallM, 0))
    group.add(mesh(front.build(), deck, wallGrain))
  }
  group.add(buildAisles(spec, rows, skin))
  group.add(buildFrontage(spec, skin))
  group.add(buildBarriers(spec, band, skin))
  group.add(buildTowers(spec, pts, skin))
  if (band) group.add(buildBand(spec, band, skin))
  if (seats) group.add(buildSeats(spec, rows, seats.form, seats.lod, skin, seats.metresPerUnit))
  if (crowd) {
    // A stand built on its own faces -z, so that is where its crowd looks. Placed in a circuit, the
    // world builder pools every stand's seats into one crowd instead and hands each its own facing.
    group.add(buildCrowd(
      seatPositions(spec, rows).map((p) => ({ ...p, fx: 0, fz: -1 })),
      crowd.fill, crowd.seed ?? 1, crowd.scale ?? 1,
    ))
  }
  group.add(buildRoof(spec, pts, skin))
  return group
}
