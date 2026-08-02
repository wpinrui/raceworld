'use client'

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Maximize } from 'lucide-react'
import type { TrackLayout } from '@/data/tracks'
import { gridBoxOps, startLineOps, startPose } from '@/lib/ui/road-marks'
import { buildScenery, type SceneryDensity } from '@/lib/ui/track-scenery'
import { MOODS, type Mood } from '@/lib/ui/lighting'
import { buildPitSlots, buildPitZone, pitCameraRotation, pitViewAzimuth } from '@/lib/ui/pit-zone'
import * as THREE from 'three'
import { Scene3DCanvas } from './Scene3DCanvas'
import { groundPoint, type OrbitCam } from '@/lib/scene3d/camera3d'
import { buildWorld3D } from '@/lib/scene3d/world3d'
import { skySeedFor } from '@/lib/scene3d/sky3d'
import { buildWorldTextures } from '@/lib/scene3d/textures3d'
import { buildWorldDetail } from '@/lib/scene3d/detail3d'
import { loadTreePack, type TreePack } from '@/lib/scene3d/treepack3d'
import { loadStandSkin, type StandSkin } from '@/lib/scene3d/standtex3d'
import { CAR_RIDE_M, CarField3D } from '@/lib/scene3d/car-field3d'
import { PitCrew3D } from '@/lib/scene3d/crew3d'
import type { CarLivery } from '@/lib/scene3d/car-mesh'
import { buildGarageSigns3D } from '@/lib/scene3d/signs3d'
import { COMPOUND_COLORS } from './TyreIndicator'
import type { TyreCompound } from '@/lib/sim/types'
import { CAR_LENGTH_M, CAR_SCALE, FRONT_LEAD_M, SPRITE, STRAIGHT, steerAngles } from '@/lib/ui/car-sprite'
import {
  PROFILE_N, lapDynamics, lateralG, sampleLap, trackPhysics, type LapDynamics,
} from '@/lib/ui/lap-dynamics'
import { buildRacingLine, type ArcPath } from '@/lib/ui/racing-line'
import type { Vec } from '@/lib/ui/geom'
import { PIT_ENTRY_FRAC, PIT_EXIT_FRAC, TRACK_WIDTH_M } from '@/lib/ui/track-path'
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
  /** The constructor's era livery for this season (#3d-port); absent, the car paints from `color`. */
  livery?: CarLivery
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

// Real-world sizes, rendered at true scale through each layout's metresPerUnit. The lane's own
// cross-section lives with the track's in track-path.ts, since the surface laid on it measures against
// the same numbers the renderer strokes with.
// CAR_LENGTH_M and CAR_SCALE now live with the sprite's own geometry in lib/ui/car-sprite.ts, which
// needs them to size the light it casts; everything car-locked here still multiplies by them.

const ZOOM_DEFAULT = 20
const ZOOM_STEP = 1.18 // per wheel notch
/** The zoom floor, in the readout's own terms, matching the ceiling above: the camera never pulls
 *  back past this, so the world stays a place rather than a diagram. */
const ZOOM_MIN_PXM = 10
/** The zoom ceiling, in the readout's own terms: the same closeness on every circuit, whatever its
 *  metres-per-unit or stage fit. */
const ZOOM_MAX_PXM = 200
const ROT_STEP = Math.PI / 36 // 5° per shift+wheel notch
/** How far the camera can lie down, radians off vertical: ~80 degrees, almost eye level with the
 *  cars, stopped just short of the horizon where an endless ground plane starts showing its edge. */
const PITCH_MAX = 1.4

/** Projection scratch, written and read within one rAF pass. */
const projA = new THREE.Vector3()
const projB = new THREE.Vector3()

/** Show or hide an element.
 *
 *  `visibility` rather than `display` throughout, and deliberately: the race loop measures the track
 *  path with `getTotalLength`, which needs the geometry laid out. */
function setVis(el: SVGElement | HTMLElement, shown: boolean): void {
  el.style.visibility = shown ? '' : 'hidden'
}

/** A path element seen as pure arc-length geometry, which is all the racing-line solver wants of it. */
const arcPath = (p: SVGPathElement): ArcPath => ({
  length: p.getTotalLength(),
  at: (s) => p.getPointAtLength(s),
})

// Sample the RACING LINE and hand it to the shared profile physics. What comes back is the lap time
// curve that places the cars plus the cornering and braking loads that shape how they sit while it
// does (lib/ui/lap-dynamics.ts).
function buildLapDynamics(path: SVGPathElement, metresPerUnit: number): LapDynamics {
  const len = path.getTotalLength()
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < PROFILE_N; i++) pts.push(path.getPointAtLength((i / PROFILE_N) * len))
  return lapDynamics(pts, len, trackPhysics(metresPerUnit))
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
  /** 'live' = sprites + camera; 'map' = the classic static full-track view with numbered dots. */
  view?: 'live' | 'map'
  /** The race's light: night venues, wet-race overcast, or the standard afternoon. */
  mood?: Mood
  /** Card pinned to the followed car; the map positions it clear of the track ribbon each frame. */
  pinnedCard?: React.ReactNode
  /** Coarse freshness counter (#live-engine): bump ~1/s so memoised renders refresh tooltip content
   * without paying the full tree cost on every 4Hz store commit. */
  tipTick?: number
  /** Garage order: team names best-first (constructor standings). Absent/unknown teams follow, so a
   * fresh season's empty table degrades to an arbitrary-but-stable order. */
  teamOrder?: string[]
}

function RaceTrackMapImpl({ layout, cars, sampleRef, followId, onFollow, showLabels = false, sceneryDensity, view = 'live', mood = 'afternoon', pinnedCard, teamOrder }: Props) {
  const pathRef = useRef<SVGPathElement>(null)
  const pitPathRef = useRef<SVGPathElement>(null)
  const lenRef = useRef(0)
  const pitLenRef = useRef(0)
  const pitDRef = useRef('') // the `d` the pit caches were built from â€” geometry, not identity
  const dynRef = useRef<LapDynamics | null>(null)
  // The solved line and its dynamics, handed to React once per circuit so the worn tarmac can be built
  // as scene ops. Null until the first frame has a path element to measure.
  // Tagged with the layout it was solved for, rather than cleared when the circuit changes: clearing it
   // meant a setState in the reset effect, and a synchronous setState in an effect body is a cascading
   // render. A stale solve is simply ignored until the loop replaces it.
  const [lapLine, setLapLine] = useState<
    { for: TrackLayout; pts: Vec[]; lateral: Float64Array; centre: Vec[]; dyn: LapDynamics } | null
  >(null)
  const pitWindowForRef = useRef<unknown>(null) // which engine instance the pit window was sent to
  const prevDrawRef = useRef(new Map<string, { x: number; y: number; kind: string; dist: number; lat: number }>()) // last drawn pose per car, for the path-switch blend
  const pathBlendRef = useRef(new Map<string, { dx: number; dy: number; start: number }>()) // path-switch offset decay
  const pitAnchorRef = useRef(new Map<string, { residual: number; t0: number }>()) // service-position pin
  const slotDistsRef = useRef<number[]>([]) // arc position of each pit box along the lane path
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
  // The padded viewBox, mirrored for the imperative camera code declared above its memo.
  const vbRef = useRef({ x: 0, y: 0, w: 1, h: 1 })

  // Camera (#3d-port increment 5): an orbit around a ground target. Middle-drag tilts and turns it,
  // keeping any follow lock (you orbit the car you are chasing); left-drag pans the free camera,
  // which is what breaks the lock; a plain click on empty ground breaks it too. The one
  // PerspectiveCamera below is shared with the GL canvas, so the loop projects the DOM overlay
  // through exactly the camera the world was drawn with.
  const defaultRot = useMemo(() => pitCameraRotation(layout) ?? 0, [layout])
  const camRef = useRef<OrbitCam>({ tx: 0, tz: 0, rot: defaultRot, pitch: 0, z: ZOOM_DEFAULT })
  const glCamera = useMemo(() => new THREE.PerspectiveCamera(), [])
  const zoomReadRef = useRef<HTMLSpanElement>(null)
  // The sun is fixed to the circuit, standardised against the pit complex so the light
  // falls the same way on every track; it must NOT move with the camera, or shadows would sit still
  // on screen while the world turned under them, which reads as the sun following the player.
  const lighting = useMemo(
    () => ({ ...MOODS[mood], azimuth: pitViewAzimuth(layout) ?? MOODS[mood].azimuth }),
    [layout, mood],
  )
  // The circuit's own cloud field: the sky shader drifts its noise with `time`, so freezing it at a
  // number derived from the id gives every venue its own weather instead of one pattern everywhere.
  const skySeed = useMemo(() => skySeedFor(layout.circuitId), [layout.circuitId])
  // The cars read the SAME light. One stable object, so the memoised sprites do not re-render for it.
  const followRef = useRef<string | null>(followId)
  useEffect(() => { followRef.current = followId }, [followId])
  const viewRef = useRef(view)

  const vb = useMemo(() => {
    const m = TRACK_WIDTH_M / layout.metresPerUnit / 2 + 8
    const [x, y, w, h] = layout.viewBox.split(' ').map(Number)
    return { x: x - m, y: y - m, w: w + 2 * m, h: h + 2 * m }
  }, [layout.viewBox, layout.metresPerUnit])
  useEffect(() => { vbRef.current = vb }, [vb])

  // Painting the canvas is defined further down, once the scene exists; `applyCam` reaches it through
  // this ref so the two can be declared in whichever order they need to be.
  const paintRef = useRef<() => void>(() => {})

  // A camera move never touches the DOM tree any more: the markers are projected by the loop, the
  // world div carries no transform, and this just repaints the GL frame and the zoom readout.
  const applyCam = useCallback(() => {
    const read = zoomReadRef.current
    if (read && viewRef.current !== 'map') {
      const pxPerM = (camRef.current.z * (stageDimsRef.current.w / vbRef.current.w))
        / layout.metresPerUnit
      read.textContent = `${pxPerM >= 10 ? Math.round(pxPerM) : pxPerM.toFixed(1)} px/m`
      // The field's detail rung follows the same number. A car is CAR_LENGTH_M long through the
      // era's scale, so its length on screen is that in metres times the pixels a metre is worth,
      // and `CAR_TIERS` is authored in exactly those pixels.
      carField3dRef.current?.setDetail(pxPerM * CAR_LENGTH_M * CAR_SCALE)
    }
    paintRef.current()
  }, [layout.metresPerUnit])

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

  // What the garage allocation and the garage signage are ACTUALLY functions of, as strings.
  //
  // `cars` gets a fresh array identity on every commit of this component, and the 1Hz tooltip tick
  // alone guarantees one every second. Memoising on it made `slotOf` churn, which made `pitDrawOps`
  // rebuild the entire pit complex's geometry, which changed `composeScene`'s identity, which made the
  // `scene` useMemo recompose the whole static world and throw away half a megabyte of path strings.
  // Once a second, so that a tooltip could be current. None of it depends on anything that moves.
  //
  // Separated by characters that cannot occur in an id, a team or driver name, a nationality or a
  // colour, so no two different car lists can spell the same signature. Written as ESCAPES and never as
  // raw bytes: as bytes they make the whole file binary to git, which switches line-ending
  // normalisation off and churns every line of it on the next write from a Windows editor.
  const garageSig = cars.map((c) => `${c.id}\u0000${c.team ?? ''}\u0000${c.color}`).join('\u0001')
  const signSig = cars.map((c) => `${c.id}\u0000${c.name}\u0000${c.nationality ?? ''}`).join('\u0001')
  // Written during render, deliberately. The loop this feeds is not React's: it reads whatever the last
  // committed render left here, and a concurrent render that gets thrown away would publish a `cars`
  // that differs from the committed one only in identity — every field the loop reads off it is the
  // same value either way.
  const carsRef = useRef(cars)
  carsRef.current = cars

  const slotOf = useMemo(() => {
    // Garage order: previous standings best-first (P1 gets the first box), alphabetical fallback for
    // anything unranked. NEVER derived from the live car list order â€” that reshuffles mid-race.
    const rank = (k: string) => {
      const i = teamOrder?.indexOf(k) ?? -1
      return i === -1 ? 1e9 : i
    }
    const cs = carsRef.current
    const keys = [...new Set(cs.map((c) => c.team ?? c.id))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    const map = new Map<string, number>()
    const colors: string[] = []
    for (const c of cs) {
      const idx = keys.indexOf(c.team ?? c.id)
      map.set(c.id, idx)
      if (colors[idx] === undefined) colors[idx] = c.color
    }
    return { byCar: map, colors }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garageSig, teamOrder])

  // Who is signed above each garage: the two cars the box order put in that bay.
  const garageCars = useMemo(() => {
    const out: TrackCarMeta[][] = []
    for (const c of carsRef.current) {
      const gi = slotOf.byCar.get(c.id)
      if (gi === undefined) continue
      ;(out[gi] ??= []).push(c)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signSig, slotOf])


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
        // Orbiting the target, a rotation is just a rotation.
        cam.rot += e.deltaY > 0 ? ROT_STEP : -ROT_STEP
      } else {
        // Zoom about the pointer: the ground point under it stays under it, at any pitch, by
        // sliding the target along the line joining it to that point.
        const rect = outer.getBoundingClientRect()
        const q = groundPoint(
          glCamera, { w: rect.width, h: rect.height },
          e.clientX - rect.left, e.clientY - rect.top,
        )
        const pxPerZ = (stageDimsRef.current.w / vbRef.current.w) / layout.metresPerUnit
        const zMax = pxPerZ > 0 ? ZOOM_MAX_PXM / pxPerZ : ZOOM_DEFAULT
        const zMin = pxPerZ > 0 ? ZOOM_MIN_PXM / pxPerZ : ZOOM_DEFAULT
        const nz = Math.min(zMax, Math.max(zMin, cam.z * (e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP)))
        if (q) {
          const k = cam.z / nz
          cam.tx = q.x + (cam.tx - q.x) * k
          cam.tz = q.z + (cam.tz - q.z) * k
        }
        cam.z = nz
      }
      applyCam()
    }
    outer.addEventListener('wheel', onWheel, { passive: false })
    return () => outer.removeEventListener('wheel', onWheel)
  }, [applyCam, glCamera, layout.metresPerUnit])

  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean; mode: 'pan' | 'orbit' } | null>(null)
  const suppressClickRef = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    if (view === 'map') return
    if (e.button === 1) e.preventDefault() // no middle-click autoscroll
    if (e.button !== 0 && e.button !== 1) return
    // Middle-drag ORBITS (tilt and turn, keeping any follow lock: you pivot around the car you are
    // chasing); left-drag pans the free camera, which is what breaks the lock.
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, mode: e.button === 1 ? 'orbit' : 'pan' }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.id !== e.pointerId) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 3) return
    if (!drag.moved) {
      drag.moved = true
      if (drag.mode === 'pan') {
        followRef.current = null
        onFollow(null)
      }
      outerRef.current?.setPointerCapture(e.pointerId)
    }
    const cam = camRef.current
    if (drag.mode === 'orbit') {
      cam.rot += dx * 0.005
      // Drag up to lean the camera down toward the horizon, drag down to come back overhead.
      cam.pitch = Math.max(0, Math.min(PITCH_MAX, cam.pitch - dy * 0.005))
    } else {
      // The world follows the finger: the target moves against the drag, foreshortening included.
      const scale = cam.z * (stageDimsRef.current.w / vbRef.current.w)
      const cos = Math.cos(cam.rot)
      const sin = Math.sin(cam.rot)
      const gx = dx
      const gy = dy / Math.max(0.25, Math.cos(cam.pitch))
      cam.tx -= (gx * cos + gy * sin) / scale
      cam.tz -= (-gx * sin + gy * cos) / scale
    }
    drag.x = e.clientX
    drag.y = e.clientY
    applyCam()
  }
  const onPointerUp = () => {
    const drag = dragRef.current
    suppressClickRef.current = !!drag?.moved
    dragRef.current = null
  }

  // One ref callback per car, built once and then handed back unchanged.
  //
  // React re-attaches a callback ref whenever its identity differs, and an inline arrow function's
  // always does — so an inline ref runs on every commit of this component whether or not the element
  // moved. For the sprite that meant five `querySelector` calls over ninety nodes, twenty times, once a
  // second, to find groups the loop was already holding. Held in a ref map keyed by car id: everything
  // these close over is a ref object or a stable ref map, so a cached callback can never go stale.
  const markerCbs = useRef(new Map<string, (el: HTMLDivElement | null) => void>())
  const markerRef = (id: string) => {
    const hit = markerCbs.current.get(id)
    if (hit) return hit
    const cb = (el: HTMLDivElement | null) => {
      if (!el) { elRefs.current.delete(id); return }
      elRefs.current.set(id, el)
      const p = posRef.current.get(id) // keep the last spot across re-renders (commit, not render)
      el.style.transform = p
        ? `translate(${p.left}px, ${p.top}px) translate(-50%, -50%)`
        : 'translate(-50%, -50%)'
    }
    markerCbs.current.set(id, cb)
    return cb
  }
  // Keyed on the VIEW as well as the car, and that is load-bearing rather than tidy. Switching between
  // the sprite and the map view's numbered dot replaces this div's descendants while keeping the div, so
  // the groups found below are detached and the loop would go on writing transforms to nodes that are no
  // longer in the document. A different key means a different callback identity, which is what makes
  // React detach and re-resolve.
  const spriteCbs = useRef(new Map<string, (el: HTMLDivElement | null) => void>())
  const spriteRef = (id: string, mode: string) => {
    const key = `${id}|${mode}`
    const hit = spriteCbs.current.get(key)
    if (hit) return hit
    const cb = (el: HTMLDivElement | null) => {
      if (!el) {
        sprRefs.current.delete(id)
        return
      }
      // The rotated hit box the tooltip and click ride on; the car itself is GL (#3d-port).
      sprRefs.current.set(id, el)
    }
    spriteCbs.current.set(key, cb)
    return cb
  }

  // Reset the VIEW: default zoom, top-down, opening bearing; keep the target (and any follow lock).
  const resetZoom = () => {
    camRef.current = { ...camRef.current, z: ZOOM_DEFAULT, pitch: 0, rot: defaultRot }
    applyCam()
  }

  // Camera per view: 'map' is the static full-track fit and mounts no GL. The LIVE camera is saved
  // on the way out and restored on the way back, so flipping views never loses where the player
  // was. Also applies the initial camera on mount, aimed at the circuit's centre.
  const savedCamRef = useRef<OrbitCam | null>(null)
  useEffect(() => {
    if (view === 'map' && viewRef.current === 'live') savedCamRef.current = { ...camRef.current }
    viewRef.current = view
    if (view !== 'map') {
      camRef.current = savedCamRef.current ?? {
        tx: vb.x + vb.w / 2, tz: vb.y + vb.h / 2, rot: defaultRot, pitch: 0, z: ZOOM_DEFAULT,
      }
    }
    applyCam()
  }, [view, defaultRot, vb, applyCam])

  // Geometry caches reset ONLY when the circuit changes â€” resetting per render rebuilt the racing-line
  // solve (tens of millions of ops) at every tick, freezing the frame each time the leader crossed the line.
  useEffect(() => {
    lenRef.current = 0
    pitLenRef.current = 0
    raceLenRef.current = 0
    dynRef.current = null
    slotDistsRef.current = []
    pitWindowForRef.current = null
  }, [layout])
  useEffect(() => { slotDistsRef.current = [] }, [pitSlots])

  useEffect(() => {
    let raf = 0
    const tick = () => {
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
          const solved = buildRacingLine(arcPath(path), layout.metresPerUnit)
          raceLine.setAttribute('d', solved.d)
          raceLenRef.current = raceLine.getTotalLength()
          dynRef.current = buildLapDynamics(raceLine, layout.metresPerUnit)
          // Hand the solved line to React ONCE, so the track surface that is worn into it can be built
          // as scene ops. It is the one piece of the world that cannot be known until a path element
          // exists to measure, so it is also the one that arrives after the first frame.
          // The edge follows the ROAD's own boundary, so it needs the centreline, sampled fine enough
          // that a polyline does not cut the spline's corners visibly. ~3m stations.
          const arc = arcPath(path)
          const nCentre = Math.max(512, Math.min(4096, Math.round(arc.length * layout.metresPerUnit / 3)))
          const centre = Array.from({ length: nCentre }, (_, i) => {
            const p = arc.at((i / nCentre) * arc.length)
            return { x: p.x, y: p.y }
          })
          setLapLine({ for: layout, pts: solved.pts, lateral: solved.lateral, centre, dyn: dynRef.current })
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
            slotFlipRef.current[si] = flip
            crew3dRef.current?.setFlip(si, flip)
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
          const p = dynRef.current!.time
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
        const dyn = dynRef.current!
        const lenTotal = lenRef.current
        const uu = (m: number) => m / layout.metresPerUnit
        const look = uu(8) // heading from ~8m of track ahead

        // Pass 1: place every car in arc space. Racing cars live on the RACING LINE path; grid slots
        // form the staggered starting grid (8m pitch, alternating sides) on the centreline.
        interface Frame { id: string; el: HTMLDivElement; kind: 'race' | 'pit' | 'grid'; dist: number; lat: number; pitPhase?: 'in' | 'box' | 'out'; stopFrac?: number; pitCalled?: boolean; pitNewCompound?: TyreCompound }
        const frames: Frame[] = []
        for (const car of carsRef.current) {
          const el = elRefs.current.get(car.id)
          if (!el) continue
          const sample = sampleRef.current(car.id)
          if (sample === null) {
            setVis(el, false)
            continue
          }
          setVis(el, true)
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
            const dist = timeToDistance(dyn.time, ((sample.prog % 1) + 1) % 1) * raceLenRef.current
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
          if (!Number.isFinite(f.dist)) { setVis(f.el, false); continue } // never crash the geometry API
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
          const { w: sw, h: sh } = stageDimsRef.current
          prevDrawRef.current.set(f.id, { x, y, kind: f.kind, dist: f.dist, lat })
          const spr = sprRefs.current.get(f.id)
          const spriteRot = heading + Math.PI / 2
          // Position via transform, not left/top: layout offsets snap to the pixel grid, which a
          // zoomed follow camera amplifies into visible jiggle on the pinned car. The LIVE marker is
          // PROJECTED through the very camera the GL frame was drawn with, so hit box, label and
          // tooltip stay glued to the car at any pitch; the map view keeps its flat fit.
          if (viewRef.current === 'map') {
            const left = ((x - vb.x) / vb.w) * sw
            const top = ((y - vb.y) / vb.h) * sh
            posRef.current.set(f.id, { left, top })
            f.el.style.transform = `translate(${left}px, ${top}px) translate(-50%, -50%)`
            if (spr) spr.style.transform = ''
          } else {
            const outerEl = outerRef.current
            const ow = outerEl?.clientWidth ?? sw
            const oh = outerEl?.clientHeight ?? sh
            const lift = uu(CAR_RIDE_M)
            projA.set(x, lift, y).project(glCamera)
            const sx = (projA.x * 0.5 + 0.5) * ow - (ow - sw) / 2
            const sy = (1 - (projA.y * 0.5 + 0.5)) * oh - (oh - sh) / 2
            posRef.current.set(f.id, { left: sx, top: sy })
            f.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`
            if (spr) {
              // Heading and scale on screen, from a second projected point half a car ahead.
              const halfCar = uu(CAR_LENGTH_M * CAR_SCALE) / 2
              projB.set(x + Math.cos(heading) * halfCar, lift, y + Math.sin(heading) * halfCar)
                .project(glCamera)
              const ax = (projB.x * 0.5 + 0.5) * ow - (ow - sw) / 2
              const ay = (1 - (projB.y * 0.5 + 0.5)) * oh - (oh - sh) / 2
              const screenHalf = Math.hypot(ax - sx, ay - sy)
              // Against the hit box's own zoom-1 pixel size, freshly derived so a resize never
              // leaves a stale scale in this closure.
              const carPx = uu(CAR_LENGTH_M * CAR_SCALE) * (sw / vb.w)
              const k = carPx > 0 ? (2 * screenHalf) / carPx : 1
              spr.style.transform = `rotate(${Math.atan2(ay - sy, ax - sx) + Math.PI / 2}rad) scale(${k})`
            }
          }
          // The real car, posed in world units off the lap's own dynamics (#3d-port). Load comes
          // from the LAP, not from how fast the car happens to be crossing the screen: a race played
          // at 4x speed corners no harder than the same race at 1x. Cars crawling the pit lane or
          // sat on the grid sit level with their wheels straight -- the crew's tyre props must match
          // the wheels in the box. The sprite's fakes (world-locked sheen, displaced contact shadow,
          // body slide) retired with the 2D canvas: the sun does those jobs now.
          const field3d = carField3dRef.current
          if (viewRef.current !== 'map' && field3d) {
            const frac = f.dist / raceLenRef.current
            const racing = f.kind === 'race'
            // Front wheels point where the corner AHEAD of them needs them to: sampled a front
            // axle's lead up the road, in real metres, because the lock a radius demands depends on
            // the car's actual wheelbase. Load is read at the CAR: it is the whole car's corner.
            const steer = racing
              ? steerAngles(
                sampleLap(dyn.curvature, frac + uu(FRONT_LEAD_M) / raceLenRef.current)
                  / layout.metresPerUnit,
                lateralG(dyn, frac, layout.metresPerUnit),
              )
              : STRAIGHT
            const sameLeg = prevDraw && prevDraw.kind === f.kind
            const raw = sameLeg ? f.dist - prevDraw.dist : 0
            field3d.pose(f.id, {
              x, y, rot: spriteRot,
              steerLeft: steer.left, steerRight: steer.right,
              lat: racing ? sampleLap(dyn.lat, frac) : 0,
              long: racing ? sampleLap(dyn.long, frac) : 0,
              // Wrapping the S/F line reads as a huge negative step; roll it over the lap length.
              ds: raw >= 0 ? raw : racing ? raw + raceLenRef.current : 0,
            })
          }
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
        const crew3d = crew3dRef.current
        if (crew3d) {
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
            if (carId) carField3dRef.current?.setWheelsVisible(carId, visible)
          }
          for (let idx = 0; idx < crew3d.slotCount; idx++) {
            const boxDist = slotDistsRef.current[idx]
            const info = pitBySlot.get(idx)
            // Crew stays out from the pit CALL through the whole in-lane visit, until the car is
            // 12m past its box on the way out.
            const wantCrew = calledSlots.has(idx) ||
              (info != null && boxDist != null && info.dist < boxDist + uu(12))
            let anim = crewAnimRef.current.get(idx)
            if (!anim && !wantCrew) { crew3d.setRootVisible(idx, false); continue }
            if (!anim) {
              anim = { mode: 'hidden', pos: {}, oldOut: [false, false, false, false], newIn: [false, false, false, false], swapped: false, restored: false, retreatT0: 0 }
              crewAnimRef.current.set(idx, anim)
            }
            if (wantCrew && anim.mode !== 'active') { anim.mode = 'active'; crew3d.setRootVisible(idx, true) }
            else if (!wantCrew && anim.mode === 'active') { anim.mode = 'retreat'; anim.retreatT0 = wallT }
            if (anim.mode === 'hidden') { crew3d.setRootVisible(idx, false); continue }
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
              crew3d.setRootVisible(idx, false)
              continue
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
              crew3d.setPart(idx, role, x + jx, y + jy)
            }

            // (1) The invisible swap OUT, on the first stopped frame.
            if (stopped && !anim.swapped) {
              anim.swapped = true
              setCarWheels(anim.carId, false)
              // Latch compound colours: the outgoing set is what the car wears NOW (the engine fits
              // the new set only at the end of the stop), the incoming set is the pit call's target.
              const meta = carsRef.current.find((cm) => cm.id === anim!.carId)
              const oldBand = meta?.compound ? COMPOUND_COLORS[meta.compound] : '#FFD700'
              const newBand = info?.newCompound ? COMPOUND_COLORS[info.newCompound] : oldBand
              for (let c = 0; c < 4; c++) {
                anim.pos[`oldT${c}`] = [WHEELS[c][0], WHEELS[c][1]]
                crew3d.setBands(idx, c, oldBand, newBand)
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
              const oldTarget: [number, number] = !anim.oldOut[c]
                ? [wx, wy]
                : retreating ? intoGarage(anim.pos[`oldT${c}`] ?? drop) : drop
              const [ox, oy] = move(`oldT${c}`, oldTarget[0], oldTarget[1], 2.6)
              crew3d.setPartVisible(idx, `oldT${c}`, anim.swapped)
              crew3d.setPart(idx, `oldT${c}`, ox, oy)
              // New tyre: pre-staged from deploy, carried by B to the hub, gone the frame the car is whole.
              const newTarget: [number, number] = anim.newIn[c] && !anim.restored ? [wx, wy] : stage
              const [nx2, ny2] = move(`newT${c}`, newTarget[0], newTarget[1], 2.6)
              crew3d.setPartVisible(idx, `newT${c}`, anim.mode === 'active' && !anim.restored)
              crew3d.setPart(idx, `newT${c}`, nx2, ny2)

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
          }
        }
      }
      // Follow camera: the orbit target IS the followed car; pitch, rotation and zoom stay the
      // player's own, so the drag-to-tilt keeps orbiting the car it is locked to. The MOVE only;
      // the frame is painted once, below.
      if (followRef.current && viewRef.current !== 'map') {
        const p = prevDrawRef.current.get(followRef.current)
        if (p) {
          camRef.current.tx = p.x
          camRef.current.tz = p.y
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
      // ONE paint per frame, for every live frame, and always from inside the rAF callback. Two
      // rules in that sentence, both load-bearing:
      //
      // ONE, because following used to paint here AND from the camera move above, and the cars
      // effect below painted again on top of that.
      //
      // INSIDE, because a WebGL context without `preserveDrawingBuffer` has its drawing buffer
      // cleared once the compositor has taken it. Painting from a React effect instead puts the
      // render in whatever task the commit lands in, and a frame composited between that clear and
      // the next render shows an empty buffer.
      if (viewRef.current !== 'map') paintRef.current()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // `cars` is read through `carsRef`, deliberately and not for convenience: as a dependency it tore
    // the whole loop down and rebuilt it every time the array got a fresh identity, which the 1Hz
    // tooltip tick does on its own. The loop's own state lives in refs, so it wants to run undisturbed
    // for the length of the race.
  }, [slotOf, pitSlots, layout, vb, sampleRef, outSign, lighting, applyCam, glCamera])

  // Road paint that belongs to the START rather than to the circuit: the chequered band and the grid
  // boxes. Three fills between them, so as ops they are three draw calls; as elements they were a
  // hundred and sixteen rects being re-rasterised inside the camera's own transform every frame.
  //
  // Handed to the world as its `overlay`, painted over everything on the ground. The chequer itself
  // is part of the 3D world's own road stack; only the grid's marks arrive from here, because only
  // this component knows where the cars park.
  const gridOverlay = useMemo(
    () => (view === 'live' ? gridBoxOps(gridMarks, u) : []),
    [u, view, gridMarks],
  )
  // The minimap's chequer, still SVG: the map view mounts no GL canvas.
  const mapMarkOps = useMemo(
    () => startLineOps(startPose(layout.start, layout.metresPerUnit), u),
    [layout.start, layout.metresPerUnit, u],
  )

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
  // The tile textures the stands' decks wear, built once per mount: a document is guaranteed here.
  const worldTextures = useMemo(() => buildWorldTextures(), [])
  // The generated surface grain: scale-free, so one set serves every circuit and every mood.
  const worldDetail = useMemo(() => buildWorldDetail(), [])
  // The tree pack, downloaded once per session and cached inside the loader. It arrives after the
  // first world is already standing (with the fallback spheres on it), and landing in state rebuilds
  // that world once. Deliberately NOT disposed on unmount: the cache is session-wide, and a second
  // mount would find a gutted pack. StrictMode's double mount is why the flag exists at all.
  const [treePack, setTreePack] = useState<TreePack | null>(null)
  useEffect(() => {
    let live = true
    loadTreePack().then((p) => { if (live) setTreePack(p) }).catch(() => {})
    return () => { live = false }
  }, [])
  // The grandstands' scanned surfaces, on the same terms as the tree pack: fetched once, and the
  // world rebuilt when they land. A failure is swallowed on purpose, because the stands are fully
  // modelled without them and a circuit with flat-coloured concrete beats a circuit with none.
  const [standSkin, setStandSkin] = useState<StandSkin | null>(null)
  useEffect(() => {
    let live = true
    loadStandSkin('/materials/web/').then((s) => { if (live) setStandSkin(s) }).catch(() => {})
    return () => { live = false }
  }, [])
  // The garage name boards build INSIDE the world (below), per invocation: a memo-held group here
  // got silently stolen by StrictMode's double-invoked world build re-parenting it.
  // The car field and the pit crew are GL RESOURCES with a StrictMode trap: dev mounts every effect
  // twice, and a cleanup that disposes the memo-held instance guts the very object the remount then
  // reuses. That is exactly how the whole pit lane (pad, markings, booms, crew) silently vanished
  // from a dev session: `dispose()` emptied the group and nothing ever rebuilt it. So disposal is
  // DEFERRED AND GUARDED: it only fires if the instance was not re-adopted by the next tick.
  const carField3d = useMemo(
    () => (view === 'live'
      ? new CarField3D(u(CAR_LENGTH_M * CAR_SCALE) / SPRITE.len, u(CAR_RIDE_M))
      : null),
    [view, u],
  )
  const carField3dRef = useRef<CarField3D | null>(null)
  useEffect(() => {
    carField3dRef.current = carField3d
    const victim = carField3d
    return () => {
      carField3dRef.current = null
      if (victim) setTimeout(() => { if (carField3dRef.current !== victim) victim.dispose() }, 0)
    }
  }, [carField3d])
  // The pit crew, in-scene (#3d-port): people and props the choreography drives through the same
  // slot-local metres it always computed. Tyre props are cut from the car's own wheel table. The
  // measured lane-side flips outlive any rebuild in `slotFlipRef`, so a fresh crew inherits them.
  const crew3d = useMemo(
    () => (view === 'live'
      ? new PitCrew3D({
        slots: pitSlots, u, colors: slotOf.colors,
        carScale: u(CAR_LENGTH_M * CAR_SCALE) / SPRITE.len, rideY: u(CAR_RIDE_M),
      })
      : null),
    [view, pitSlots, u, slotOf],
  )
  const crew3dRef = useRef<PitCrew3D | null>(null)
  useEffect(() => {
    crew3dRef.current = crew3d
    slotFlipRef.current.forEach((flip, si) => crew3d?.setFlip(si, flip))
    const victim = crew3d
    return () => {
      crew3dRef.current = null
      if (victim) setTimeout(() => { if (crew3dRef.current !== victim) victim.dispose() }, 0)
    }
  }, [crew3d])
  // Liveries, compounds and retirements arrive through React; `ensure` is a no-op until one changes.
  useEffect(() => {
    if (!carField3d) return
    const live = new Set<string>()
    for (const c of cars) {
      live.add(c.id)
      carField3d.ensure(c.id, c.livery ?? c.color, c.compound)
      carField3d.setOpacity(c.id, c.retired ? 0.35 : 1)
    }
    carField3d.sweep(live)
    // Deliberately no paint: `cars` gets a fresh identity on every sim tick, and the rAF loop is
    // already painting every frame. Repainting here only added a second render per tick, taken
    // outside the frame callback.
  }, [carField3d, cars])
  // The whole static world as real geometry, built off React's render because it only changes when
  // the WORLD does: a new circuit, the lap's ink arriving, the grid being painted, a team claiming
  // its garage. The camera never touches it — a camera move is a matrix on the same buffers, which
  // is the entire performance argument of the port (#3d-port increment 5). Note what is ABSENT
  // against the 2D scene build: no `viewAz`, because nothing leans any more, so rotating the camera
  // no longer rebuilds anything.
  const world3d = useMemo(() => {
    if (view !== 'live') return null
    return buildWorld3D({
      layout,
      scenery,
      pitZone,
      pitSlots,
      lap: lapLine?.for === layout ? lapLine : null,
      lighting,
      textures: worldTextures,
      detail: worldDetail,
      frame: vb,
      overlay: gridOverlay,
      garageColors: (gi) => slotOf.colors[gi],
      extras: () => (pitZone ? [buildGarageSigns3D(pitZone, u, (gi) => garageCars[gi] ?? [])] : []),
      night: mood === 'night',
      treePack,
      standSkin,
    })
  }, [view, layout, scenery, pitZone, pitSlots, lapLine, lighting, worldTextures, worldDetail, vb, gridOverlay, slotOf, u, garageCars, mood, treePack, standSkin])
  // The painter repaints when the CAMERA moves; anything that changes the picture WITHOUT one has to
  // ask: a freshly built world, or the STAGE being measured or resized (it is half of
  // pixels-per-metre).
  useEffect(() => { applyCam() }, [applyCam, world3d, stage.w, stage.h])


  return (
    <div
      ref={outerRef}
      className="relative w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={() => {
        // A plain click on empty ground releases the follow lock; drags never land here (they set
        // the suppress flag), and car clicks stop their own propagation.
        if (!suppressClickRef.current && viewRef.current !== 'map' && followRef.current) {
          followRef.current = null
          onFollow(null)
        }
      }}
    >
      {/* On the OUTER box, not the stage: the stage letterboxes to the viewBox's aspect, and a canvas
          clipped to it stops painting at the stage edge — the world visibly ended there under zoom.
          Stage centre and viewport centre coincide, so the camera transform is the same either way. */}
      {view === 'live' && (
        <Scene3DCanvas
          world={world3d}
          carsGroup={carField3d?.group ?? null}
          crewGroup={crew3d?.group ?? null}
          base={scenery.base}
          lighting={lighting}
          night={mood === 'night'}
          skySeed={skySeed}
          ppu={vb.w > 0 && stage.w > 0 ? stage.w / vb.w : 1}
          unitsPerMetre={u(1)}
          camRef={camRef}
          camera={glCamera}
          paintRef={paintRef}
          className="absolute inset-0"
        />
      )}
      <div ref={stageRef} className="relative" style={{ width: stage.w, height: stage.h }}>
        <div ref={worldRef} className="absolute inset-0" style={{ transformOrigin: '50% 50%' }}>
          {/* overflow visible: the world extends far beyond the stage so the camera never sees the
              edge of it under follow + zoom. */}
          <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
            {/* The map view is a clean dark minimap: no scenery, no canvas, just the ribbon and the
                start's own paint under numbered dots. Everything below is drawn for it alone — the
                live view's world comes off the canvas behind this document. */}
            {view === 'map' && (
              <rect x={vb.x - 4000} y={vb.y - 4000} width={vb.w + 8000} height={vb.h + 8000} fill="#0F1319" />
            )}
            {/* Kept in the document whatever draws it: the race loop measures this path with
                getTotalLength, which needs it present. Invisible once the canvas has the road. */}
            <path
              ref={pathRef} d={layout.d} fill="none" stroke="#D8D8D2"
              strokeWidth={u(TRACK_WIDTH_M)} strokeLinejoin="round"
              visibility={view === 'map' ? undefined : 'hidden'}
            />
            {/* Measured, never drawn: the lane the pitting cars are placed along. */}
            <path ref={pitPathRef} d={layout.pit.d} fill="none" stroke="none" />
            {/* The start/finish chequer, off the same description every renderer takes. */}
            {view === 'map' && mapMarkOps.map((op, i) => (
              <path key={`rm${i}`} d={op.d} fill={op.fill} />
            ))}
            {/* Invisible: the computed racing line the cars actually drive (sampled per frame). */}
            <path ref={raceLineRef} fill="none" stroke="none" />
          </svg>
          <div className="contents">{cars.map((car) => (
            <div
              key={car.id}
              ref={markerRef(car.id)}
              className="absolute left-0 top-0"
              style={{ opacity: car.retired ? 0.35 : 1 }}
            >
              {/* The car is scenery, not a control: no tooltip, no hover, no click. Following is
                  driven from the timing table, and a car that swallowed clicks also swallowed the
                  ground click that stops following. `pointer-events-none` all the way down. */}
              <div
                ref={spriteRef(car.id, view)}
                className="pointer-events-none"
                // Live sprites carry a real contact shadow (#sim-2d), which a filter that turns
                // with the car cannot be. The map view's numbered dot still wants one.
                style={view === 'map' ? { filter: 'drop-shadow(0.5px 0.8px 0.5px rgba(0,0,0,0.5))' } : undefined}
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
                  // The car itself is GL (#3d-port); this transparent box is its exact rendered
                  // footprint, still measured by `spriteRef` to place the labels and the pinned card.
                  <div style={{ width: carL * SPRITE.aspect, height: carL }} />
                )}
              </div>
                {showLabels && (
                  <div
                    className="absolute left-full top-1/2 flex items-center gap-1 whitespace-nowrap pointer-events-none"
                    style={{
                      // Counter-rotate AND counter-scale against the camera so labels stay upright and a
                      // constant screen size at any zoom, anchored beside the car.
                      // Markers are projected into screen space now, so a label is naturally
                      // upright at a constant size: no counter-transforms left to apply.
                      transformOrigin: 'left center',
                      transform: 'translate(8px, -50%)',
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

      {/* Camera controls (the map view is static; nothing to reset). Clicks stay in the cluster,
          or pressing a button would read as a ground click and drop the follow lock. */}
      {view === 'live' && (
        <div
          className="absolute bottom-3 right-3 flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            ref={zoomReadRef}
            className="text-xs font-semibold text-[#FFFFFF]"
            style={{ WebkitTextStroke: '1px #000000', paintOrder: 'stroke' }}
          />
          <Tooltip content="Reset view">
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
  p.mood === n.mood &&
  p.followId === n.followId &&
  p.showLabels === n.showLabels &&
  p.sceneryDensity === n.sceneryDensity &&
  p.tipTick === n.tipTick &&
  p.teamOrder === n.teamOrder &&
  (p.pinnedCard == null) === (n.pinnedCard == null) &&
  sameCars(p.cars, n.cars, (n.view ?? 'live') === 'map'),
)
