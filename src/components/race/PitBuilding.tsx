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

import { obliqueRingFaces, quad, ringPath, sweptRing } from '@/lib/ui/extrude'
import {
  type Lighting, lightDir, litFace, shadeFace, shadowFill, shadowOpacity, shadowReach, tintFace,
} from '@/lib/ui/lighting'
import type { PitZone } from '@/lib/ui/pit-zone'
import { NationalityFlag } from '@/components/world/NationalityFlag'
import { EXTRUDE } from './SceneryLayer'

/** Roofline of the complex. Tall enough to throw a shadow across the lane, low enough that the wall
 *  face does not swallow the boxes at the tightest metres-per-unit. */
export const PIT_BUILDING_H_M = 8.5
/** Height of the garage opening. The storey above overhangs it, so this is also how deep the recess
 *  in the front face is measured vertically: a garage door, not a two-storey void. */
const GARAGE_H_M = 3.2
/** Rooftop plant boxes stand this proud of the roof. */
const PLANT_H_M = 2.2
/** Concrete-and-glass white, not another dark infield shed. */
const PIT_WHITE = '#E4E2DC'

/** The shadow the complex throws across the lane and the track. Drawn as its own layer so it lands on
 *  tarmac already painted, exactly as the scenery shadows do. */
export function PitBuildingShadow({ zone, u, lighting }: {
  zone: PitZone; u: (m: number) => number; lighting: Lighting
}) {
  const dir = lightDir(lighting)
  const cast = u(PIT_BUILDING_H_M * shadowReach(lighting))
  // Cast from the UPPER outline: it is the outer envelope, since the storey above overhangs the
  // garage recesses bitten out of the one below.
  return (
    <path
      d={sweptRing(zone.upperPts, dir.x * cast, dir.y * cast)}
      fill={shadowFill(lighting)} opacity={shadowOpacity(lighting)}
    />
  )
}

/** The floor of each garage, in that team's colour. Drawn EARLY — before the lane's paint — because
 *  the recesses reach past the working lane's white edge line, and that line has to run unbroken. */
export function PitGarageFloors({ zone, lighting, garageColor }: {
  zone: PitZone; lighting: Lighting; garageColor?: (i: number) => string | undefined
}) {
  return (
    <g>
      {zone.garageFloors.map((r, i) => (
        <path key={`gf${i}`} d={ringPath(r)} fill={shadeFace(garageColor?.(i) ?? '#2A2F38', lighting)} />
      ))}
    </g>
  )
}

export function PitBuilding({ zone, u, lighting, garageColor }: {
  zone: PitZone; u: (m: number) => number; lighting: Lighting
  /** Team colour for garage i, for the shutter at the back of its bay. */
  garageColor?: (i: number) => string | undefined
}) {
  const dir = lightDir(lighting)
  const lift = u(PIT_BUILDING_H_M * EXTRUDE)
  const mid = u(GARAGE_H_M * EXTRUDE)
  const plantLift = u(PLANT_H_M * EXTRUDE)
  const up = (p: { x: number; y: number }, k: number) => ({ x: p.x - dir.x * k, y: p.y - dir.y * k })
  const lower = zone.buildingPts.map((p) => up(p, mid))
  const upper = zone.upperPts.map((p) => up(p, lift))
  const onRoof = `translate(${-dir.x * lift} ${-dir.y * lift})`
  // Plant sits ON the roof, so its base is already lifted and it lifts again by its own height.
  const plantTops = zone.plant.map((r) => r.map((p) => up(p, lift + plantLift)))
  const wall = shadeFace(PIT_WHITE, lighting)
  // The returns take a second tone. Without it the front of the complex and its ends are one flat
  // white and the whole mass reads as a cut-out.
  const ret = tintFace(PIT_WHITE, lighting, -0.45)
  return (
    <g>
      {/* Ground floor first, then the storey standing on it. Height draws LATER everywhere in this
          renderer — a roof is painted over its own walls — so the upper storey is the nearer surface,
          and its underside is what closes off the back of each garage recess. Stacked the other way
          round the ground floor paints straight over the wall above it. */}
      <path d={sweptRing(lower, dir.x * mid, dir.y * mid)} fill={wall} />
      {/* The garage door, on the back wall of its bay and in that wall's plane. It replaced a flat
          rounded rectangle laid on the ground, which was drawn when the complex had no perspective at
          all and read as a sticker once it gained some. */}
      {zone.garageFloors.map((r, i) => {
        const h = mid * 0.82
        const top = (p: { x: number; y: number }) => ({ x: p.x - dir.x * h, y: p.y - dir.y * h })
        const lintel = (p: { x: number; y: number }) => ({ x: p.x - dir.x * h * 0.82, y: p.y - dir.y * h * 0.82 })
        return (
          <g key={`gd${i}`}>
            <path d={quad(r[3], r[2], top(r[2]), top(r[3]))} fill="#161A21" />
            <path d={quad(lintel(r[3]), lintel(r[2]), top(r[2]), top(r[3]))} fill={garageColor?.(i) ?? '#9AA3B2'} />
          </g>
        )
      })}
      {/* Ends and pier returns LAST of the ground floor, so they occlude any shutter that reached
          across them. A shutter sits on the back wall of its bay, eight metres deeper into the
          building than the end wall beside it, so painting it over that wall put the far surface in
          front of the near one. These are exactly the faces angled away from the view, which is what
          the oblique split already isolates. */}
      <path d={obliqueRingFaces(lower, dir.x * mid, dir.y * mid)} fill={ret} />
      <path d={sweptRing(upper, dir.x * (lift - mid), dir.y * (lift - mid))} fill={wall} />
      <path d={obliqueRingFaces(upper, dir.x * (lift - mid), dir.y * (lift - mid))} fill={ret} />
      <path d={ringPath(upper)} fill={litFace(PIT_WHITE, lighting)} />
      {/* White siding, laid breadth-wise. Drawn as geometry off the zone rather than as a tile
          pattern: the complex follows the lane's curve, and a tile grid would run straight through
          it at whatever angle the map happened to sit at. */}
      <path
        d={zone.roofSeams} transform={onRoof} fill="none"
        stroke={tintFace(PIT_WHITE, lighting, -0.16)} strokeWidth={u(0.18)}
      />
      {/* Viewing terrace along the front of the roof, and its railing. */}
      <path d={zone.roofDeck} transform={onRoof} fill={tintFace(PIT_WHITE, lighting, -0.22)} />
      <path
        d={`M ${zone.roofRail.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`}
        transform={onRoof} fill="none" stroke={shadeFace(PIT_WHITE, lighting)} strokeWidth={u(0.35)}
      />
      {/* Rooftop plant, extruded off the roof so the roof itself has relief rather than markings. */}
      <path
        d={plantTops.map((r) => sweptRing(r, dir.x * plantLift, dir.y * plantLift)).join('')}
        fill={tintFace(PIT_WHITE, lighting, -0.5)}
      />
      <path d={plantTops.map((r) => ringPath(r)).join('')} fill={tintFace(PIT_WHITE, lighting, -0.12)} />
    </g>
  )
}


/** Height of the signage band on the fascia above each garage opening. */
const SIGN_H_M = 1.5
/** Pixel size the flag is laid out at inside its foreignObject before being scaled into wall units.
 *  Sub-pixel layout boxes collapse, so it cannot simply be built at its final size. */
const FLAG_PX = 40

/** Driver name boards across each garage fascia, laid IN the plane of that wall.
 *
 *  A label drawn upright on a map is a map label; a real garage's signage sits on the building, so it
 *  takes the same basis the windows take — along the wall, and up it. The one concession to
 *  readability is that the run direction flips when it would otherwise write right-to-left. */
export function PitGarageSigns({ zone, u, lighting, drivers }: {
  zone: PitZone; u: (m: number) => number; lighting: Lighting
  drivers: (i: number) => Array<{ name: string; nationality?: string }>
}) {
  const dir = lightDir(lighting)
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
              return (
                <g key={d.name}>
                  {/* The flag goes through the app's own component rather than an SVG <image>: the
                      flag artwork carries a viewBox and no intrinsic size, and an <image> pointed at
                      it renders at nothing. A foreignObject lays out in CSS pixels, so it is built at
                      a workable pixel size and scaled down into the wall's units. */}
                  <g transform={`translate(${x} ${band * 0.24}) scale(${flagW / FLAG_PX})`}>
                    <foreignObject width={FLAG_PX} height={FLAG_PX * 0.75}>
                      <div style={{ lineHeight: 0 }}>
                        <NationalityFlag code={d.nationality} size={`${FLAG_PX}px`} />
                      </div>
                    </foreignObject>
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

/** "Kimi Raikkonen" -> "K Raikkonen", the form a garage board actually carries. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.length < 2 ? name : `${parts[0][0]} ${parts.slice(1).join(' ')}`
}
