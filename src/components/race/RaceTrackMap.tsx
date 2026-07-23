'use client'

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Maximize } from 'lucide-react'
import type { TrackLayout } from '@/data/tracks'
import { buildScenery, type Scenery, type SceneryDensity } from '@/lib/ui/track-scenery'
import { Tooltip } from '@/components/ui/Tooltip'
import { NationalityFlag } from '@/components/world/NationalityFlag'

// 2D top-down race view (#sim-overhaul phase 6): the circuit outline with a team-coloured car sprite per
// entrant, plus a 2D camera. Rendering follows the qualifying TrackMap pattern: a private rAF reads
// per-car samples from `sampleRef` and moves markers via direct DOM writes, so nothing re-renders per
// frame. The whole scene (track + cars) lives on one "world" layer; the camera is a single CSS transform
// on it — wheel zooms to the cursor, drag pans, Shift+wheel rotates, clicking a car follows it.

export interface TrackCarMeta {
  id: string
  /** Live race position (shown in the tooltip). */
  pos: number
  color: string
  name: string
  team?: string
  nationality?: string
  isPlayer?: boolean
  retired?: boolean
}

/** One frame of a car's position: lap TIME fraction 0..1 (racing line), pit-lane progress when `pit`,
 * or a starting-grid slot before lights out. During lap 1, `gridSlot` + `blend` ease the car from its
 * grid box onto the racing line (at blend >= 1 the slot is ignored). Racing progress is mapped through
 * a curvature-derived speed profile, so equal time steps cover more distance on straights than corners. */
export type TrackSample = { prog: number; pit?: boolean; gridSlot?: number; blend?: number } | null

// Speed-profile physics in REAL units (m/s, m/s²), converted per track via metresPerUnit: top speed,
// the hairpin floor, lateral grip (sets each corner's speed via v = sqrt(A_LAT / curvature)), and
// traction/braking limits that smear speed changes over real distance.
const PROFILE_N = 256
const V_TOP_M = 87
const V_FLOOR_M = 10
const A_LAT_M = 14
const A_ACCEL_M = 12.75
const A_BRAKE_M = 41

// Real-world sizes, rendered at true scale through each layout's metresPerUnit.
const TRACK_WIDTH_M = 12
const TARMAC_WIDTH_M = 10
const PIT_WIDTH_M = 7
const SF_HALF_M = 7
const CAR_LENGTH_M = 5.63

const ZOOM_MIN = 0.6
const ZOOM_MAX = 20
const ROT_STEP = Math.PI / 36 // 5° per shift+wheel notch

// How much of the track's width the racing line may use, each side of the centreline: half the tarmac
// minus half a car and a margin.
const RACE_LINE_HALF_M = 4.0

// Sample the centreline at n stations: points, right normals, and signed curvature (right turn > 0).
function sampleCentre(center: SVGPathElement, len: number, n: number) {
  const c: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n; i++) c.push(center.getPointAtLength((i / n) * len))
  const ds = len / n
  const r: Array<{ x: number; y: number }> = []
  const kappa = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = c[(i - 1 + n) % n]
    const b = c[(i + 1) % n]
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
    r.push({ x: -(b.y - a.y) / d, y: (b.x - a.x) / d }) // right of travel
    const hIn = Math.atan2(c[i].y - a.y, c[i].x - a.x)
    const hOut = Math.atan2(b.y - c[i].y, b.x - c[i].x)
    let dth = hOut - hIn
    if (dth > Math.PI) dth -= 2 * Math.PI
    if (dth < -Math.PI) dth += 2 * Math.PI
    kappa[i] = dth / ds
  }
  return { c, r, kappa, ds }
}

// Minimise CURVATURE, not length: a midpoint-pull relaxation is curve-shortening flow, whose optimum
// is the taut string, i.e. the SHORTEST way round, hugging the insides. The fastest line minimises
// sum(kappa^2). In the lateral domain, path curvature ~ centreline kappa minus the lateral second
// derivative; Gauss-Seidel on that quartic system's stationarity equations (update = ds^2/6 times the
// discrete laplacian of kappa), clamped to the corridor, converges to the true minimum-curvature line:
// out wide, apex, out wide. A resolution ladder gets the long-range shape cheaply at the coarse level;
// a whisper of centring spring breaks the degeneracy on straights (any straight line has zero kappa).
function buildRacingLine(center: SVGPathElement, metresPerUnit: number): string {
  const len = center.getTotalLength()
  const targetN = Math.min(1200, Math.max(256, Math.round(len / (6 / metresPerUnit))))
  const ladder: number[] = []
  for (let n = targetN; n > 150; n = Math.ceil(n / 2)) ladder.push(n)
  if (ladder.length === 0) ladder.push(targetN)
  ladder.reverse() // coarse -> fine
  const w = RACE_LINE_HALF_M / metresPerUnit

  let a = new Float64Array(ladder[0])
  let prevN = ladder[0]
  for (let li = 0; li < ladder.length; li++) {
    const n = ladder[li]
    const { kappa: kc, ds } = sampleCentre(center, len, n)
    if (li > 0) {
      // Upsample the previous level's laterals (linear, wrapping).
      const up = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        const x = (i / n) * prevN
        const j = Math.floor(x) % prevN
        const f = x - Math.floor(x)
        up[i] = a[j] * (1 - f) + a[(j + 1) % prevN] * f
      }
      a = up
    }
    prevN = n
    const inv2 = 1 / (ds * ds)
    const lap = (i: number) => (a[(i - 1 + n) % n] - 2 * a[i] + a[(i + 1) % n]) * inv2
    // Path curvature: kc PLUS a'' — shifting toward the inside of a turn tightens it.
    const k = new Float64Array(n)
    for (let i = 0; i < n; i++) k[i] = kc[i] + lap(i)

    const sweeps = li === 0 ? 4000 : 900
    const OMEGA = 1.4
    const SPRING = 0.0008
    for (let pass = 0; pass < sweeps; pass++) {
      const fwd = pass % 2 === 0
      for (let s = 0; s < n; s++) {
        const i = fwd ? s : n - 1 - s
        const ip = (i - 1 + n) % n
        const inx = (i + 1) % n
        // Stationarity of sum(kappa^2) wrt a_i: a_i <- a_i - ds^2/6 * (discrete laplacian of kappa).
        const step = -((k[ip] - 2 * k[i] + k[inx]) * ds * ds) / 6
        const next = Math.max(-w, Math.min(w, (a[i] + OMEGA * step) / (1 + SPRING)))
        if (next !== a[i]) {
          a[i] = next
          // kappa depends on laterals at i-1, i, i+1: refresh the three affected stations.
          k[ip] = kc[ip] + lap(ip)
          k[i] = kc[i] + lap(i)
          k[inx] = kc[inx] + lap(inx)
        }
      }
    }
  }

  const { c, r } = sampleCentre(center, len, prevN)
  const pts = c.map((p, i) => `${(p.x + r[i].x * a[i]).toFixed(2)} ${(p.y + r[i].y * a[i]).toFixed(2)}`)
  return `M ${pts.join(' L ')} Z`
}

// Cumulative normalised lap TIME at each equal-distance station of the RACING LINE; inverting it turns
// a time fraction into a distance fraction. Classic three-step profile: corner limits from curvature,
// then an acceleration-limited forward pass and a braking-limited backward pass (twice, for the wrap).
function buildTimeProfile(path: SVGPathElement, metresPerUnit: number): Float64Array {
  const vTop = V_TOP_M / metresPerUnit
  const vFloor = V_FLOOR_M / metresPerUnit
  const aLat = A_LAT_M / metresPerUnit
  const aAccel = A_ACCEL_M / metresPerUnit
  const aBrake = A_BRAKE_M / metresPerUnit
  const len = path.getTotalLength()
  const ds = len / PROFILE_N
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < PROFILE_N; i++) pts.push(path.getPointAtLength((i / PROFILE_N) * len))

  const v = new Float64Array(PROFILE_N)
  for (let i = 0; i < PROFILE_N; i++) {
    const a = pts[(i - 2 + PROFILE_N) % PROFILE_N]
    const b = pts[i]
    const c = pts[(i + 2) % PROFILE_N]
    const in_ = Math.atan2(b.y - a.y, b.x - a.x)
    const out = Math.atan2(c.y - b.y, c.x - b.x)
    let dth = out - in_
    if (dth > Math.PI) dth -= 2 * Math.PI
    if (dth < -Math.PI) dth += 2 * Math.PI
    const kappa = Math.abs(dth) / (4 * ds)
    v[i] = Math.max(vFloor, Math.min(vTop, Math.sqrt(aLat / Math.max(kappa, 1e-9))))
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < PROFILE_N; i++) {
      const j = (i + 1) % PROFILE_N
      v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * aAccel * ds))
    }
    for (let i = PROFILE_N - 1; i >= 0; i--) {
      const j = (i + 1) % PROFILE_N
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * aBrake * ds))
    }
  }

  const cum = new Float64Array(PROFILE_N + 1)
  for (let i = 0; i < PROFILE_N; i++) cum[i + 1] = cum[i] + ds / ((v[i] + v[(i + 1) % PROFILE_N]) / 2)
  const total = cum[PROFILE_N]
  for (let i = 0; i <= PROFILE_N; i++) cum[i] /= total
  return cum
}

// Invert the profile: time fraction -> distance fraction.
function timeToDistance(profile: Float64Array, f: number): number {
  let lo = 0
  let hi = PROFILE_N
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (profile[mid] <= f) lo = mid
    else hi = mid
  }
  const span = profile[hi] - profile[lo] || 1
  return (lo + (f - profile[lo]) / span) / PROFILE_N
}

// The user-authored top-down F1 sprite (designs/F1 car.dc.html): three livery roles over fixed
// neutrals. PRIMARY = nose/chassis/sidepods/mid wing flaps, SECONDARY = wing planes/stripe/blades/
// helmet, TERTIARY = floor/endplates/halo/beam wing/fin. Memoised: ~90 elements per car, and only the
// livery/scale ever change.
const SPRITE_VIEWBOX = '-16 0 272 520'
const SPRITE_ASPECT = 272 / 520

// Derive the darker livery accents from the team's single colour.
function shade(hex: string, f: number): string {
  const v = hex.replace('#', '')
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16)
  const ch = (x: number) => Math.max(0, Math.min(255, Math.round(x * (1 + f))))
  const r = ch((n >> 16) & 255)
  const g = ch((n >> 8) & 255)
  const b = ch(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

const CarSprite = memo(function CarSprite({ color, length }: { color: string; length: number }) {
  const p = color
  const sec = shade(color, -0.38)
  const t = '#969CA6'
  return (
    <svg width={length * SPRITE_ASPECT} height={length} viewBox={SPRITE_VIEWBOX} className="block">
      {/* floor, visible through coke bottle */}
      <path d="M60 190 L120 164 L180 190 L180 450 Q180 460 170 460 L70 460 Q60 460 60 450 Z" fill="#14171E" />
      {/* front suspension: upper + lower wishbone + pushrod */}
      <path d="M52 84 L106 104 L106 110 L52 92 Z" fill="#2E3138" />
      <path d="M188 84 L134 104 L134 110 L188 92 Z" fill="#2E3138" />
      <path d="M52 126 L106 126 L106 131 L52 132 Z" fill="#2E3138" />
      <path d="M188 126 L134 126 L134 131 L188 132 Z" fill="#2E3138" />
      <path d="M54 106 L104 118 L104 122 L54 110 Z" fill="#43474F" />
      <path d="M186 106 L136 118 L136 122 L186 110 Z" fill="#43474F" />
      {/* rear suspension: 3 elements */}
      <path d="M56 374 L100 380 L100 385 L56 380 Z" fill="#2E3138" />
      <path d="M184 374 L140 380 L140 385 L184 380 Z" fill="#2E3138" />
      <path d="M56 397 L100 397 L100 404 L56 404 Z" fill="#43474F" />
      <path d="M184 397 L140 397 L140 404 L184 404 Z" fill="#43474F" />
      <path d="M56 424 L100 420 L100 425 L56 430 Z" fill="#2E3138" />
      <path d="M184 424 L140 420 L140 425 L184 430 Z" fill="#2E3138" />
      {/* front wing: swept elements, angular endplates */}
      <rect x="62" y="44" width="3" height="10" fill={p} />
      <rect x="88" y="44" width="3" height="10" fill={p} />
      <rect x="149" y="44" width="3" height="10" fill={p} />
      <rect x="175" y="44" width="3" height="10" fill={p} />
      <path d="M30 42 Q120 30 210 42 L210 51 Q120 41 30 51 Z" fill={sec} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <path d="M36 31 Q120 19 204 31 L204 40 Q120 29 36 40 Z" fill={p} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <path d="M44 21 Q120 11 196 21 L196 29 Q120 19 44 29 Z" fill={sec} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <path d="M56 13 Q120 5 184 13 L184 19 Q120 11 56 19 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="0.5" />
      <path d="M28 12 L40 9 L32 52 L20 50 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      <path d="M212 12 L200 9 L208 52 L220 50 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      {/* nose */}
      <path d="M120 8 C112 8 108 24 106 48 L102 110 Q100 142 95 166 L145 166 Q140 142 138 110 L134 48 C132 24 128 8 120 8 Z" fill={p} stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
      <path d="M120 12 C115 12 113 26 112 48 L109 118 L131 118 L128 48 C127 26 125 12 120 12 Z" fill={sec} />
      <path d="M94 174 Q74 218 58 218 L58 213 Q77 213 90 172 Z" fill={p} stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
      <path d="M146 174 Q166 218 182 218 L182 213 Q163 213 150 172 Z" fill={p} stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
      {/* chassis + sidepods, coke bottle */}
      <path d="M95 166 L145 166 L146 202 C154 204 161 205 168 206 C179 208 190 214 190 224 L188 290 C186 316 170 332 156 342 C150 350 148 356 148 366 L148 448 L92 448 L92 366 C92 356 90 350 84 342 C70 332 54 316 52 290 L50 224 C50 214 61 208 72 206 C79 205 86 204 94 202 Z" fill={p} stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
      {/* sidepod inlets */}
      <path d="M56 218 L94 212 L92 228 L54 234 Z" fill="#0B0D10" />
      <path d="M184 218 L146 212 L148 228 L186 234 Z" fill="#0B0D10" />
      {/* sidepod edge blades */}
      <path d="M52 224 C52 214 61 209 72 207 L94 203 L95 210 L74 214 C63 215 58 219 58 226 L60 288 C62 310 78 328 89 338 L84 344 C68 332 54 316 52 290 Z" fill={sec} />
      <path d="M188 224 C188 214 179 209 168 207 L146 203 L145 210 L166 214 C177 215 182 219 182 226 L180 288 C178 310 162 328 151 338 L156 344 C172 332 186 316 188 290 Z" fill={sec} />
      <path d="M62 246 L82 242 L82 245 L62 249 Z" fill="rgba(0,0,0,0.2)" />
      <path d="M63 258 L83 254 L83 257 L63 261 Z" fill="rgba(0,0,0,0.2)" />
      <path d="M64 270 L84 266 L84 269 L64 273 Z" fill="rgba(0,0,0,0.2)" />
      <path d="M178 246 L158 242 L158 245 L178 249 Z" fill="rgba(0,0,0,0.2)" />
      <path d="M177 258 L157 254 L157 257 L177 261 Z" fill="rgba(0,0,0,0.2)" />
      <path d="M176 270 L156 266 L156 269 L176 273 Z" fill="rgba(0,0,0,0.2)" />
      {/* engine cover spine + fin */}
      <path d="M113 262 L127 262 L124 446 L116 446 Z" fill={sec} />
      <rect x="117" y="352" width="6" height="94" fill={t} />
      {/* mirrors */}
      <rect x="90" y="202" width="11" height="6" rx="2" fill={t} />
      <rect x="139" y="202" width="11" height="6" rx="2" fill={t} />
      {/* cockpit + halo + helmet */}
      <rect x="104" y="194" width="32" height="60" rx="14" fill="#0B0D10" />
      <path d="M105 210 C105 190 135 190 135 210" fill="none" stroke={t} strokeWidth="5" strokeLinecap="round" />
      <rect x="118" y="190" width="4" height="16" fill={t} />
      <circle cx="120" cy="234" r="10" fill={sec} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      <rect x="113" y="228" width="14" height="3" rx="1.5" fill="#0B0D10" />
      {/* tyres */}
      <rect x="6" y="64" width="48" height="88" rx="18" fill="#16181D" />
      <rect x="16" y="82" width="28" height="52" rx="11" fill="#2E3138" />
      <rect x="186" y="64" width="48" height="88" rx="18" fill="#16181D" />
      <rect x="196" y="82" width="28" height="52" rx="11" fill="#2E3138" />
      <rect x="4" y="350" width="52" height="96" rx="19" fill="#16181D" />
      <rect x="15" y="370" width="30" height="56" rx="12" fill="#2E3138" />
      <rect x="184" y="350" width="52" height="96" rx="19" fill="#16181D" />
      <rect x="195" y="370" width="30" height="56" rx="12" fill="#2E3138" />
      {/* diffuser */}
      <path d="M84 448 L156 448 L164 468 L76 468 Z" fill="#0B0D10" />
      <rect x="96" y="450" width="3" height="16" fill="#2E3138" />
      <rect x="110" y="450" width="3" height="17" fill="#2E3138" />
      <rect x="127" y="450" width="3" height="17" fill="#2E3138" />
      <rect x="141" y="450" width="3" height="16" fill="#2E3138" />
      {/* rear wing: pylon + beam wing attach it to the body */}
      <rect x="66" y="476" width="3" height="12" fill={p} />
      <rect x="92" y="478" width="3" height="12" fill={p} />
      <rect x="145" y="478" width="3" height="12" fill={p} />
      <rect x="171" y="476" width="3" height="12" fill={p} />
      <rect x="116" y="412" width="8" height="36" fill="#2E3138" />
      <path d="M44 446 Q120 436 196 446 L196 453 Q120 444 44 453 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      <path d="M44 453 Q120 445 196 453 L196 464 Q120 456 44 464 Z" fill={p} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <path d="M42 466 Q120 458 198 466 L198 481 Q120 473 42 481 Z" fill={sec} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
      <rect x="113" y="448" width="14" height="9" rx="2" fill="#0B0D10" />
      <path d="M30 420 L42 415 L44 490 L32 487 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      <path d="M210 420 L198 415 L196 490 L208 487 Z" fill={t} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      {/* shading */}
      <path d="M95 166 L94 202 C86 204 79 205 72 206 C61 208 50 214 50 224 L52 290 C54 316 70 332 84 342 C90 350 92 356 92 366 L92 448 L100 448 L100 366 C100 354 96 346 89 338 C76 327 62 311 60 288 L58 226 C58 218 63 214 72 212 L98 208 L104 166 Z" fill="rgba(255,255,255,0.16)" />
      <path d="M145 166 L146 202 C154 204 161 205 168 206 C179 208 190 214 190 224 L188 290 C186 316 170 332 156 342 C150 350 148 356 148 366 L148 448 L140 448 L140 366 C140 354 144 346 151 338 C164 327 178 311 180 288 L182 226 C182 218 177 214 168 212 L142 208 L138 166 Z" fill="rgba(0,0,0,0.14)" />
      <path d="M120 8 C112 8 108 24 106 48 L102 110 Q100 142 95 166 L102 166 Q106 142 108 110 L111 48 C112 30 114 16 118 10 Z" fill="rgba(255,255,255,0.16)" />
    </svg>
  )
})

// Static scenery layer: generated once per circuit, transforms with the camera. The seat-stripe and
// crowd-dot patterns live in userSpace so they align with each rotated stand's local axes. Faux
// lighting comes from the top-left: every solid prop casts a soft drop shadow toward bottom-right and
// wears a diagonal bevel (lit top-left edge, shaded bottom-right).
function SceneryLayer({ scenery, u }: { scenery: Scenery; u: (m: number) => number }) {
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
      <g transform={`translate(${u(1.6)} ${u(2)})`} fill="#000000" opacity={0.22}>
        {structures.map((r, i) => (
          <g key={`sh${i}`} transform={`translate(${r.x} ${r.y}) rotate(${deg(r.rot)})`}>
            {partsOf(r).map((p, j) => (
              <rect key={j} x={p.dx - p.w / 2} y={p.dy - p.h / 2} width={p.w} height={p.h} rx={u(0.8)} />
            ))}
          </g>
        ))}
      </g>

      {/* Pit building */}
      {scenery.plaza.slice(1).map((r, i) => (
        <g key={`pb${i}`} transform={`translate(${r.x} ${r.y}) rotate(${deg(r.rot)})`}>
          <rect x={-r.w / 2} y={-r.h / 2} width={r.w} height={r.h} rx={u(0.8)} fill={r.fill} stroke="#2E333B" strokeWidth={u(0.6)} />
          <rect x={-r.w / 2} y={-r.h / 2} width={r.w} height={r.h} rx={u(0.8)} fill="url(#tm-bevel)" />
          {r.vents?.map((v, j) => (
            <rect key={j} x={v.dx - v.s / 2} y={v.dy - v.s / 2} width={v.s} height={v.s} fill="#333944" />
          ))}
        </g>
      ))}

      {scenery.stands.map((s, i) => {
        const roofY = s.flipped ? s.h / 2 - u(2.2) : -s.h / 2
        return (
          <g key={`s${i}`} transform={`translate(${s.x} ${s.y}) rotate(${deg(s.rot)})`}>
            <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} fill="url(#tm-seats)" stroke="#2E333B" strokeWidth={u(0.6)} />
            <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} fill="url(#tm-crowd)" />
            <rect x={-s.w / 2} y={roofY} width={s.w} height={u(2.2)} fill="#7B8494" />
            <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} fill="url(#tm-bevel)" />
          </g>
        )
      })}

      {scenery.buildings.map((b, i) => (
        <g key={`b${i}`} transform={`translate(${b.x} ${b.y}) rotate(${deg(b.rot)})`}>
          {partsOf(b).map((p, j) => (
            <rect key={`f${j}`} x={p.dx - p.w / 2} y={p.dy - p.h / 2} width={p.w} height={p.h} rx={u(0.8)} fill={b.fill} stroke="#2E333B" strokeWidth={u(0.5)} />
          ))}
          {partsOf(b).map((p, j) => (
            <rect key={`v${j}`} x={p.dx - p.w / 2} y={p.dy - p.h / 2} width={p.w} height={p.h} rx={u(0.8)} fill="url(#tm-bevel)" />
          ))}
          {b.vents?.map((v, j) => (
            <rect key={`n${j}`} x={v.dx - v.s / 2} y={v.dy - v.s / 2} width={v.s} height={v.s} fill="#333944" />
          ))}
        </g>
      ))}

      {/* Tree shadows, then canopies with their lit side. */}
      <g transform={`translate(${u(2.4)} ${u(3)})`} fill="#000000" opacity={0.3}>
        {scenery.trees.map((t, i) => <path key={`ts${i}`} d={t.d} />)}
      </g>
      {scenery.trees.map((t, i) => (
        <g key={`v${i}`}>
          <path d={t.d} fill={`url(#tm-tree${t.variant})`} stroke="#1E3318" strokeWidth={u(0.35)} />
          <path d={t.hd} fill="#8FB35F" opacity={0.3} />
        </g>
      ))}
    </g>
  )
}

interface Props {
  layout: TrackLayout
  cars: TrackCarMeta[]
  /** Per-frame sampler: where a car is right now, or null to hide its marker. Read inside rAF. */
  sampleRef: React.MutableRefObject<(id: string) => TrackSample>
  /** Followed car (camera lock), or null for a free camera. Click a car (here or on the timing board)
   * to follow it; dragging the map breaks the lock. */
  followId: string | null
  onFollow: (id: string | null) => void
  /** Show a flag + name label beside each marker. */
  showLabels?: boolean
  /** Per-track scenery density multipliers (trees/buildings). */
  sceneryDensity?: SceneryDensity
}

export function RaceTrackMap({ layout, cars, sampleRef, followId, onFollow, showLabels = false, sceneryDensity }: Props) {
  const pathRef = useRef<SVGPathElement>(null)
  const pitPathRef = useRef<SVGPathElement>(null)
  const lenRef = useRef(0)
  const pitLenRef = useRef(0)
  const profileRef = useRef<Float64Array | null>(null)
  const raceLineRef = useRef<SVGPathElement>(null)
  const raceLenRef = useRef(0)
  const elRefs = useRef(new Map<string, HTMLDivElement>())
  const sprRefs = useRef(new Map<string, HTMLDivElement>())
  const posRef = useRef(new Map<string, { left: number; top: number }>())
  const headingRef = useRef(new Map<string, number>())
  const latRef = useRef(new Map<string, number>())
  const outerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const stageDimsRef = useRef({ w: 0, h: 0 })
  const [stage, setStage] = useState({ w: 0, h: 0 })

  // Camera: pan (px), zoom, rotation — applied as one transform on the world layer. While following,
  // the pan is owned by the follow logic; dragging breaks the lock and pans freely.
  const camRef = useRef({ x: 0, y: 0, z: 1, rot: 0 })
  const followRef = useRef<string | null>(followId)
  useEffect(() => { followRef.current = followId }, [followId])

  const applyCam = () => {
    const world = worldRef.current
    if (!world) return
    const { x, y, z, rot } = camRef.current
    world.style.transform = `translate(${x}px, ${y}px) rotate(${rot}rad) scale(${z})`
    world.style.setProperty('--cam-rot', `${rot}rad`)
    world.style.setProperty('--cam-zoom-inv', String(1 / z))
  }

  // Real-world metres -> viewBox units for this track.
  const u = (metres: number) => metres / layout.metresPerUnit

  // Pad the authored viewBox: it hugs the racing line, so half the track stroke (and the pit lane)
  // would otherwise be clipped wherever the path touches an edge.
  const vb = useMemo(() => {
    const m = TRACK_WIDTH_M / layout.metresPerUnit / 2 + 8
    const [x, y, w, h] = layout.viewBox.split(' ').map(Number)
    return { x: x - m, y: y - m, w: w + 2 * m, h: h + 2 * m }
  }, [layout.viewBox, layout.metresPerUnit])

  // Fit an inner stage of the track's exact aspect ratio inside whatever box we're given, so the marker
  // layer's percentage coordinates line up with the SVG at any viewport size.
  useLayoutEffect(() => {
    const el = outerRef.current
    if (!el) return
    const fit = () => {
      const { width, height } = el.getBoundingClientRect()
      const scale = Math.min(width / vb.w, height / vb.h)
      const dims = { w: Math.floor(vb.w * scale), h: Math.floor(vb.h * scale) }
      stageDimsRef.current = dims
      setStage(dims)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [vb])

  // Camera inputs: wheel = zoom to cursor, Shift+wheel = rotate about the centre, drag = pan.
  useEffect(() => {
    const outer = outerRef.current
    if (!outer) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = camRef.current
      if (e.shiftKey) {
        const delta = e.deltaY > 0 ? ROT_STEP : -ROT_STEP
        cam.rot += delta
        const cos = Math.cos(delta)
        const sin = Math.sin(delta)
        const { x, y } = cam
        cam.x = x * cos - y * sin
        cam.y = x * sin + y * cos
      } else {
        const stageEl = stageRef.current
        if (!stageEl) return
        const rect = stageEl.getBoundingClientRect()
        const { w, h } = stageDimsRef.current
        const qx = e.clientX - rect.left - (rect.width / 2 - w / 2) - w / 2
        const qy = e.clientY - rect.top - (rect.height / 2 - h / 2) - h / 2
        const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.z * (e.deltaY > 0 ? 1 / 1.18 : 1.18)))
        const k = nz / cam.z
        cam.x = qx - k * (qx - cam.x)
        cam.y = qy - k * (qy - cam.y)
        cam.z = nz
      }
      applyCam()
    }
    outer.addEventListener('wheel', onWheel, { passive: false })
    return () => outer.removeEventListener('wheel', onWheel)
  }, [])

  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.id !== e.pointerId) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 3) return
    if (!drag.moved) {
      drag.moved = true
      followRef.current = null
      onFollow(null)
      outerRef.current?.setPointerCapture(e.pointerId)
    }
    camRef.current.x += dx
    camRef.current.y += dy
    drag.x = e.clientX
    drag.y = e.clientY
    applyCam()
  }
  const onPointerUp = () => {
    suppressClickRef.current = !!dragRef.current?.moved
    dragRef.current = null
  }

  const clickCar = (id: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    onFollow(followRef.current === id ? null : id)
  }

  const resetCamera = () => {
    camRef.current = { x: 0, y: 0, z: 1, rot: 0 }
    onFollow(null)
    applyCam()
  }

  useEffect(() => {
    lenRef.current = 0 // re-measure if the layout changes
    pitLenRef.current = 0
    raceLenRef.current = 0
    profileRef.current = null
    let raf = 0
    const tick = () => {
      const path = pathRef.current
      const pitPath = pitPathRef.current
      const raceLine = raceLineRef.current
      if (path && pitPath && raceLine) {
        if (!lenRef.current) lenRef.current = path.getTotalLength()
        if (!pitLenRef.current) pitLenRef.current = pitPath.getTotalLength()
        if (!raceLenRef.current) {
          raceLine.setAttribute('d', buildRacingLine(path, layout.metresPerUnit))
          raceLenRef.current = raceLine.getTotalLength()
          profileRef.current = buildTimeProfile(raceLine, layout.metresPerUnit)
        }
        const prof = profileRef.current!
        const lenTotal = lenRef.current
        const uu = (m: number) => m / layout.metresPerUnit
        const look = uu(8) // heading from ~8m of track ahead

        // Pass 1: place every car in arc space. Racing cars live on the RACING LINE path; grid slots
        // form the staggered starting grid (8m pitch, alternating sides) on the centreline.
        interface Frame {
          id: string; el: HTMLDivElement; kind: 'race' | 'pit' | 'grid'; dist: number; lat: number
          blend?: number
        }
        const frames: Frame[] = []
        for (const car of cars) {
          const el = elRefs.current.get(car.id)
          if (!el) continue
          const sample = sampleRef.current(car.id)
          if (sample === null) {
            el.style.visibility = 'hidden'
            continue
          }
          el.style.visibility = ''
          if (sample.pit) {
            frames.push({ id: car.id, el, kind: 'pit', dist: Math.min(1, Math.max(0, sample.prog)) * pitLenRef.current, lat: 0 })
          } else if (sample.gridSlot != null && sample.blend == null) {
            // Parked pre-race ONLY: lap-1 samples also carry gridSlot (for the launch deficit) but come
            // WITH a blend — those must fall through to the racing branch, or the whole first lap
            // renders as a frozen grid.
            const back = uu(3 + (sample.gridSlot - 1) * 8)
            frames.push({
              id: car.id, el, kind: 'grid',
              dist: (((lenTotal - back) % lenTotal) + lenTotal) % lenTotal,
              lat: (sample.gridSlot % 2 === 1 ? 1 : -1) * uu(1.7),
            })
          } else {
            const dist = timeToDistance(prof, ((sample.prog % 1) + 1) % 1) * raceLenRef.current
            // Grid stagger in TIME lives in the sampler's official seeds now; only the grid box's
            // lateral offset fades out here over the opening stretch of lap 1.
            const lat = sample.gridSlot != null
              ? (sample.gridSlot % 2 === 1 ? 1 : -1) * uu(1.7) * (1 - Math.min(1, sample.blend ?? 1))
              : 0
            frames.push({ id: car.id, el, kind: 'race', dist, lat, blend: sample.blend })
          }
        }

        // Pass 2: side-by-side separation — when two racing cars share ~8m of arc, the chasing car
        // moves off-line (side chosen stably per car) and the car ahead leans slightly the other way,
        // so a battle runs genuinely two-wide instead of overlapping.
        const racing = frames
          .filter((f) => f.kind === 'race' && (f.blend ?? 1) >= 1)
          .sort((a, b) => a.dist - b.dist)
        const sepRange = uu(8)
        const latMax = uu(3.4)
        for (let i = 0; i < racing.length; i++) {
          const behind = racing[i]
          const ahead = racing[(i + 1) % racing.length]
          if (behind === ahead) break
          const gap = i === racing.length - 1 ? ahead.dist + raceLenRef.current - behind.dist : ahead.dist - behind.dist
          if (gap < sepRange) {
            const side = behind.id.charCodeAt(behind.id.length - 1) % 2 === 0 ? 1 : -1
            const k = 1 - gap / sepRange
            behind.lat = Math.max(-latMax, Math.min(latMax, behind.lat + side * uu(3.0) * k))
            ahead.lat = Math.max(-latMax, Math.min(latMax, ahead.lat - side * uu(0.9) * k))
          }
        }

        // Pass 3: resolve to viewBox coordinates and write the DOM.
        for (const f of frames) {
          if (!Number.isFinite(f.dist)) { f.el.style.visibility = 'hidden'; continue } // never crash the geometry API
          const p = f.kind === 'pit' ? pitPath : f.kind === 'race' ? raceLine : path
          const total = f.kind === 'pit' ? pitLenRef.current : f.kind === 'race' ? raceLenRef.current : lenTotal
          const pt = p.getPointAtLength(f.dist)
          const aheadPt = p.getPointAtLength(f.kind === 'pit' ? Math.min(total, f.dist + look) : (f.dist + look) % total)
          const target = Math.atan2(aheadPt.y - pt.y, aheadPt.x - pt.x)
          // Low-pass the heading so polyline vertices don't twitch the sprite. The delta must be
          // modulo-wrapped, not single-corrected: a closed lap winds the stored heading by 2π each
          // time around, and an under-corrected delta makes the sprite pirouette the long way.
          const prev = headingRef.current.get(f.id) ?? target
          const raw = target - prev
          const delta = ((raw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
          const heading = prev + delta * 0.25
          headingRef.current.set(f.id, heading)
          // Low-pass the lateral too: chicane sign flips and battle-role handoffs become slides.
          const prevLat = latRef.current.get(f.id) ?? f.lat
          const lat = prevLat + (f.lat - prevLat) * 0.15
          latRef.current.set(f.id, lat)
          const x = pt.x - Math.sin(heading) * lat
          const y = pt.y + Math.cos(heading) * lat
          const left = ((x - vb.x) / vb.w) * 100
          const top = ((y - vb.y) / vb.h) * 100
          posRef.current.set(f.id, { left, top })
          // Position via transform, not left/top: layout offsets snap to the pixel grid in world space,
          // which a zoomed follow camera amplifies into visible jiggle on the pinned car.
          const { w: sw, h: sh } = stageDimsRef.current
          f.el.style.transform = `translate(${(left / 100) * sw}px, ${(top / 100) * sh}px) translate(-50%, -50%)`
          const spr = sprRefs.current.get(f.id)
          if (spr) spr.style.transform = `rotate(${heading + Math.PI / 2}rad)`
        }
      }
      // Follow camera: keep the followed car pinned to the stage centre (rotation and zoom untouched).
      if (followRef.current) {
        const pos = posRef.current.get(followRef.current)
        if (pos) {
          const { w, h } = stageDimsRef.current
          const cam = camRef.current
          const dx = (pos.left / 100) * w - w / 2
          const dy = (pos.top / 100) * h - h / 2
          const cos = Math.cos(cam.rot)
          const sin = Math.sin(cam.rot)
          cam.x = -cam.z * (dx * cos - dy * sin)
          cam.y = -cam.z * (dx * sin + dy * cos)
          applyCam()
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cars, layout, vb, sampleRef])

  // S/F line: a short tick perpendicular to the direction of travel at path start.
  const sf = useMemo(() => {
    const { x, y, angle } = layout.start
    const nx = Math.cos(angle + Math.PI / 2)
    const ny = Math.sin(angle + Math.PI / 2)
    const half = SF_HALF_M / layout.metresPerUnit
    return { x1: x - nx * half, y1: y - ny * half, x2: x + nx * half, y2: y + ny * half }
  }, [layout.start, layout.metresPerUnit])

  // Cars render at their true footprint: px per viewBox unit at zoom 1, times the real car length
  // (the sprite's width follows its own aspect ratio).
  const pxPerUnit = vb.w > 0 && stage.w > 0 ? stage.w / vb.w : 1
  const carL = Math.max(3.5, u(CAR_LENGTH_M) * pxPerUnit)

  // Scenery is deterministic per circuit and static — build once per layout.
  const scenery = useMemo(
    () => buildScenery(layout.trace, layout.pit.box, {
      circuitId: layout.circuitId,
      metresPerUnit: layout.metresPerUnit,
      viewBox: layout.viewBox,
      density: sceneryDensity,
    }),
    [layout, sceneryDensity],
  )
  const sceneryNode = useMemo(
    () => <SceneryLayer scenery={scenery} u={(m) => m / layout.metresPerUnit} />,
    [scenery, layout.metresPerUnit],
  )

  return (
    <div
      ref={outerRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={stageRef} className="relative" style={{ width: stage.w, height: stage.h }}>
        <div ref={worldRef} className="absolute inset-0" style={{ transformOrigin: '50% 50%' }}>
          {/* overflow visible: the ground plane extends far beyond the canvas so the camera never sees
              the edge of the world under follow + zoom. */}
          <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
            {/* Grass ground plane, far beyond the canvas so the camera never sees the edge of the world. */}
            <rect x={vb.x - 4000} y={vb.y - 4000} width={vb.w + 8000} height={vb.h + 8000} fill="#2F4A28" />
            {sceneryNode}
            {/* Pit lane: a narrower asphalt ribbon with painted edge lines, pit-box slots, and the wall. */}
            <defs>
              <pattern id="tm-hatch" width={u(2.2)} height={u(2.2)} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
                <rect width={u(0.7)} height={u(2.2)} fill="#E6E3DC" opacity={0.45} />
              </pattern>
            </defs>
            <path ref={pitPathRef} d={layout.pit.d} fill="none" stroke="#454C58" strokeWidth={u(PIT_WIDTH_M)} strokeLinejoin="round" strokeLinecap="round" />
            {layout.pit.hatches.map((d, i) => (
              <path key={`ph${i}`} d={d} fill="url(#tm-hatch)" />
            ))}
            {layout.pit.edges.map((d, i) => (
              <path key={`pe${i}`} d={d} fill="none" stroke="#E8C33A" strokeWidth={u(0.35)} opacity={0.9} />
            ))}
            {layout.pit.slots.map((s, i) => (
              <g key={`pl${i}`} transform={`translate(${s.x} ${s.y}) rotate(${(s.rot * 180) / Math.PI})`}>
                <rect x={-u(3)} y={-u(1.6)} width={u(6)} height={u(3.2)} rx={u(0.3)} fill="none" stroke="#E6E3DC" strokeWidth={u(0.28)} opacity={0.85} />
              </g>
            ))}
            <path d={layout.pit.wall} fill="none" stroke="#9AA3B2" strokeWidth={u(1)} strokeLinecap="round" />
            <path d={layout.pit.wall} fill="none" stroke="#6E7683" strokeWidth={u(0.35)} strokeLinecap="round" />
            {/* Track: white edge lines around grey asphalt. */}
            <path ref={pathRef} d={layout.d} fill="none" stroke="#D8D8D2" strokeWidth={u(TRACK_WIDTH_M)} strokeLinejoin="round" />
            <path d={layout.d} fill="none" stroke="#33383E" strokeWidth={u(TARMAC_WIDTH_M)} strokeLinejoin="round" />
            {/* Red/white kerbs through the corners. */}
            {scenery.kerbs.map((k, i) => (
              <g key={`k${i}`}>
                <path d={k.d} fill="none" stroke="#E6E3DC" strokeWidth={u(1.3)} strokeLinecap="round" />
                <path d={k.d} fill="none" stroke="#C8352F" strokeWidth={u(1.3)} strokeDasharray={`${u(3)} ${u(3)}`} />
              </g>
            ))}
            <line x1={sf.x1} y1={sf.y1} x2={sf.x2} y2={sf.y2} stroke="#FFFFFF" strokeWidth={u(1.5)} />
            {/* Invisible: the computed racing line the cars actually drive (sampled per frame). */}
            <path ref={raceLineRef} fill="none" stroke="none" />
          </svg>
          {cars.map((car) => (
            <Tooltip
              key={car.id}
              content={
                <div>
                  <div className="font-semibold">P{car.pos} {car.name}</div>
                  {car.team && <div className="text-[#9CA3AF]">{car.team}</div>}
                </div>
              }
            >
              <div
                ref={(el) => {
                  if (!el) { elRefs.current.delete(car.id); return }
                  elRefs.current.set(car.id, el)
                  const p = posRef.current.get(car.id) // keep the last spot across re-renders (commit, not render)
                  const { w, h } = stageDimsRef.current
                  el.style.transform = p && w
                    ? `translate(${(p.left / 100) * w}px, ${(p.top / 100) * h}px) translate(-50%, -50%)`
                    : 'translate(-50%, -50%)'
                }}
                onClick={() => clickCar(car.id)}
                className="absolute left-0 top-0 cursor-pointer"
                style={{ opacity: car.retired ? 0.35 : 1 }}
              >
                {/* Click target that doesn't affect layout, so the label anchor hugs the car itself. */}
                <div className="absolute -inset-2" />
                <div
                  ref={(el) => { if (el) sprRefs.current.set(car.id, el); else sprRefs.current.delete(car.id) }}
                  style={{
                    filter: car.isPlayer
                      ? 'drop-shadow(0.5px 0.8px 0.5px rgba(0,0,0,0.5)) drop-shadow(0 0 2px #FFFFFF) drop-shadow(0 0 4px rgba(255,255,255,0.6))'
                      : 'drop-shadow(0.5px 0.8px 0.5px rgba(0,0,0,0.5))',
                  }}
                >
                  <CarSprite color={car.color} length={carL} />
                </div>
                {showLabels && (
                  <div
                    className="absolute left-full top-1/2 flex items-center gap-1 whitespace-nowrap pointer-events-none"
                    style={{
                      // Counter-rotate AND counter-scale against the camera so labels stay upright and a
                      // constant screen size at any zoom, anchored beside the car.
                      transformOrigin: 'left center',
                      transform: 'rotate(calc(-1 * var(--cam-rot, 0rad))) scale(var(--cam-zoom-inv, 1)) translate(8px, -50%)',
                    }}
                  >
                    {car.nationality && <NationalityFlag code={car.nationality} />}
                    <span
                      className="text-xs font-semibold text-[#FFFFFF]"
                      style={{ WebkitTextStroke: '1px #000000', paintOrder: 'stroke' }}
                    >
                      {car.name}
                    </span>
                  </div>
                )}
              </div>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* Camera controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
        <Tooltip content="Reset camera">
          <button
            onClick={resetCamera}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#1E2431] hover:text-[#FFFFFF] cursor-pointer"
          >
            <Maximize size={18} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
