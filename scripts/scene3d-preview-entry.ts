// Browser half of the 3D preview probe (#3d-port): esbuild bundles this into a static HTML page.
// Two modes share one scene builder:
//
//  - ?shot=1: the headless path the node half rasterises. Fixed canvas sized like the 2D preview's
//    stills, one render, `__done` when the pixels are ready. Nothing interactive.
//  - opened from disk: the viewer. Circuit and mood pickers, Top/Tilt camera resets, orbit controls,
//    window-fitted and resizable, scenes rebuilt in place.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TRACK_LAYOUTS, type TrackLayout } from '../src/data/tracks'
import { CAR_LENGTH_M, CAR_SCALE, SPRITE } from '../src/lib/ui/car-sprite'
import { PREVIEW_LIVERIES, carField } from '../src/lib/ui/car-field'
import { CAR_RIDE_M, CarField3D } from '../src/lib/scene3d/car-field3d'
import { PitCrew3D } from '../src/lib/scene3d/crew3d'
import { buildGarageSigns3D } from '../src/lib/scene3d/signs3d'
import { TRACK_WIDTH_M } from '../src/lib/ui/track-path'
import { gridBoxOps } from '../src/lib/ui/road-marks'
import type { DrawOp } from '../src/lib/ui/scenery-draw'
import { buildScenery } from '../src/lib/ui/track-scenery'
import { buildPitSlots, buildPitZone } from '../src/lib/ui/pit-zone'
import { roadLap, solveLap } from '../src/lib/ui/lap-solve'
import { MOODS, type Mood } from '../src/lib/ui/lighting'
import {
  applyOrbitCam, frameOrtho, parseViewBox, type OrbitCam, type ViewBox3D,
} from '../src/lib/scene3d/camera3d'
import { balanceAmbient, refitShadow } from '../src/lib/scene3d/lighting3d'
import {
  applyToneMapping, buildSky, refitFog, skySeedFor, type SkyEnv,
} from '../src/lib/scene3d/sky3d'
import { bakeWorldEnv, type WorldEnv } from '../src/lib/scene3d/env3d'
import { buildWorldTextures } from '../src/lib/scene3d/textures3d'
import { buildWorldDetail } from '../src/lib/scene3d/detail3d'
import { buildPost } from '../src/lib/scene3d/post3d'
import { buildWorld3D, type World3D } from '../src/lib/scene3d/world3d'
import { loadTreePack, type TreePack } from '../src/lib/scene3d/treepack3d'
import { loadStandSkin, type StandSkin } from '../src/lib/scene3d/standtex3d'

/** The probe runs off file://, where `public/` is not a served root; the .glb is addressed relative
 *  to the written page instead, and the node half copies it in beside the viewer. */
const PACK_URLS = { broadleaf: 'trees.glb', conifer: 'low_poly_forest_tree_pack.glb' }

/** Loaded once before any scene is built, and read by every `buildScene`. */
let treePack: TreePack | null = null
/** The scanned materials, packed into the page by the node half. Null leaves the ground on its flat
 *  biome fill, which is what the world looked like before it had a surface. */
let standSkin: StandSkin | null = null

declare global {
  interface Window {
    __done?: boolean
    __error?: string
    /** Scanned maps as data: URIs. A page on file:// is its own origin, so a file:// image is
     *  cross-origin data WebGL refuses to upload; inlining is the only way in. */
    __standTex?: Record<string, string>
    __stats?: {
      meshes: number; triangles: number; w: number; h: number
      /** The baked sky's horizon radiance, already scaled: the number to tune `SKY_INTENSITY` on,
       *  because a sky that clips to white and a sky that is genuinely bright look identical. */
      horizon?: [number, number, number]
      /** The haze's near and far, in world units. */
      fogSpan?: [number, number]
    }
    /** Debug handles: the scene is data, and being able to poke it from the console or a probe's
     *  `evaluate` is the whole reason the viewer exists. */
    __scene?: THREE.Scene
    __camera?: THREE.Camera
    __THREE?: typeof THREE
    __renderer?: THREE.WebGLRenderer
    /** The output chain the shot was composited through, so a probe can re-run it after poking the
     *  scene and compare it against a straight `renderer.render`. */
    __post?: { render(): void }
    /** Re-drive the eye shot's orbit camera: the live `paint`'s camera, shadow and fog work, so a
     *  probe can sweep viewpoints over one built circuit. */
    __orbit?: (next: Partial<OrbitCam>, size?: { w: number; h: number }) => void
    /** The padded whole-circuit box the orbit's target is addressed in. */
    __full?: ViewBox3D
    /** The circuit's scale, so a probe can convert the map's zoom scalar into the px/m the live
     *  view's own readout shows and quote a viewpoint in the numbers the report came with. */
    __mpu?: number
    /** Where the front row parks, so a probe can point at the grid without hunting for it. */
    __gridAt?: { x: number; z: number } | null
    /** Both baked environments, mountable one against the other: the sky alone, and the world shot
     *  in front of it. What a probe needs to answer whether swapping them moved the LIGHT, which is
     *  a separate question from whether the reflections got better. */
    __envs?: {
      sky: THREE.Texture | null
      skyIntensity: number
      probe: THREE.Texture | null
      probeIntensity: number
    }
  }
}

const q = new URLSearchParams(location.search)
// The tiles and the surface grain are static; one set serves every rebuild.
const textures = buildWorldTextures()
const detail = buildWorldDetail()

interface BuiltScene {
  scene: THREE.Scene
  layout: TrackLayout
  /** The padded whole-circuit box, the framing every shot and the viewer's resets share. */
  full: ViewBox3D
  /** The world as built, for everything the live canvas reads off it after the fact: the sun's
   *  shadow box, the wood's tiers, the ground the haze stops at, the reflection probe's stand. */
  world: World3D
  stats: { meshes: number; triangles: number }
}

/** The START's road paint, exactly as `RaceTrackMap` derives it: boxes read off the SAME path
 *  element and the same arc formula the car frames use. Handed to the world as its `overlay`, which
 *  is the one input the probe's scene was missing against the live one. */
function gridOverlayOps(layout: TrackLayout, n: number): DrawOp[] {
  if (n <= 0) return []
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', layout.d)
  const total = path.getTotalLength()
  const uw = (m: number) => m / layout.metresPerUnit
  const boxes = Array.from({ length: n }, (_, i) => {
    const back = uw(3 + i * 8)
    const dist = (((total - back) % total) + total) % total
    const pt = path.getPointAtLength(dist)
    const ahead = path.getPointAtLength((dist + uw(8)) % total)
    const rot = Math.atan2(ahead.y - pt.y, ahead.x - pt.x)
    const lat = uw(1.7) * (i % 2 === 0 ? 1 : -1)
    return {
      x: pt.x - Math.sin(rot) * lat,
      y: pt.y + Math.cos(rot) * lat,
      deg: (rot * 180) / Math.PI,
    }
  })
  return gridBoxOps(boxes, uw)
}

/** Where the pole box sits, for a probe that wants to look at the grid. */
function gridAt(layout: TrackLayout, n: number): { x: number; z: number } | null {
  if (n <= 0) return null
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', layout.d)
  const total = path.getTotalLength()
  const back = 3 / layout.metresPerUnit
  const pt = path.getPointAtLength((((total - back) % total) + total) % total)
  return { x: pt.x, z: pt.y }
}

/** What a scene is submitting RIGHT NOW: instanced draws are counted at their live `count`, which is
 *  the whole point here, since the wood's tiers repack as the camera moves. */
function countScene(scene: THREE.Object3D): { meshes: number; triangles: number } {
  let meshes = 0
  let triangles = 0
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    meshes++
    const g = o.geometry as THREE.BufferGeometry
    const per = (g.index ? g.index.count : g.attributes.position.count) / 3
    triangles += o instanceof THREE.InstancedMesh ? per * o.count : per
  })
  return { meshes, triangles: Math.round(triangles) }
}

function buildScene(id: string, moodName: string, frame?: ViewBox3D): BuiltScene {
  const layout = TRACK_LAYOUTS[id]
  if (!layout) throw new Error(`no such layout: ${id}`)
  const mpu = layout.metresPerUnit
  const scenery = buildScenery(layout.trace, layout.pit, {
    circuitId: layout.circuitId,
    metresPerUnit: mpu,
    viewBox: layout.viewBox,
    pitOutside: layout.pitOutside,
    biome: layout.biome,
    terrainDetail: false,
  })
  const pitSlots = buildPitSlots(layout, 10)
  const pitZone = buildPitZone(layout, pitSlots)
  // The mood's own sun, NOT the 2D preview's pit-straight override. That override chained the light
  // to the oblique extrusion bearing, which threw every shadow up-screen; real shadows tucked behind
  // their own casters from the tilted camera. In 3D the lean is gone and the light stands alone:
  // sun up-and-left, shadows down-right, visible from straight above and from the diorama tilt.
  const lighting = MOODS[moodName as Mood] ?? MOODS.afternoon
  const full = parseViewBox(layout.viewBox, TRACK_WIDTH_M / mpu / 2 + 8)
  const world = buildWorld3D({
    layout, scenery, pitZone, pitSlots, lap: roadLap(solveLap(layout)), lighting,
    textures, detail, frame: frame ?? full,
    // The live view's grid paint. Absent from this probe until it turned out to be the one thing
    // the live scene builds and this one did not.
    overlay: gridOverlayOps(layout, Number(q.get('grid') ?? '0')),
    night: moodName === 'night',
    treePack,
    standSkin,
    // The same stand-in names the 2D preview letters its boards with.
    extras: () => (pitZone
      ? [buildGarageSigns3D(pitZone, (m) => m / mpu, () => [
        { name: 'Kimi Raikkonen', nationality: 'FI' },
        { name: 'Felipe Massa', nationality: 'BR' },
      ])]
      : []),
  })
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(scenery.base)
  scene.add(world.group)
  // The pit boxes and their (hidden) crews, exactly as the live map mounts them, so the furniture
  // is inspectable here. Flips derived from the drawn lane the same way the map measures them.
  const crew = new PitCrew3D({
    slots: pitSlots, u: (m) => m / mpu, colors: pitSlots.map(() => '#9AA3B2'),
    carScale: CAR_LENGTH_M * CAR_SCALE / mpu / SPRITE.len, rideY: CAR_RIDE_M / mpu,
  })
  pitSlots.forEach((slot, si) => {
    let best = layout.pit.fastPts[0]
    let bestD = Infinity
    for (const p of layout.pit.fastPts) {
      const d = (p.x - slot.x) ** 2 + (p.y - slot.y) ** 2
      if (d < bestD) { bestD = d; best = p }
    }
    const yLocal = -Math.sin(slot.rot) * (best.x - slot.x) + Math.cos(slot.rot) * (best.y - slot.y)
    crew.setFlip(si, yLocal > 0 ? -1 : 1)
  })
  scene.add(crew.group)
  return { scene, layout, full, world, stats: world.stats }
}

/** The live car field, strung round the racing line: the SAME `CarField3D` the map mounts, so what
 *  this probe shoots is what the race view renders. The impostor stopgap retired with the loft. */
function carMeshes(
  layout: TrackLayout, n: number, near?: { x: number; z: number },
): { group: THREE.Group; focus: { x: number; z: number } | null } {
  const field = new CarField3D(
    CAR_LENGTH_M * CAR_SCALE / layout.metresPerUnit / SPRITE.len,
    CAR_RIDE_M / layout.metresPerUnit,
  )
  // `carField` strings its cars at even fractions of the lap, so at any useful zoom the odds of one
  // landing in shot are poor: twenty cars round Silverstone sit 300m apart. Given a point to look
  // near, oversample the lap and keep the cars closest to it, which puts a field under the camera
  // wherever it is pointed. This is a probe: what matters is being able to SEE the thing.
  const placed = near
    ? carField(layout, 400)
      .sort((a, b) => (a.x - near.x) ** 2 + (a.y - near.z) ** 2
        - ((b.x - near.x) ** 2 + (b.y - near.z) ** 2))
      .slice(0, n)
    : carField(layout, n)
  placed.forEach((car, i) => {
    const id = `p${i}`
    field.ensure(id, PREVIEW_LIVERIES[i % PREVIEW_LIVERIES.length])
    field.pose(id, {
      x: car.x, y: car.y, rot: car.rot,
      steerLeft: car.steer.left, steerRight: car.steer.right,
      lat: car.lat, long: car.long, ds: 0,
    })
  })
  return {
    group: field.group,
    focus: placed.length ? { x: placed[0].x, z: placed[0].y } : null,
  }
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      ;(o.geometry as THREE.BufferGeometry).dispose()
      const m = o.material
      for (const mat of Array.isArray(m) ? m : [m]) mat.dispose()
    }
  })
}

const canvas = document.getElementById('gl') as HTMLCanvasElement

/** The one renderer setup, shared by both shot paths and the viewer, so the probe can never drift
 *  from itself on a look decision that lives on the renderer rather than in the scene. */
function makeRenderer(preserve = false): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: preserve })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  applyToneMapping(renderer)
  window.__renderer = renderer
  window.__THREE = THREE
  return renderer
}

/** Hang the mood's sky behind a built scene, with the haze that joins it to the ground, then shoot
 *  the world's own reflection probe off it. Called after the renderer exists, because baking either
 *  one is a render. Mirrors `Scene3DCanvas` exactly, including the fallback: no sky bakeable, flat
 *  ground colour, still a picture. */
function dressSky(
  built: BuiltScene, moodName: string, cars?: THREE.Object3D | null,
): Array<SkyEnv | WorldEnv> {
  const lighting = MOODS[moodName as Mood] ?? MOODS.afternoon
  let env: SkyEnv | null = null
  try {
    env = buildSky(window.__renderer!, lighting, {
      night: moodName === 'night', seed: skySeedFor(built.layout.circuitId),
    })
  } catch (err) {
    console.warn(`sky bake failed, falling back to the flat clear: ${String(err)}`)
  }
  if (env) {
    built.scene.background = env.texture
    built.scene.backgroundIntensity = env.intensity
    built.scene.environment = env.environment
    built.scene.environmentIntensity = env.lightIntensity
    built.scene.fog = new THREE.Fog(env.horizon, 1, 2)
  }
  balanceAmbient(built.world.sky, !!env?.lightsScene)
  built.world.trees.update(built.world.probe)
  const probe = bakeWorldEnv(window.__renderer!, built.scene, {
    at: built.world.probe, ground: built.world.ground, hide: [cars],
  })
  if (probe) {
    built.scene.environment = probe.environment
    built.scene.environmentIntensity = probe.intensity
  }
  window.__envs = {
    sky: env?.environment ?? null,
    skyIntensity: env?.lightIntensity ?? 1,
    probe: probe?.environment ?? null,
    probeIntensity: probe?.intensity ?? 1,
  }
  return [env, probe].filter((e): e is SkyEnv | WorldEnv => !!e)
}

/** The haze actually in force, for the probe's console line. */
function horizonOf(built: BuiltScene): [number, number, number] | undefined {
  const { fog } = built.scene
  return fog instanceof THREE.Fog ? [fog.color.r, fog.color.g, fog.color.b] : undefined
}

/** Where the haze ramps, for the probe's console line: the numbers to read when the horizon still
 *  has a seam on it, because a fog that is present and a fog that is fitted past the world look the
 *  same from here. */
function fogSpanOf(built: BuiltScene): [number, number] | undefined {
  const { fog } = built.scene
  return fog instanceof THREE.Fog ? [fog.near, fog.far] : undefined
}

/** Refit the haze to the shot, as the live canvas refits it per paint, against the world's own
 *  ground plane. */
function fitFog(built: BuiltScene, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
  if (!(built.scene.fog instanceof THREE.Fog)) return
  refitFog(built.scene.fog, camera, built.world.ground)
}

/** The pitched shot: the map's OWN orbit camera, driven by the same `applyOrbitCam` the live canvas
 *  drives, so a horizon shot is the player's horizon and not a projection only the probe can make.
 *  The ortho shots above cannot show one at all: orthographic ground fills the frame at every tilt. */
async function eyeShot() {
  document.body.classList.add('shot')
  const id = q.get('id') ?? 'britain'
  const layout = TRACK_LAYOUTS[id]
  if (!layout) throw new Error(`no such layout: ${id}`)
  const w = Number(q.get('w') ?? '1600')
  const h = Number(q.get('h') ?? '900')
  const full = parseViewBox(layout.viewBox, TRACK_WIDTH_M / layout.metresPerUnit / 2 + 8)
  const [cxf, cyf] = (q.get('at') ?? '0.5,0.5').split(',').map(Number)
  const cam: OrbitCam = {
    tx: full.x + full.w * cxf,
    tz: full.y + full.h * cyf,
    rot: (Number(q.get('rot') ?? '0') * Math.PI) / 180,
    pitch: (Number(q.get('pitch') ?? '0') * Math.PI) / 180,
    z: Number(q.get('ez') ?? '20'),
  }
  const built = buildScene(id, q.get('mood') ?? 'afternoon', full)
  const cars = Number(q.get('cars') ?? '0')
  let carsGroup: THREE.Group | null = null
  if (cars > 0) {
    const field = carMeshes(layout, cars, { x: cam.tx, z: cam.tz })
    carsGroup = field.group
    built.scene.add(field.group)
    // Look AT a car, not at the fraction of the viewBox that happened to be asked for. Cars sit on
    // the racing line at whatever spacing the field gives them, and hunting one down by nudging
    // `--at` is a waste of a probe: if the shot was asked for with cars in it, centre one.
    if (field.focus) {
      cam.tx = field.focus.x
      cam.tz = field.focus.z
    }
  }

  const renderer = makeRenderer(true)
  renderer.setPixelRatio(1)
  renderer.setSize(w, h, false)
  dressSky(built, q.get('mood') ?? 'afternoon', carsGroup)

  const camera = new THREE.PerspectiveCamera()
  // `ppu` is the stage's pixels per viewBox unit at zoom 1, exactly as `RaceTrackMap` computes it.
  const frame = applyOrbitCam(camera, cam, { w, h }, w / full.w)
  const half = Math.hypot(frame.halfW, frame.halfH)
  refitShadow(built.world.sun, { x: frame.cx - half, y: frame.cz - half, w: 2 * half, h: 2 * half })
  built.world.trees.update(camera.position)
  fitFog(built, camera)
  const post = buildPost(renderer, built.scene, camera, 1 / layout.metresPerUnit)
  post.setSize(w, h, 1)
  post.render()
  window.__post = post

  // The whole orbit, re-drivable from a probe: same `applyOrbitCam`, same shadow refit, same fog
  // refit, i.e. everything `Scene3DCanvas.paint` does per camera move. A probe hunting an artifact
  // has to sweep viewpoints, and rebuilding the circuit for each one costs seconds apiece.
  window.__orbit = (next, size) => {
    Object.assign(cam, next)
    const vw = size?.w ?? renderer.domElement.width / renderer.getPixelRatio()
    const vh = size?.h ?? renderer.domElement.height / renderer.getPixelRatio()
    const f = applyOrbitCam(camera, cam, { w: vw, h: vh }, vw / full.w)
    const r = Math.hypot(f.halfW, f.halfH)
    refitShadow(built.world.sun, { x: f.cx - r, y: f.cz - r, w: 2 * r, h: 2 * r })
    built.world.trees.update(camera.position)
    fitFog(built, camera)
  }
  window.__full = full
  window.__mpu = layout.metresPerUnit
  window.__gridAt = gridAt(layout, Number(q.get('grid') ?? '0'))

  // Re-counted AFTER the orbit has repacked the wood's detail tiers. `built.stats` is taken at build
  // time, when the tree tiers are still on their placeholder split, so it says nothing about what
  // this shot actually submits — and the tree band is exactly the knob that number has to answer for.
  window.__stats = {
    ...countScene(built.scene), w, h, horizon: horizonOf(built), fogSpan: fogSpanOf(built),
  }
  window.__scene = built.scene
  window.__camera = camera
}

/** The headless path: everything the node probe's screenshots depend on, unchanged. */
async function shotMain() {
  document.body.classList.add('shot')
  const id = q.get('id') ?? 'britain'
  const tilt = Number(q.get('tilt') ?? '0')
  const zoom = Number(q.get('zoom') ?? '1')
  const [cxf, cyf] = (q.get('at') ?? '0.5,0.5').split(',').map(Number)
  const layout = TRACK_LAYOUTS[id]
  if (!layout) throw new Error(`no such layout: ${id}`)
  // Same pad, crop convention and output width as the 2D preview, so the stills sit side by side.
  const full = parseViewBox(layout.viewBox, TRACK_WIDTH_M / layout.metresPerUnit / 2 + 8)
  const vb = zoom > 1
    ? {
      x: full.x + full.w * cxf - full.w / zoom / 2, y: full.y + full.h * cyf - full.h / zoom / 2,
      w: full.w / zoom, h: full.h / zoom,
    }
    : full
  const w = Math.round(Math.max(vb.w * 2, 900))
  const h = Math.round((w * vb.h) / vb.w)

  // Built after the crop is known, so the sun's shadow map is fitted to what is in shot.
  const built = buildScene(id, q.get('mood') ?? 'afternoon', vb)
  const cars = Number(q.get('cars') ?? '0')
  const carsGroup = cars > 0 ? carMeshes(layout, cars).group : null
  if (carsGroup) built.scene.add(carsGroup)
  const camera = frameOrtho(vb, tilt)
  const renderer = makeRenderer(true)
  renderer.setPixelRatio(1)
  renderer.setSize(w, h, false)
  dressSky(built, q.get('mood') ?? 'afternoon', carsGroup)
  fitFog(built, camera)
  const post = buildPost(renderer, built.scene, camera, 1 / layout.metresPerUnit)
  post.setSize(w, h, 1)
  post.render()
  window.__post = post

  window.__stats = { ...built.stats, w, h, horizon: horizonOf(built), fogSpan: fogSpanOf(built) }
  window.__scene = built.scene
  window.__camera = camera
}

/** The viewer: the same world, hand-orbitable, rebuilt in place from the bar's pickers. */
function viewerMain() {
  const circuitSel = document.getElementById('circuit') as HTMLSelectElement
  const moodSel = document.getElementById('mood') as HTMLSelectElement
  const topBtn = document.getElementById('top') as HTMLButtonElement
  const tiltBtn = document.getElementById('tilt') as HTMLButtonElement
  const stat = document.getElementById('stat') as HTMLSpanElement

  for (const id of Object.keys(TRACK_LAYOUTS).sort()) {
    circuitSel.add(new Option(id[0].toUpperCase() + id.slice(1), id))
  }
  for (const mood of Object.keys(MOODS)) {
    moodSel.add(new Option(mood[0].toUpperCase() + mood.slice(1), mood))
  }
  circuitSel.value = q.get('id') && TRACK_LAYOUTS[q.get('id')!] ? q.get('id')! : 'britain'
  moodSel.value = (q.get('mood') ?? 'afternoon') in MOODS ? q.get('mood') ?? 'afternoon' : 'afternoon'

  const renderer = makeRenderer()
  renderer.setPixelRatio(window.devicePixelRatio)

  let built: BuiltScene | null = null
  let baked: Array<SkyEnv | WorldEnv> = []
  let camera: THREE.OrthographicCamera | null = null
  let controls: OrbitControls | null = null
  const aspect = () => window.innerWidth / window.innerHeight
  const render = () => {
    if (!built || !camera) return
    fitFog(built, camera)
    renderer.render(built.scene, camera)
  }

  const setCamera = (tiltDeg: number) => {
    if (!built) return
    camera = frameOrtho(built.full, tiltDeg, aspect())
    window.__camera = camera
    controls?.dispose()
    controls = new OrbitControls(camera, canvas)
    controls.addEventListener('change', render)
    render()
  }

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, true)
    if (!built || !camera) return
    // Refit the frustum to the new aspect without touching the orbit.
    const fit = frameOrtho(built.full, 0, aspect())
    camera.left = fit.left
    camera.right = fit.right
    camera.top = fit.top
    camera.bottom = fit.bottom
    camera.updateProjectionMatrix()
    render()
  }

  const rebuild = () => {
    const id = circuitSel.value
    const mood = moodSel.value
    circuitSel.disabled = true
    moodSel.disabled = true
    stat.textContent = 'building'
    // Yield a frame so the disabled state paints before the synchronous solve blocks the thread.
    requestAnimationFrame(() => setTimeout(() => {
      if (built) disposeScene(built.scene)
      for (const b of baked) b.dispose()
      built = buildScene(id, mood)
      baked = dressSky(built, mood)
      window.__scene = built.scene
      document.title = `scene3d ${id}`
      try {
        history.replaceState(null, '', `?id=${id}&mood=${mood}`)
      } catch {
        // file:// may refuse; the picker state is the same truth.
      }
      stat.textContent = `${built.stats.meshes} meshes, ${Math.round(built.stats.triangles / 1000)}k triangles`
      circuitSel.disabled = false
      moodSel.disabled = false
      setCamera(24)
    }, 20))
  }

  circuitSel.addEventListener('change', rebuild)
  moodSel.addEventListener('change', rebuild)
  topBtn.addEventListener('click', () => setCamera(0))
  tiltBtn.addEventListener('click', () => setCamera(24))
  window.addEventListener('resize', resize)

  renderer.setSize(window.innerWidth, window.innerHeight, true)
  rebuild()
}

;(async () => {
  try {
    // Before ANY scene is built: the pack is what the wood is made of, and a world built without it
    // falls back to the old spheres. The live canvas can afford to build twice and swap; a probe
    // shooting one frame cannot.
    treePack = await loadTreePack(PACK_URLS).catch(() => null)
    // Same reasoning as the pack: the ground is skinned at build time, so the maps have to be in
    // hand before the first scene rather than swapped in after it.
    standSkin = await loadStandSkin('tex/', window.__standTex).catch(() => null)
    if (q.has('shot')) await (q.has('pitch') ? eyeShot() : shotMain())
    else viewerMain()
  } catch (err) {
    window.__error = err instanceof Error ? (err.stack ?? err.message) : String(err)
  }
  window.__done = true
})()
