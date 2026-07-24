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

import { obliqueRingFaces, ringPath, sweptRing } from '@/lib/ui/extrude'
import {
  type Lighting, lightDir, litFace, shadeFace, shadowFill, shadowOpacity, shadowReach, tintFace,
} from '@/lib/ui/lighting'
import type { PitZone } from '@/lib/ui/pit-zone'
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

export function PitBuilding({ zone, u, lighting, garageColor }: {
  zone: PitZone; u: (m: number) => number; lighting: Lighting
  /** Team colour for garage i. The recesses are deep enough to see into, and an unpainted floor shows
   *  the ground through them. */
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
      {/* Garage floors, under everything: only the sliver the overhang does not cover shows, and it
          should read as that team's box rather than as grass seen through a hole in the building. */}
      {zone.garageFloors.map((r, i) => (
        <path key={`gf${i}`} d={ringPath(r)} fill={shadeFace(garageColor?.(i) ?? '#2A2F38', lighting)} />
      ))}
      {/* Ground floor first, then the storey standing on it. Height draws LATER everywhere in this
          renderer — a roof is painted over its own walls — so the upper storey is the nearer surface,
          and its underside is what closes off the back of each garage recess. Stacked the other way
          round the ground floor paints straight over the wall above it. */}
      <path d={sweptRing(lower, dir.x * mid, dir.y * mid)} fill={wall} />
      <path d={obliqueRingFaces(lower, dir.x * mid, dir.y * mid)} fill={ret} />
      <path d={sweptRing(upper, dir.x * (lift - mid), dir.y * (lift - mid))} fill={wall} />
      <path d={obliqueRingFaces(upper, dir.x * (lift - mid), dir.y * (lift - mid))} fill={ret} />
      <path d={ringPath(upper)} fill={litFace(PIT_WHITE, lighting)} />
      <path d={ringPath(upper)} fill="url(#tm-pitdeck)" />
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

/** Roof decking, referenced by `PitBuilding`. A roof is a horizontal plane in this projection, so a
 *  tile pattern genuinely fits it — unlike a wall, whose face is a sheared parallelogram. */
export function PitBuildingDefs({ u }: { u: (m: number) => number }) {
  return (
    <pattern id="tm-pitdeck" width={u(4.2)} height={u(4.2)} patternUnits="userSpaceOnUse">
      <rect width={u(0.4)} height={u(4.2)} fill="#000000" opacity={0.06} />
      <rect x={u(0.4)} width={u(0.35)} height={u(4.2)} fill="#FFFFFF" opacity={0.05} />
    </pattern>
  )
}
