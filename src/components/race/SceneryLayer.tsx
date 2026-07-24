import type { Scenery, SceneryPart, SceneryRect } from '@/lib/ui/track-scenery'
import {
  contactOpacity, edgeFace, lightDir, shadeFace, shadowFill, shadowOpacity, shadowReach,
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
/** Canopy height, for the tree shadow. Kept short of the true cast length: 1140 blobs cannot afford
 *  a swept shadow each, and a fully-detached round shadow reads worse than a slightly short one. */
const TREE_H_M = 5

const deg = (r: number) => (r * 180) / Math.PI

const partsOf = (r: { w: number; h: number; parts?: SceneryPart[] }): SceneryPart[] =>
  r.parts ?? [{ dx: 0, dy: 0, w: r.w, h: r.h }]

const heightM = (r: { storeys?: number }) => (r.storeys ?? 1) * STOREY_M

/** Every part of a footprint as subpaths of ONE path. Filled nonzero (all rects wound the same way)
 *  this renders as their union, which keeps a multi-part building to a couple of DOM nodes instead
 *  of a couple per part — the scene is plain SVG with no culling, so element count is the budget. */
function partsPath(parts: SceneryPart[]): string {
  let d = ''
  for (const p of parts) {
    const x0 = p.dx - p.w / 2
    const y0 = p.dy - p.h / 2
    d += `M ${x0.toFixed(2)} ${y0.toFixed(2)} h ${p.w.toFixed(2)} v ${p.h.toFixed(2)} h ${(-p.w).toFixed(2)} Z `
  }
  return d
}

/** A footprint SWEPT along the light, as one nonzero path: the same rects repeated at intervals from
 *  the object's base out to the shadow's far end. A shadow is the volume an object sweeps between
 *  itself and the ground it blocks light from, so drawing only the translated copy renders just the
 *  far end and the shadow visibly detaches — at a low sun that gap is longer than the building.
 *  `ox`/`oy` are the offset already rotated into the footprint's LOCAL frame. */
function sweptPath(parts: SceneryPart[], ox: number, oy: number): string {
  const len = Math.hypot(ox, oy)
  if (len < 1e-6) return partsPath(parts)
  // Step in less than the smallest footprint dimension so consecutive copies always overlap.
  const minDim = parts.reduce((m, p) => Math.min(m, p.w, p.h), Infinity)
  const steps = Math.max(1, Math.min(14, Math.ceil(len / Math.max(minDim * 0.8, 1e-6))))
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    d += partsPath(parts.map((p) => ({ ...p, dx: p.dx + ox * f, dy: p.dy + oy * f })))
  }
  return d
}

/** Rotate a world-space vector into a footprint's local frame. */
function toLocal(x: number, y: number, rot: number): { x: number; y: number } {
  const c = Math.cos(-rot)
  const s = Math.sin(-rot)
  return { x: x * c - y * s, y: x * s + y * c }
}

/** A footprint drawn as ONE silhouette. Pass 1 strokes the whole path in the outline colour,
 *  dilating the union; pass 2 fills it with no stroke, covering every internal seam. The outline
 *  survives only around the union, so an L or U footprint reads as one building instead of loose
 *  rectangles with edges showing where the parts meet. */
function Footprint({ d, fill, stroke, sw }: {
  d: string; fill: string; stroke: string; sw: number
}) {
  return (
    <>
      <path d={d} fill={stroke} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d={d} fill={fill} />
    </>
  )
}

export function SceneryLayer({ scenery, u, lighting, detail = 'full' }: {
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

      {/* Contact shadow: the same silhouette, NOT offset, dilated by a stroke. Ambient occlusion
          rather than a cast shadow, so it survives overcast and keeps objects sitting in the ground
          when the directional shadow has faded. Drawn at BOTH LOD tiers — it is one path and it is
          what stops props reading as pasted on at zoom-out. */}
      <g fill={shFill} stroke={shFill} opacity={contactOp}>
        {structures.map((r, i) => (
          <path
            key={`ao${i}`} d={partsPath(partsOf(r))} strokeWidth={u(2.2)} strokeLinejoin="round"
            transform={`translate(${r.x} ${r.y}) rotate(${deg(r.rot)})`}
          />
        ))}
      </g>

      {/* Cast shadows, thrown along the light by each structure's height. */}
      {full && (
        <g fill={shFill} opacity={shOp}>
          {structures.map((r, i) => {
            const t = u(heightM(r) * reach)
            const o = toLocal(dir.x * t, dir.y * t, r.rot)
            return (
              <path
                key={`sh${i}`} d={sweptPath(partsOf(r), o.x, o.y)}
                transform={`translate(${r.x} ${r.y}) rotate(${deg(r.rot)})`}
              />
            )
          })}
        </g>
      )}

      {/* Extruded wall faces: the footprint repeated toward the light's far side, under the roof. */}
      {full && structures.map((r, i) => {
        const t = u(heightM(r) * EXTRUDE)
        return (
          <g key={`wl${i}`} transform={`translate(${r.x + dir.x * t} ${r.y + dir.y * t}) rotate(${deg(r.rot)})`}>
            <Footprint
              d={partsPath(partsOf(r))} fill={shadeFace(r.fill, lighting)} stroke={edgeFace(r.fill, lighting)}
              sw={u(0.5)}
            />
          </g>
        )
      })}

      {scenery.stands.map((s, i) => {
        // The roof and back wall sit on the edge AWAY from the track; `facing` is the edge that
        // looks at it. Seating rakes down from the roof toward the circuit.
        const roofY = s.facing ? -s.h / 2 : s.h / 2 - u(2.6)
        return (
          <g key={`s${i}`} transform={`translate(${s.x} ${s.y}) rotate(${deg(s.rot)})`}>
            <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} fill="url(#tm-seats)" stroke="#2E333B" strokeWidth={u(0.6)} />
            {full && <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} fill="url(#tm-crowd)" />}
            {full && (
              <rect
                x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h}
                fill={s.facing ? 'url(#tm-rake)' : 'url(#tm-rake-flip)'}
              />
            )}
            <rect x={-s.w / 2} y={roofY} width={s.w} height={u(2.6)} fill="#7B8494" stroke="#2E333B" strokeWidth={u(0.4)} />
            {full && <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} fill="url(#tm-bevel)" />}
          </g>
        )
      })}

      {scenery.buildings.map((b, i) => {
        const d = partsPath(partsOf(b))
        return (
          <g key={`b${i}`} transform={`translate(${b.x} ${b.y}) rotate(${deg(b.rot)})`}>
            <Footprint d={d} fill={b.fill} stroke="#2E333B" sw={u(0.5)} />
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

      {/* Tree shadows, then canopies with their lit side — the biggest node count, dropped at low LOD. */}
      {full && (
        <g
          transform={`translate(${dir.x * u(TREE_H_M * reach)} ${dir.y * u(TREE_H_M * reach)})`}
          fill={shFill} opacity={shOp * 0.85}
        >
          {scenery.trees.map((t, i) => <path key={`ts${i}`} d={t.d} />)}
        </g>
      )}
      {full && scenery.trees.map((t, i) => (
        <g key={`v${i}`}>
          <path d={t.d} fill={`url(#tm-tree${t.variant})`} stroke="#1E3318" strokeWidth={u(0.35)} />
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
  // Barriers and tyre walls are about a metre and a half tall, so they throw a short hard shadow.
  const wallT = u(1.5 * reach)
  return (
    <g>
      {/* Furniture obeys the same light as the buildings. Without this the barriers read as painted
          lines while everything behind them reads as solid, which breaks the whole illusion. */}
      {full && (
        <g fill="none" stroke={shFill} opacity={shOp} strokeLinecap="round">
          {scenery.barriers.filter((b) => b.kind === 'wall').map((b, i) => (
            <path
              key={`bs${i}`} d={b.d} strokeWidth={u(1.6)}
              transform={`translate(${dir.x * wallT} ${dir.y * wallT})`}
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
      {scenery.barriers.map((b, i) => (
        b.kind === 'wall'
          ? (
            <g key={`bw${i}`}>
              <path d={b.d} fill="none" stroke="#20242B" strokeWidth={u(1.5)} strokeLinecap="round" />
              <path d={b.d} fill="none" stroke="#C9CDD4" strokeWidth={u(0.9)} strokeLinecap="round" />
            </g>
          )
          : full && (
            <path
              key={`bf${i}`} d={b.d} fill="none" stroke="#79808C" strokeWidth={u(0.5)}
              strokeDasharray={`${u(1.6)} ${u(1.6)}`} opacity={0.55}
            />
          )
      ))}

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

      {full && scenery.marshals.map((m, i) => {
        const t = u(2.6 * reach)
        return (
          <g key={`mp${i}`}>
            {/* Extruded side face, then the lit hut on top of it. */}
            <g transform={`translate(${m.x + dir.x * t} ${m.y + dir.y * t}) rotate(${(m.rot * 180) / Math.PI})`}>
              <rect x={-u(2.2)} y={-u(1.6)} width={u(4.4)} height={u(3.2)} rx={u(0.4)} fill={edgeFace('#3A4049', lighting)} />
            </g>
            <g transform={`translate(${m.x} ${m.y}) rotate(${(m.rot * 180) / Math.PI})`}>
              <rect x={-u(2.2)} y={-u(1.6)} width={u(4.4)} height={u(3.2)} rx={u(0.4)} fill="#3A4049" stroke="#20242B" strokeWidth={u(0.4)} />
              <rect x={-u(2.2)} y={-u(1.6)} width={u(4.4)} height={u(1.0)} fill="#E8952B" />
            </g>
          </g>
        )
      })}
    </g>
  )
}
