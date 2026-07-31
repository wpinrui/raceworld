// Browser half of the 3D preview probe (#3d-port): esbuild bundles this into a static HTML page.
// Two modes share one scene builder:
//
//  - ?shot=1: the headless path the node half rasterises. Fixed canvas sized like the 2D preview's
//    stills, one render, `__done` when the pixels are ready. Nothing interactive.
//  - opened from disk: the viewer. Circuit and mood pickers, Top/Tilt camera resets, orbit controls,
//    window-fitted and resizable, scenes rebuilt in place.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TRACK_LAYOUTS, type TrackLayout } from '../src/data/tracks'
import { CarSprite } from '../src/components/race/CarSprite'
import { CAR_LENGTH_M, CAR_SCALE, SPRITE, carLight } from '../src/lib/ui/car-sprite'
import { PREVIEW_LIVERIES, carField } from '../src/lib/ui/car-field'
import { TRACK_WIDTH_M } from '../src/lib/ui/track-path'
import { buildScenery } from '../src/lib/ui/track-scenery'
import { buildPitSlots, buildPitZone } from '../src/lib/ui/pit-zone'
import { roadLap, solveLap } from '../src/lib/ui/lap-solve'
import { MOODS, type Mood } from '../src/lib/ui/lighting'
import { frameOrtho, parseViewBox, type ViewBox3D } from '../src/lib/scene3d/camera3d'
import { buildWorldTextures } from '../src/lib/scene3d/textures3d'
import { buildWorld3D } from '../src/lib/scene3d/world3d'

declare global {
  interface Window {
    __done?: boolean
    __error?: string
    __stats?: { meshes: number; triangles: number; w: number; h: number }
    /** Debug handles: the scene is data, and being able to poke it from the console or a probe's
     *  `evaluate` is the whole reason the viewer exists. */
    __scene?: THREE.Scene
    __camera?: THREE.Camera
    __THREE?: typeof THREE
    __renderer?: THREE.WebGLRenderer
  }
}

const q = new URLSearchParams(location.search)
// The tiles are static; one set serves every rebuild.
const textures = buildWorldTextures()

interface BuiltScene {
  scene: THREE.Scene
  layout: TrackLayout
  /** The padded whole-circuit box, the framing every shot and the viewer's resets share. */
  full: ViewBox3D
  stats: { meshes: number; triangles: number }
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
    textures, frame: frame ?? full,
  })
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(scenery.base)
  scene.add(world.group)
  return { scene, layout, full, stats: world.stats }
}

/** Sprite padding for the impostor bake, in sprite units: the contact shadow's soft tail reaches
 *  past the artwork's own viewBox and clipping it is exactly the bug the 2D preview un-wraps its
 *  sprites to avoid. */
const IMPOSTOR_PAD = 40

/** The existing 2D sprites, baked to textures on flat quads: increment 4's stopgap so the world is
 *  raceable before the real car mesh lands. Identical pixels to the map's own cars at top-down. */
async function carImpostors(
  layout: TrackLayout, moodName: string, n: number,
): Promise<THREE.Group> {
  const lighting = MOODS[moodName as Mood] ?? MOODS.afternoon
  const light = carLight(lighting)
  const u = (m: number) => m / layout.metresPerUnit
  const scale = u(CAR_LENGTH_M * CAR_SCALE) / SPRITE.len
  const [vx, vy, vw, vh] = SPRITE.viewBox.split(' ').map(Number)
  const box = { x: vx - IMPOSTOR_PAD, y: vy - IMPOSTOR_PAD, w: vw + 2 * IMPOSTOR_PAD, h: vh + 2 * IMPOSTOR_PAD }
  const group = new THREE.Group()
  await Promise.all(carField(layout, n).map(async (car, i) => {
    const sprite = renderToStaticMarkup(createElement(CarSprite, {
      id: `p${i}`, color: PREVIEW_LIVERIES[i % PREVIEW_LIVERIES.length], length: SPRITE.len, light,
      spriteRot: car.rot, attitude: car.attitude, steer: car.steer,
    }))
    const body = sprite.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" `
      + `width="${box.w}" height="${box.h}">${body}</svg>`
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('impostor rasterise failed'))
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    })
    const bake = document.createElement('canvas')
    bake.width = box.w
    bake.height = box.h
    bake.getContext('2d')!.drawImage(image, 0, 0)
    const texture = new THREE.CanvasTexture(bake)
    texture.colorSpace = THREE.SRGBColorSpace
    const geo = new THREE.PlaneGeometry(box.w * scale, box.h * scale)
    geo.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }))
    // The padded box is centred on the sprite's own pivot, so placing the quad's centre at the car
    // places the car. The lift clears the WHOLE painter stack: the marks layer tops out at 0.52m of
    // lift, and an impostor a hair below any layer loses the depth test to it and vanishes.
    mesh.position.set(car.x, u(0.6), car.y)
    mesh.rotation.y = -car.rot
    mesh.renderOrder = 2000
    group.add(mesh)
  }))
  return group
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
  if (cars > 0) built.scene.add(await carImpostors(layout, q.get('mood') ?? 'afternoon', cars))
  const camera = frameOrtho(vb, tilt)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(1)
  renderer.setSize(w, h, false)
  renderer.render(built.scene, camera)

  window.__stats = { ...built.stats, w, h }
  window.__scene = built.scene
  window.__camera = camera
  window.__THREE = THREE
  window.__renderer = renderer
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

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(window.devicePixelRatio)
  window.__renderer = renderer
  window.__THREE = THREE

  let built: BuiltScene | null = null
  let camera: THREE.OrthographicCamera | null = null
  let controls: OrbitControls | null = null
  const aspect = () => window.innerWidth / window.innerHeight
  const render = () => {
    if (built && camera) renderer.render(built.scene, camera)
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
      built = buildScene(id, mood)
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
    if (q.has('shot')) await shotMain()
    else viewerMain()
  } catch (err) {
    window.__error = err instanceof Error ? (err.stack ?? err.message) : String(err)
  }
  window.__done = true
})()
