'use client'

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Maximize } from 'lucide-react'
import type { TrackLayout } from '@/data/tracks'
import { KERB_BLOCK_M, KERB_WIDTH_M } from '@/lib/ui/track-scenery'
import { buildScenery, type SceneryDensity } from '@/lib/ui/track-scenery'
import {
  SceneryLayer, SceneryShadowLayer, ScenerySolidsLayer, TrackFurnitureLayer, EXTRUDE, visibleTrees,
  type Cull, type Hidden, type SceneryPiece,
} from './SceneryLayer'
import {
  MOODS, dirAt, lightDir, screenUpAzimuth, shadowFill, shadowOpacity, shadowReach,
} from '@/lib/ui/lighting'
import { buildPitSlots, buildPitZone, pitCameraRotation, pitViewAzimuth } from '@/lib/ui/pit-zone'
import { useSceneryBitmap } from './use-scenery-bitmap'
import { SceneryCanvas, drawScene, warmScene } from './SceneryCanvas'
import { sceneryScene, type DrawOp, type SceneMark } from '@/lib/ui/scenery-draw'
import { canvasPaint } from '@/lib/ui/scenery-paint'
import {
  PitBuilding, PitBuildingShadow, PitGarageFloors, PitGarageSigns, pitComplexOps, pitFloorOps,
} from './PitBuilding'
import { COMPOUND_COLORS } from './TyreIndicator'
import { shade } from '@/lib/color'
import type { TyreCompound } from '@/lib/sim/types'
import { PIT_ENTRY_FRAC, PIT_EXIT_FRAC, TARMAC_WIDTH_M, TRACK_WIDTH_M } from '@/lib/ui/track-path'
import { liveBridge } from '@/lib/store/live-bridge'
import { Tooltip } from '@/components/ui/Tooltip'
import { NationalityFlag } from '@/components/world/NationalityFlag'

// 2D top-down race view (#sim-overhaul phase 6): the circuit outline with a team-coloured car sprite per
// entrant, plus a 2D camera. Rendering follows the qualifying TrackMap pattern: a private rAF reads
// per-car samples from `sampleRef` and moves markers via direct DOM writes, so nothing re-renders per
// frame. The whole scene (track + cars) lives on one "world" layer; the camera is a single CSS transform
// on it â€” wheel zooms to the cursor, drag pans, Shift+wheel rotates, clicking a car follows it.

export interface TrackCarMeta {
  id: string
  /** Live race position (shown in the tooltip). */
  pos: number
  /** Current tyre compound â€” drives the rim-edge colour band on the sprite's wheels. */
  compound?: TyreCompound
  color: string
  name: string
  team?: string
  nationality?: string
  isPlayer?: boolean
  retired?: boolean
}

/** One frame of a car's position: lap TIME fraction 0..1 (racing line), pit-lane progress when `pit`,
 * or a starting-grid slot. All cars LAUNCH TOGETHER at lights out: `launch` (0..1) slides the grid box
 * to the S/F line, timed so the car crosses exactly when its official grid-seeded time says. Racing
 * progress maps through a curvature-derived speed profile (more distance per time step on straights). */
export type TrackSample = { prog: number; pit?: boolean; pitPhase?: 'in' | 'box' | 'out'; stopFrac?: number; pitCalled?: boolean; pitNewCompound?: TyreCompound; gridSlot?: number; launch?: number } | null

// Speed-profile physics in REAL units (m/s, m/sÂ²), converted per track via metresPerUnit: top speed,
// the hairpin floor, lateral grip (sets each corner's speed via v = sqrt(A_LAT / curvature)), and
// traction/braking limits that smear speed changes over real distance.
const PROFILE_N = 256
/** Underside of the overhead gantry booms. Low: they clear a crew member's head and no more, so both
 *  the lift off the box floor and the shadow they throw are short. */
/** Frame-rate caps to cycle through, uncapped first. A steady rate reads as smoother than a higher
 *  one that swings, so the cap stays available â€” but with the static world baked to an image there is
 *  no longer a swing to steady, and capping a frame that already fits only throws frames away. */
const FRAME_CAPS: number[] = [0, 30, 45]

/** The layer switches, the node budget, the frame cap and the baked-world switch are all still wired
 *  and working; only their KEYBOARD shortcuts are off. They belong in settings, and this is the seam
 *  they get driven from when that exists. Typed as boolean so the block below stays live code rather
 *  than something the compiler narrows away.
 *
 *  The readout keeps its backtick: it is worth having to hand at any time. */
// Off in normal play. Flip on to get the layer hotkeys and the 'n' lap benchmark back — the
// readout keeps its backtick either way. The 2026-07 frame-rate campaign closed with the pit
// straight's raster dips accepted as the known residual (see the bench reports in that PR).
const DEBUG_KEYS: boolean = false

/** Diagnostic hotkeys: one category each, so the cost of a layer can be measured by removing it.
 *  Along the top letter row rather than the digits, which the race speed controls already own. */
const HOTKEYS: Record<string, SceneryPiece | 'kerbs' | 'pit' | 'boxes' | 'cars' | 'signs'> = {
  q: 'trees',
  w: 'shadows',
  e: 'buildings',
  r: 'stands',
  t: 'furniture',
  y: 'kerbs',
  u: 'pit',
  i: 'ground',
  o: 'boxes',
  // The car sprites are the last un-ported layer; hiding them attributes their raster cost live.
  a: 'cars',
  // The garage signs alone: 'pit' hides the canvas complex AND these SVG name boards together,
  // which left the benchmark unable to say which half was the pit straight's hitch.
  g: 'signs',
}
/** Element budget for the drawn world. Frame rate on this renderer tracks document node count more
 *  closely than it tracks anything else, so scenery is shed to hold this line. */
const NODE_BUDGET = 4000
/** How much wider than the viewport the tree-cull disc is drawn, and how far the camera may travel
 *  inside it before the set is recomputed. Together they decide how often culling costs a re-render. */
const CULL_MARGIN = 1.45
const CULL_SLACK = 0.3
/** Quiet period after the last rotation input before the scene is rebuilt on the new bearing. */
const ROT_SETTLE_MS = 120
const GANTRY_H_M = 2.2
/** Boom length: back to the building's front face, with a few centimetres of overlap so the join is
 *  visible rather than exact. Shared with its shadow, which has to stay exactly the same shape. */
const GANTRY_REACH_M = 4.75
const V_TOP_M = 87
const V_FLOOR_M = 10
const A_LAT_M = 14
const A_ACCEL_M = 12.75
const A_BRAKE_M = 41

// Real-world sizes, rendered at true scale through each layout's metresPerUnit.
const PIT_WIDTH_M = 9.5 // lane + working apron: the boxes sit 1.6m off-centre and their markings and
                        // gantries reach ~3.8m out â€” a 7m ribbon put them on the grass
const CAR_LENGTH_M = 5.63
// Uniform sprite shrink (proportions untouched). Everything car-locked multiplies by this:
// footprint, crew wheel anchors, tyre props, collision clearances.
const CAR_SCALE = 0.85

const ZOOM_MAX = 60
const ZOOM_DEFAULT = 20
const ZOOM_STEP = 1.18 // per wheel notch
const ZOOM_MIN = 0.6 // full-track view; far-zoom cost is handled by the scenery LOD + composited world layer
// Below this zoom the scenery drops its heavy layers (trees, shadows, bevels) â€” unresolvable there anyway.
const LOD_ZOOM = 3
const ROT_STEP = Math.PI / 36 // 5Â° per shift+wheel notch

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
    // Path curvature: kc PLUS a'' â€” shifting toward the inside of a turn tightens it.
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

const CarSprite = memo(function CarSprite({ color, length, compound }: { color: string; length: number; compound?: TyreCompound }) {
  const band = compound ? COMPOUND_COLORS[compound] : null
  const p = color
  const sec = shade(color, 0.62)
  const t = '#969CA6'
  return (
    <svg width={length * SPRITE_ASPECT} height={length} viewBox={SPRITE_VIEWBOX} className="block" style={{ overflow: 'visible' }}>
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
      {/* tyres â€” tagged so the pit choreography can take each wheel OFF the car while its tyre
          is being carried (#live-engine) */}
      <g data-wheel="fl">
        <rect x="6" y="64" width="48" height="88" rx="18" fill="#16181D" />
        <rect x="16" y="82" width="28" height="52" rx="11" fill="#2E3138" />
      </g>
      <g data-wheel="fr">
        <rect x="186" y="64" width="48" height="88" rx="18" fill="#16181D" />
        <rect x="196" y="82" width="28" height="52" rx="11" fill="#2E3138" />
      </g>
      <g data-wheel="rl">
        <rect x="4" y="350" width="52" height="96" rx="19" fill="#16181D" />
        <rect x="15" y="370" width="30" height="56" rx="12" fill="#2E3138" />
      </g>
      <g data-wheel="rr">
        <rect x="184" y="350" width="52" height="96" rx="19" fill="#16181D" />
        <rect x="195" y="370" width="30" height="56" rx="12" fill="#2E3138" />
      </g>
      {/* Compound band: a thin line on each tyre's OUTER edge, spanning ~the rim diameter. */}
      {band && (
        <g>
          <rect x="6" y="92" width="3" height="32" rx="1.5" fill={band} />
          <rect x="231" y="92" width="3" height="32" rx="1.5" fill={band} />
          <rect x="4" y="381" width="3" height="34" rx="1.5" fill={band} />
          <rect x="233" y="381" width="3" height="34" rx="1.5" fill={band} />
        </g>
      )}
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
  /** Rich hover card per car; falls back to a simple name/team tip. */
  tooltipFor?: (id: string) => React.ReactNode
  /** 'live' = sprites + camera; 'map' = the classic static full-track view with numbered dots. */
  view?: 'live' | 'map'
  /** Card pinned to the followed car; the map positions it clear of the track ribbon each frame. */
  pinnedCard?: React.ReactNode
  /** Coarse freshness counter (#live-engine): bump ~1/s so memoised renders refresh tooltip content
   * without paying the full tree cost on every 4Hz store commit. */
  tipTick?: number
  /** Garage order: team names best-first (constructor standings). Absent/unknown teams follow, so a
   * fresh season's empty table degrades to an arbitrary-but-stable order. */
  teamOrder?: string[]
}

function RaceTrackMapImpl({ layout, cars, sampleRef, followId, onFollow, showLabels = false, sceneryDensity, tooltipFor, view = 'live', pinnedCard, teamOrder }: Props) {
  const pathRef = useRef<SVGPathElement>(null)
  const pitPathRef = useRef<SVGPathElement>(null)
  const lenRef = useRef(0)
  const pitLenRef = useRef(0)
  const pitDRef = useRef('') // the `d` the pit caches were built from â€” geometry, not identity
  const profileRef = useRef<Float64Array | null>(null)
  const pitWindowForRef = useRef<unknown>(null) // which engine instance the pit window was sent to
  const prevDrawRef = useRef(new Map<string, { x: number; y: number; kind: string; dist: number; lat: number }>()) // last drawn pose per car, for the path-switch blend
  const pathBlendRef = useRef(new Map<string, { dx: number; dy: number; start: number }>()) // path-switch offset decay
  const pitAnchorRef = useRef(new Map<string, { residual: number; t0: number }>()) // service-position pin
  const slotDistsRef = useRef<number[]>([]) // arc position of each pit box along the lane path
  const crewRefs = useRef(new Map<number, SVGGElement>()) // per-slot pit crew overlays (root visibility)
  const crewPartsRef = useRef(new Map<string, SVGGElement>()) // `slot:role` -> member/prop group
  const slotInnerRefs = useRef(new Map<number, SVGGElement>()) // flipped so the garage faces away from the lane
  const gantryShRefs = useRef(new Map<number, SVGGElement>()) // gantry shadow, offset against that flip
  const gantryRefs = useRef(new Map<number, SVGGElement>()) // gantry booms, lifted off the box floor
  const slotFlipRef = useRef<number[]>([]) // which way each box was mirrored, measured in the layout pass
  const crewAnimRef = useRef(new Map<number, {
    mode: 'hidden' | 'active' | 'retreat'
    pos: Record<string, [number, number]>
    oldOut: boolean[]   // this corner's OLD tyre is being / has been carried off the car
    newIn: boolean[]    // this corner's NEW tyre is being / has been carried to the hub
    swapped: boolean    // movable tyres overlaid + the car sprite's own wheels hidden
    restored: boolean   // car sprite wheels back + new-set props hidden (same frame â€” seamless)
    carId?: string
    retreatT0: number
    lastWall?: number
  }>())
  const raceLineRef = useRef<SVGPathElement>(null)
  const raceLenRef = useRef(0)
  const elRefs = useRef(new Map<string, HTMLDivElement>())
  const sprRefs = useRef(new Map<string, HTMLDivElement>())
  const posRef = useRef(new Map<string, { left: number; top: number }>())
  const headingRef = useRef(new Map<string, number>())
  const latRef = useRef(new Map<string, number>())
  const tipRef = useRef<HTMLDivElement>(null)
  const tipPosRef = useRef<{ x: number; y: number } | null>(null)
  const outerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const stageDimsRef = useRef({ w: 0, h: 0 })
  const [stage, setStage] = useState({ w: 0, h: 0 })

  // Camera: pan (px), zoom, rotation â€” applied as one transform on the world layer. While following,
  // the pan is owned by the follow logic; dragging breaks the lock and pans freely.
  const defaultRot = useMemo(() => pitCameraRotation(layout) ?? 0, [layout])
  const camRef = useRef({ x: 0, y: 0, z: ZOOM_DEFAULT, rot: defaultRot })
  // Mirrored into state so the SCENERY can follow the camera. The map's whole sense of depth is one
  // bearing, and that bearing lives in world space, so rotating the camera would otherwise tip every
  // solid over sideways. Every path that carries height is rebuilt from it, which is why this is
  // state and not just a ref.
  const [camRot, setCamRot] = useState(defaultRot)
  // TWO bearings. The sun is fixed to the circuit, standardised against the pit complex so the light
  // falls the same way on every track; it must NOT move with the camera, or shadows would sit still
  // on screen while the world turned under them, which reads as the sun following the player. The
  // view bearing is the camera's, and keeps every solid leaning up the screen however far it turns.
  const lighting = useMemo(
    () => ({ ...MOODS.afternoon, azimuth: pitViewAzimuth(layout) ?? MOODS.afternoon.azimuth }),
    [layout],
  )
  const viewAz = screenUpAzimuth(camRot)
  const ldir = useMemo(() => lightDir(lighting), [lighting])
  const followRef = useRef<string | null>(followId)
  useEffect(() => { followRef.current = followId }, [followId])
  const viewRef = useRef(view)

  // Scenery LOD: below LOD_ZOOM the heavy layers drop out (state flips only on threshold crossings).
  const [lodLow, setLodLow] = useState(false)
  const lodLowRef = useRef(false)

  const vb = useMemo(() => {
    const m = TRACK_WIDTH_M / layout.metresPerUnit / 2 + 8
    const [x, y, w, h] = layout.viewBox.split(' ').map(Number)
    return { x: x - m, y: y - m, w: w + 2 * m, h: h + 2 * m }
  }, [layout.viewBox, layout.metresPerUnit])

  // Frame-rate readout, toggled with the backtick. Deliberately not React state: it writes straight
  // into a text node from its own rAF loop, so measuring the map costs the map nothing. Node count
  // comes with it because that is the number the frame rate actually tracks on this renderer.
  const [hud, setHud] = useState(false)
  // One hotkey per category, so what is expensive can be MEASURED instead of reasoned about. Each key
  // skips rendering that category outright rather than hiding it, so the node count moves with it.
  const [hidden, setHidden] = useState<ReadonlySet<SceneryPiece | 'kerbs' | 'pit' | 'boxes' | 'cars' | 'signs'>>(() => new Set())
  const hiddenRef = useRef<ReadonlySet<string>>(hidden)
  const [budgetOn, setBudgetOn] = useState(false)
  const hudRef = useRef<HTMLDivElement>(null)
  // 0 means uncapped; cycled from the readout so the two can be compared directly.
  // On by default: it is the fix, not an experiment. The hotkey stays so it can be compared.
  const [bitmapOn, setBitmapOn] = useState(false)
  const [canvasOn, setCanvasOn] = useState(true)
  const staticRef = useRef<SVGGElement>(null)
  const [frameCap, setFrameCap] = useState(FRAME_CAPS[0])
  const frameCapRef = useRef(FRAME_CAPS[0])
  useEffect(() => { hiddenRef.current = hidden }, [hidden])
  useEffect(() => { frameCapRef.current = frameCap }, [frameCap])
  // Benchmark entry, reached through a ref because the key listener binds once.
  const benchKeyRef = useRef<() => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return
      if (e.key === '`') setHud((v) => !v)
      if (!DEBUG_KEYS) return
      if (e.key === 'b' || e.key === 'B') setBudgetOn((v) => !v)
      if (e.key === 'p' || e.key === 'P') setBitmapOn((v) => !v)
      if (e.key === 'x' || e.key === 'X') setCanvasOn((v) => !v)
      if (e.key === 'n' || e.key === 'N') benchKeyRef.current()
      if (e.key === 'c' || e.key === 'C') {
        setFrameCap((v) => FRAME_CAPS[(FRAME_CAPS.indexOf(v) + 1) % FRAME_CAPS.length])
      }
      const piece = HOTKEYS[e.key.toLowerCase()]
      if (!piece) return
      setHidden((prev) => {
        const next = new Set(prev)
        if (next.has(piece)) next.delete(piece)
        else next.add(piece)
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!hud) return
    let raf = 0
    let frames = 0
    let since = performance.now()
    const tick = () => {
      frames++
      const now = performance.now()
      if (now - since >= 500) {
        const el = hudRef.current
        if (el) {
          const nodes = worldRef.current?.querySelectorAll('*').length ?? 0
          const fps = Math.round((frames * 1000) / (now - since))
          // Where the nodes actually are, per tagged subtree, rather than a guess at the split.
          const world = worldRef.current
          const by = ['scenery', 'boxes', 'cars'].map((k) => {
            const n = [...(world?.querySelectorAll(`[data-cost="${k}"]`) ?? [])]
              .reduce((sum, g) => sum + 1 + g.querySelectorAll('*').length, 0)
            return `${k} ${n}`
          }).join('  ')
          const offList = [...hiddenRef.current].join(',')
          const capTxt = frameCapRef.current > 0 ? `cap ${frameCapRef.current}` : 'uncapped'
          // Where the canvas's paint time goes, section by section, from the last drawn frame â€”
          // so a slow corner names its own cost instead of being reasoned about. Main-thread
          // command cost; the GPU raster that follows is not observable from here.
          const stats = Object.entries(paintStatsRef.current)
          const paintTotal = stats.reduce((s, [, v]) => s + v, 0)
          const paint = paintTotal > 0
            ? `  |  paint ${paintTotal.toFixed(1)}ms ` + stats
              .sort((a, b) => b[1] - a[1]).slice(0, 4)
              .map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' ')
            : ''
          const ts = tickStatsRef.current
          const tickTxt = ts.n > 0 ? `  |  tick ${(ts.sum / ts.n).toFixed(1)}/${ts.max.toFixed(1)}ms` : ''
          ts.sum = 0
          ts.n = 0
          ts.max = 0
          el.textContent = `${fps} fps (${capTxt})  ${nodes} nodes  |  ${by}${paint}${tickTxt}`
            + `${offList ? `  |  off: ${offList}` : ''}`
        }
        frames = 0
        since = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [hud])

  // Trees only exist at FULL detail, which is racing zoom â€” exactly when the least of the circuit is
  // on screen and the most of it is still in the DOM being repainted as the camera follows a car.
  // So they are culled to a disc around what is visible.
  //
  // Committed through state with hysteresis, never per frame: the disc is deliberately larger than
  // the viewport, and it only moves once the camera has left a good fraction of it. A tree therefore
  // appears well outside the frame and the set changes a handful of times a lap, not sixty times a
  // second.
  const [cull, setCull] = useState<Cull | null>(null)
  const cullRef = useRef<Cull | null>(null)
  const updateCull = useCallback(() => {
    const outer = outerRef.current
    const { w: sw } = stageDimsRef.current
    if (!outer || !sw) return
    const cam = camRef.current
    const ppu = sw / vb.w // px per viewBox unit before the camera transform
    // Undo the world transform to find where the viewport centre lands in the drawn scene.
    const cos = Math.cos(-cam.rot)
    const sin = Math.sin(-cam.rot)
    const qx = (-cam.x * cos - -cam.y * sin) / cam.z
    const qy = (-cam.x * sin + -cam.y * cos) / cam.z
    const next: Cull = {
      cx: vb.x + vb.w / 2 + qx / ppu,
      cy: vb.y + vb.h / 2 + qy / ppu,
      r: (Math.hypot(outer.clientWidth, outer.clientHeight) / 2 / cam.z / ppu) * CULL_MARGIN,
    }
    const prev = cullRef.current
    if (prev && Math.hypot(next.cx - prev.cx, next.cy - prev.cy) < prev.r * CULL_SLACK
      && Math.abs(next.r - prev.r) < prev.r * CULL_SLACK) return
    cullRef.current = next
    if (canvasOnRef.current && viewRef.current === 'live') {
      // The canvas is the only consumer of the disc in this mode: recompose off-React and let the
      // paint that follows in applyCam draw it. A setState here re-rendered the whole component.
      composeSceneRef.current(next)
    } else {
      setCull(next)
    }
  }, [vb])

  // Painting the canvas is defined further down, once the scene exists; `applyCam` reaches it through
  // this ref so the two can be declared in whichever order they need to be. The same goes for scene
  // composition: on a cull step the canvas recomposes IMPERATIVELY through this ref, because pushing
  // the disc through React state re-rendered and reconciled the whole component â€” thousands of car
  // and pit-box nodes â€” several times a lap, which is what the recurring fps dips were.
  const paintRef = useRef<() => void>(() => {})
  const composeSceneRef = useRef<(cull: Cull | null) => void>(() => {})
  const canvasOnRef = useRef(true)

  // Rebuilding the world on a new bearing means regenerating every path that carries height, which is
  // a full re-render of a few thousand nodes. Far too slow to do on each frame of a rotate, so the
  // camera turns on its own (the transform is imperative and cheap) and the SOLIDS catch up once the
  // gesture settles. The wheel has no end event, so it gets a short quiet period instead.
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleRot = () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(() => setCamRot(camRef.current.rot), ROT_SETTLE_MS)
  }
  useEffect(() => () => { if (settleTimerRef.current) clearTimeout(settleTimerRef.current) }, [])

  const applyCam = useCallback(() => {
    const world = worldRef.current
    if (!world) return
    const { x, y, z, rot } = camRef.current
    world.style.transform = `translate(${x}px, ${y}px) rotate(${rot}rad) scale(${z})`
    world.style.setProperty('--cam-rot', `${rot}rad`)
    world.style.setProperty('--cam-zoom-inv', String(1 / z))
    updateCull()
    paintRef.current()
    const low = z < LOD_ZOOM && viewRef.current === 'live'
    if (low !== lodLowRef.current) {
      lodLowRef.current = low
      setLodLow(low)
    }
  }, [updateCull])


  // Real-world metres -> viewBox units for this track.
  // Memoised: the scene and its paints are keyed on it, and a fresh closure every render would
  // rebuild a whole circuit's geometry sixty times a second.
  const u = useCallback((metres: number) => metres / layout.metresPerUnit, [layout.metresPerUnit])

  // Which side is the OUTSIDE of the circuit (from the loop's orientation): the pinned card lives
  // there permanently so it never crosses the track. Clockwise (y-down) = interior on the right of
  // travel, so outside is the left; anticlockwise mirrors.
  const outSign = useMemo(() => {
    const t = layout.trace
    const area = t.reduce((s, p, i) => {
      const q = t[(i + 1) % t.length]
      return s + (p[0] * q[1] - q[0] * p[1])
    }, 0)
    return area > 0 ? -1 : 1
  }, [layout.trace])

  // Pad the authored viewBox: it hugs the racing line, so half the track stroke (and the pit lane)
  // would otherwise be clipped wherever the path touches an edge.
  // Each team owns a pit box: slots are assigned in order of team appearance in the car list, so a
  // car stops at ITS box and the crew wears its colour.
  // One pit box per team on this grid, spaced ~2.5 car lengths and INTERPOLATED along the lane
  // (station-rounding collapsed neighbouring boxes onto one point on coarse lanes).
  const teamCount = useMemo(() => Math.max(1, new Set(cars.map((c) => c.team ?? c.id)).size), [cars])
  const pitSlots = useMemo(() => buildPitSlots(layout, teamCount), [layout, teamCount])

  // Starting grid: one box per car, staggered EXACTLY like the launch frames (8m pitch,
  // centres 3+(n-1)*8 m behind the S/F, +-1.7m with lat positive = driver's right). Marks are
  // an inverted U (crossbar at the front wing, legs trailing back) plus a yellow tyre guide
  // offset right of each box so the driver can sight it past the nose.
  // Grid marks are read from the SAME path element and the SAME arc formula the car frames use
  // (getPointAtLength on `pathRef`, back = 3 + (slot-1)*8 m from the S/F, lat +-1.7m). Any
  // parallel re-derivation of the track curve drifts from what getPointAtLength returns, which
  // put the boxes off the parked cars.
  const [gridMarks, setGridMarks] = useState<Array<{ x: number; y: number; deg: number }>>([])
  useEffect(() => {
    const path = pathRef.current
    if (!path) return
    const total = path.getTotalLength()
    const uw = (m: number) => m / layout.metresPerUnit
    const out = Array.from({ length: cars.length }, (_, i) => {
      const slot = i + 1
      const back = uw(3 + (slot - 1) * 8)
      const dist = ((total - back) % total + total) % total
      const pt = path.getPointAtLength(dist)
      const ahead = path.getPointAtLength((dist + uw(8)) % total)
      const rot = Math.atan2(ahead.y - pt.y, ahead.x - pt.x)
      const side = slot % 2 === 1 ? 1 : -1
      const lat = uw(1.7) * side
      return { x: pt.x - Math.sin(rot) * lat, y: pt.y + Math.cos(rot) * lat, deg: (rot * 180) / Math.PI }
    })
    setGridMarks(out)
  }, [layout, cars.length])

  // Zone furniture: the working-lane stripe exists ONLY along the box cluster; limiter lines bound
  // it; the pit building runs behind the garages so no team works off a grass verge.
  const pitZone = useMemo(() => buildPitZone(layout, pitSlots), [layout, pitSlots])

  // Gantry placement, kept off the layout pass because it changes with the CAMERA: the booms lift
  // against the view bearing, their shadow falls along the sun, and only the first of those moves
  // when the player rotates. Both live inside the slot's mirrored group, so each displacement is
  // pre-flipped in y or it would land on the wrong side for half the grid.
  useEffect(() => {
    const vdir = dirAt(viewAz)
    const lift = -(GANTRY_H_M * EXTRUDE) / layout.metresPerUnit
    const cast = (GANTRY_H_M * shadowReach(lighting)) / layout.metresPerUnit
    pitSlots.forEach((slot, si) => {
      const flip = slotFlipRef.current[si] ?? 1
      const local = (d: { x: number; y: number }) => ({
        x: Math.cos(slot.rot) * d.x + Math.sin(slot.rot) * d.y,
        y: -Math.sin(slot.rot) * d.x + Math.cos(slot.rot) * d.y,
      })
      const v = local(vdir)
      const l = local(ldir)
      gantryRefs.current.get(si)?.setAttribute('transform', `translate(${v.x * lift} ${v.y * lift * flip})`)
      gantryShRefs.current.get(si)?.setAttribute('transform', `translate(${l.x * cast} ${l.y * cast * flip})`)
    })
  }, [pitSlots, layout.metresPerUnit, viewAz, ldir, lighting])

  const slotOf = useMemo(() => {
    // Garage order: previous standings best-first (P1 gets the first box), alphabetical fallback for
    // anything unranked. NEVER derived from the live car list order â€” that reshuffles mid-race.
    const rank = (k: string) => {
      const i = teamOrder?.indexOf(k) ?? -1
      return i === -1 ? 1e9 : i
    }
    const keys = [...new Set(cars.map((c) => c.team ?? c.id))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    const map = new Map<string, number>()
    const colors: string[] = []
    for (const c of cars) {
      const idx = keys.indexOf(c.team ?? c.id)
      map.set(c.id, idx)
      if (colors[idx] === undefined) colors[idx] = c.color
    }
    return { byCar: map, colors }
  }, [cars, teamOrder])

  // Who is signed above each garage: the two cars the box order put in that bay.
  const garageCars = useMemo(() => {
    const out: TrackCarMeta[][] = []
    for (const c of cars) {
      const gi = slotOf.byCar.get(c.id)
      if (gi === undefined) continue
      ;(out[gi] ??= []).push(c)
    }
    return out
  }, [cars, slotOf])


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
      if (viewRef.current === 'map') return // the map view is static
      const cam = camRef.current
      if (e.shiftKey) {
        const delta = e.deltaY > 0 ? ROT_STEP : -ROT_STEP
        cam.rot += delta
        const cos = Math.cos(delta)
        const sin = Math.sin(delta)
        const { x, y } = cam
        cam.x = x * cos - y * sin
        cam.y = x * sin + y * cos
        settleRot()
      } else {
        const stageEl = stageRef.current
        if (!stageEl) return
        const rect = stageEl.getBoundingClientRect()
        const { w, h } = stageDimsRef.current
        const qx = e.clientX - rect.left - (rect.width / 2 - w / 2) - w / 2
        const qy = e.clientY - rect.top - (rect.height / 2 - h / 2) - h / 2
        const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.z * (e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP)))
        const k = nz / cam.z
        cam.x = qx - k * (qx - cam.x)
        cam.y = qy - k * (qy - cam.y)
        cam.z = nz
      }
      applyCam()
    }
    outer.addEventListener('wheel', onWheel, { passive: false })
    return () => outer.removeEventListener('wheel', onWheel)
  }, [applyCam])

  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean; mode: 'pan' | 'rotate' } | null>(null)
  const suppressClickRef = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    if (view === 'map') return
    if (e.button === 1) e.preventDefault() // no middle-click autoscroll
    if (e.button !== 0 && e.button !== 1) return
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, mode: e.button === 1 ? 'rotate' : 'pan' }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.id !== e.pointerId) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 3) return
    if (!drag.moved) {
      drag.moved = true
      // Only PANNING breaks the follow lock; rotation orbits the followed car.
      if (drag.mode === 'pan') {
        followRef.current = null
        onFollow(null)
      }
      outerRef.current?.setPointerCapture(e.pointerId)
    }
    const cam = camRef.current
    if (drag.mode === 'rotate') {
      const delta = dx * 0.005
      cam.rot += delta
      const cos = Math.cos(delta)
      const sin = Math.sin(delta)
      const { x, y } = cam
      cam.x = x * cos - y * sin
      cam.y = x * sin + y * cos
    } else {
      cam.x += dx
      cam.y += dy
    }
    drag.x = e.clientX
    drag.y = e.clientY
    applyCam()
  }
  const onPointerUp = () => {
    const drag = dragRef.current
    suppressClickRef.current = !!drag?.moved
    dragRef.current = null
    // A rotate gesture ends here, which is when the scene is rebuilt on the new bearing.
    if (drag?.moved && drag.mode === 'rotate') settleRot()
  }

  const clickCar = (id: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    // Clicking the followed car does nothing â€” the only way to unfollow is to pan away.
    if (followRef.current !== id) onFollow(id)
  }

  // Reset ZOOM only: keep the pan (or the follow lock) and rotation exactly as they are.
  const resetZoom = () => {
    camRef.current = { ...camRef.current, z: ZOOM_DEFAULT }
    applyCam()
  }

  // Camera per view: 'map' is the static full-track fit (the stage IS the whole track at zoom 1).
  // The LIVE camera (zoom/pan/rotation) is saved on the way out and restored on the way back, so
  // flipping views never loses where the player was. Also applies the initial camera on mount.
  const savedCamRef = useRef<{ x: number; y: number; z: number; rot: number } | null>(null)
  useEffect(() => {
    if (view === 'map' && viewRef.current === 'live') savedCamRef.current = { ...camRef.current }
    viewRef.current = view
    camRef.current = view === 'map'
      ? { x: 0, y: 0, z: 1, rot: 0 }
      : savedCamRef.current ?? { x: 0, y: 0, z: ZOOM_DEFAULT, rot: defaultRot }
    setCamRot(camRef.current.rot)
    applyCam()
  }, [view, defaultRot, applyCam])  

  // Geometry caches reset ONLY when the circuit changes â€” resetting per render rebuilt the racing-line
  // solve (tens of millions of ops) at every tick, freezing the frame each time the leader crossed the line.
  useEffect(() => {
    lenRef.current = 0
    pitLenRef.current = 0
    raceLenRef.current = 0
    profileRef.current = null
    slotDistsRef.current = []
    pitWindowForRef.current = null
  }, [layout])
  useEffect(() => { slotDistsRef.current = [] }, [pitSlots])

  useEffect(() => {
    let raf = 0
    // Frame cap. It does not make a frame cheaper, it makes the RATE steady, and a steady 30 reads as
    // smoother than a rate swinging between 40 and 60 as scenery comes in and out of shot. It only
    // holds while a frame's work fits the budget; past that the cap is simply not the binding
    // constraint. Half a frame of slack stops it beating against a 60Hz vsync into an uneven 20.
    let due = 0
    const tick = (now: number) => {
      const cap = frameCapRef.current
      if (cap > 0) {
        if (now < due) {
          raf = requestAnimationFrame(tick)
          return
        }
        const step = 1000 / cap
        due = now + step - Math.min(step / 2, now - due)
      }
      const tickT0 = performance.now()
      const path = pathRef.current
      const pitPath = pitPathRef.current
      const raceLine = raceLineRef.current
      if (path && pitPath && raceLine) {
        if (!lenRef.current) lenRef.current = path.getTotalLength()
        // Geometry caches (lane length, projected box distances, the engine's pit window) are
        // only valid for the exact path they were measured on: re-key them on the `d` string so
        // a changed lane can never be driven with stale distances.
        if (pitDRef.current !== layout.pit.fastD) {
          pitDRef.current = layout.pit.fastD
          pitLenRef.current = pitPath.getTotalLength()
          slotDistsRef.current = []
          pitWindowForRef.current = null
        }
        if (!pitLenRef.current) pitLenRef.current = pitPath.getTotalLength()
        if (!raceLenRef.current) {
          raceLine.setAttribute('d', buildRacingLine(path, layout.metresPerUnit))
          raceLenRef.current = raceLine.getTotalLength()
          profileRef.current = buildTimeProfile(raceLine, layout.metresPerUnit)
        }
        if (pitPath && pitLenRef.current > 0 && slotDistsRef.current.length === 0 && pitSlots.length > 0) {
          // Project each pit box onto the lane path once: the arc position a stopping car parks at.
          slotDistsRef.current = pitSlots.map((slot, si) => {
            let bestS = pitLenRef.current / 2
            let bestD = Infinity
            const step = Math.max(0.75, pitLenRef.current / 400)
            for (let a = 0; a <= pitLenRef.current; a += step) {
              const q = pitPath.getPointAtLength(a)
              const d = (q.x - slot.x) ** 2 + (q.y - slot.y) ** 2
              if (d < bestD) { bestD = d; bestS = a }
            }
            // Fine pass: the coarse grid leaves up to half a step (~0.8m) of longitudinal slop
            // between the painted box and the anchor the car/props pin to.
            for (let a = Math.max(0, bestS - step); a <= Math.min(pitLenRef.current, bestS + step); a += step / 25) {
              const q = pitPath.getPointAtLength(a)
              const d = (q.x - slot.x) ** 2 + (q.y - slot.y) ** 2
              if (d < bestD) { bestD = d; bestS = a }
            }
            // Which local side is the LANE on? The garage must face the other way â€” this depends on
            // the track's winding, so it is measured, not assumed. The slot's whole interior flips.
            const lane = pitPath.getPointAtLength(bestS)
            const yLocal = -Math.sin(slot.rot) * (lane.x - slot.x) + Math.cos(slot.rot) * (lane.y - slot.y)
            const flip = yLocal > 0 ? -1 : 1
            slotInnerRefs.current.get(si)?.setAttribute('transform', `scale(1 ${flip})`)
            slotFlipRef.current[si] = flip
            return bestS
          })
        }
        // Tell the live engine where the DRAWN pit entry/exit sit in lap-TIME terms (#live-engine).
        // Found GEOMETRICALLY: the racing line's arc distances are redistributed relative to the
        // centreline the lane hangs off, so "0.93 of the racing line" is a different physical point â€”
        // instead, locate where the racing line passes closest to the lane's actual endpoint. Re-sent
        // whenever a fresh engine appears on the bridge (restart, next race).
        if (liveBridge.current && pitPath && pitLenRef.current > 0 && pitWindowForRef.current !== liveBridge.current) {
          pitWindowForRef.current = liveBridge.current
          const p = profileRef.current!
          const rl = raceLine
          const rlLen = raceLenRef.current
          const nearestTimeFrac = (target: DOMPoint, centreFrac: number) => {
            let bestS = centreFrac * rlLen
            let bestD = Infinity
            const half = rlLen * 0.08
            const step = Math.max(1, rlLen / 900)
            for (let s = centreFrac * rlLen - half; s <= centreFrac * rlLen + half; s += step) {
              const arc = ((s % rlLen) + rlLen) % rlLen
              const pt = rl.getPointAtLength(arc)
              const d = (pt.x - target.x) ** 2 + (pt.y - target.y) ** 2
              if (d < bestD) { bestD = d; bestS = arc }
            }
            return p[Math.max(0, Math.min(p.length - 1, Math.round((bestS / rlLen) * (p.length - 1))))]
          }
          liveBridge.current.setPitWindow(
            nearestTimeFrac(pitPath.getPointAtLength(0), PIT_ENTRY_FRAC),
            nearestTimeFrac(pitPath.getPointAtLength(pitLenRef.current), PIT_EXIT_FRAC),
          )
        }
        const prof = profileRef.current!
        const lenTotal = lenRef.current
        const uu = (m: number) => m / layout.metresPerUnit
        const look = uu(8) // heading from ~8m of track ahead

        // Pass 1: place every car in arc space. Racing cars live on the RACING LINE path; grid slots
        // form the staggered starting grid (8m pitch, alternating sides) on the centreline.
        interface Frame { id: string; el: HTMLDivElement; kind: 'race' | 'pit' | 'grid'; dist: number; lat: number; pitPhase?: 'in' | 'box' | 'out'; stopFrac?: number; pitCalled?: boolean; pitNewCompound?: TyreCompound }
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
            // The lane's 0..1 progress parks at THIS team's box: 0..0.5 crawls to the box, 0.5 holds
            // in it, 0.5..1 crawls from the box to the exit.
            const fracIn = Math.min(1, Math.max(0, sample.prog))
            const slotIdx = slotOf.byCar.get(car.id)
            const boxDist = slotIdx != null ? slotDistsRef.current[slotIdx] : undefined
            let dist = boxDist == null
              ? fracIn * pitLenRef.current
              : fracIn < 0.5
                ? (fracIn / 0.5) * boxDist
                : boxDist + ((fracIn - 0.5) / 0.5) * (pitLenRef.current - boxDist)
            // A serviced car has exactly ONE correct position: the box point. It is PINNED there by
            // geometry, not converged on by dynamics â€” a half-second roll-in absorbs whatever
            // residual the approach left, then the pin is exact for the whole stop.
            if (sample.pitPhase === 'box' && boxDist != null) {
              let anchor = pitAnchorRef.current.get(car.id)
              if (!anchor) {
                anchor = { residual: dist - boxDist, t0: performance.now() }
                pitAnchorRef.current.set(car.id, anchor)
              }
              const t = Math.min(1, (performance.now() - anchor.t0) / 500)
              dist = boxDist + anchor.residual * (1 - t * t * (3 - 2 * t))
            } else {
              pitAnchorRef.current.delete(car.id)
            }
            frames.push({ id: car.id, el, kind: 'pit', dist, lat: 0, pitPhase: sample.pitPhase, stopFrac: sample.stopFrac, pitNewCompound: sample.pitNewCompound })
          } else if (sample.gridSlot != null) {
            // On the grid â€” parked pre-race, and from lights out the whole field launches TOGETHER:
            // `launch` covers the run to the S/F line so the car crosses exactly when its official
            // (grid-seeded) time begins. CUBED: a launch is an acceleration â€” barely moving off the
            // box, arriving at the line near racing speed â€” not a constant crawl with a jump at the line.
            const launch = Math.min(1, sample.launch ?? 0)
            const covered = launch * launch * launch
            const back = uu(3 + (sample.gridSlot - 1) * 8) * (1 - covered)
            frames.push({
              id: car.id, el, kind: 'grid',
              dist: (((lenTotal - back) % lenTotal) + lenTotal) % lenTotal,
              lat: (sample.gridSlot % 2 === 1 ? 1 : -1) * uu(1.7) * (1 - covered),
            })
          } else {
            const dist = timeToDistance(prof, ((sample.prog % 1) + 1) % 1) * raceLenRef.current
            frames.push({ id: car.id, el, kind: 'race', dist, lat: 0, pitCalled: sample.pitCalled })
          }
        }

        // Pass 2: side-by-side separation, cluster-aware â€” pairwise nudges with fixed per-car sides
        // stacked three-deep battles onto one line. Any chain of cars sharing ~8m of arc is a CLUSTER:
        // the front car holds the racing line, followers fan out to alternating distinct lanes
        // (nearest first), each blended in by how close it actually runs.
        const racing = frames.filter((f) => f.kind === 'race').sort((a, b) => a.dist - b.dist)
        const sepRange = uu(8)
        const latMax = uu(5)
        if (racing.length > 1) {
          // Start clustering just past the WIDEST inter-car gap so no cluster spans the lap seam.
          let cut = 0
          let widest = -1
          for (let i = 0; i < racing.length; i++) {
            const a = racing[i]
            const b = racing[(i + 1) % racing.length]
            const gap = (i === racing.length - 1 ? b.dist + raceLenRef.current : b.dist) - a.dist
            if (gap > widest) { widest = gap; cut = (i + 1) % racing.length }
          }
          const order = [...racing.slice(cut), ...racing.slice(0, cut)]
          let cluster: typeof racing = [order[0]]
          const flush = () => {
            if (cluster.length > 1) {
              const front = cluster[cluster.length - 1]
              const baseSide = front.id.charCodeAt(front.id.length - 1) % 2 === 0 ? 1 : -1
              for (let j = cluster.length - 2, lane = 0; j >= 0; j--, lane++) {
                const me = cluster[j]
                const ahead = cluster[j + 1]
                const gap = ahead.dist - me.dist + (ahead.dist < me.dist ? raceLenRef.current : 0)
                const k = Math.max(0, 1 - gap / sepRange)
                const side = baseSide * (lane % 2 === 0 ? 1 : -1)
                const mag = uu(3.0 + 1.7 * Math.floor(lane / 2))
                me.lat = Math.max(-latMax, Math.min(latMax, side * mag * k))
              }
            }
            cluster = []
          }
          for (let i = 1; i < order.length; i++) {
            const prev = order[i - 1]
            const cur = order[i]
            const gap = cur.dist - prev.dist + (cur.dist < prev.dist ? raceLenRef.current : 0)
            if (gap < sepRange) cluster.push(cur)
            else { flush(); cluster = [cur] }
          }
          flush()
        }

        // Pass 3a: resolve each frame to its path point, smoothed heading and smoothed lateral.
        interface Draw { f: Frame; pt: DOMPoint; heading: number; lat: number; total: number }
        const draws: Draw[] = []
        for (const f of frames) {
          if (!Number.isFinite(f.dist)) { f.el.style.visibility = 'hidden'; continue } // never crash the geometry API
          const p = f.kind === 'pit' ? pitPath : f.kind === 'race' ? raceLine : path
          const total = f.kind === 'pit' ? pitLenRef.current : f.kind === 'race' ? raceLenRef.current : lenTotal
          const pt = p.getPointAtLength(f.dist)
          const aheadPt = p.getPointAtLength(f.kind === 'pit' ? Math.min(total, f.dist + look) : (f.dist + look) % total)
          const target = Math.atan2(aheadPt.y - pt.y, aheadPt.x - pt.x)
          // Low-pass the heading so polyline vertices don't twitch the sprite. The delta must be
          // modulo-wrapped, not single-corrected: a closed lap winds the stored heading by 2Ï€ each
          // time around, and an under-corrected delta makes the sprite pirouette the long way.
          const prev = headingRef.current.get(f.id) ?? target
          const raw = target - prev
          const delta = ((raw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
          const heading = prev + delta * 0.25
          headingRef.current.set(f.id, heading)
          // Pit lane discipline: transit runs the FAR side of the lane (the fast lane), clear of
          // everyone's boxes; a stopping car swings diagonally up INTO its box â€” parking centred
          // inside the rectangle â€” and diagonally back out to the lane. The offset funnels to the
          // centreline at both tapers where the lane meets track.
          if (f.kind === 'pit') {
            const slotIdx = slotOf.byCar.get(f.id)
            const refSlot = (slotIdx != null ? pitSlots[slotIdx] : undefined) ?? pitSlots[0]
            if (refSlot) {
              // The lane's OWN garage-side sign: a per-frame projection toward a distant box
              // flips with curvature through the tapers, which drove cars up the wrong side of
              // the lane (and, once the working lane was trimmed, onto the grass).
              const sideSign = layout.pit.latSign
              let lat = -sideSign * uu(2.8) // centred in the marked fast lane (âˆ’4.3 line to âˆ’1.3 stripe)
              const boxDist = slotIdx != null ? slotDistsRef.current[slotIdx] : undefined
              // Only the arrival and the stop swing across to the boxes; a car on its way out
              // rejoins the fast lane and stays there (the working lane may not even exist past
              // the box zone). Departing cars still slide out smoothly via the lateral low-pass.
              const swings = f.pitPhase !== 'out' || f.dist < (boxDist ?? 0) + uu(12)
              if (boxDist != null && swings) {
                const prox = Math.max(0, 1 - Math.abs(f.dist - boxDist) / uu(12))
                const e = prox * prox * (3 - 2 * prox)
                lat += (sideSign * uu(1.6) - lat) * e
                // Deep in the box zone the sprite aligns to the BOX, not the path lookahead â€” the
                // parked car sits square in the rectangle.
                if (prox > 0.4) {
                  const cur = headingRef.current.get(f.id)
                  if (cur != null) {
                    const dl = ((refSlot.rot - cur + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
                    headingRef.current.set(f.id, cur + dl * 0.3 * prox)
                  }
                }
              }
              f.lat = lat
            }
          }
          // Low-pass the lateral too: chicane sign flips and battle-role handoffs become slides.
          const prevLat = latRef.current.get(f.id) ?? f.lat
          const lat = prevLat + (f.lat - prevLat) * 0.15
          draws.push({ f, pt, heading: headingRef.current.get(f.id) ?? heading, lat, total })
        }

        // Pass 3b: sprites must NEVER overlap. On-track pairs within a car length of arc get their
        // DISPLAYED laterals pushed to at least a car width apart (written back so next frame's
        // low-pass continues from the resolved values â€” the push is smooth, not a pop). Queued pit
        // sprites are arc-clamped behind the car ahead in the lane.
        const minArc = uu(6.5 * CAR_SCALE)
        const minLat = uu(2.6 * CAR_SCALE)
        const latCap = uu(5.5)
        const onTrack = draws.filter((d) => d.f.kind === 'race').sort((a, b) => a.f.dist - b.f.dist)
        for (let sweep = 0; sweep < 2; sweep++) {
          for (let i = 0; i < onTrack.length; i++) {
            const a = onTrack[i]
            const b = onTrack[(i + 1) % onTrack.length]
            if (a === b) break
            const arcGap = (i === onTrack.length - 1 ? b.f.dist + raceLenRef.current : b.f.dist) - a.f.dist
            if (arcGap < minArc) {
              const dLat = b.lat - a.lat
              if (Math.abs(dLat) < minLat) {
                const push = (minLat - Math.abs(dLat)) / 2
                const dir = dLat >= 0 ? 1 : -1
                a.lat = Math.max(-latCap, Math.min(latCap, a.lat - dir * push))
                b.lat = Math.max(-latCap, Math.min(latCap, b.lat + dir * push))
              }
            }
          }
        }
        const inLane = draws.filter((d) => d.f.kind === 'pit').sort((a, b) => a.f.dist - b.f.dist)
        for (let i = inLane.length - 2; i >= 0; i--) {
          const maxDist = inLane[i + 1].f.dist - uu(6.5 * CAR_SCALE)
          if (inLane[i].f.dist > maxDist) {
            inLane[i].f.dist = Math.max(0, maxDist)
            inLane[i].pt = pitPath!.getPointAtLength(inLane[i].f.dist)
          }
        }
        for (const d of draws) latRef.current.set(d.f.id, d.lat)

        // Pass 3c: write the DOM.
        for (const d of draws) {
          const { f, pt, heading, lat } = d
          let x = pt.x - Math.sin(heading) * lat
          let y = pt.y + Math.cos(heading) * lat
          // Path-switch OFFSET DECAY: changing path (raceâ†”pit, gridâ†’race) changes the base point the
          // sprite hangs off â€” the racing line and the lane mouth are metres apart. The car keeps its
          // new path's motion from the FIRST frame; only the positional discrepancy, captured at the
          // switch, decays to zero. (The previous version lerped from a frozen snapshot â€” which pins
          // the sprite motionless at the start of every switch. Never again.)
          const prevDraw = prevDrawRef.current.get(f.id)
          if (prevDraw && prevDraw.kind !== f.kind) {
            pathBlendRef.current.set(f.id, { dx: prevDraw.x - x, dy: prevDraw.y - y, start: performance.now() })
          }
          const bl = pathBlendRef.current.get(f.id)
          if (bl) {
            const t = (performance.now() - bl.start) / 800
            if (t >= 1) {
              pathBlendRef.current.delete(f.id)
            } else {
              const e = t * t * (3 - 2 * t)
              x += bl.dx * (1 - e)
              y += bl.dy * (1 - e)
            }
          }
          const left = ((x - vb.x) / vb.w) * 100
          const top = ((y - vb.y) / vb.h) * 100
          posRef.current.set(f.id, { left, top })
          // Position via transform, not left/top: layout offsets snap to the pixel grid in world space,
          // which a zoomed follow camera amplifies into visible jiggle on the pinned car.
          const { w: sw, h: sh } = stageDimsRef.current
          prevDrawRef.current.set(f.id, { x, y, kind: f.kind, dist: f.dist, lat })
          f.el.style.transform = `translate(${(left / 100) * sw}px, ${(top / 100) * sh}px) translate(-50%, -50%)`
          const spr = sprRefs.current.get(f.id)
          if (spr) spr.style.transform = viewRef.current === 'map' ? '' : `rotate(${heading + Math.PI / 2}rad)`
        }

        // Pit crews (#live-engine): the stop choreographed to spec, on MEASURED geometry.
        // The car sprite (272x520 units scaled to the 5.63m car) puts its wheel centres at
        // x = +1.646 (front) / -1.494 (rear), y = +/-0.975 in slot-local metres when parked centred;
        // each wheel is a 0.95x0.52 rounded rect the movable props pixel-match. Sequence:
        //   stop -> overlay old-tyre props on the real wheels, hide the sprite's wheels (invisible
        //   swap) -> per corner, carrier A walks the old tyre to a drop point CLEAR of carrier B's
        //   line, carrier B brings the pre-staged new tyre to the hub -> when all four sit on the
        //   hubs, the sprite's wheels return and the new props vanish in the same frame -> jacks
        //   step aside, the car leaves -> everyone walks straight into the garage from wherever
        //   they stand (carrier A per corner takes the old tyre) and all vanish together.
        if (crewRefs.current.size > 0) {
          const pitBySlot = new Map<number, { id: string; dist: number; phase?: string; stopFrac?: number; newCompound?: TyreCompound }>()
          for (const d of draws) {
            if (d.f.kind !== 'pit') continue
            const idx = slotOf.byCar.get(d.f.id)
            if (idx != null) pitBySlot.set(idx, { id: d.f.id, dist: d.f.dist, phase: d.f.pitPhase, stopFrac: d.f.stopFrac, newCompound: d.f.pitNewCompound })
          }
          // A pending pit CALL summons the crew before the car ever reaches the lane.
          const calledSlots = new Set<number>()
          for (const d of draws) {
            if (d.f.kind === 'race' && d.f.pitCalled) {
              const idx = slotOf.byCar.get(d.f.id)
              if (idx != null) calledSlots.add(idx)
            }
          }
          const wallT = performance.now()
          const setCarWheels = (carId: string | undefined, visible: boolean) => {
            const spr = carId ? sprRefs.current.get(carId) : undefined
            if (spr) spr.querySelectorAll('[data-wheel]').forEach((w) => { (w as SVGGElement).style.visibility = visible ? '' : 'hidden' })
          }
          crewRefs.current.forEach((root, idx) => {
            const boxDist = slotDistsRef.current[idx]
            const info = pitBySlot.get(idx)
            // Crew stays out from the pit CALL through the whole in-lane visit, until the car is
            // 12m past its box on the way out.
            const wantCrew = calledSlots.has(idx) ||
              (info != null && boxDist != null && info.dist < boxDist + uu(12))
            let anim = crewAnimRef.current.get(idx)
            if (!anim && !wantCrew) { root.style.visibility = 'hidden'; return }
            if (!anim) {
              anim = { mode: 'hidden', pos: {}, oldOut: [false, false, false, false], newIn: [false, false, false, false], swapped: false, restored: false, retreatT0: 0 }
              crewAnimRef.current.set(idx, anim)
            }
            if (wantCrew && anim.mode !== 'active') { anim.mode = 'active'; root.style.visibility = '' }
            else if (!wantCrew && anim.mode === 'active') { anim.mode = 'retreat'; anim.retreatT0 = wallT }
            if (anim.mode === 'hidden') { root.style.visibility = 'hidden'; return }
            if (anim.mode === 'retreat' && wallT - anim.retreatT0 > 3000) {
              // Teardown: everything vanishes TOGETHER; the departed car always has its wheels.
              setCarWheels(anim.carId, true)
              anim.mode = 'hidden'
              anim.pos = {}
              anim.oldOut = [false, false, false, false]
              anim.newIn = [false, false, false, false]
              anim.swapped = false
              anim.restored = false
              anim.carId = undefined
              root.style.visibility = 'hidden'
              return
            }

            if (info) anim.carId = info.id
            const stopped = anim.mode === 'active' && info?.stopFrac != null
            const stopFrac = info?.stopFrac ?? 0
            const dtw = Math.min(0.05, Math.max(0.001, (wallT - (anim.lastWall || wallT)) / 1000))
            anim.lastWall = wallT
            const retreating = anim.mode === 'retreat'

            // MEASURED stations (slot-local metres; garage is always +y in this flipped frame).
            const WHEELS: Array<[number, number]> = [[1.646, 0.975], [-1.494, 0.975], [1.646, -0.975], [-1.494, -0.975]].map(([wx, wy]) => [wx * CAR_SCALE, wy * CAR_SCALE] as [number, number])
            const stageOf = (c: number): [number, number] => {
              const [wx, wy] = WHEELS[c]
              return [wx + 0.55, wy + (wy > 0 ? 1.05 : -1.05)] // new set staged just outside each wheel
            }
            const dropOf = (c: number): [number, number] => {
              const [wx, wy] = WHEELS[c]
              return [wx - 0.95, wy + (wy > 0 ? 1.05 : -1.05)] // old set dropped beside it, clear of B's line
            }
            const intoGarage = (cur: [number, number]): [number, number] =>
              [Math.max(-3.2, Math.min(3.2, cur[0])), 2.35] // straight in from wherever you stand
            const move = (key: string, tx: number, ty: number, speed = 5): [number, number] => {
              const cur = anim!.pos[key] ?? [Math.max(-3, Math.min(3, tx)), 2.4] // emerge from the garage front
              const dx = tx - cur[0]
              const dy = ty - cur[1]
              const d = Math.hypot(dx, dy)
              const maxStep = speed * dtw
              const nx = d <= maxStep ? tx : cur[0] + (dx / d) * maxStep
              const ny = d <= maxStep ? ty : cur[1] + (dy / d) * maxStep
              anim!.pos[key] = [nx, ny]
              return [nx, ny]
            }
            const place = (role: string, x: number, y: number, jx = 0, jy = 0) => {
              const el = crewPartsRef.current.get(`${idx}:${role}`)
              if (el) el.setAttribute('transform', `translate(${uu(x + jx)} ${uu(y + jy)})`)
            }

            // (1) The invisible swap OUT, on the first stopped frame.
            if (stopped && !anim.swapped) {
              anim.swapped = true
              setCarWheels(anim.carId, false)
              // Latch compound colours: the outgoing set is what the car wears NOW (the engine fits
              // the new set only at the end of the stop), the incoming set is the pit call's target.
              const meta = cars.find((cm) => cm.id === anim!.carId)
              const oldBand = meta?.compound ? COMPOUND_COLORS[meta.compound] : '#FFD700'
              const newBand = info?.newCompound ? COMPOUND_COLORS[info.newCompound] : oldBand
              for (let c = 0; c < 4; c++) {
                anim.pos[`oldT${c}`] = [WHEELS[c][0], WHEELS[c][1]]
                crewPartsRef.current.get(`${idx}:oldTline${c}`)?.setAttribute('fill', oldBand)
                crewPartsRef.current.get(`${idx}:newTline${c}`)?.setAttribute('fill', newBand)
              }
            }
            // Corner schedule: old off through the first half, new on through the second.
            for (let c = 0; c < 4; c++) {
              if (stopped && stopFrac >= 0.06 + c * 0.045) anim.oldOut[c] = true
              if (stopped && stopFrac >= 0.45 + c * 0.045) anim.newIn[c] = true
            }
            // (2) The invisible swap BACK, once all four new tyres sit on the hubs.
            if (anim.swapped && !anim.restored) {
              const allOn = [0, 1, 2, 3].every((c) => {
                if (!anim!.newIn[c]) return false
                const cur = anim!.pos[`newT${c}`]
                return cur != null && Math.hypot(cur[0] - WHEELS[c][0], cur[1] - WHEELS[c][1]) < 0.1
              })
              if (allOn || !stopped) { // car leaving early is the safety path: swap back instantly
                anim.restored = true
                setCarWheels(anim.carId, true)
              }
            }

            // Jack men: in only while the car is stopped and unrestored; then OUT OF THE WAY.
            for (const j of [0, 1]) {
              const sign = j === 0 ? 1 : -1
              const park: [number, number] = [sign * 4.6, 1.35]
              const work: [number, number] = [sign * 3.6, 0]
              const cur = anim.pos[`jack${j}`]
              const target = retreating ? intoGarage(cur ?? park) : stopped && !anim.restored ? work : park
              const [x, y] = move(`jack${j}`, target[0], target[1], 3.6)
              place(`jack${j}`, x, y, 0, stopped && !anim.restored ? Math.sin(wallT / 130 + j * 2) * 0.08 : 0)
            }

            for (let c = 0; c < 4; c++) {
              const [wx, wy] = WHEELS[c]
              const out = wy > 0 ? 1 : -1
              const stage = stageOf(c)
              const drop = dropOf(c)

              // Old tyre: on the car until its moment, then carried by A to the drop; to the garage on retreat.
              const oldEl = crewPartsRef.current.get(`${idx}:oldT${c}`)
              const oldTarget: [number, number] = !anim.oldOut[c]
                ? [wx, wy]
                : retreating ? intoGarage(anim.pos[`oldT${c}`] ?? drop) : drop
              const [ox, oy] = move(`oldT${c}`, oldTarget[0], oldTarget[1], 2.6)
              if (oldEl) {
                oldEl.style.visibility = anim.swapped ? '' : 'hidden'
                oldEl.setAttribute('transform', `translate(${uu(ox)} ${uu(oy)})`)
              }
              // New tyre: pre-staged from deploy, carried by B to the hub, gone the frame the car is whole.
              const newEl = crewPartsRef.current.get(`${idx}:newT${c}`)
              const newTarget: [number, number] = anim.newIn[c] && !anim.restored ? [wx, wy] : stage
              const [nx2, ny2] = move(`newT${c}`, newTarget[0], newTarget[1], 2.6)
              if (newEl) {
                newEl.style.visibility = anim.mode === 'active' && !anim.restored ? '' : 'hidden'
                newEl.setAttribute('transform', `translate(${uu(nx2)} ${uu(ny2)})`)
              }

              // Gunner works the hub; carrier A owns the old tyre, carrier B the new one.
              const jit = stopped && !anim.restored ? Math.sin(wallT / 90 + c * 1.7) * 0.07 : 0
              const gT: [number, number] = retreating ? intoGarage(anim.pos[`gun${c}`] ?? [wx, wy]) : [wx, wy + out * 0.75]
              const [gx, gy] = move(`gun${c}`, gT[0], gT[1])
              place(`gun${c}`, gx, gy, jit, jit * 0.6)
              const aT: [number, number] = retreating
                ? [ox - 0.35, oy + 0.3] // walking the old tyre home
                : anim.oldOut[c] ? [ox - 0.35, oy + 0.3] : [drop[0], drop[1]]
              const [ax, ay] = move(`handA${c}`, aT[0], aT[1], 4.2)
              place(`handA${c}`, ax, ay)
              const bT: [number, number] = retreating
                ? intoGarage(anim.pos[`handB${c}`] ?? stage)
                : anim.newIn[c] && !anim.restored ? [nx2 + 0.35, ny2 + 0.3] : [stage[0], stage[1]]
              const [bx, by] = move(`handB${c}`, bT[0], bT[1], 4.2)
              place(`handB${c}`, bx, by)
            }

            // Lollipop man out front; straight home on retreat.
            const lT: [number, number] = retreating ? intoGarage(anim.pos['lolli'] ?? [4.35, 0]) : [4.35, 0]
            const [lx, ly] = move('lolli', lT[0], lT[1])
            place('lolli', lx, ly, 0, stopped ? Math.sin(wallT / 400) * 0.05 : 0)
          })
        }
      }
      // Follow camera: keep the followed car pinned to the stage centre (rotation and zoom untouched).
      if (followRef.current && viewRef.current !== 'map') {
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

      // Pinned card: orbit the followed car perpendicular to the LOCAL TRACK DIRECTION, just clear of
      // the ribbon, preferring above â€” so it never sits on the tarmac. Low-passed so it glides.
      const tip = tipRef.current
      if (tip) {
        const fid = followRef.current
        const heading = fid ? headingRef.current.get(fid) : undefined
        if (fid && viewRef.current === 'live' && heading != null) {
          const hs = heading + camRef.current.rot // track direction in screen space
          // Always the circuit's OUTSIDE, so the card never crosses the ribbon during a lap.
          const nx = outSign * -Math.sin(hs)
          const ny = outSign * Math.cos(hs)
          const { w, h } = stageDimsRef.current
          const ppu = vb.w > 0 ? w / vb.w : 1
          const ribbonHalf = ((TRACK_WIDTH_M / 2) / layout.metresPerUnit) * ppu * camRef.current.z
          const r = tip.getBoundingClientRect()
          const clearance = Math.abs(nx) * (r.width / 2) + Math.abs(ny) * (r.height / 2)
          const offset = ribbonHalf + clearance + 18
          const tx = w / 2 + nx * offset
          const ty = h / 2 + ny * offset
          const cur = tipPosRef.current ?? { x: tx, y: ty }
          cur.x += (tx - cur.x) * 0.12
          cur.y += (ty - cur.y) * 0.12
          tipPosRef.current = cur
          tip.style.opacity = '1'
          tip.style.transform = `translate(${cur.x}px, ${cur.y}px) translate(-50%, -50%) scale(0.9)`
        } else {
          tip.style.opacity = '0'
          tipPosRef.current = null
        }
      }
      // The tick's own JS cost, for the readout: it splits "the script is slow" from "the browser
      // is rasterising a heavy document" â€” the two look identical in an fps number alone.
      const tickDt = performance.now() - tickT0
      const tstat = tickStatsRef.current
      tstat.sum += tickDt
      tstat.n++
      if (tickDt > tstat.max) tstat.max = tickDt
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [slotOf, pitSlots, cars, layout, vb, sampleRef, outSign, ldir, lighting, applyCam])

  // S/F line: a chequered band (3 rows of 0.5m squares) spanning EXACTLY the tarmac width.
  const sf = useMemo(() => {
    const { x, y, angle } = layout.start
    // Nudged forward of the path start so the band clears the pole box's crossbar.
    const lead = 1.5 / layout.metresPerUnit
    return { x: x + Math.cos(angle) * lead, y: y + Math.sin(angle) * lead, deg: (angle * 180) / Math.PI }
  }, [layout.start, layout.metresPerUnit])

  // Cars render at their true footprint: px per viewBox unit at zoom 1, times the real car length
  // (the sprite's width follows its own aspect ratio).
  const pxPerUnit = vb.w > 0 && stage.w > 0 ? stage.w / vb.w : 1
  // TRUE footprint, never floored: a minimum pixel size silently inflated the sprite on tracks
  // whose viewBox is small in units (Montreal: 1.9px true -> 3.5px clamped, +82%), so the cars
  // no longer matched the track or their grid boxes. The zoomed-out view draws markers, not
  // sprites, so nothing needs the floor.
  const carL = u(CAR_LENGTH_M * CAR_SCALE) * pxPerUnit

  // Scenery is deterministic per circuit and static â€” build once per layout.
  const scenery = useMemo(
    () => buildScenery(layout.trace, layout.pit, {
      circuitId: layout.circuitId,
      metresPerUnit: layout.metresPerUnit,
      viewBox: layout.viewBox,
      density: sceneryDensity,
      pitOutside: layout.pitOutside,
      biome: layout.biome,
    }),
    [layout, sceneryDensity],
  )
  // A node BUDGET rather than a fixed tree count. The number that actually predicts frame rate on
  // this renderer is how many elements are in the document, and that varies with the circuit, the
  // zoom and how much scenery happens to be in shot â€” so it is measured every half second and the
  // tree allowance is steered toward the budget rather than guessed at. An estimate would drift from
  // the renderer the moment the renderer changed.
  const [maxTrees, setMaxTrees] = useState(Infinity)
  const maxTreesRef = useRef<number>(Infinity)
  const nodesRef = useRef(0)
  useEffect(() => {
    const id = setInterval(() => {
      if (!budgetOn) {
        if (maxTreesRef.current !== Infinity) {
          maxTreesRef.current = Infinity
          setMaxTrees(Infinity)
        }
        return
      }
      const n = worldRef.current?.querySelectorAll('*').length ?? 0
      if (!n) return
      nodesRef.current = n
      const cap = maxTreesRef.current
      // Two nodes a tree, so a node overshoot converts straight into a tree allowance. Damped by half
      // so the loop settles instead of hunting, and only committed once it is worth a re-render.
      const next = n > NODE_BUDGET
        ? cap - Math.ceil((n - NODE_BUDGET) / 4)
        : cap + Math.ceil((NODE_BUDGET - n) / 8)
      const clamped = Math.max(0, Math.min(scenery.trees.length, next))
      if (Math.abs(clamped - cap) < Math.max(12, cap * 0.06)) return
      maxTreesRef.current = clamped
      setMaxTrees(clamped)
    }, 500)
    return () => clearInterval(id)
  }, [scenery.trees.length, budgetOn])

  // Only the scenery categories, narrowed for the layers that take them.
  const hide = useMemo(() => hidden as Hidden, [hidden])

  // Kerbs are cheap in element count and expensive in pixels, and at racing zoom you are inside one
  // corner at a time. Same disc the trees use.
  const visibleKerbs = useMemo(
    () => (cull
      ? scenery.kerbs.filter((k) => Math.hypot(k.cx - cull.cx, k.cy - cull.cy) <= cull.r + k.r)
      : scenery.kerbs),
    [scenery.kerbs, cull],
  )

  // The static world as one description, drawn straight onto a canvas by the render loop. Vectors are
  // redrawn at the exact camera transform each frame, so it is as sharp at 60x zoom as at 1x â€” which
  // is what the pre-baked image could never be, and the reason it is being replaced.
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The road, in the order the SVG lays it: white casing under grey asphalt, for track and lane alike.
  // The ground plane, separate from the road: composed as part of `track` it painted OVER the
  // relief bands and fields, which is why the canvas ground read as one flat green.
  const baseDrawOp = useMemo((): DrawOp => (
    { d: `M ${vb.x - 4000} ${vb.y - 4000} h ${vb.w + 8000} v ${vb.h + 8000} h ${-(vb.w + 8000)} Z`, fill: scenery.base }
  ), [vb, scenery.base])
  const trackDrawOps = useMemo((): DrawOp[] => {
    const ops: DrawOp[] = [
      { d: layout.d, stroke: '#D8D8D2', width: u(TRACK_WIDTH_M) },
      { d: layout.pit.fastD, stroke: '#D8D8D2', width: u(5.5), cap: 'round' },
    ]
    if (pitZone) ops.push({ d: pitZone.work, fill: '#D8D8D2', stroke: '#D8D8D2', width: u(1.3) })
    ops.push(
      { d: layout.d, stroke: '#33383E', width: u(TARMAC_WIDTH_M) },
      { d: layout.pit.fastD, stroke: '#33383E', width: u(4.2), cap: 'round' },
    )
    if (pitZone) ops.push({ d: pitZone.work, fill: '#33383E' })
    return ops
  }, [layout, pitZone, u])
  const pitDrawOps = useMemo(() => (pitZone && !hidden.has('pit')
    ? {
      under: pitFloorOps(pitZone, lighting, (gi) => slotOf.colors[gi]),
      over: pitComplexOps(pitZone, u, lighting, viewAz, (gi) => slotOf.colors[gi]),
    }
    : { under: [], over: [] }), [pitZone, hidden, lighting, u, viewAz, slotOf])
  // The pit complex is one of the heaviest things on the map and exists in exactly one place, so it
  // is gated by the same disc the rest of the scenery culls to.
  const pitDisc = useMemo(() => {
    if (!pitZone) return null
    const pts = [...pitZone.buildingPts, ...pitZone.garageFloors.flat()]
    if (pts.length === 0) return null
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const r = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy))) + u(80)
    return { cx, cy, r }
  }, [pitZone, u])
  // One composer for both paths: React re-renders call it when the WORLD changes (track, light,
  // detail tier, hidden set â€” all rare), and `updateCull` calls it through `composeSceneRef` when
  // only the DISC moves, several times a lap, without a render.
  const composeScene = useCallback((cullNow: Cull | null) => {
    if (!(canvasOn && view === 'live')) return null
    const pitNear = !cullNow || !pitDisc
      || Math.hypot(pitDisc.cx - cullNow.cx, pitDisc.cy - cullNow.cy) <= cullNow.r + pitDisc.r
    const kerbs = hidden.has('kerbs') ? [] : (cullNow
      ? scenery.kerbs.filter((k) => Math.hypot(k.cx - cullNow.cx, k.cy - cullNow.cy) <= cullNow.r + k.r)
      : scenery.kerbs
    ).flatMap((k): DrawOp[] => {
      const clip = { cx: k.cx, cy: k.cy, r: k.r + u(KERB_WIDTH_M) }
      return [
        { d: k.d, stroke: '#E6E3DC', width: u(KERB_WIDTH_M), cap: 'round', clip },
        {
          d: k.d, stroke: '#C8352F', width: u(KERB_WIDTH_M), cap: 'butt',
          dash: { on: u(KERB_BLOCK_M), off: u(KERB_BLOCK_M), shift: 0 }, clip,
        },
      ]
    })
    const marks: SceneMark[] = []
    const items = sceneryScene(scenery, {
      u, lighting, view: viewAz, full: !lodLow, ground: !hidden.has('ground'), extrude: EXTRUDE,
      storeyM: 4.6, bayM: 5.4, standFrontM: 1.0, standRearM: 5.5, standRoofFrac: 0.3,
      marshalM: 2.8, marshalW: 4.4, marshalD: 3.2, fenceM: 4, tyreM: 1.5,
      solidHeightM: (r) => ('facing' in r ? 5.5 : ((r.storeys ?? 1) * 4.6)),
      // The same disc the SVG solids layer culled to: the canvas walks every op every frame, so a
      // circuit's whole tree population would be path setup for things nowhere near the shot.
      trees: hidden.has('trees') ? [] : visibleTrees(scenery.trees, cullNow),
      cull: cullNow,
      base: baseDrawOp,
      track: trackDrawOps,
      kerbs,
      pitUnder: pitNear ? pitDrawOps.under : [],
      pitOver: pitNear ? pitDrawOps.over : [],
    }, marks)
    return { items, marks }
  }, [
    canvasOn, view, scenery, u, lighting, viewAz, lodLow, hidden, baseDrawOp, trackDrawOps,
    pitDrawOps, pitDisc,
  ])
  const scene = useMemo(() => composeScene(cullRef.current), [composeScene])
  const sceneRef = useRef(scene)
  useEffect(() => { sceneRef.current = scene }, [scene])
  // On a cull step, the old scene keeps painting while the new one's paths parse in the
  // background; the swap lands only when the Path2D cache is warm. Parsing them inside the next
  // paint instead was a 2-3 vsync hitch on every disc move â€” the last dip the benchmark found.
  const warmTokenRef = useRef<{ cancel: () => void } | null>(null)
  useEffect(() => {
    composeSceneRef.current = (cullNow) => {
      const next = composeScene(cullNow)
      warmTokenRef.current?.cancel()
      if (!next) {
        sceneRef.current = next
        return
      }
      warmTokenRef.current = warmScene(next.items, () => { sceneRef.current = next })
    }
    return () => warmTokenRef.current?.cancel()
  }, [composeScene])
  useEffect(() => { canvasOnRef.current = canvasOn }, [canvasOn])
  // Last frame's paint time by scene section, for the fps readout. Only collected while the
  // readout is up â€” the timing calls are cheap but not free.
  const paintStatsRef = useRef<Record<string, number>>({})
  // True while the benchmark drives the map; keeps paint timing on with the readout closed.
  const benchRef = useRef(false)
  // The race tick's JS cost since the readout last sampled: average and worst frame.
  const tickStatsRef = useRef({ sum: 0, n: 0, max: 0 })
  // Called from applyCam, so the canvas follows the camera on exactly the frames the world does.
  const paintCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const sc = sceneRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { w: sw } = stageDimsRef.current
    if (!sc || sw === 0) {
      // No scene (map view): leave nothing stale behind the minimap.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    const dpr = window.devicePixelRatio || 1
    const timing = hudRef.current || benchRef.current ? { marks: sc.marks, out: {} } : undefined
    drawScene(
      ctx, sc.items, camRef.current, vb,
      { w: canvas.width / dpr, h: canvas.height / dpr }, dpr, sw / vb.w,
      (name, c, bbox) => canvasPaint(name, c, {
        lighting, u, bounds: bbox ?? { x: vb.x, y: vb.y, w: vb.w, h: vb.h },
        pxPerUnit: camRef.current.z * (sw / vb.w) * dpr,
      }) ?? '#FF00FF',
      timing,
    )
    if (timing) paintStatsRef.current = timing.out
  }, [vb, lighting, u])
  useEffect(() => { paintRef.current = paintCanvas }, [paintCanvas])

  // â”€â”€ Benchmark mode â”€â”€
  //
  // One keypress runs an ablation matrix over a live race: the same follow camera at racing zoom,
  // one FULL LAP per configuration so every segment covers the identical corners â€” the segment
  // boundary is the followed car crossing the line. Configurations: each layer hidden in turn, the
  // dynamic layers isolated, and the SVG renderer as the old baseline. The result prints as a
  // table and downloads as JSON, so a perf report is a file rather than a screenshot relay.
  const [benchOn, setBenchOn] = useState(false)
  const benchStatusRef = useRef<HTMLDivElement>(null)
  const benchAbortRef = useRef(false)
  const runBench = useCallback(async () => {
    if (viewRef.current !== 'live' || cars.length === 0) return
    const SEGMENTS: Array<{ name: string; canvas: boolean; hide: string[] }> = [
      { name: 'baseline', canvas: true, hide: [] },
      { name: 'no-trees', canvas: true, hide: ['trees'] },
      { name: 'no-shadows', canvas: true, hide: ['shadows'] },
      { name: 'no-buildings', canvas: true, hide: ['buildings'] },
      { name: 'no-stands', canvas: true, hide: ['stands'] },
      { name: 'no-furniture', canvas: true, hide: ['furniture'] },
      { name: 'no-ground', canvas: true, hide: ['ground'] },
      { name: 'no-kerbs', canvas: true, hide: ['kerbs'] },
      { name: 'no-pit', canvas: true, hide: ['pit'] },
      // Splits the pit finding: the signs are SVG text boards, the complex is canvas fills.
      { name: 'no-signs', canvas: true, hide: ['signs'] },
      { name: 'no-boxes', canvas: true, hide: ['boxes'] },
      { name: 'no-cars', canvas: true, hide: ['cars'] },
      { name: 'no-cars-boxes', canvas: true, hide: ['cars', 'boxes'] },
      { name: 'dynamic-only', canvas: true, hide: ['trees', 'shadows', 'buildings', 'stands', 'furniture', 'ground', 'kerbs', 'pit'] },
      { name: 'svg-mode', canvas: false, hide: [] },
    ]
    const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms) })
    // The followed car's lap fraction, when it is actually lapping: in the pit lane (or on the
    // grid) `prog` measures something else, so those frames cannot vote on a crossing.
    const lapOf = () => {
      const fid = followRef.current
      const s = fid ? sampleRef.current(fid) : null
      return s && !s.pit && s.gridSlot == null ? s.prog : null
    }
    // Frames until the followed car next crosses the line: rAF deltas, plus the canvas paint totals
    // those frames logged. A lap that never completes (race over, car parked) times out rather than
    // hanging the run.
    const TIMEOUT_MS = 240000
    const untilCrossing = (collect: boolean) => new Promise<{
      deltas: number[]; paintMs: number; paintN: number; seconds: number; timedOut: boolean
    }>((resolve) => {
      const deltas: number[] = []
      let paintMs = 0
      let paintN = 0
      const start = performance.now()
      let last = start
      let prev = lapOf()
      const loop = (now: number) => {
        if (collect) {
          deltas.push(now - last)
          const p = Object.values(paintStatsRef.current).reduce((s, v) => s + v, 0)
          if (p > 0) { paintMs += p; paintN++ }
        }
        last = now
        const prog = lapOf()
        const crossed = prev != null && prog != null && prev > 0.7 && prog < 0.3
        if (prog != null) prev = prog
        const timedOut = now - start > TIMEOUT_MS
        if (crossed || timedOut || benchAbortRef.current) {
          resolve({ deltas, paintMs, paintN, seconds: (now - start) / 1000, timedOut })
          return
        }
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })
    const status = (t: string) => { if (benchStatusRef.current) benchStatusRef.current.textContent = t }

    benchRef.current = true
    benchAbortRef.current = false
    setBenchOn(true)
    const prev = {
      hidden: hiddenRef.current as ReadonlySet<SceneryPiece | 'kerbs' | 'pit' | 'boxes' | 'cars' | 'signs'>,
      canvas: canvasOnRef.current,
      cap: frameCapRef.current,
      follow: followRef.current,
      z: camRef.current.z,
    }
    setHud(false) // the readout resets the tick stats every half second, which would corrupt the report
    setFrameCap(0)
    // The racing shot: leader followed at racing zoom, the case every number so far describes.
    const leader = cars.find((c) => c.pos === 1) ?? cars[0]
    onFollow(leader.id)
    camRef.current.z = 20
    applyCam()
    const segments: Array<Record<string, number | string | boolean>> = []
    try {
      status('waiting for the leader to cross the lineâ€¦')
      await untilCrossing(false)
      for (let i = 0; i < SEGMENTS.length; i++) {
        const seg = SEGMENTS[i]
        if (benchAbortRef.current) break
        status(`bench ${i + 1}/${SEGMENTS.length}  ${seg.name}  (one lap)`)
        setCanvasOn(seg.canvas)
        setHidden(new Set(seg.hide) as Set<SceneryPiece | 'kerbs' | 'pit' | 'boxes' | 'cars' | 'signs'>)
        paintStatsRef.current = {}
        const t0 = { ...tickStatsRef.current }
        const r = await untilCrossing(true)
        const t1 = tickStatsRef.current
        // The first beat of a segment pays the configuration switch itself (a React render the
        // benchmark caused, not the game) â€” those frames don't get to vote.
        let skipped = 0
        let skipMs = 0
        while (skipped < r.deltas.length && skipMs < 300) skipMs += r.deltas[skipped++]
        const sorted = r.deltas.slice(skipped).sort((a, b) => a - b)
        const mean = sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length)
        const worst = sorted.slice(-Math.max(1, Math.round(sorted.length * 0.01)))
        segments.push({
          name: seg.name,
          fps: Math.round(1000 / mean),
          low1: Math.round(1000 / (worst.reduce((s, v) => s + v, 0) / worst.length)),
          p95ms: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
          maxMs: +(sorted[sorted.length - 1] ?? 0).toFixed(1),
          longFrames: sorted.filter((d) => d > 25).length,
          paintMs: +(r.paintN > 0 ? r.paintMs / r.paintN : 0).toFixed(2),
          tickMs: +(t1.n > t0.n ? Math.max(0, t1.sum - t0.sum) / (t1.n - t0.n) : 0).toFixed(2),
          lapSec: +r.seconds.toFixed(1),
          ...(r.timedOut ? { timedOut: true } : {}),
        })
        if (r.timedOut) break
      }
    } finally {
      setHidden(new Set(prev.hidden))
      setCanvasOn(prev.canvas)
      setFrameCap(prev.cap)
      onFollow(prev.follow)
      camRef.current.z = prev.z
      applyCam()
      benchRef.current = false
    }
    const report = {
      circuit: layout.circuitId,
      at: new Date().toISOString(),
      dpr: window.devicePixelRatio || 1,
      viewport: { w: outerRef.current?.clientWidth ?? 0, h: outerRef.current?.clientHeight ?? 0 },
      aborted: benchAbortRef.current,
      segments,
    }
    console.table(segments)
    console.log('BENCH JSON', JSON.stringify(report))
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `bench-${layout.circuitId}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    status(benchAbortRef.current ? 'bench aborted' : 'bench done â€” report downloaded')
    await sleep(2500)
    setBenchOn(false)
  }, [cars, layout.circuitId, onFollow, applyCam, sampleRef])
  useEffect(() => {
    benchKeyRef.current = () => {
      if (benchRef.current) benchAbortRef.current = true
      else void runBench()
    }
  }, [runBench])

  // Baking covers the WHOLE circuit, so culling is switched off while it is on: a disc around the
  // camera would be baked into the image and then travel with it.
  const bakeKey = `${layout.circuitId}|${viewAz.toFixed(3)}|${lodLow}|${[...hidden].join(',')}`
  const bitmap = useSceneryBitmap(staticRef, vb, bitmapOn && view === 'live', bakeKey)
  const bakeCull = bitmapOn ? null : cull


  // One fake sun for the whole map. A low afternoon light is the dry-race default; moods become
  // data here later (weather, night) rather than separate rendering paths.
  const sceneryNode = useMemo(
    () => <SceneryLayer scenery={scenery} u={(m) => m / layout.metresPerUnit} lighting={lighting} hide={hide} detail={lodLow ? 'low' : 'full'} />,
    [scenery, layout.metresPerUnit, lighting, hide, lodLow],
  )
  const shadowNode = useMemo(
    () => <SceneryShadowLayer scenery={scenery} u={(m) => m / layout.metresPerUnit} lighting={lighting} view={viewAz} cull={bakeCull} maxTrees={bitmapOn ? undefined : maxTrees} hide={hide} detail={lodLow ? 'low' : 'full'} />,
    [scenery, layout.metresPerUnit, lighting, viewAz, bakeCull, bitmapOn, maxTrees, hide, lodLow],
  )
  const solidsNode = useMemo(
    () => <ScenerySolidsLayer scenery={scenery} u={(m) => m / layout.metresPerUnit} lighting={lighting} view={viewAz} cull={bakeCull} maxTrees={bitmapOn ? undefined : maxTrees} hide={hide} detail={lodLow ? 'low' : 'full'} />,
    [scenery, layout.metresPerUnit, lighting, viewAz, bakeCull, bitmapOn, maxTrees, hide, lodLow],
  )
  const furnitureNode = useMemo(
    () => <TrackFurnitureLayer scenery={scenery} u={(m) => m / layout.metresPerUnit} lighting={lighting} view={viewAz} hide={hide} detail={lodLow ? 'low' : 'full'} />,
    [scenery, layout.metresPerUnit, lighting, viewAz, hide, lodLow],
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
      {hud && (
        <div
          ref={hudRef}
          className="absolute left-2 top-2 z-30 rounded bg-black/70 px-2 py-1 font-mono text-[11px] text-[#FFFFFF]"
        />
      )}
      {benchOn && (
        <div
          ref={benchStatusRef}
          className="absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded bg-black/70 px-3 py-1 font-mono text-[12px] text-[#FFFFFF]"
        />
      )}
      {/* On the OUTER box, not the stage: the stage letterboxes to the viewBox's aspect, and a canvas
          clipped to it stops painting at the stage edge â€” the world visibly ended there under zoom.
          The SVG never had the problem because its overflow is visible. Stage centre and viewport
          centre coincide, so the camera transform is the same either way. */}
      {canvasOn && <SceneryCanvas canvasRef={canvasRef} className="absolute inset-0" />}
      <div ref={stageRef} className="relative" style={{ width: stage.w, height: stage.h }}>
        <div ref={worldRef} className="absolute inset-0" style={{ transformOrigin: '50% 50%' }}>
          {/* overflow visible: the ground plane extends far beyond the canvas so the camera never sees
              the edge of the world under follow + zoom. */}
          <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
            {/* Grass ground plane, far beyond the canvas so the camera never sees the edge of the world.
                The static map view drops the scenery for a clean dark minimap. */}
            {/* The static world, baked to one image when that mode is on. Hidden by VISIBILITY rather
                than display, because the race loop measures the track path with getTotalLength and
                that has to keep working while the picture comes from the bitmap. */}
            <g ref={staticRef} style={{ visibility: bitmap ? 'hidden' : undefined }}>
            {(!canvasOn || view === 'map') && (
              <rect x={vb.x - 4000} y={vb.y - 4000} width={vb.w + 8000} height={vb.h + 8000} fill={view === 'map' ? '#0F1319' : scenery.base} />
            )}
            <g data-cost="scenery">{view === 'live' && !canvasOn && sceneryNode}</g>
            {pitZone && !hidden.has('pit') && !canvasOn && <PitGarageFloors zone={pitZone} lighting={lighting} garageColor={(gi) => slotOf.colors[gi]} />}
            {/* Track: white edge lines around grey asphalt. Drawn BEFORE the pit complex so the
                lane tarmac (same asphalt colour) interrupts the edge line across both pit mouths. */}
            {/* Kept in the document whatever draws it: the race loop measures this path with
                getTotalLength, which needs it present. Invisible once the canvas has the road. */}
            <path
              ref={pathRef} d={layout.d} fill="none" stroke="#D8D8D2"
              strokeWidth={u(TRACK_WIDTH_M)} strokeLinejoin="round"
              visibility={canvasOn ? 'hidden' : undefined}
            />
            {!canvasOn && (
  <path d={layout.pit.fastD} fill="none" stroke="#D8D8D2" strokeWidth={u(5.5)} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {pitZone && !canvasOn && <path d={pitZone.work} fill="#D8D8D2" stroke="#D8D8D2" strokeWidth={u(1.3)} strokeLinejoin="round" />}
            {!canvasOn && (
  <path d={layout.d} fill="none" stroke="#33383E" strokeWidth={u(TARMAC_WIDTH_M)} strokeLinejoin="round" />
            )}
            {!canvasOn && (
  <path d={layout.pit.fastD} fill="none" stroke="#33383E" strokeWidth={u(4.2)} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {pitZone && !canvasOn && <path d={pitZone.work} fill="#33383E" />}
            {/* Pit lane: an asphalt ribbon with painted edge lines, pit-box slots, and the wall. */}
            <path ref={pitPathRef} d={layout.pit.d} fill="none" stroke="none" />
            {/* Pit building first (under everything on the apron side), then paint: the fast lane's
                track-side line, entry/exit guide lines reaching onto the track, the whiteâ€“blueâ€“white
                working-lane stripe ONLY along the box zone, and the limiter lines bounding it. */}
            {pitZone && !hidden.has('pit') && !canvasOn && <PitBuildingShadow zone={pitZone} u={u} lighting={lighting} />}
            {pitZone && !hidden.has('pit') && !canvasOn && <PitBuilding zone={pitZone} u={u} lighting={lighting} view={viewAz} garageColor={(gi) => slotOf.colors[gi]} />}
            {pitZone && !hidden.has('pit') && !hidden.has('signs') && <PitGarageSigns zone={pitZone} u={u} lighting={lighting} view={viewAz} drivers={(gi) => garageCars[gi] ?? []} />}
            {pitZone && !canvasOn && (
              <g>
                <path d={pitZone.sep} fill="none" stroke="#F2F2F2" strokeWidth={u(0.6)} strokeLinecap="round" />
                <path d={pitZone.sep} fill="none" stroke="#2E62C9" strokeWidth={u(0.34)} strokeLinecap="round" />
                <path d={pitZone.limiterIn} stroke="#F2F2F2" strokeWidth={u(0.35)} strokeLinecap="butt" />
                <path d={pitZone.limiterOut} stroke="#F2F2F2" strokeWidth={u(0.35)} strokeLinecap="butt" />
              </g>
            )}
            </g>
            {bitmap?.map((t) => (
              <image key={t.url} href={t.url} x={t.x} y={t.y} width={t.w} height={t.h} />
            ))}
            <g data-cost="boxes" style={{ display: hidden.has('boxes') ? 'none' : undefined }}>
            {pitSlots.map((s, i) => (
              <g key={`pl${i}`} transform={`translate(${s.x} ${s.y}) rotate(${(s.rot * 180) / Math.PI})`}>
                {/* Everything inside flips so the garage faces AWAY from the lane (measured per slot). */}
                <g ref={(el) => { if (el) slotInnerRefs.current.set(i, el); else slotInnerRefs.current.delete(i) }}>
                {/* Work pad + PIT MARKINGS (broadcast style): paired bars above and below the car
                    with end/centre ticks and an exit arrow. Geometry anchor unchanged. */}
                <rect x={-u(3.2)} y={-u(1.9)} width={u(6.9)} height={u(3.8)} rx={u(0.3)} fill="#3C434F" opacity={0.45} />
                {([1, -1] as const).map((sy) => (
                  <g key={sy}>
                    <rect x={-u(3)} y={u(sy * 1.62) - u(0.07)} width={u(6)} height={u(0.14)} fill="#E8C33A" opacity={0.95} />
                    {[-3, 0, 3].map((tx) => (
                      <rect key={tx} x={u(tx) - u(0.07)} y={sy > 0 ? u(1.62) : -u(1.62) - u(0.55)} width={u(0.14)} height={u(0.55)} fill="#E8C33A" opacity={0.95} />
                    ))}
                  </g>
                ))}
                {/* Entry and exit arrows, long tails, both along the direction of travel. */}
                {([-4.7, 3.2] as const).map((ax) => (
                  <path
                    key={ax}
                    d={`M ${u(ax)} 0 L ${u(ax + 1.5)} 0 M ${u(ax + 1.15)} ${-u(0.35)} L ${u(ax + 1.55)} 0 L ${u(ax + 1.15)} ${u(0.35)}`}
                    fill="none" stroke="#E8C33A" strokeWidth={u(0.14)} strokeLinecap="round"
                  />
                ))}
                {/* The booms sit four metres up over the box, so they throw the one shadow a pit stop
                    is actually watched under. Placed by the layout pass, which is the only thing that
                    knows which way this slot is flipped. */}
                <g
                  ref={(el) => { if (el) gantryShRefs.current.set(i, el); else gantryShRefs.current.delete(i) }}
                  fill={shadowFill(lighting)} opacity={shadowOpacity(lighting)}
                >
                  {([1.5, -1.5] as const).map((bx) => (
                    <rect key={bx} x={u(bx) - u(0.3)} y={-u(1.5)} width={u(0.6)} height={u(GANTRY_REACH_M)} rx={u(0.12)} />
                  ))}
                </g>
                {/* Overhead gantry: two booms from the garage out over the box â€” black, team accents. */}
                <g ref={(el) => { if (el) gantryRefs.current.set(i, el); else gantryRefs.current.delete(i) }}>
                {([1.5, -1.5] as const).map((bx) => (
                  <g key={bx}>
                    {/* A metal beam seen from above: its length is the only thing that reads at this
                        scale, so it carries a highlight down one flank rather than a face â€” a face
                        would need the light direction, which the box only learns once it knows which
                        way it is flipped. Height comes from the lift and the shadow, not from paint. */}
                    <rect x={u(bx) - u(0.3)} y={-u(1.5)} width={u(0.6)} height={u(GANTRY_REACH_M)} rx={u(0.12)} fill="#2E333C" />
                    <rect x={u(bx) - u(0.3)} y={-u(1.5)} width={u(0.2)} height={u(GANTRY_REACH_M)} rx={u(0.08)} fill="#4C5460" />
                  </g>
                ))}
                </g>
                {/* Crew: static parts registered by role; the rAF choreography drives every
                    transform (deploy from the garage, jacks on stop, tyre swaps, retreat). */}
                <g
                  ref={(el) => { if (el) crewRefs.current.set(i, el); else crewRefs.current.delete(i) }}
                  style={{ visibility: 'hidden' }}
                >
                  {(['jack0', 'jack1'] as const).map((role, ji) => (
                    <g key={role} ref={(el) => { if (el) crewPartsRef.current.set(`${i}:${role}`, el); else crewPartsRef.current.delete(`${i}:${role}`) }}>
                      <rect x={0} y={-u(0.1)} width={u(0.85) * (ji === 0 ? 1 : -1)} height={u(0.2)} rx={u(0.08)} fill="#8B929E" />
                      <circle r={u(0.38)} fill={slotOf.colors[i] ?? '#9AA3B2'} stroke="#FFFFFF" strokeWidth={u(0.09)} />
                    </g>
                  ))}
                  {[0, 1, 2, 3].map((c) => (
                    <g key={`corner${c}`}>
                      <g ref={(el) => { if (el) crewPartsRef.current.set(`${i}:gun${c}`, el); else crewPartsRef.current.delete(`${i}:gun${c}`) }}>
                        <rect x={-u(0.09)} y={-u(0.5)} width={u(0.18)} height={u(0.34)} rx={u(0.05)} fill="#5E6673" />
                        <circle r={u(0.36)} fill={slotOf.colors[i] ?? '#9AA3B2'} stroke="#FFFFFF" strokeWidth={u(0.09)} />
                      </g>
                      <g ref={(el) => { if (el) crewPartsRef.current.set(`${i}:handA${c}`, el); else crewPartsRef.current.delete(`${i}:handA${c}`) }}>
                        <circle r={u(0.34)} fill={slotOf.colors[i] ?? '#9AA3B2'} stroke="#FFFFFF" strokeWidth={u(0.08)} />
                      </g>
                      <g ref={(el) => { if (el) crewPartsRef.current.set(`${i}:handB${c}`, el); else crewPartsRef.current.delete(`${i}:handB${c}`) }}>
                        <circle r={u(0.34)} fill={slotOf.colors[i] ?? '#9AA3B2'} stroke="#FFFFFF" strokeWidth={u(0.08)} />
                      </g>
                      {(['oldT', 'newT'] as const).map((tk) => {
                        // Pixel-matched to the car sprite's wheels (long axis = travel = local x).
                        // The sprite's REAR wheels are larger than the fronts: 96x52 vs 88x48
                        // sprite-units at scale 5.63/520 â€” a single prop size shrank the rears
                        // visibly at the swap. Corners 0/2 are the front axle, 1/3 the rear.
                        const front = c === 0 || c === 2
                        const tw = (front ? 0.9528 : 1.0394) * CAR_SCALE
                        const th = (front ? 0.5197 : 0.563) * CAR_SCALE
                        const rw = (front ? 0.563 : 0.6063) * CAR_SCALE
                        const rh = (front ? 0.3032 : 0.3248) * CAR_SCALE
                        const outer = c <= 1 ? 1 : -1 // garage corners face out +y, lane corners -y
                        return (
                          <g key={tk} ref={(el) => { if (el) crewPartsRef.current.set(`${i}:${tk}${c}`, el); else crewPartsRef.current.delete(`${i}:${tk}${c}`) }} style={{ visibility: 'hidden' }}>
                            <rect x={-u(tw / 2)} y={-u(th / 2)} width={u(tw)} height={u(th)} rx={u((front ? 0.195 : 0.206) * CAR_SCALE)} fill="#16181D" />
                            <rect x={-u(rw / 2)} y={-u(rh / 2)} width={u(rw)} height={u(rh)} rx={u(0.12)} fill="#2E3138" />
                            <rect
                              ref={(el) => { if (el) crewPartsRef.current.set(`${i}:${tk}line${c}`, el as unknown as SVGGElement); else crewPartsRef.current.delete(`${i}:${tk}line${c}`) }}
                              x={-u(rw * 0.3)} y={outer > 0 ? u(th / 2) - u(0.065) : -u(th / 2)} width={u(rw * 0.6)} height={u(0.065)} rx={u(0.03)} fill="#FFD700"
                            />
                          </g>
                        )
                      })}
                    </g>
                  ))}
                  <g ref={(el) => { if (el) crewPartsRef.current.set(`${i}:lolli`, el); else crewPartsRef.current.delete(`${i}:lolli`) }}>
                    <rect x={-u(0.055)} y={-u(1.05)} width={u(0.11)} height={u(1.05)} fill="#8B929E" />
                    <circle cy={-u(1.2)} r={u(0.27)} fill="#E8C33A" />
                    <circle r={u(0.38)} fill={slotOf.colors[i] ?? '#9AA3B2'} stroke="#FFFFFF" strokeWidth={u(0.09)} />
                  </g>
                </g>
                </g>
              </g>
            ))}
            </g>
            {/* Red/white kerbs through the corners. Once the canvas owns the world these MUST come
                off the document: a dashed stroke re-expands on every camera frame, which is the
                measured, hotkey-confirmed cause of the original racing stutter â€” leaving them here
                meant paying it twice, once per renderer. */}
            {!canvasOn && !hidden.has('kerbs') && (bitmapOn ? scenery.kerbs : visibleKerbs).map((k, i) => (
              <g key={`k${i}`}>
                <path d={k.d} fill="none" stroke="#E6E3DC" strokeWidth={u(KERB_WIDTH_M)} strokeLinecap="round" />
                <path
                  d={k.d} fill="none" stroke="#C8352F" strokeWidth={u(KERB_WIDTH_M)}
                  strokeDasharray={`${u(KERB_BLOCK_M)} ${u(KERB_BLOCK_M)}`}
                />
              </g>
            ))}
            {/* Scenery shadows fall across the tarmac, so they draw AFTER every piece of track
                paint; the solids that cast them stand on top. Nothing overlaps the ribbon (the
                generator guarantees it), so drawing solids here cannot hide the road. The canvas
                draws all three of these layers itself, in this same order â€” left in the document
                they rendered the whole static world twice, one world stacked on the other. */}
            {!canvasOn && view === 'live' && shadowNode}
            {!canvasOn && view === 'live' && solidsNode}
            {/* Barriers, tyre walls and marshal posts: circuit furniture sits ON the tarmac's edge,
                so it draws after the ribbon rather than with the scenery underneath it. */}
            {!canvasOn && view === 'live' && furnitureNode}
            <g transform={`translate(${sf.x} ${sf.y}) rotate(${sf.deg})`}>
              {Array.from({ length: 72 }, (_, i) => {
                const row = i % 3
                const col = Math.floor(i / 3)
                if ((row + col) % 2 === 1) return null
                return (
                  <rect
                    key={`sf${i}`}
                    x={-u(0.75) + row * u(0.5)}
                    y={-u(6) + col * u(0.5)}
                    width={u(0.5)}
                    height={u(0.5)}
                    fill="#F2F2F2"
                  />
                )
              })}
            </g>
            {view === 'live' && gridMarks.map((g, i) => (
              <g key={`gm${i}`} transform={`translate(${g.x} ${g.y}) rotate(${g.deg})`}>
                {/* Inverted U: crossbar where the front wing sits, legs nearly the car's length. */}
                {/* Anchored to the PARKED CAR (centre at the slot origin, CAR_SCALE applied):
                    crossbar just clear of the wing tip, yellow tick exactly at the front axle. */}
                <rect x={u(2.49)} y={-u(1.7)} width={u(0.25)} height={u(3.4)} fill="#F2F2F2" />
                <rect x={u(0.35)} y={-u(1.7)} width={u(2.39)} height={u(0.25)} fill="#F2F2F2" />
                <rect x={u(0.35)} y={u(1.45)} width={u(2.39)} height={u(0.25)} fill="#F2F2F2" />
                {/* Yellow tyre guide: TRANSVERSE at front-axle height, reaching out past the
                    right leg so the driver can sight it beside the nose. */}
                <rect x={u(1.31)} y={u(1.2)} width={u(0.18)} height={u(1.6)} fill="#E8C33A" />
              </g>
            ))}
            {/* Invisible: the computed racing line the cars actually drive (sampled per frame). */}
            <path ref={raceLineRef} fill="none" stroke="none" />
          </svg>
          <div data-cost="cars" className={hidden.has('cars') ? 'hidden' : 'contents'}>{cars.map((car) => (
            <div
              key={car.id}
              ref={(el) => {
                if (!el) { elRefs.current.delete(car.id); return }
                elRefs.current.set(car.id, el)
                const p = posRef.current.get(car.id) // keep the last spot across re-renders (commit, not render)
                const { w, h } = stageDimsRef.current
                el.style.transform = p && w
                  ? `translate(${(p.left / 100) * w}px, ${(p.top / 100) * h}px) translate(-50%, -50%)`
                  : 'translate(-50%, -50%)'
              }}
              className="absolute left-0 top-0"
              style={{ opacity: car.retired ? 0.35 : 1 }}
            >
              {(() => {
                {/* Tooltip + click on the sprite ONLY â€” its exact rendered footprint, no hover halo. */}
                const sprite = (
                  <div
                    ref={(el) => { if (el) sprRefs.current.set(car.id, el); else sprRefs.current.delete(car.id) }}
                    onClick={() => clickCar(car.id)}
                    className="cursor-pointer"
                    style={{ filter: 'drop-shadow(0.5px 0.8px 0.5px rgba(0,0,0,0.5))' }}
                  >
                    {view === 'map' ? (
                      <div
                        className="flex items-center justify-center rounded-full font-bold text-[#FFFFFF]"
                        style={{
                          width: 20, height: 20, fontSize: 10,
                          backgroundColor: car.color,
                          border: '1.5px solid rgba(0,0,0,0.5)',
                          boxShadow: car.isPlayer ? '0 0 0 2px #FFFFFF' : undefined,
                        }}
                      >
                        <span style={{ WebkitTextStroke: '0.7px rgba(0,0,0,0.9)', paintOrder: 'stroke' }}>{car.pos}</span>
                      </div>
                    ) : (
                      <CarSprite color={car.color} length={carL} compound={car.compound} />
                    )}
                  </div>
                )
                // The followed car's pinned card IS its tooltip â€” no double card on hover.
                if (pinnedCard && view === 'live' && car.id === followId) return sprite
                return (
                  <Tooltip
                    bare={!!tooltipFor}
                    content={
                      tooltipFor?.(car.id) ?? (
                        <div>
                          <div className="font-semibold">P{car.pos} {car.name}</div>
                          {car.team && <div className="text-[#9CA3AF]">{car.team}</div>}
                        </div>
                      )
                    }
                  >
                    {sprite}
                  </Tooltip>
                )
              })()}
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
          ))}</div>
        </div>
        {pinnedCard && view === 'live' && (
          <div ref={tipRef} className="absolute left-0 top-0 pointer-events-none" style={{ opacity: 0 }}>
            {pinnedCard}
          </div>
        )}
      </div>

      {/* Camera controls (the map view is static; nothing to reset) */}
      {view === 'live' && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
          <Tooltip content="Reset zoom">
            <button
              onClick={resetZoom}
              className="h-9 w-9 flex items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#1E2431] hover:text-[#FFFFFF] cursor-pointer"
            >
              <Maximize size={18} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

// Memoised against the 4Hz live-projection commits (#live-engine): re-rendering this tree (the
// scenery SVG, 20 tooltip-wrapped sprites) on every commit stalled the main thread and the clock
// then lurched the whole field forward at once. Function-prop identities are deliberately ignored
// (fresh closures, equal behaviour); `tipTick` bumps ~1/s so tooltip content stays current; car
// positions only matter to the render in map view (numbered dots) â€” live-view sprites are placed
// per-frame from sampleRef, not from props.
function sameCars(a: TrackCarMeta[], b: TrackCarMeta[], comparePos: boolean): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.id !== y.id || x.color !== y.color || x.retired !== y.retired || x.isPlayer !== y.isPlayer || x.compound !== y.compound) return false
    if (comparePos && x.pos !== y.pos) return false
  }
  return true
}

export const RaceTrackMap = memo(RaceTrackMapImpl, (p, n) =>
  p.layout === n.layout &&
  p.view === n.view &&
  p.followId === n.followId &&
  p.showLabels === n.showLabels &&
  p.sceneryDensity === n.sceneryDensity &&
  p.tipTick === n.tipTick &&
  p.teamOrder === n.teamOrder &&
  (p.pinnedCard == null) === (n.pinnedCard == null) &&
  sameCars(p.cars, n.cars, (n.view ?? 'live') === 'map'),
)
