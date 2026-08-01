// #sim-2d — the pit complex as a solid. It is the tallest structure on any circuit and it was the one
// flat shape left on the map: no height, no shadow, while every shed in the infield had both.
//
// Two things here differ from an infield building on purpose:
//
//  1. The authored ring is the BASE, not the roof. Infield sheds anchor their roof because nothing is
//     aligned to them; this outline is surveyed against the lane and the boxes line up with it, so it
//     stays put on the ground and the mass lifts UP-light off it.
//  2. The garages are recesses in the front face rather than doors painted on it, which makes the
//     outline concave — hence a ring extrusion rather than the box extrusion the scenery uses.
//
// The complex itself is DRAW OPS, like the rest of the world. The garage name boards below are the one
// piece of it that stays in the SVG document, because they carry real text and real flag artwork and
// neither survives a `DrawOp`.

import { linePath, mapPathPoints, obliqueRingFaces, quad, ringPath, sweptRing, type Vec } from '@/lib/ui/extrude'
import {
  type Lighting, dirAt, lightDir, litFace, shadeFace, shadowFill, shadowOpacity, shadowReach,
  tintFace,
} from '@/lib/ui/lighting'
import type { PitZone } from '@/lib/ui/pit-zone'
import { EXTRUDE, type DrawOp } from '@/lib/ui/scenery-draw'
import { flagSvgUrl } from '@/components/world/NationalityFlag'

/** Roofline of the complex. Tall enough to throw a shadow across the lane, low enough that the wall
 *  face does not swallow the boxes at the tightest metres-per-unit. */
export const PIT_BUILDING_H_M = 8.5
/** Height of the garage opening. The storey above overhangs it, so this is also how deep the recess
 *  in the front face is measured vertically: a garage door, not a two-storey void. Exported for the
 *  3D complex, which stands the same storeys up for real (#3d-port). */
export const GARAGE_H_M = 3.2
/** Rooftop plant boxes stand this proud of the roof. */
export const PLANT_H_M = 2.2
/** Concrete-and-glass white, not another dark infield shed. */
export const PIT_WHITE = '#E4E2DC'

/** Height of the signage band on the fascia above each garage opening. */
export const SIGN_H_M = 1.5
/** Pixel size the flag is laid out at before being scaled into wall units. Sub-pixel layout boxes
 *  collapse, so it cannot simply be built at its final size — which on a garage board is a fraction
 *  of a unit. */
const FLAG_PX = 40

/** Driver name boards across each garage fascia, laid IN the plane of that wall.
 *
 *  A label drawn upright on a map is a map label; a real garage's signage sits on the building, so it
 *  takes the same basis the windows take — along the wall, and up it. The one concession to
 *  readability is that the run direction flips when it would otherwise write right-to-left. */
export function PitGarageSigns({ zone, u, lighting, view, drivers }: {
  zone: PitZone; u: (m: number) => number; lighting: Lighting; view: number
  drivers: (i: number) => Array<{ name: string; nationality?: string }>
}) {
  const dir = dirAt(view)
  const mid = u(GARAGE_H_M * EXTRUDE)
  const band = u(SIGN_H_M * EXTRUDE)
  return (
    <g style={{ userSelect: 'none', pointerEvents: 'none' }}>
      {zone.garageFloors.map((r, i) => {
        const crew = drivers(i)
        if (crew.length === 0) return null
        // Baseline runs along the fascia's ground edge; text hangs from the top of the band.
        const rev = r[1].x < r[0].x
        const a = rev ? r[1] : r[0]
        const b = rev ? r[0] : r[1]
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        if (len < 1e-6) return null
        const ex = (b.x - a.x) / len
        const ey = (b.y - a.y) / len
        // "Up the wall" is -dir, so the text's own +y (downward) is +dir.
        const lift = mid + band
        const org = { x: a.x - dir.x * lift, y: a.y - dir.y * lift }
        const m = `matrix(${ex} ${ey} ${dir.x} ${dir.y} ${org.x} ${org.y})`
        const size = band * 0.62
        return (
          <g key={`sg${i}`} transform={m}>
            <rect x={0} y={0} width={len} height={band} fill={shadeFace(PIT_WHITE, lighting)} />
            {crew.slice(0, 2).map((d, k) => {
              // Centred on the midpoint of its own half of the board, flag and name measured together,
              // so a long surname stays balanced against a short one on the other side.
              const label = shortName(d.name)
              const flagW = size * 1.33
              const textW = label.length * size * 0.52
              const gap = size * 0.34
              const x = len * (0.25 + k * 0.5) - (flagW + gap + textW) / 2
              // The same artwork the rest of the app shows, addressed as a URL rather than mounted as
              // a component. A foreignObject holds real HTML, which means CSS layout and its own
              // raster on every frame the camera moves; `flagSvgUrl` exists to avoid exactly that.
              //
              // Still built at FLAG_PX and scaled down, which is not about foreignObject at all: a
              // garage board is a fraction of a unit tall, and an external image asked to occupy a
              // sub-pixel box rasterises to nothing — the flags vanish at every zoom, because the
              // collapse happens at layout, before the camera's transform ever scales it up.
              const flag = flagSvgUrl(d.nationality)
              return (
                <g key={d.name}>
                  <g transform={`translate(${x} ${band * 0.24}) scale(${flagW / FLAG_PX})`}>
                    {flag ? (
                      <image href={flag} width={FLAG_PX} height={FLAG_PX * 0.75} />
                    ) : (
                      // Not an ISO alpha-2 code. A neutral plate rather than a wrong country, and the
                      // board's spacing is identical either way.
                      <rect width={FLAG_PX} height={FLAG_PX * 0.75} fill="#6B7280" />
                    )}
                  </g>
                  <text x={x + flagW + gap} y={band * 0.76} fontSize={size} fontWeight={600} fill="#14181F">
                    {label}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
    </g>
  )
}

/** "Kimi Raikkonen" -> "K Raikkonen", the form a garage board actually carries. Exported for the
 *  3D boards, which write the same label (#3d-port). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.length < 2 ? name : `${parts[0][0]} ${parts.slice(1).join(' ')}`
}

/** The garage floors, which go down BEFORE the lane's paint so its white edge line runs unbroken. */
export function pitFloorOps(
  zone: PitZone, lighting: Lighting, garageColor?: (i: number) => string | undefined,
): DrawOp[] {
  return zone.garageFloors.map((r, i) => ({
    d: ringPath(r),
    fill: shadeFace(garageColor?.(i) ?? '#2A2F38', lighting),
  }))
}

/** The complex itself, in paint order: shadow, ground floor, shutters, upper storey, roof and its
 *  furniture, then the lane markings.
 *
 *  Ground floor first, then the storey standing on it. Height draws LATER everywhere in this renderer
 *  — a roof is painted over its own walls — so the upper storey is the nearer surface, and its
 *  underside is what closes off the back of each garage recess. Stacked the other way round the
 *  ground floor paints straight over the wall above it. */
export function pitComplexOps(
  zone: PitZone, u: (m: number) => number, lighting: Lighting, view: number,
  garageColor?: (i: number) => string | undefined,
): DrawOp[] {
  const ldir = lightDir(lighting)
  const dir = dirAt(view)
  const lift = u(PIT_BUILDING_H_M * EXTRUDE)
  const mid = u(GARAGE_H_M * EXTRUDE)
  const plantLift = u(PLANT_H_M * EXTRUDE)
  const cast = u(PIT_BUILDING_H_M * shadowReach(lighting))
  const up = (p: Vec, k: number) => ({ x: p.x - dir.x * k, y: p.y - dir.y * k })
  const wall = shadeFace(PIT_WHITE, lighting)
  // The returns take a second tone. Without it the front of the complex and its ends are one flat
  // white and the whole mass reads as a cut-out.
  const ret = tintFace(PIT_WHITE, lighting, -0.45)
  const lower = zone.buildingPts.map((p) => up(p, mid))
  const upper = zone.upperPts.map((p) => up(p, lift))
  const rise = lift - mid
  const plantTops = zone.plant.map((r) => r.map((p) => up(p, lift + plantLift)))

  const ops: DrawOp[] = [
    // The shadow the complex throws across the lane, cast from the UPPER outline: it is the outer
    // envelope, since the storey above overhangs the recesses bitten out of the one below.
    {
      d: sweptRing(zone.upperPts, ldir.x * cast, ldir.y * cast),
      fill: shadowFill(lighting),
      alpha: shadowOpacity(lighting),
    },
    { d: sweptRing(lower, dir.x * mid, dir.y * mid), fill: wall },
  ]
  // The garage door, on the back wall of its bay and in that wall's plane. It replaced a flat rounded
  // rectangle laid on the ground, which was drawn when the complex had no perspective at all and read
  // as a sticker once it gained some.
  for (const [i, r] of zone.garageFloors.entries()) {
    const h = mid * 0.82
    const top = (p: Vec) => up(p, h)
    const lintel = (p: Vec) => up(p, h * 0.82)
    ops.push({ d: quad(r[3], r[2], top(r[2]), top(r[3])), fill: '#161A21' })
    ops.push({ d: quad(lintel(r[3]), lintel(r[2]), top(r[2]), top(r[3])), fill: garageColor?.(i) ?? '#9AA3B2' })
  }
  // Ends and pier returns LAST of the ground floor, so they occlude any shutter that reached across
  // them. A shutter sits on the back wall of its bay, eight metres deeper into the building than the
  // end wall beside it, so painting it over that wall put the far surface in front of the near one.
  ops.push({ d: obliqueRingFaces(lower, dir.x * mid, dir.y * mid), fill: ret })
  ops.push({ d: sweptRing(upper, dir.x * rise, dir.y * rise), fill: wall })
  ops.push({ d: obliqueRingFaces(upper, dir.x * rise, dir.y * rise), fill: ret })
  ops.push({ d: ringPath(upper), fill: litFace(PIT_WHITE, lighting) })
  // White siding, laid breadth-wise. Drawn as geometry off the zone rather than as a tile pattern:
  // the complex follows the lane's curve, and a tile grid would run straight through it at whatever
  // angle the map happened to sit at.
  ops.push({
    d: mapPathPoints(zone.roofSeams, (x, y) => up({ x, y }, lift)),
    stroke: tintFace(PIT_WHITE, lighting, -0.16),
    width: u(0.18),
  })
  // Viewing terrace along the front of the roof, and its railing.
  ops.push({ d: ringPath(zone.roofDeck.map((p) => up(p, lift))), fill: tintFace(PIT_WHITE, lighting, -0.22) })
  ops.push({
    d: linePath(zone.roofRail.map((p) => up(p, lift))),
    stroke: shadeFace(PIT_WHITE, lighting),
    width: u(0.35),
  })
  // Rooftop plant, extruded off the roof so the roof itself has relief rather than markings.
  ops.push({
    d: plantTops.map((r) => sweptRing(r, dir.x * plantLift, dir.y * plantLift)).join(''),
    fill: tintFace(PIT_WHITE, lighting, -0.5),
  })
  ops.push({ d: plantTops.map((r) => ringPath(r)).join(''), fill: tintFace(PIT_WHITE, lighting, -0.12) })
  // The lane's own paint, on the ground: the separator stripe down the box row and the two limiter
  // lines that bound it.
  for (const [colour, widthM] of [['#F2F2F2', 0.6], ['#2E62C9', 0.34]] as const) {
    ops.push({ d: linePath(zone.sep), stroke: colour, width: u(widthM), cap: 'round' })
  }
  for (const l of [zone.limiterIn, zone.limiterOut]) {
    ops.push({ d: linePath(l), stroke: '#F2F2F2', width: u(0.35), cap: 'butt' })
  }
  return ops
}
