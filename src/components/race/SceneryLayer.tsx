import type { Scenery, SceneryPart, SceneryRect } from '@/lib/ui/track-scenery'

// Static scenery layer: generated once per circuit, transforms with the camera. The seat-stripe and
// crowd-dot patterns live in userSpace so they align with each rotated stand's local axes. Faux
// lighting comes from the top-left: every solid prop casts a soft drop shadow toward bottom-right,
// wears a diagonal bevel, and is extruded by its storey count so it reads as a volume rather than a
// flat rectangle.

/** Metres of apparent height per storey, and how far a metre of height throws its shadow. */
const STOREY_M = 4.2
const SHADOW_PER_M = 0.14
/** Wall faces and shadows point down-right, matching the top-left key light. */
const LIGHT = { x: 0.62, y: 0.78 }

const deg = (r: number) => (r * 180) / Math.PI

const partsOf = (r: { w: number; h: number; parts?: SceneryPart[] }): SceneryPart[] =>
  r.parts ?? [{ dx: 0, dy: 0, w: r.w, h: r.h }]

const heightM = (r: { storeys?: number }) => (r.storeys ?? 1) * STOREY_M

/** Darken a hex fill toward black, for the extruded wall faces. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** A footprint drawn as ONE silhouette. Pass 1 strokes every part in the outline colour, dilating
 *  the union; pass 2 fills them with no stroke, covering every internal seam. The outline survives
 *  only around the union, so an L or U footprint reads as one building instead of loose rectangles
 *  with edges showing where the parts meet. */
function Footprint({ parts, fill, stroke, sw, rx }: {
  parts: SceneryPart[]; fill: string; stroke: string; sw: number; rx: number
}) {
  return (
    <>
      {parts.map((p, j) => (
        <rect
          key={`o${j}`} x={p.dx - p.w / 2} y={p.dy - p.h / 2} width={p.w} height={p.h} rx={rx}
          fill={stroke} stroke={stroke} strokeWidth={sw} strokeLinejoin="round"
        />
      ))}
      {parts.map((p, j) => (
        <rect key={`f${j}`} x={p.dx - p.w / 2} y={p.dy - p.h / 2} width={p.w} height={p.h} rx={rx} fill={fill} />
      ))}
    </>
  )
}

export function SceneryLayer({ scenery, u, detail = 'full' }: {
  scenery: Scenery; u: (m: number) => number; detail?: 'full' | 'low'
}) {
  const full = detail === 'full'
  const structures: SceneryRect[] = [...scenery.stands, ...scenery.buildings]
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
        <linearGradient id="tm-bevel" x1="0" y1="0" x2="1" y2="1">
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
      </defs>

      {scenery.terrain.map((b, i) => (
        <g key={`t${i}`}>
          <path d={b.d} fill={b.fill} />
          {b.water && <path d={b.d} fill="url(#tm-water)" />}
        </g>
      ))}
      {scenery.runoffs.map((b, i) => <path key={`r${i}`} d={b.d} fill={b.fill} />)}

      {/* Drop shadows, thrown proportionally to each structure's height. */}
      {full && (
        <g fill="#000000" opacity={0.22}>
          {structures.map((r, i) => {
            const t = u(heightM(r) * SHADOW_PER_M)
            return (
              <g key={`sh${i}`} transform={`translate(${r.x + LIGHT.x * t} ${r.y + LIGHT.y * t}) rotate(${deg(r.rot)})`}>
                {partsOf(r).map((p, j) => (
                  <rect key={j} x={p.dx - p.w / 2} y={p.dy - p.h / 2} width={p.w} height={p.h} rx={u(0.8)} />
                ))}
              </g>
            )
          })}
        </g>
      )}

      {/* Extruded wall faces: the footprint repeated toward the light's far side, under the roof. */}
      {full && structures.map((r, i) => {
        const t = u(heightM(r) * 0.5)
        return (
          <g key={`wl${i}`} transform={`translate(${r.x + LIGHT.x * t} ${r.y + LIGHT.y * t}) rotate(${deg(r.rot)})`}>
            <Footprint
              parts={partsOf(r)} fill={shade(r.fill, 0.62)} stroke={shade(r.fill, 0.45)}
              sw={u(0.5)} rx={u(0.8)}
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
        const parts = partsOf(b)
        return (
          <g key={`b${i}`} transform={`translate(${b.x} ${b.y}) rotate(${deg(b.rot)})`}>
            <Footprint parts={parts} fill={b.fill} stroke="#2E333B" sw={u(0.5)} rx={u(0.8)} />
            {/* One bevel over the whole silhouette, clipped to the union. Drawing it per part gave
                every sub-rect its own full light-to-dark ramp, seaming at each internal edge. */}
            {full && (
              <>
                <clipPath id={`tm-bc${i}`}>
                  {parts.map((p, j) => (
                    <rect key={j} x={p.dx - p.w / 2} y={p.dy - p.h / 2} width={p.w} height={p.h} rx={u(0.8)} />
                  ))}
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
        <g transform={`translate(${u(2.4)} ${u(3)})`} fill="#000000" opacity={0.3}>
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
