import type { Scenery } from '@/lib/ui/track-scenery'

// Static scenery layer: generated once per circuit, transforms with the camera. The seat-stripe and
// crowd-dot patterns live in userSpace so they align with each rotated stand's local axes. Faux
// lighting comes from the top-left: every solid prop casts a soft drop shadow toward bottom-right and
// wears a diagonal bevel (lit top-left edge, shaded bottom-right).
export function SceneryLayer({ scenery, u, detail = 'full' }: { scenery: Scenery; u: (m: number) => number; detail?: 'full' | 'low' }) {
  const full = detail === 'full'
  const deg = (r: number) => (r * 180) / Math.PI
  const partsOf = (r: { w: number; h: number; parts?: Array<{ dx: number; dy: number; w: number; h: number }> }) =>
    r.parts ?? [{ dx: 0, dy: 0, w: r.w, h: r.h }]
  // The pit apron (plaza[0]) is flat paving; everything after it is a solid structure.
  const structures = [...scenery.plaza.slice(1), ...scenery.stands, ...scenery.buildings]
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
            fill="none"
            stroke="#A8D4E6"
            strokeWidth={u(0.35)}
            opacity={0.3}
          />
          <path
            d={`M ${-u(2)} ${u(4.6)} q ${u(2.2)} ${-u(1.4)} ${u(4.5)} 0 t ${u(4.5)} 0`}
            fill="none"
            stroke="#A8D4E6"
            strokeWidth={u(0.35)}
            opacity={0.2}
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
      </defs>

      {scenery.terrain.map((b, i) => (
        <g key={`t${i}`}>
          <path d={b.d} fill={b.fill} />
          {b.water && <path d={b.d} fill="url(#tm-water)" />}
        </g>
      ))}
      {scenery.runoffs.map((b, i) => <path key={`r${i}`} d={b.d} fill={b.fill} />)}

      {/* The pit apron: flat paving, no shadow. */}
      {scenery.plaza.slice(0, 1).map((r, i) => (
        <g key={`p${i}`} transform={`translate(${r.x} ${r.y}) rotate(${deg(r.rot)})`}>
          <rect x={-r.w / 2} y={-r.h / 2} width={r.w} height={r.h} rx={u(2)} fill={r.fill} stroke="#2E333B" strokeWidth={u(0.6)} />
        </g>
      ))}

      {/* Drop shadows for every solid structure, cast toward bottom-right. */}
      {full && <g transform={`translate(${u(1.6)} ${u(2)})`} fill="#000000" opacity={0.22}>
        {structures.map((r, i) => (
          <g key={`sh${i}`} transform={`translate(${r.x} ${r.y}) rotate(${deg(r.rot)})`}>
            {partsOf(r).map((p, j) => (
              <rect key={j} x={p.dx - p.w / 2} y={p.dy - p.h / 2} width={p.w} height={p.h} rx={u(0.8)} />
            ))}
          </g>
        ))}
      </g>}

      {/* Pit building */}
      {scenery.plaza.slice(1).map((r, i) => (
        <g key={`pb${i}`} transform={`translate(${r.x} ${r.y}) rotate(${deg(r.rot)})`}>
          <rect x={-r.w / 2} y={-r.h / 2} width={r.w} height={r.h} rx={u(0.8)} fill={r.fill} stroke="#2E333B" strokeWidth={u(0.6)} />
          {full && <rect x={-r.w / 2} y={-r.h / 2} width={r.w} height={r.h} rx={u(0.8)} fill="url(#tm-bevel)" />}
          {full && r.vents?.map((v, j) => (
            <rect key={j} x={v.dx - v.s / 2} y={v.dy - v.s / 2} width={v.s} height={v.s} fill="#333944" />
          ))}
        </g>
      ))}

      {scenery.stands.map((s, i) => {
        const roofY = s.flipped ? s.h / 2 - u(2.2) : -s.h / 2
        return (
          <g key={`s${i}`} transform={`translate(${s.x} ${s.y}) rotate(${deg(s.rot)})`}>
            <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} fill="url(#tm-seats)" stroke="#2E333B" strokeWidth={u(0.6)} />
            {full && <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} fill="url(#tm-crowd)" />}
            <rect x={-s.w / 2} y={roofY} width={s.w} height={u(2.2)} fill="#7B8494" />
            {full && <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} fill="url(#tm-bevel)" />}
          </g>
        )
      })}

      {scenery.buildings.map((b, i) => (
        <g key={`b${i}`} transform={`translate(${b.x} ${b.y}) rotate(${deg(b.rot)})`}>
          {partsOf(b).map((p, j) => (
            <rect key={`f${j}`} x={p.dx - p.w / 2} y={p.dy - p.h / 2} width={p.w} height={p.h} rx={u(0.8)} fill={b.fill} stroke="#2E333B" strokeWidth={u(0.5)} />
          ))}
          {full && partsOf(b).map((p, j) => (
            <rect key={`v${j}`} x={p.dx - p.w / 2} y={p.dy - p.h / 2} width={p.w} height={p.h} rx={u(0.8)} fill="url(#tm-bevel)" />
          ))}
          {full && b.vents?.map((v, j) => (
            <rect key={`n${j}`} x={v.dx - v.s / 2} y={v.dy - v.s / 2} width={v.s} height={v.s} fill="#333944" />
          ))}
        </g>
      ))}

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
