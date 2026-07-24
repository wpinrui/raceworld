import type { Scenery, SceneryPart, SceneryRect } from '@/lib/ui/track-scenery'
import { partsPath, posts, rakedStand, ribbon, sideFacesX, sweptHull } from '@/lib/ui/extrude'
import {
  contactOpacity, lightDir, shadeFace, shadowFill, shadowOpacity, shadowReach, tintFace,
  type Lighting,
} from '@/lib/ui/lighting'

// Static scenery layer: generated once per circuit, transforms with the camera. The seat-stripe and
// crowd-dot patterns live in userSpace so they align with each rotated stand's local axes.
//
// Every solid obeys ONE fake light, supplied as four scalars (see lighting.ts): it is extruded away
// from the sun by its storey count, throws a cast shadow whose length is the real cot(altitude), and
// carries a tight contact shadow where it meets the ground. That last one is ambient rather than
// directional, so it survives overcast and is what actually makes things sit IN the world.

/** Metres of apparent height per storey. Diorama scale: tall enough that height is unmistakable. */
const STOREY_M = 4.6
/** Wall depth as a fraction of height — how much of the side face the oblique view reveals. */
const EXTRUDE = 0.62
/** Apparent height of one terrace step in the relief bands. */
const BAND_STEP_M = 6
/** A grandstand's front (trackside) and rear heights in metres. Real seating banks rake up away
 *  from the circuit; extruding one uniformly made them read as tall slabs beside the track.
 *
 *  These stay LOW on purpose. A stand is only 12-17 m deep, so displacing its rear edge by the full
 *  height of a real grandstand shears the deck by nearly half its own depth and the bank reads as a
 *  ski jump. The rake wants to be a gentle ramp; the height is carried by the roof and the shadow. */
const STAND_FRONT_M = 1.0
const STAND_REAR_M = 5.5
/** How much of the deck the rear roof canopy covers. */
const STAND_ROOF_FRAC = 0.3
/** Marshal hut height. */
const MARSHAL_H_M = 2.8
/** Trackside wall heights: armco/concrete, then the debris fencing standing behind it. */
const BARRIER_H_M = 1.3
const FENCE_H_M = 4
/** Canopy height, for the tree shadow. Kept short of the true cast length: 1140 blobs cannot afford
 *  a swept shadow each, and a fully-detached round shadow reads worse than a slightly short one. */
const TREE_H_M = 5

const deg = (r: number) => (r * 180) / Math.PI

const partsOf = (r: { w: number; h: number; parts?: SceneryPart[] }): SceneryPart[] =>
  r.parts ?? [{ dx: 0, dy: 0, w: r.w, h: r.h }]

const heightM = (r: { storeys?: number }) => (r.storeys ?? 1) * STOREY_M
/** A stand's effective height for shadow purposes: the rear, which is what casts. */
const isStand = (r: SceneryRect): r is Scenery['stands'][number] => 'facing' in r
const solidHeightM = (r: SceneryRect) => (isStand(r) ? STAND_REAR_M : heightM(r))

/** Rotate a world-space vector into a footprint's local frame. */
function toLocal(x: number, y: number, rot: number): { x: number; y: number } {
  const c = Math.cos(-rot)
  const s = Math.sin(-rot)
  return { x: x * c - y * s, y: x * s + y * c }
}

export function SceneryLayer({ scenery, u, lighting, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const dir = lightDir(lighting)
  const reach = shadowReach(lighting)
  const shFill = shadowFill(lighting)
  const shOp = shadowOpacity(lighting)
  return (
    <g>
      <defs>
        <pattern id="tm-seats" width={u(2.4)} height={u(1.5)} patternUnits="userSpaceOnUse">
          <rect width={u(2.4)} height={u(1.5)} fill="#3E4552" />
          <rect y={u(0.95)} width={u(2.4)} height={u(0.55)} fill="#575F6E" />
        </pattern>
        <pattern id="tm-crowd" width={u(3.2)} height={u(3.2)} patternUnits="userSpaceOnUse">
          <circle cx={u(0.7)} cy={u(0.8)} r={u(0.3)} fill="#DC143C" opacity={0.5} />
          <circle cx={u(2.2)} cy={u(1.7)} r={u(0.3)} fill="#00D9FF" opacity={0.45} />
          <circle cx={u(1.3)} cy={u(2.6)} r={u(0.3)} fill="#E8B923" opacity={0.45} />
          <circle cx={u(2.7)} cy={u(0.5)} r={u(0.3)} fill="#FFFFFF" opacity={0.4} />
        </pattern>
        <pattern id="tm-water" width={u(9)} height={u(6)} patternUnits="userSpaceOnUse">
          <path
            d={`M 0 ${u(2)} q ${u(2.2)} ${-u(1.4)} ${u(4.5)} 0 t ${u(4.5)} 0`}
            fill="none" stroke="#A8D4E6" strokeWidth={u(0.35)} opacity={0.3}
          />
          <path
            d={`M ${-u(2)} ${u(4.6)} q ${u(2.2)} ${-u(1.4)} ${u(4.5)} 0 t ${u(4.5)} 0`}
            fill="none" stroke="#A8D4E6" strokeWidth={u(0.35)} opacity={0.2}
          />
        </pattern>
        <radialGradient id="tm-tree0">
          <stop offset="0%" stopColor="#4F7B3A" />
          <stop offset="100%" stopColor="#2C4B22" />
        </radialGradient>
        <radialGradient id="tm-tree1">
          <stop offset="0%" stopColor="#6B7A35" />
          <stop offset="100%" stopColor="#3D4A1E" />
        </radialGradient>
        <linearGradient
          id="tm-bevel" x1="0" y1="0" x2="1" y2="1"
          gradientTransform={`rotate(${deg(lighting.azimuth) - 45} 0.5 0.5)`}
        >
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.16" />
          <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
        </linearGradient>
        {/* Seating rake: pale at the back under the roof, darkening toward the trackside front, so
            which way a stand faces is legible at a glance rather than implied by a thin roof band. */}
        <linearGradient id="tm-rake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.30" />
        </linearGradient>
        <linearGradient id="tm-rake-flip" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.30" />
        </linearGradient>
        {/* Crop rows: enough texture to tell cultivated land from rough ground at a glance. */}
        <pattern id="tm-crop" width={u(11)} height={u(11)} patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
          <rect width={u(3.4)} height={u(11)} fill="#FFFFFF" opacity={0.05} />
        </pattern>
      </defs>

      {/* Relief, lowest band up. Each band gets a dark copy offset down-right underneath it, so the
          terrace steps catch the same top-left key light as every prop shadow. Big paths, few of
          them — they stay affordable at full zoom-out, which is where the flat plane showed. */}
      {scenery.bands.map((b, i) => (
        <g key={`hb${i}`}>
          <path
            d={b.d} fillRule="evenodd" fill={shFill} opacity={shOp * 0.9}
            transform={`translate(${dir.x * u(BAND_STEP_M * reach)} ${dir.y * u(BAND_STEP_M * reach)})`}
          />
          <path d={b.d} fillRule="evenodd" fill={b.fill} />
        </g>
      ))}

      {/* Field patchwork: the quilt of cultivated land a circuit sits in. A single flat green was
          the main reason the surround read as a runway extending forever. */}
      {scenery.fields.map((f, i) => (
        <g key={`fd${i}`}>
          <path d={f.d} fill={f.fill} opacity={0.75} />
          {/* Crop rows and hedgerows are per-field detail; zoomed out only the tint is legible, and
              this layer draws at BOTH tiers, so the extras come off at low LOD. */}
          {full && f.crop && <path d={f.d} fill="url(#tm-crop)" />}
          {full && <path d={f.d} fill="none" stroke="#1F3318" strokeWidth={u(2.2)} opacity={0.35} />}
        </g>
      ))}

      {scenery.terrain.map((b, i) => (
        <g key={`t${i}`}>
          <path d={b.d} fill={b.fill} />
          {b.water && <path d={b.d} fill="url(#tm-water)" />}
        </g>
      ))}
      {scenery.runoffs.map((b, i) => <path key={`r${i}`} d={b.d} fill={b.fill} />)}

    </g>
  )
}

/** Shadows, drawn AFTER the track ribbon. Everything scenery used to draw came before it, so the
 *  tarmac painted straight over every shadow and they stopped dead at the grass verge. Drawing them
 *  here is safe because the generator guarantees no prop overlaps the track — see
 *  track-scenery.test.ts — so nothing casting a shadow can be occluded by the road it falls on. */
export function SceneryShadowLayer({ scenery, u, lighting, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const structures: SceneryRect[] = [...scenery.stands, ...scenery.buildings]
  const dir = lightDir(lighting)
  const reach = shadowReach(lighting)
  const shFill = shadowFill(lighting)
  const shOp = shadowOpacity(lighting)
  const contactOp = contactOpacity(lighting)
  return (
    <g>
      {/* Contact occlusion, hugging the base. Ambient rather than directional, so it survives
          overcast and keeps things sitting in the ground. Cheap enough for both LOD tiers. */}
      <g fill={shFill} stroke={shFill} opacity={contactOp}>
        {structures.map((r, i) => {
          const b = u(solidHeightM(r) * EXTRUDE)
          return (
            <path
              key={`ao${i}`} d={partsPath(partsOf(r))} strokeWidth={u(2.2)} strokeLinejoin="round"
              transform={`translate(${r.x + dir.x * b} ${r.y + dir.y * b}) rotate(${deg(r.rot)})`}
            />
          )
        })}
      </g>

      {/* Cast shadow, swept along the ground FROM THE BASE so its near end tucks under the solid. */}
      {full && (
        <g fill={shFill} opacity={shOp}>
          {structures.map((r, i) => {
            const b = u(solidHeightM(r) * EXTRUDE)
            const t = u(solidHeightM(r) * reach)
            const o = toLocal(dir.x * t, dir.y * t, r.rot)
            return (
              <path
                key={`sh${i}`} d={sweptHull(partsOf(r), o.x, o.y)}
                transform={`translate(${r.x + dir.x * b} ${r.y + dir.y * b}) rotate(${deg(r.rot)})`}
              />
            )
          })}
        </g>
      )}

      {/* Tree shadows travel with the same light. */}
      {full && (
        <g
          transform={`translate(${dir.x * u(TREE_H_M * reach)} ${dir.y * u(TREE_H_M * reach)})`}
          fill={shFill} opacity={shOp * 0.85}
        >
          {scenery.trees.map((t, i) => <path key={`ts${i}`} d={t.d} />)}
        </g>
      )}
    </g>
  )
}

/** The solids themselves: walls, roofs, stands and canopies, all above the shadows. */
export function ScenerySolidsLayer({ scenery, u, lighting, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const dir = lightDir(lighting)
  return (
    <g>
      {/* Walls: the swept band from roof outline to base outline, as one silhouette. The roof is
          painted over its near half below, leaving only the faces that actually face the camera. */}
      {full && scenery.buildings.map((r, i) => {
        const t = u(heightM(r) * EXTRUDE)
        const o = toLocal(dir.x * t, dir.y * t, r.rot)
        const parts = partsOf(r)
        return (
          <g key={`wl${i}`} transform={`translate(${r.x} ${r.y}) rotate(${deg(r.rot)})`}>
            {/* The whole solid's silhouette, outlined once. */}
            <path d={sweptHull(parts, o.x, o.y)} fill={shadeFace(r.fill, lighting)} />
            {/* The left/right height faces, a shade apart from the top/bottom ones so the two
                visible planes of the box are distinguishable. */}
            <path d={sideFacesX(parts, o.x, o.y)} fill={tintFace(r.fill, lighting, -0.45)} />
          </g>
        )
      })}

      {/* Grandstands rake: the trackside front barely lifts, the rear lifts a long way, so the deck
          climbs away from the circuit like real seating. Extruded uniformly they read as office
          blocks parked beside the track — they are a bank of seats, not a building. */}
      {scenery.stands.map((s, i) => {
        const t = u(STAND_REAR_M * EXTRUDE)
        const o = toLocal(dir.x * t, dir.y * t, s.rot)
        const { hull, deck, roof } = rakedStand(
          s.w, s.h, s.facing, o, 1 - STAND_FRONT_M / STAND_REAR_M, STAND_ROOF_FRAC,
        )
        return (
          <g key={`s${i}`} transform={`translate(${s.x} ${s.y}) rotate(${deg(s.rot)})`}>
            {/* Structure below the deck: the exposed sides of the bank. */}
            <path d={hull} fill={shadeFace(s.fill, lighting)} />
            {/* The seating deck itself, patterned and raked. */}
            <path d={deck} fill="url(#tm-seats)" />
            {full && <path d={deck} fill="url(#tm-crowd)" />}
            {full && <path d={deck} fill={s.facing ? 'url(#tm-rake)' : 'url(#tm-rake-flip)'} />}
            {/* Roof over the rear rows only. */}
            <path d={roof} fill="#7B8494" />
            {full && <path d={deck} fill="url(#tm-bevel)" />}
          </g>
        )
      })}

      {scenery.buildings.map((b, i) => {
        const d = partsPath(partsOf(b))
        return (
          <g key={`b${i}`} transform={`translate(${b.x} ${b.y}) rotate(${deg(b.rot)})`}>
            <path d={d} fill={b.fill} />
            {/* One bevel over the whole silhouette, clipped to the union. Drawing it per part gave
                every sub-rect its own full light-to-dark ramp, seaming at each internal edge. */}
            {full && (
              <>
                <clipPath id={`tm-bc${i}`}>
                  <path d={d} />
                </clipPath>
                <g clipPath={`url(#tm-bc${i})`}>
                  <rect x={-b.w / 2} y={-b.h / 2} width={b.w} height={b.h} fill="url(#tm-bevel)" />
                </g>
              </>
            )}
            {full && b.vents?.map((v, j) => (
              <rect key={`n${j}`} x={v.dx - v.s / 2} y={v.dy - v.s / 2} width={v.s} height={v.s} fill="#333944" />
            ))}
          </g>
        )
      })}

      {/* Canopies with their lit side — the biggest node count, dropped at low LOD. */}
      {full && scenery.trees.map((t, i) => (
        <g key={`v${i}`}>
          <path d={t.d} fill={`url(#tm-tree${t.variant})`} />
          <path d={t.hd} fill="#8FB35F" opacity={0.3} />
        </g>
      ))}
    </g>
  )
}

/** Circuit furniture that belongs ON TOP of the tarmac: barriers line the track edge, so drawing
 *  them with the rest of the scenery (which is painted before the ribbon) would bury them under it.
 *  All long polylines, so both LOD tiers can afford them — they are what makes the place read as a
 *  racing circuit rather than a road. */
export function TrackFurnitureLayer({ scenery, u, lighting, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; lighting: Lighting; detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const dir = lightDir(lighting)
  const reach = shadowReach(lighting)
  const shFill = shadowFill(lighting)
  const shOp = shadowOpacity(lighting)
  // Barriers and tyre walls throw a short hard shadow, cast from their BASE like every other solid.
  const wallT = u(BARRIER_H_M * reach)
  const wallB = u(BARRIER_H_M * EXTRUDE)
  return (
    <g>
      {/* Furniture obeys the same light as the buildings. Without this the barriers read as painted
          lines while everything behind them reads as solid, which breaks the whole illusion. */}
      {full && (
        <g fill="none" stroke={shFill} opacity={shOp} strokeLinecap="round">
          {scenery.barriers.filter((b) => b.kind === 'wall').map((b, i) => (
            <path
              key={`bs${i}`} d={b.d} strokeWidth={u(1.6)}
              transform={`translate(${dir.x * wallB + dir.x * wallT} ${dir.y * wallB + dir.y * wallT})`}
            />
          ))}
          {scenery.tyreWalls.map((t, i) => (
            <path
              key={`ts${i}`} d={t.d} strokeWidth={u(3.6)}
              transform={`translate(${dir.x * wallT} ${dir.y * wallT})`}
            />
          ))}
        </g>
      )}

      {/* Barriers and fencing are solids on a curve. Each needs the height face between its top line
          and its base, or it is a line plus a detached shadow and reads as floating above the
          ground. The wall's face is solid; the debris fence's is a cage, so it is drawn see-through
          with its posts as verticals — one path for a whole circuit's worth. */}
      {scenery.barriers.map((b, i) => {
        const solid = b.kind === 'wall'
        const t = u((solid ? BARRIER_H_M : FENCE_H_M) * EXTRUDE)
        const ox = dir.x * t
        const oy = dir.y * t
        if (solid) {
          return (
            <g key={`bw${i}`}>
              {/* Face, then the top rail. No dark casing under the rail: that was an outline around
                  the barrier rather than any part of it, and the face and shadow now carry its form. */}
              <path d={ribbon(b.pts, ox, oy)} fill={shadeFace('#8A9099', lighting)} />
              <path d={b.d} fill="none" stroke="#C9CDD4" strokeWidth={u(0.9)} strokeLinecap="round" />
            </g>
          )
        }
        if (!full) return null
        return (
          <g key={`bf${i}`}>
            {/* Mesh: you can see the circuit through debris fencing, so the face is barely there. */}
            <path d={ribbon(b.pts, ox, oy)} fill="#AEB6C2" opacity={0.13} />
            <path
              d={posts(b.pts, ox, oy, 2)} fill="none" stroke="#79808C"
              strokeWidth={u(0.35)} opacity={0.5}
            />
            <path d={b.d} fill="none" stroke="#79808C" strokeWidth={u(0.4)} opacity={0.6} />
          </g>
        )
      })}

      {/* Tyre walls: banded so they read as stacked tyres even when only a few pixels wide. */}
      {scenery.tyreWalls.map((t, i) => (
        <g key={`tw${i}`}>
          <path d={t.d} fill="none" stroke="#1B1F26" strokeWidth={u(3.4)} strokeLinecap="round" />
          {full && t.bands.map((c, j) => (
            <path
              key={j} d={t.d} fill="none" stroke={c} strokeWidth={u(2.6)} strokeLinecap="butt"
              strokeDasharray={`${u(2.4)} ${u(4.8)}`} strokeDashoffset={u(2.4 * j)}
            />
          ))}
        </g>
      ))}

      {/* Marshal posts are solids too, so they get real height faces rather than a displaced copy of
          themselves — the same mistake the buildings started with. */}
      {full && scenery.marshals.map((m, i) => {
        const hut: SceneryPart[] = [{ dx: 0, dy: 0, w: u(4.4), h: u(3.2) }]
        const t = u(MARSHAL_H_M * EXTRUDE)
        const o = toLocal(dir.x * t, dir.y * t, m.rot)
        const sh = u(MARSHAL_H_M * reach)
        const so = toLocal(dir.x * sh, dir.y * sh, m.rot)
        const deg2 = (m.rot * 180) / Math.PI
        return (
          <g key={`mp${i}`} transform={`translate(${m.x} ${m.y}) rotate(${deg2})`}>
            <path
              d={sweptHull(hut, so.x, so.y)} fill={shFill} opacity={shOp}
              transform={`translate(${o.x} ${o.y})`}
            />
            <path d={sweptHull(hut, o.x, o.y)} fill={shadeFace('#3A4049', lighting)} />
            {/* Roof on top, with the orange marshal panel on its trackside edge. */}
            <rect x={-u(2.2)} y={-u(1.6)} width={u(4.4)} height={u(3.2)} rx={u(0.3)} fill="#3A4049" />
            <rect x={-u(2.2)} y={-u(1.6)} width={u(4.4)} height={u(1.0)} fill="#E8952B" />
          </g>
        )
      })}
    </g>
  )
}
