'use client'

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Maximize } from 'lucide-react'
import type { TrackLayout } from '@/data/tracks'
import { KERB_BLOCK_M, KERB_WIDTH_M } from '@/lib/ui/track-scenery'
import { buildScenery, type SceneryDensity } from '@/lib/ui/track-scenery'
import { QUALITY, atLeast, lodBucket, lodScale, rungFor, type Quality } from '@/lib/ui/lod'
import { SOFT_LAYERS, SOFT_SPREAD } from '@/lib/ui/surface-ink'
import {
  SceneryLayer, SceneryShadowLayer, ScenerySolidsLayer, TrackFurnitureLayer, EXTRUDE, visibleTrees,
  type Cull, type Hidden, type SceneryPiece,
} from './SceneryLayer'
import {
  MOODS, dirAt, lightDir, screenUpAzimuth, shadowFill, shadowReach,
} from '@/lib/ui/lighting'
import { buildPitSlots, buildPitZone, pitCameraRotation, pitViewAzimuth } from '@/lib/ui/pit-zone'
import { linePath } from '@/lib/ui/extrude'
import { useSceneryBitmap } from './use-scenery-bitmap'
import { SceneryCanvas, contextFor, drawScene, warmScene, type SceneTiming } from './SceneryCanvas'
import { isGroup, sceneryScene, type DrawOp, type SceneItem, type SceneMark } from '@/lib/ui/scenery-draw'
import { canvasPaint, type PaintCtx } from '@/lib/ui/scenery-paint'
import {
  PitBuilding, PitBuildingShadow, PitGarageFloors, PitGarageSigns, SIGN_H_M,
  pitComplexOps, pitFloorOps,
} from './PitBuilding'
import { COMPOUND_COLORS } from './TyreIndicator'
import type { TyreCompound } from '@/lib/sim/types'
import { CarSprite } from './CarSprite'
import { GANTRY_H_M, PitBoxes, type PitBoxRefs } from './PitBoxes'
import {
  CAR_LENGTH_M, CAR_SCALE, FRONT_LEAD_M, LEVEL, SPRITE, STRAIGHT, bodyTransform, carAttitude, carLight,
  shadowTransform, sheenTransform, steerAngles, steerTransform,
} from '@/lib/ui/car-sprite'
import {
  PROFILE_N, lapDynamics, lateralG, sampleLap, trackPhysics, type LapDynamics,
} from '@/lib/ui/lap-dynamics'
import { buildRacingLine, type ArcPath } from '@/lib/ui/racing-line'
import { roadOps } from '@/lib/ui/road-ops'
import { gridBoxOps, startLineOps } from '@/lib/ui/road-marks'
import type { Vec } from '@/lib/ui/geom'
import {
  LANE_LINE_M, LANE_TARMAC_M, LANE_WIDTH_M, PIT_ENTRY_FRAC, PIT_EXIT_FRAC, TARMAC_WIDTH_M,
  TRACK_WIDTH_M,
} from '@/lib/ui/track-path'
import { liveBridge } from '@/lib/store/live-bridge'
import { PERF, resetPerfFlags, setPerfFlags } from '@/lib/ui/perf-flags'
import { trackFeatures, type ShotWorld } from '@/lib/ui/perf-shots'
import { PerfLabModal } from './PerfLabModal'
import { usePerfLab } from './use-perf-lab'
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
// ON. The layer hotkeys and 'n' for the perf lab; the readout keeps its backtick either way.
//
// Three successive comments here claimed this was parked while the value said otherwise, so: it is live,
// and it is live because ablating a layer is still the only way to attribute a raster cost that only a
// browser can see. What has been settled without it is the COMMAND cost, which `npm run zoom:check`
// measures headlessly; the pit straight's raster dips remain the known residual.
//
// The cost of leaving it on is that these are bare unmodified letters across the top row, so stray
// typing silently hides half the world and the only clue is the `off:` list in the readout. They belong
// behind a settings screen, which is the seam this flag marks. The letters are already off while a text
// field has focus and while the lab is up, which is what the lab needs to own its own configuration.
const DEBUG_KEYS: boolean = true

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
  // which left the pit-straight measurement unable to say which half was the hitch.
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
/** How long the perf lab waits for a composed scene to land before measuring anyway. The warm parses in
 *  time-boxed slices, so a cold scene takes as many frames as it takes; this is the backstop that keeps
 *  a run moving rather than the expected path. */
const SETTLE_CAP_MS = 400

// Real-world sizes, rendered at true scale through each layout's metresPerUnit. The lane's own
// cross-section lives with the track's in track-path.ts, since the surface laid on it measures against
// the same numbers the renderer strokes with.
// CAR_LENGTH_M and CAR_SCALE now live with the sprite's own geometry in lib/ui/car-sprite.ts, which
// needs them to size the light it casts; everything car-locked here still multiplies by them.

const ZOOM_MAX = 60
const ZOOM_DEFAULT = 20
const ZOOM_STEP = 1.18 // per wheel notch
const ZOOM_MIN = 0.6 // full-track view; far-zoom cost is handled by the scenery LOD + composited world layer
// Detail tiers, in SCREEN PIXELS PER METRE of track.
//
// In pixels per metre and not in zoom, because zoom is not a shared unit: a circuit's own metres per
// unit and viewBox decide how big it draws, and 5x frames Monza very differently from Monaco. The one
// gate here used to be 3 ZOOM, which works out anywhere between 1.2 and 2.2 px/m across the 37 layouts.
//
// There are two of them because the map is DRAW-CALL bound, not pixel bound, and the two halves of the
// picture reach the point of diminishing returns at very different sizes. Measured on a shot framing the
// whole pit building (3.5px/m): 993 draw calls against 100-230 at racing zoom, hiding 70% of the pixels
// changed the frame rate not at all, and ablation put a draw call at about 19 microseconds — so those
// calls are most of a 33ms frame.

/** Graphics quality presets, as the multipliers the shared ladder in lib/ui/lod.ts is scaled by. These
 *  are the STARTING values for the three user settings; the tuning panel under the fps readout moves
 *  them live so the frame-rate-to-fidelity trade can be judged by eye rather than by rebuild. */
/** Whether the tarmac carries what has been driven into it: the racing line, the marbles a corner
 *  throws off, the brake marks into every real braking zone, and the road's own grain.
 *
 *  OFF. It is the most expensive thing on the map per unit of picture. Every mark is cut into 128 arcs
 *  and softened by four nested strokes, so a racing shot pulls in a few hundred draw calls and a wide
 *  one most of a thousand — and this renderer is draw-call bound. The tarmac's EDGE is a separate thing
 *  and stays: it is what makes the road read as a slab laid on the ground rather than a line drawn into
 *  it, and as rims it costs about a tenth of what it used to.
 *
 *  Everything behind this flag still works and is still tested; nothing is deleted. Turn it back on when
 *  there is frame budget to spend on it. */
const SURFACE_INK = false

const QUALITY_PRESETS: Array<{ key: Quality; label: string }> = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
]

/** What each remaining gate measures itself by, in metres, so it can go through the same ladder as
 *  every solid rather than carrying a zoom threshold of its own.
 *
 *  The ink's is the width of its whole softening band: four nested strokes a SOFT_SPREAD apart, and once
 *  that band is unresolvable the four are indistinguishable from one. The signage band is the height of
 *  the board the names sit on. */
const INK_SOFTENING_M = SOFT_LAYERS * SOFT_SPREAD
const SIGN_BAND_M = SIGN_H_M * EXTRUDE
const ROT_STEP = Math.PI / 36 // 5Â° per shift+wheel notch

/** Show or hide an element, writing only when it is actually changing.
 *
 *  The render loop settles the visibility of every car and every pit crew on every frame, and on the
 *  overwhelming majority of them the answer is the same as last frame's — twenty cars on track and ten
 *  garages standing idle is thirty style-attribute writes a frame to say nothing. A write goes through
 *  CSSOM parsing whether or not the value moved, so the cheapest place to notice is here. Remembered on
 *  the element, so nothing has to be pruned when a car retires or a circuit changes.
 *
 *  `visibility` rather than `display` throughout, and deliberately: the race loop measures the track
 *  path with `getTotalLength`, which needs the geometry laid out. */
const VIS = Symbol('vis')
type Hideable = (SVGElement | HTMLElement) & { [VIS]?: boolean }

function setVis(el: Hideable, shown: boolean): void {
  if (PERF.visElide && el[VIS] === shown) return
  el[VIS] = shown
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
  /** Open the perf lab as soon as the map is up. For /dev/perf-lab, whose whole reason to exist is the
   * lab; everywhere else it stays behind the 'n' key. */
  openPerfLab?: boolean
}

function RaceTrackMapImpl({ layout, cars, sampleRef, followId, onFollow, showLabels = false, sceneryDensity, tooltipFor, view = 'live', pinnedCard, teamOrder, openPerfLab = false }: Props) {
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
  const crewRefs = useRef(new Map<number, SVGGElement>()) // per-slot pit crew overlays (root visibility)
  const crewPartsRef = useRef(new Map<string, SVGGElement>()) // `slot:role` -> member/prop group
  const slotInnerRefs = useRef(new Map<number, SVGGElement>()) // flipped so the garage faces away from the lane
  const gantryShRefs = useRef(new Map<number, SVGGElement>()) // gantry shadow, offset against that flip
  const gantryRefs = useRef(new Map<number, SVGGElement>()) // gantry booms, lifted off the box floor
  // The five of them as one object, built once. `PitBoxes` is memoised on its props, so a fresh bundle
  // per render would defeat the memo and put its thousand elements back in every commit.
  const pitBoxRefs = useRef<PitBoxRefs>({
    inner: slotInnerRefs, gantry: gantryRefs, gantryShadow: gantryShRefs,
    crew: crewRefs, parts: crewPartsRef,
  }).current
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
  // The cars read the SAME light. One stable object, so the memoised sprites do not re-render for it.
  const carLit = useMemo(() => carLight(lighting), [lighting])
  const shadowRefs = useRef(new Map<string, SVGGElement>())
  const bodyRefs = useRef(new Map<string, SVGGElement>())
  const sheenRefs = useRef(new Map<string, SVGGElement>())
  const steerRefs = useRef(new Map<string, [SVGGElement, SVGGElement]>()) // front wheels, left then right
  const followRef = useRef<string | null>(followId)
  useEffect(() => { followRef.current = followId }, [followId])
  const viewRef = useRef(view)

  // Scenery LOD for the SVG layers, off the shared ladder (state flips only on threshold
  // crossings). The tarmac's ink has its own, earlier tier: it stops being worth softening long before
  // the scenery stops being worth drawing.
  const [lodLow, setLodLow] = useState(false)
  const lodLowRef = useRef(false)
  const [inkFlat, setInkFlat] = useState(false)
  const inkFlatRef = useRef(false)
  // What the per-object detail ladder reads. Committed in half-octave buckets rather than live: a
  // rung only changes at discrete scales, and recomposing the scene on every zoom notch would cost
  // far more than the ladder saves.
  const [scenePxPerM, setScenePxPerM] = useState(Infinity)
  const sceneBucketRef = useRef(Number.NaN)
  // Which preset is live, and what each preset is currently worth. Held here rather than in a settings
  // store because the point is to TUNE them: the sliders write these, the ladder reads them, and the
  // fps readout above shows what it cost. Whatever survives tuning becomes the shipped defaults.
  const [qualityKey, setQualityKey] = useState<Quality>('medium')
  const [qualityOf, setQualityOf] = useState<Record<Quality, number>>({ ...QUALITY })
  const quality = qualityOf[qualityKey]
  // applyCam runs outside React, so the gates it computes read the live value through a ref.
  const qualityRef = useRef(quality)
  useEffect(() => { qualityRef.current = quality }, [quality])
  // Garage signage carries the only real TEXT on the map, and text is the one thing on it that does not
  // degrade gracefully — it stops being legible long before it stops being expensive. Gated on the
  // band's own height in screen pixels rather than on a zoom number, because a circuit's metres per
  // unit decides how big the building draws.
  const [signsLettered, setSignsLettered] = useState(true)
  const signsLetteredRef = useRef(true)

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
  // The perf lab, reached through refs because the key listener binds once.
  const benchKeyRef = useRef<() => void>(() => {})
  const labOpenRef = useRef(false)
  const labCloseRef = useRef<() => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return
      // These are bare unmodified letters, so a field taking text owns them.
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      // The lab drives the layer set, the renderer and the camera for the length of a run; a stray
      // letter underneath it would silently change the configuration a row is being measured under.
      // The readout is in that list and not an exception to it: opening it resets the tick stats twice
      // a second, which is the reason the lab closes it in the first place.
      if (DEBUG_KEYS && labOpenRef.current) {
        if (e.key === 'Escape') labCloseRef.current()
        return
      }
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
          // The camera, so a report of where the frame rate went can name the shot it went in. Zoom
          // alone does not describe one: the same zoom frames a different amount of circuit on every
          // layout, so the readout carries what that zoom WORKS OUT to here — how many screen pixels
          // a metre of track covers.
          const z = camRef.current.z
          const pxPerM = (stageDimsRef.current.w / vb.w) * z / layout.metresPerUnit
          const cam = `${z.toFixed(1)}x  ${pxPerM.toFixed(1)}px/m`
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
          el.textContent = `${fps} fps (${capTxt})  ${cam}  |  ${nodes} nodes  ${by}${paint}${tickTxt}`
            + `${offList ? `  |  off: ${offList}` : ''}`
        }
        frames = 0
        since = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [hud, vb.w, layout.metresPerUnit])

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

  // The camera the world layer and the canvas were last brought up to date for, plus the stage size
  // that reading was taken at. A follow camera calls `applyCam` every single frame whether or not the
  // car it is locked to has moved, and it very often has not: a serviced car is PINNED to its box for
  // the whole stop, and the whole field sits still on the grid before lights out. Repainting the
  // static world sixty times a second to produce the identical picture is the one cost on this
  // renderer with no upside at all, and it lands during the pit stop, which is the busiest thing on
  // the map. NaN so the first call can never match.
  const paintedRef = useRef({ x: NaN, y: NaN, z: NaN, rot: NaN, w: NaN, h: NaN })

  const applyCam = useCallback((force = false) => {
    const world = worldRef.current
    if (!world) return
    const { x, y, z, rot } = camRef.current
    const { w: stageW, h: stageH } = stageDimsRef.current
    const was = paintedRef.current
    if (!force && PERF.cameraGuard && was.x === x && was.y === y && was.z === z && was.rot === rot
      && was.w === stageW && was.h === stageH) return
    paintedRef.current = { x, y, z, rot, w: stageW, h: stageH }
    world.style.transform = `translate(${x}px, ${y}px) rotate(${rot}rad) scale(${z})`
    world.style.setProperty('--cam-rot', `${rot}rad`)
    world.style.setProperty('--cam-zoom-inv', String(1 / z))
    updateCull()
    paintRef.current()
    // Screen pixels per metre of track: the one measure of "how far out am I" that means the same
    // thing on every circuit, and what both detail gates below are expressed in.
    const pxPerM = (stageDimsRef.current.w / vb.w) * z / layout.metresPerUnit
    const live = viewRef.current === 'live'
    const rung = (sizeM: number) => (live ? rungFor(sizeM, pxPerM, qualityRef.current) : 'near')
    // The SVG layers' own two-tier prop, driven off the ladder like everything else: a 12m tree is the
    // smallest thing they draw, so it decides when they stop drawing the heavy half.
    const low = !atLeast(rung(12), 'far')
    if (low !== lodLowRef.current) {
      lodLowRef.current = low
      setLodLow(low)
    }
    const flat = !atLeast(rung(INK_SOFTENING_M), 'mid')
    if (flat !== inkFlatRef.current) {
      inkFlatRef.current = flat
      setInkFlat(flat)
    }
    // The bucket's OWN scale, never the live one: a rung has to be a pure function of the bucket, or
    // it flips at a different place zooming in than zooming out.
    const bucket = live ? lodBucket(pxPerM) : Number.POSITIVE_INFINITY
    if (bucket !== sceneBucketRef.current) {
      sceneBucketRef.current = bucket
      setScenePxPerM(live ? lodScale(pxPerM) : Infinity)
    }
    const lettered = atLeast(rung(SIGN_BAND_M), 'far')
    if (lettered !== signsLetteredRef.current) {
      signsLetteredRef.current = lettered
      setSignsLettered(lettered)
    }
  }, [updateCull, layout.metresPerUnit, vb.w])


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
      const { w, h } = stageDimsRef.current
      el.style.transform = p && w
        ? `translate(${(p.left / 100) * w}px, ${(p.top / 100) * h}px) translate(-50%, -50%)`
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
        shadowRefs.current.delete(id)
        bodyRefs.current.delete(id)
        sheenRefs.current.delete(id)
        steerRefs.current.delete(id)
        return
      }
      sprRefs.current.set(id, el)
      // The groups the loop drives, found once here rather than queried per frame.
      const put = (sel: string, into: Map<string, SVGGElement>) => {
        const g = el.querySelector<SVGGElement>(sel)
        if (g) into.set(id, g)
        else into.delete(id)
      }
      put('[data-car-shadow]', shadowRefs.current)
      put('[data-car-body]', bodyRefs.current)
      put('[data-car-sheen]', sheenRefs.current)
      const fl = el.querySelector<SVGGElement>('[data-wheel="fl"]')
      const fr = el.querySelector<SVGGElement>('[data-wheel="fr"]')
      if (fl && fr) steerRefs.current.set(id, [fl, fr])
      else steerRefs.current.delete(id)
    }
    spriteCbs.current.set(key, cb)
    return cb
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
    // Forced: switching views changes what is drawn even when the restored camera happens to match
    // the one already applied.
    applyCam(true)
  }, [view, defaultRot, applyCam])

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
          const left = ((x - vb.x) / vb.w) * 100
          const top = ((y - vb.y) / vb.h) * 100
          posRef.current.set(f.id, { left, top })
          // Position via transform, not left/top: layout offsets snap to the pixel grid in world space,
          // which a zoomed follow camera amplifies into visible jiggle on the pinned car.
          const { w: sw, h: sh } = stageDimsRef.current
          prevDrawRef.current.set(f.id, { x, y, kind: f.kind, dist: f.dist, lat })
          f.el.style.transform = `translate(${(left / 100) * sw}px, ${(top / 100) * sh}px) translate(-50%, -50%)`
          const spr = sprRefs.current.get(f.id)
          const spriteRot = heading + Math.PI / 2
          if (spr) spr.style.transform = viewRef.current === 'map' ? '' : `rotate(${spriteRot}rad)`
          // The sprite turns whole, so anything painted on it turns with it -- which is exactly what
          // reads as flat. Three groups inside it are held against the WORLD instead (#sim-2d): the
          // contact shadow keeps pointing away from the sun, the sheen keeps facing it, and the body
          // leans and dips over both. Map view draws numbered dots, which have none of them.
          if (viewRef.current !== 'map') {
            shadowRefs.current.get(f.id)?.setAttribute('transform', shadowTransform(carLit, spriteRot))
            // Load comes from the LAP, not from how fast the sprite happens to be crossing the screen:
            // a race played at 4x speed corners no harder than the same race at 1x. Cars crawling the
            // pit lane or sat on the grid sit level.
            const frac = f.dist / raceLenRef.current
            const att = f.kind === 'race'
              ? carAttitude(sampleLap(dyn.lat, frac), sampleLap(dyn.long, frac))
              : LEVEL
            bodyRefs.current.get(f.id)?.setAttribute('transform', bodyTransform(att))
            sheenRefs.current.get(f.id)?.setAttribute('transform', sheenTransform(spriteRot, att))
            // Front wheels point where the corner AHEAD of them needs them to: sampled a front-axle's
            // lead up the road, and converted to real metres, because the steering angle a radius
            // demands depends on the car's actual wheelbase. Pit-lane and grid cars keep their wheels
            // straight -- the crew's tyre props pixel-match the wheels in the box, and a steered wheel
            // would break that match on the one car anyone is looking closely at.
            const fronts = steerRefs.current.get(f.id)
            if (fronts) {
              const steer = f.kind === 'race'
                ? steerAngles(
                  sampleLap(dyn.curvature, frac + uu(FRONT_LEAD_M) / raceLenRef.current)
                    / layout.metresPerUnit,
                  // Load is read at the CAR, not at the front axle: it is the whole car's corner.
                  lateralG(dyn, frac, layout.metresPerUnit),
                )
                : STRAIGHT
              fronts[0].setAttribute('transform', steerTransform(steer.left, SPRITE.wheels[0]))
              fronts[1].setAttribute('transform', steerTransform(steer.right, SPRITE.wheels[1]))
            }
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
            if (!anim && !wantCrew) { setVis(root, false); return }
            if (!anim) {
              anim = { mode: 'hidden', pos: {}, oldOut: [false, false, false, false], newIn: [false, false, false, false], swapped: false, restored: false, retreatT0: 0 }
              crewAnimRef.current.set(idx, anim)
            }
            if (wantCrew && anim.mode !== 'active') { anim.mode = 'active'; setVis(root, true) }
            else if (!wantCrew && anim.mode === 'active') { anim.mode = 'retreat'; anim.retreatT0 = wallT }
            if (anim.mode === 'hidden') { setVis(root, false); return }
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
              setVis(root, false)
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
              const meta = carsRef.current.find((cm) => cm.id === anim!.carId)
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
                setVis(oldEl, anim.swapped)
                oldEl.setAttribute('transform', `translate(${uu(ox)} ${uu(oy)})`)
              }
              // New tyre: pre-staged from deploy, carried by B to the hub, gone the frame the car is whole.
              const newEl = crewPartsRef.current.get(`${idx}:newT${c}`)
              const newTarget: [number, number] = anim.newIn[c] && !anim.restored ? [wx, wy] : stage
              const [nx2, ny2] = move(`newT${c}`, newTarget[0], newTarget[1], 2.6)
              if (newEl) {
                setVis(newEl, anim.mode === 'active' && !anim.restored)
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
    // `cars` is read through `carsRef`, deliberately and not for convenience: as a dependency it tore
    // the whole loop down and rebuilt it every time the array got a fresh identity, which the 1Hz
    // tooltip tick does on its own. The loop's own state lives in refs, so it wants to run undisturbed
    // for the length of the race.
  }, [slotOf, pitSlots, layout, vb, sampleRef, outSign, ldir, lighting, carLit, applyCam])

  // Road paint that belongs to the START rather than to the circuit: the chequered band and the grid
  // boxes. Three fills between them, so as ops they are three draw calls; as elements they were a
  // hundred and sixteen rects being re-rasterised inside the camera's own transform every frame.
  //
  // Handed to the scene as its `overlay`, which paints after the furniture — the same place in the stack
  // the SVG layer draws them, so the two renderers still agree about whether a grandstand's shadow falls
  // across the start line. (It does not.)
  const roadMarkOps = useMemo(() => {
    const { x, y, angle } = layout.start
    // Nudged forward of the path start so the band clears the pole box's crossbar.
    const lead = 1.5 / layout.metresPerUnit
    const at = { x: x + Math.cos(angle) * lead, y: y + Math.sin(angle) * lead, angle }
    return [
      ...startLineOps(at, u),
      // The grid boxes belong to the live view, exactly as the grid marks always did.
      ...(view === 'live' ? gridBoxOps(gridMarks, u) : []),
    ]
  }, [layout.start, layout.metresPerUnit, u, view, gridMarks])

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
  // The ground plane is NOT an op. It used to be a world-sized rect at the bottom of the scene, which
  // meant every frame wrote the whole surface twice — once clearing it, once covering the clear. It is
  // the colour `drawScene` fills the canvas with instead of clearing, so the frame writes it once.
  const trackDrawOps = useMemo((): DrawOp[] => roadOps({
    layout,
    u,
    pitZone,
    lap: lapLine?.for === layout ? lapLine : null,
    ground: scenery.base,
    shadow: shadowFill(lighting),
    inkFull: !inkFlat,
    surfaceInk: SURFACE_INK,
  }), [layout, pitZone, u, lapLine, inkFlat, scenery.base, lighting])
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
  const composeScene = useCallback((cullArg: Cull | null) => {
    if (!(canvasOn && view === 'live')) return null
    // Disc off: compose the whole circuit however little of it is in shot, which is what the renderer
    // did before the disc and what its saving is measured against.
    const cullNow = PERF.cullDisc ? cullArg : null
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
      u, lighting, view: viewAz, ground: !hidden.has('ground'), extrude: EXTRUDE,
      // The whole hidden set, not just the two categories the canvas used to read. Ablating a
      // grandstand used to change the SVG picture and leave the canvas one untouched, so a perf run
      // reported that hiding them cost nothing.
      hide: hidden as ReadonlySet<string>,
      // The detail ladder's input. Bucketed by the scene cache, so this changes the picture at
      // discrete scales rather than continuously as the camera zooms.
      pxPerM: scenePxPerM,
      quality,
      storeyM: 4.6, bayM: 5.4, standFrontM: 1.0, standRearM: 5.5, standRoofFrac: 0.3,
      marshalM: 2.8, marshalW: 4.4, marshalD: 3.2, fenceM: 4,
      solidHeightM: (r) => ('facing' in r ? 5.5 : ((r.storeys ?? 1) * 4.6)),
      // The same disc the SVG solids layer culled to: the canvas walks every op every frame, so a
      // circuit's whole tree population would be path setup for things nowhere near the shot.
      trees: hidden.has('trees') ? [] : visibleTrees(scenery.trees, cullNow),
      cull: cullNow,
      track: trackDrawOps,
      kerbs,
      pitUnder: pitNear ? pitDrawOps.under : [],
      pitOver: pitNear ? pitDrawOps.over : [],
      overlay: roadMarkOps,
    }, marks)
    return { items, marks }
  }, [
    canvasOn, view, scenery, u, lighting, viewAz, hidden, trackDrawOps,
    pitDrawOps, pitDisc, scenePxPerM, quality, roadMarkOps,
  ])
  const sceneRef = useRef<{ items: SceneItem[]; marks: SceneMark[] } | null>(null)
  // On a swap, the old scene keeps painting while the new one's paths parse in the background; the
  // swap lands only when the Path2D cache is warm. Parsing them inside the next paint instead was a
  // 2-3 vsync hitch on every disc move â€” the last dip the benchmark found.
  const warmTokenRef = useRef<{ cancel: () => void } | null>(null)
  // ONE owner of the swap, for both paths. It used to be two, and only the cull path warmed: a
  // render-driven recompose assigned straight to `sceneRef`, so a detail-tier crossing (which is what
  // rebuilds the geometry, so it is exactly the case where the paths are genuinely new) parsed its
  // whole scene inside the very next paint. Measured at 26-226KB of fresh path data per crossing,
  // about one crossing per two wheel notches. That is the hitch this warm exists to prevent, taken on
  // the one path that skipped it.
  // One-shot callback fired the moment a scene actually lands, so the perf lab can wait for the picture
  // it is about to measure rather than guess at a number of frames. Nothing else reads it.
  const swapWatchRef = useRef<(() => void) | null>(null)
  // Scenes landed since the map mounted. The watcher above is a one-shot the lab's settle owns and
  // consumes, which cannot answer "did a scene land on THIS frame" for ninety frames in a row; a tally
  // can, and the run diffs it per frame to put the long frames next to the recomposes.
  const swapTallyRef = useRef(0)
  /** Composes since the map mounted and the main-thread time they took, the warm's slices included.
   *
   *  A third clock, because there were only two and neither of them runs here. Composing rebuilds the
   *  circuit's geometry and the warm parses its paths, both on the main thread and both OUTSIDE any
   *  paint and outside the race loop's tick — so the lab's `busyMs`, which is those two summed, could
   *  not see a millisecond of it. That made the two mitigations paid at compose time (the geometry memo
   *  and the warmed swap) unmeasurable on a vsync-bound shot: they came back "no effect" from a clock
   *  they do not report to, which is the same defect the SVG row already carries a guard for. */
  const composeTallyRef = useRef({ n: 0, ms: 0 })
  const swapped = () => {
    swapTallyRef.current++
    const w = swapWatchRef.current
    swapWatchRef.current = null
    w?.()
  }
  const swapScene = useCallback((next: { items: SceneItem[]; marks: SceneMark[] } | null) => {
    // Whatever else is in flight, this supersedes it. Without that, a zoom notch that both crosses a
    // detail tier and commits a cull step lands a warm holding the scene as it was BEFORE the tier
    // changed, and the picture stays a tier behind until some later cull step happens to recompose
    // it â€” which needs a 30% change in the disc's radius, about two more notches, and a different
    // number of them zooming in than out because the radius goes as 1/zoom. That was the band where
    // the trees were missing on the way in and lingering on the way out.
    warmTokenRef.current?.cancel()
    // Warm off: swap immediately and let the next paint parse whatever is new inside itself, which is
    // the 33-50ms frame this warm was added to remove.
    if (!next || !sceneRef.current || !PERF.warmSwap) {
      // Nothing to keep painting in the meantime, so there is nothing to be gained by waiting.
      sceneRef.current = next
      paintRef.current()
      swapped()
      return
    }
    warmTokenRef.current = warmScene(next.items, () => {
      sceneRef.current = next
      paintRef.current()
      swapped()
    }, (ms) => { composeTallyRef.current.ms += ms })
  }, [])
  useEffect(() => {
    composeSceneRef.current = (cullNow) => {
      // Timed around the geometry build itself. The swap that follows either warms (whose slices report
      // through the callback above) or assigns and paints (which the painter's own tally already sees).
      const t0 = performance.now()
      const next = composeScene(cullNow)
      const tally = composeTallyRef.current
      tally.n++
      tally.ms += performance.now() - t0
      swapScene(next)
    }
    return () => warmTokenRef.current?.cancel()
  }, [composeScene, swapScene])
  // The world changed: a new circuit, a new bearing, a detail tier crossed, a layer toggled, the lap's
  // ink arriving. Composed HERE rather than in a `useMemo` during render, because composing is where
  // the geometry gets rebuilt and that is 8ms on a Grand Prix circuit and 28ms on Monaco â€” work that
  // has no business inside a commit. Declared after the effect above so the ref it calls is already
  // pointing at the current composer.
  useEffect(() => { composeSceneRef.current(cullRef.current) }, [composeScene])
  useEffect(() => { canvasOnRef.current = canvasOn }, [canvasOn])
  // Last frame's paint time by scene section, for the fps readout. Only collected while the
  // readout is up â€” the timing calls are cheap but not free.
  const paintStatsRef = useRef<Record<string, number>>({})
  /** Paints since the map mounted, the section time they logged, and what they put through the
   *  rasteriser. Only the painter can count these, so it does, and the perf lab reads deltas off it
   *  rather than inferring them. */
  const paintTallyRef = useRef({
    n: 0, ms: 0, drawn: 0, skipped: 0, sections: {} as Record<string, number>,
  })
  // True while the perf lab drives the map; keeps paint timing on with the readout closed.
  const benchRef = useRef(false)
  // The race tick's JS cost since the readout last sampled: average and worst frame.
  const tickStatsRef = useRef({ sum: 0, n: 0, max: 0 })
  // The paint lookup's argument, allocated ONCE and mutated per op. `canvasPaint` reads it and keeps
  // nothing, and `drawScene` asks for a paint per gradient- or pattern-filled op — every canopy at the
  // near rung, every stand deck, every roof — so a fresh object and a fresh fallback bounds per lookup
  // was a few hundred throwaway objects a frame.
  const paintCtxRef = useRef<PaintCtx>({
    lighting, u, bounds: { x: 0, y: 0, w: 0, h: 0 }, pxPerUnit: 1,
  })
  // Called from applyCam, so the canvas follows the camera on exactly the frames the world does.
  const paintCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const sc = sceneRef.current
    const ctx = canvas && contextFor(canvas)
    if (!canvas || !ctx) return
    const { w: sw } = stageDimsRef.current
    if (!sc || sw === 0) {
      // Nothing composed yet (the stage has not been measured). The surface is opaque, so it is
      // FILLED with the ground rather than cleared — a clear on an opaque canvas is black, and the
      // one frame before the first real paint would flash it.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = scenery.base
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      return
    }
    const dpr = window.devicePixelRatio || 1
    const timing = hudRef.current || benchRef.current
      ? ({ marks: sc.marks, out: {} } as SceneTiming)
      : undefined
    const pc = paintCtxRef.current
    pc.lighting = lighting
    pc.u = u
    pc.pxPerUnit = camRef.current.z * (sw / vb.w) * dpr
    drawScene(
      ctx, sc.items, camRef.current, vb,
      { w: canvas.width / dpr, h: canvas.height / dpr }, dpr, sw / vb.w,
      (name, c, bbox) => {
        // An op with no bbox resolves its paint against the whole viewBox; only a gradient carries one.
        pc.bounds = bbox ?? vb
        return canvasPaint(name, c, pc) ?? '#FF00FF'
      },
      scenery.base,
      timing,
    )
    if (timing) {
      paintStatsRef.current = timing.out
      // Tallied HERE, by the only thing that knows a paint happened. The lap benchmark used to decide it
      // from the section timers, counting a frame as painted when they summed above zero — which reads
      // a frame whose paint rounded to 0.0 as no paint at all, and reads the frame AFTER a skipped one
      // as a second paint, because the section times are a ref left standing from last time. Both
      // errors land on the same segments: the cheap ones and the still-camera ones.
      const tally = paintTallyRef.current
      tally.n++
      tally.drawn += timing.drawn ?? 0
      tally.skipped += timing.skipped ?? 0
      for (const [k, v] of Object.entries(timing.out)) {
        tally.ms += v
        tally.sections[k] = (tally.sections[k] ?? 0) + v
      }
    }
  }, [vb, lighting, u, scenery.base])
  useEffect(() => { paintRef.current = paintCanvas }, [paintCanvas])
  // The canvas paints when the CAMERA moves, so anything that changes the picture WITHOUT one has to
  // ask. A newly composed scene asks through `swapScene`; what is left is the painter being rebuilt
  // and the STAGE being measured or resized. The stage belongs here rather than with the camera
  // because it is half of pixels-per-metre, and because resizing it clears the canvas's backing
  // store — with a free camera nothing else would ever repaint it. Declared after the ref above so it
  // always calls the current painter, never the previous render's.
  useEffect(() => { applyCam(true) }, [applyCam, paintCanvas, stage.w, stage.h])

  // ── Perf lab ──
  //
  // What replaced the lap benchmark. That one asked a live race to be its clock: one configuration per
  // LAP, boundaries at the followed car crossing the line, so a run cost fifteen laps and only ever
  // ablated LAYERS. It could tell you what the trees cost and it could not tell you whether the Path2D
  // cache was still doing anything.
  //
  // This drives the camera itself along scripted shots for a fixed count of FRAMES, so a cell costs a
  // second and a half instead of a lap, frame 40 of every cell frames the same thing, and the axes
  // include the MITIGATIONS (lib/ui/perf-flags.ts) rather than only the layers. The plan, the
  // arithmetic and the text all live in lib/ui/perf-bench.ts and lib/ui/perf-report.ts; the run loop
  // lives in use-perf-lab.ts. What is left here is the handful of handles a run is allowed to touch.
  // Keyed on the pit disc as well as the circuit: the disc is what the pit-straight shot aims at, and it
  // is rebuilt whenever the garage count changes even though the layout has not.
  const featuresRef = useRef<{
    for: TrackLayout; disc: unknown; cornerF: number; pitF: number
  } | null>(null)
  const perfSavedRef = useRef<{
    hidden: ReadonlySet<string>; canvas: boolean; quality: Quality; presets: Record<Quality, number>
    cap: number; follow: string | null
    cam: { x: number; y: number; z: number; rot: number }; hud: boolean
  } | null>(null)

  const perfWorld = useCallback((): ShotWorld | null => {
    const path = pathRef.current
    const len = lenRef.current
    const { w, h } = stageDimsRef.current
    if (!path || !len || !w) return null
    const at = (f: number) => {
      const p = path.getPointAtLength(((((f % 1) + 1) % 1)) * len)
      return { x: p.x, y: p.y }
    }
    // Found once per circuit and kept: the search walks 360 stations through getPointAtLength, which is
    // not something to repeat between cells of the same run.
    let feat = featuresRef.current
    if (!feat || feat.for !== layout || feat.disc !== pitDisc) {
      feat = { for: layout, disc: pitDisc, ...trackFeatures(at, len, layout.metresPerUnit, pitDisc) }
      featuresRef.current = feat
    }
    return {
      vb, stage: { w, h }, metresPerUnit: layout.metresPerUnit, trackAt: at,
      cornerF: feat.cornerF, pitF: feat.pitF, rot0: defaultRot,
    }
  }, [layout, vb, pitDisc, defaultRot])

  const perfLab = usePerfLab({
    info: () => ({
      circuit: layout.circuitId,
      dpr: window.devicePixelRatio || 1,
      viewport: { w: outerRef.current?.clientWidth ?? 0, h: outerRef.current?.clientHeight ?? 0 },
      cars: cars.length,
    }),
    world: perfWorld,
    setCamera: (cam) => {
      const turned = cam.rot !== camRef.current.rot
      camRef.current = { ...cam }
      applyCam()
      // A bearing only reaches the SOLIDS through `setCamRot`, which the wheel and pointer handlers
      // call once a gesture settles. `applyCam` turns the transform and nothing else, so without this
      // the bearing shot would rotate the picture and never rebuild a single thing that carries
      // height, which is the entire cost it exists to measure.
      if (turned) settleRot()
    },
    applyConfig: (cfg) => {
      setPerfFlags(cfg.flagsOff)
      setHidden(new Set(cfg.hide) as Set<SceneryPiece | 'kerbs' | 'pit' | 'boxes' | 'cars' | 'signs'>)
      setQualityKey(cfg.quality)
      setCanvasOn(cfg.canvas)
    },
    // Compose now, and resolve when the scene that lands is on screen. Bounded, because the warm parses
    // in slices and a cold scene takes as many frames as it takes.
    settle: () => new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        swapWatchRef.current = null
        resolve()
      }
      swapWatchRef.current = finish
      composeSceneRef.current(cullRef.current)
      setTimeout(finish, SETTLE_CAP_MS)
    }),
    timing: (on) => {
      benchRef.current = on
      if (!on) return
      perfSavedRef.current = {
        hidden: hiddenRef.current, canvas: canvasOnRef.current, quality: qualityKey,
        presets: qualityOf, cap: frameCapRef.current, follow: followRef.current,
        cam: { ...camRef.current }, hud,
      }
      // The readout resets the tick stats twice a second, the cap throws frames away, and the follow
      // camera would fight the scripted one for the transform. All three go for the length of a run.
      setHud(false)
      setFrameCap(0)
      // The sliders under the readout move what a preset is WORTH, and a run that inherited a hand-tuned
      // "medium" would report a number nothing else could reproduce. Pinned to the shipped ladder for
      // the run and handed back after.
      setQualityOf({ ...QUALITY })
      followRef.current = null
      onFollow(null)
    },
    paintTally: () => paintTallyRef.current,
    tickTally: () => tickStatsRef.current,
    swapTally: () => swapTallyRef.current,
    composeTally: () => composeTallyRef.current,
    scene: () => {
      const sc = sceneRef.current
      let ops = 0
      let chars = 0
      for (const item of sc?.items ?? []) {
        if (isGroup(item)) {
          ops += item.ops.length
          for (const op of item.ops) chars += op.d.length
        } else {
          ops += 1
          chars += item.d.length
        }
      }
      return {
        items: sc?.items.length ?? 0,
        ops,
        pathKb: chars / 1024,
        nodes: worldRef.current?.querySelectorAll('*').length ?? 0,
      }
    },
    restore: () => {
      const saved = perfSavedRef.current
      if (!saved) return
      perfSavedRef.current = null
      setHidden(new Set(saved.hidden) as Set<SceneryPiece | 'kerbs' | 'pit' | 'boxes' | 'cars' | 'signs'>)
      setCanvasOn(saved.canvas)
      setQualityKey(saved.quality)
      setQualityOf(saved.presets)
      setFrameCap(saved.cap)
      setHud(saved.hud)
      // Both halves, mirroring what `timing` took: the ref is what the render loop reads, and waiting
      // for the prop to round-trip back through its effect leaves a frame following nothing.
      followRef.current = saved.follow
      onFollow(saved.follow)
      camRef.current = { ...saved.cam }
      requestAnimationFrame(() => applyCam(true))
    },
  }, cars.length, openPerfLab)
  // Published after the commit rather than during it: a discarded render must not be able to leave the
  // key listener pointing at a lab that never existed.
  const perfLabRef = useRef(perfLab)
  useEffect(() => {
    perfLabRef.current = perfLab
    labOpenRef.current = perfLab.open
  })
  useEffect(() => {
    benchKeyRef.current = () => perfLabRef.current.setOpen(true)
    labCloseRef.current = () => {
      if (perfLabRef.current.state.phase === 'running') perfLabRef.current.abort()
      else perfLabRef.current.setOpen(false)
    }
  }, [])
  // Unmounting mid-run would otherwise leave the run driving a camera on a dead component for the rest
  // of the plan, and ship the player a renderer with a mitigation switched off and nothing saying so.
  useEffect(() => () => {
    perfLabRef.current.abort()
    resetPerfFlags()
  }, [])

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
  // The garage name boards are the only real TEXT on the map and the only remote artwork on it (the
  // flags), and they stay in the document even when the canvas owns the world, because neither degrades
  // through a `DrawOp`. Memoised for the same reason the pit boxes are: nothing about who is signed
  // above a garage changes during a race, and the map commits at least once a second regardless.
  const signsNode = useMemo(
    () => (pitZone
      ? (
        <PitGarageSigns
          zone={pitZone} u={u} lighting={lighting} view={viewAz}
          drivers={(gi) => garageCars[gi] ?? []} lettered={signsLettered}
        />
      )
      : null),
    [pitZone, u, lighting, viewAz, garageCars, signsLettered],
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
      {hud && (
        <div className="absolute left-2 top-9 z-30 w-56 rounded bg-black/70 px-2 py-2 font-mono text-[11px] text-[#FFFFFF]">
          <div className="flex gap-1">
            {QUALITY_PRESETS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => { setQualityKey(key); requestAnimationFrame(() => applyCam(true)) }}
                className={`flex-1 rounded px-1 py-0.5 ${key === qualityKey ? 'bg-[#2E62C9]' : 'bg-white/15'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {QUALITY_PRESETS.map(({ key, label }) => (
            <label key={key} className="mt-1.5 flex items-center gap-1.5">
              <span className="w-12 shrink-0">{label}</span>
              <input
                type="range" min={0.2} max={4} step={0.05} value={qualityOf[key]}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setQualityOf((prev) => ({ ...prev, [key]: v }))
                  setQualityKey(key)
                  // The gates live in applyCam, which React does not drive; nudge it so the change
                  // shows on this frame rather than on the next camera move.
                  requestAnimationFrame(() => applyCam(true))
                }}
                className="min-w-0 flex-1 accent-[#2E62C9]"
              />
              <span className="w-8 shrink-0 text-right">{qualityOf[key].toFixed(2)}</span>
            </label>
          ))}
        </div>
      )}
      <PerfLabModal lab={perfLab} />
      {/* On the OUTER box, not the stage: the stage letterboxes to the viewBox's aspect, and a canvas
          clipped to it stops painting at the stage edge â€” the world visibly ended there under zoom.
          The SVG never had the problem because its overflow is visible. Stage centre and viewport
          centre coincide, so the camera transform is the same either way. */}
      {canvasOn && view === 'live' && (
        <SceneryCanvas
          canvasRef={canvasRef}
          className="absolute inset-0"
          // A resize clears the backing store, and nothing else would repaint it: the paint effect
          // watches the scene, and the camera has not moved. With a free camera (collapse the
          // standings panel without following a car) the world simply stayed blank.
          onResize={() => applyCam(true)}
        />
      )}
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
  <path d={layout.pit.fastD} fill="none" stroke="#D8D8D2" strokeWidth={u(LANE_WIDTH_M)} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {pitZone && !canvasOn && <path d={pitZone.work} fill="#D8D8D2" stroke="#D8D8D2" strokeWidth={u(2 * LANE_LINE_M)} strokeLinejoin="round" />}
            {!canvasOn && (
  <path d={layout.d} fill="none" stroke="#33383E" strokeWidth={u(TARMAC_WIDTH_M)} strokeLinejoin="round" />
            )}
            {!canvasOn && (
  <path d={layout.pit.fastD} fill="none" stroke="#33383E" strokeWidth={u(LANE_TARMAC_M)} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {pitZone && !canvasOn && <path d={pitZone.work} fill="#33383E" />}
            {/* Pit lane: an asphalt ribbon with painted edge lines, pit-box slots, and the wall. */}
            <path ref={pitPathRef} d={layout.pit.d} fill="none" stroke="none" />
            {/* Pit building first (under everything on the apron side), then paint: the fast lane's
                track-side line, entry/exit guide lines reaching onto the track, the whiteâ€“blueâ€“white
                working-lane stripe ONLY along the box zone, and the limiter lines bounding it. */}
            {pitZone && !hidden.has('pit') && !canvasOn && <PitBuildingShadow zone={pitZone} u={u} lighting={lighting} />}
            {pitZone && !hidden.has('pit') && !canvasOn && <PitBuilding zone={pitZone} u={u} lighting={lighting} view={viewAz} garageColor={(gi) => slotOf.colors[gi]} />}
            {!hidden.has('pit') && !hidden.has('signs') && signsNode}
            {pitZone && !canvasOn && (
              <g>
                <path d={pitZone.sep} fill="none" stroke="#F2F2F2" strokeWidth={u(0.6)} strokeLinecap="round" />
                <path d={pitZone.sep} fill="none" stroke="#2E62C9" strokeWidth={u(0.34)} strokeLinecap="round" />
                <path d={linePath(pitZone.limiterIn)} stroke="#F2F2F2" strokeWidth={u(0.35)} strokeLinecap="butt" />
                <path d={linePath(pitZone.limiterOut)} stroke="#F2F2F2" strokeWidth={u(0.35)} strokeLinecap="butt" />
              </g>
            )}
            </g>
            {bitmap?.map((t) => (
              <image key={t.url} href={t.url} x={t.x} y={t.y} width={t.w} height={t.h} />
            ))}
            <g data-cost="boxes" style={{ display: hidden.has('boxes') ? 'none' : undefined }}>
            <PitBoxes slots={pitSlots} u={u} colors={slotOf.colors} lighting={lighting} refs={pitBoxRefs} />
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
            {/* The start/finish chequer and the grid boxes. As paths off the shared description, so
                the canvas and this layer cannot disagree about them; drawn here only when the canvas
                is not the one drawing them. */}
            {(!canvasOn || view === 'map') && roadMarkOps.map((op, i) => (
              <path key={`rm${i}`} d={op.d} fill={op.fill} />
            ))}
            {/* Invisible: the computed racing line the cars actually drive (sampled per frame). */}
            <path ref={raceLineRef} fill="none" stroke="none" />
          </svg>
          <div data-cost="cars" className={hidden.has('cars') ? 'hidden' : 'contents'}>{cars.map((car) => (
            <div
              key={car.id}
              ref={markerRef(car.id)}
              className="absolute left-0 top-0"
              style={{ opacity: car.retired ? 0.35 : 1 }}
            >
              {(() => {
                {/* Tooltip + click on the sprite ONLY â€” its exact rendered footprint, no hover halo. */}
                const sprite = (
                  <div
                    ref={spriteRef(car.id, view)}
                    onClick={() => clickCar(car.id)}
                    className="cursor-pointer"
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
                      <CarSprite id={car.id} color={car.color} length={carL} compound={car.compound} light={carLit} />
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
  p.openPerfLab === n.openPerfLab &&
  (p.pinnedCard == null) === (n.pinnedCard == null) &&
  sameCars(p.cars, n.cars, (n.view ?? 'live') === 'map'),
)
