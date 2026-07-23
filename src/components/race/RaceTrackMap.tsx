'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
 * or a starting-grid slot before lights out. Racing progress is mapped through a curvature-derived
 * speed profile, so equal time steps cover more distance on straights than in corners. */
export type TrackSample = { prog: number; pit?: boolean; gridSlot?: number } | null

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
const CAR_WIDTH_M = 2.0

const ZOOM_MIN = 0.6
const ZOOM_MAX = 20
const ROT_STEP = Math.PI / 36 // 5° per shift+wheel notch

interface MotionProfile {
  /** Cumulative normalised lap TIME at each equal-distance station (invert for time -> distance). */
  time: Float64Array
  /** Racing-line lateral offset (viewBox units, positive = right of travel) at each station. */
  lateral: Float64Array
}

// Circular box blur, applied three times for a gaussian-ish kernel.
function blur(src: Float64Array, radius: number): Float64Array {
  let a = src
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float64Array(a.length)
    for (let i = 0; i < a.length; i++) {
      let sum = 0
      for (let j = -radius; j <= radius; j++) sum += a[(i + j + a.length) % a.length]
      out[i] = sum / (2 * radius + 1)
    }
    a = out
  }
  return a
}

// Cumulative normalised lap TIME at each equal-distance station; inverting it turns a time fraction
// into a distance fraction. Classic three-step racing profile: corner limits from curvature, then an
// acceleration-limited forward pass and a braking-limited backward pass (twice each, for the wrap).
// The racing LINE comes from a difference of gaussians on the signed turn rate: wide on entry, clipping
// the apex inside, drifting wide again on exit.
function buildMotionProfile(path: SVGPathElement, metresPerUnit: number): MotionProfile {
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
  const turn = new Float64Array(PROFILE_N) // signed turn angle over the window; positive = right turn
  for (let i = 0; i < PROFILE_N; i++) {
    const a = pts[(i - 2 + PROFILE_N) % PROFILE_N]
    const b = pts[i]
    const c = pts[(i + 2) % PROFILE_N]
    const in_ = Math.atan2(b.y - a.y, b.x - a.x)
    const out = Math.atan2(c.y - b.y, c.x - b.x)
    let dth = out - in_
    if (dth > Math.PI) dth -= 2 * Math.PI
    if (dth < -Math.PI) dth += 2 * Math.PI
    turn[i] = dth
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

  // Racing line: DoG of the signed turn rate. Narrow blur tracks the apex, wide blur anticipates it.
  const r1 = Math.max(1, Math.round(12 / metresPerUnit / ds))
  const narrow = blur(turn, r1)
  const wide = blur(turn, r1 * 3 + 1)
  const T_REF = 0.12 // turn angle treated as a full-commitment corner
  const lateral = new Float64Array(PROFILE_N)
  const A = 3.2 / metresPerUnit
  const B = 2.2 / metresPerUnit
  const clamp1 = (x: number) => Math.max(-1, Math.min(1, x))
  const latMax = 3.4 / metresPerUnit
  for (let i = 0; i < PROFILE_N; i++) {
    const raw = A * clamp1(narrow[i] / T_REF) - B * clamp1(wide[i] / T_REF)
    lateral[i] = Math.max(-latMax, Math.min(latMax, raw))
  }

  return { time: cum, lateral }
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

// Top-down open-wheeler, nose pointing up: front wing, tapered body over sidepods, cockpit, rear wing,
// four exposed wheels. Tinted by the team colour; rendered at the car's true footprint.
function CarSprite({ color, width, length }: { color: string; width: number; length: number }) {
  const outline = 'rgba(0,0,0,0.55)'
  return (
    <svg width={width} height={length} viewBox="0 0 24 50" preserveAspectRatio="none" className="block">
      <rect x="2" y="1" width="20" height="4" rx="1.2" fill={color} stroke={outline} strokeWidth="1" />
      <rect x="1" y="8" width="4.6" height="8" rx="1.6" fill="#14181F" />
      <rect x="18.4" y="8" width="4.6" height="8" rx="1.6" fill="#14181F" />
      <rect x="0.6" y="33" width="5.2" height="9" rx="1.6" fill="#14181F" />
      <rect x="18.2" y="33" width="5.2" height="9" rx="1.6" fill="#14181F" />
      <rect x="5.6" y="24" width="12.8" height="10" rx="2" fill={color} stroke={outline} strokeWidth="1" />
      <path
        d="M12 2 C10.6 6 10.2 8 10 12 L7 20 L7 32 L9.4 44 L14.6 44 L17 32 L17 20 L14 12 C13.8 8 13.4 6 12 2 Z"
        fill={color}
        stroke={outline}
        strokeWidth="1"
      />
      <ellipse cx="12" cy="25" rx="2.6" ry="4.2" fill="#0F1419" />
      <rect x="3.4" y="45" width="17.2" height="4" rx="1.2" fill={color} stroke={outline} strokeWidth="1" />
    </svg>
  )
}

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
  const profileRef = useRef<MotionProfile | null>(null)
  const elRefs = useRef(new Map<string, HTMLDivElement>())
  const sprRefs = useRef(new Map<string, HTMLDivElement>())
  const posRef = useRef(new Map<string, { left: number; top: number }>())
  const headingRef = useRef(new Map<string, number>())
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
    profileRef.current = null
    let raf = 0
    const tick = () => {
      const path = pathRef.current
      const pitPath = pitPathRef.current
      if (path && pitPath) {
        if (!lenRef.current) lenRef.current = path.getTotalLength()
        if (!pitLenRef.current) pitLenRef.current = pitPath.getTotalLength()
        if (!profileRef.current) profileRef.current = buildMotionProfile(path, layout.metresPerUnit)
        const prof = profileRef.current
        const lenTotal = lenRef.current
        const uu = (m: number) => m / layout.metresPerUnit
        const look = uu(8) // heading from ~8m of track ahead

        // Pass 1: place every car in arc space. Racing cars get the racing-line lateral offset; grid
        // slots form the staggered starting grid (8m pitch, alternating sides) in DISTANCE space.
        interface Frame { id: string; el: HTMLDivElement; onPit: boolean; dist: number; lat: number; race: boolean }
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
            frames.push({ id: car.id, el, onPit: true, dist: Math.min(1, Math.max(0, sample.prog)) * pitLenRef.current, lat: 0, race: false })
          } else if (sample.gridSlot != null) {
            const back = uu(3 + (sample.gridSlot - 1) * 8)
            frames.push({
              id: car.id, el, onPit: false,
              dist: (((lenTotal - back) % lenTotal) + lenTotal) % lenTotal,
              lat: (sample.gridSlot % 2 === 1 ? 1 : -1) * uu(1.7),
              race: false,
            })
          } else {
            const dist = timeToDistance(prof.time, ((sample.prog % 1) + 1) % 1) * lenTotal
            const idx = Math.min(PROFILE_N - 1, Math.floor((dist / lenTotal) * PROFILE_N))
            frames.push({ id: car.id, el, onPit: false, dist, lat: prof.lateral[idx], race: true })
          }
        }

        // Pass 2: side-by-side separation — when two racing cars share ~6m of arc, the chasing car
        // moves off-line (side chosen stably per car) instead of overlapping the car ahead.
        const racing = frames.filter((f) => f.race).sort((a, b) => a.dist - b.dist)
        const sepRange = uu(6)
        const latMax = uu(3.4)
        for (let i = 0; i < racing.length; i++) {
          const behind = racing[i]
          const ahead = racing[(i + 1) % racing.length]
          if (behind === ahead) break
          const gap = i === racing.length - 1 ? ahead.dist + lenTotal - behind.dist : ahead.dist - behind.dist
          if (gap < sepRange) {
            const side = behind.id.charCodeAt(behind.id.length - 1) % 2 === 0 ? 1 : -1
            behind.lat = Math.max(-latMax, Math.min(latMax, behind.lat + side * uu(2.1) * (1 - gap / sepRange)))
          }
        }

        // Pass 3: resolve to viewBox coordinates and write the DOM.
        for (const f of frames) {
          const p = f.onPit ? pitPath : path
          const total = f.onPit ? pitLenRef.current : lenTotal
          const pt = p.getPointAtLength(f.dist)
          const aheadPt = p.getPointAtLength(f.onPit ? Math.min(total, f.dist + look) : (f.dist + look) % total)
          const target = Math.atan2(aheadPt.y - pt.y, aheadPt.x - pt.x)
          // Low-pass the heading so polyline vertices don't twitch the sprite.
          const prev = headingRef.current.get(f.id) ?? target
          let delta = target - prev
          if (delta > Math.PI) delta -= 2 * Math.PI
          if (delta < -Math.PI) delta += 2 * Math.PI
          const heading = prev + delta * 0.25
          headingRef.current.set(f.id, heading)
          const x = pt.x - Math.sin(heading) * f.lat
          const y = pt.y + Math.cos(heading) * f.lat
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

  // Cars render at their true footprint: px per viewBox unit at zoom 1, times the real car size.
  const pxPerUnit = vb.w > 0 && stage.w > 0 ? stage.w / vb.w : 1
  const carW = Math.max(1.5, u(CAR_WIDTH_M) * pxPerUnit)
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
                  <CarSprite color={car.color} width={carW} length={carL} />
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
