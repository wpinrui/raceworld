// Browser half of the 3D preview probe (#3d-port): esbuild bundles this into a static HTML page the
// node half rasterises through a headless system browser. The same page opened from disk with no
// ?shot parameter is the hand-orbitable viewer: drag to tumble, wheel to zoom.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TRACK_LAYOUTS } from '../src/data/tracks'
import { TRACK_WIDTH_M } from '../src/lib/ui/track-path'
import { buildScenery } from '../src/lib/ui/track-scenery'
import { buildPitSlots, buildPitZone } from '../src/lib/ui/pit-zone'
import { frameOrtho, parseViewBox } from '../src/lib/scene3d/camera3d'
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
  }
}

function main() {
  const q = new URLSearchParams(location.search)
  const id = q.get('id') ?? 'britain'
  const tilt = Number(q.get('tilt') ?? '0')
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
  const world = buildWorld3D({ layout, scenery, pitZone })

  // Same pad, crop convention and output width as the 2D preview, so the stills sit side by side.
  const full = parseViewBox(layout.viewBox, TRACK_WIDTH_M / mpu / 2 + 8)
  const zoom = Number(q.get('zoom') ?? '1')
  const [cxf, cyf] = (q.get('at') ?? '0.5,0.5').split(',').map(Number)
  const vb = zoom > 1
    ? {
      x: full.x + full.w * cxf - full.w / zoom / 2, y: full.y + full.h * cyf - full.h / zoom / 2,
      w: full.w / zoom, h: full.h / zoom,
    }
    : full
  const w = Math.round(Math.max(vb.w * 2, 900))
  const h = Math.round((w * vb.h) / vb.w)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(scenery.base)
  scene.add(world.group)
  const camera = frameOrtho(vb, tilt)

  const canvas = document.getElementById('gl') as HTMLCanvasElement
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(w, h, false)
  renderer.render(scene, camera)

  window.__stats = { ...world.stats, w, h }
  window.__scene = scene
  window.__camera = camera
  window.__THREE = THREE
  if (!q.has('shot')) {
    const controls = new OrbitControls(camera, canvas)
    controls.addEventListener('change', () => renderer.render(scene, camera))
  }
}

try {
  main()
} catch (err) {
  window.__error = err instanceof Error ? (err.stack ?? err.message) : String(err)
}
window.__done = true
