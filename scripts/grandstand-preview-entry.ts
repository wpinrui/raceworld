// Browser half of the grandstand probe: esbuild bundles this into one static HTML page. Opened from
// disk it is a viewer (orbit camera, massing picker, live spec sliders); with ?shot=1 it renders one
// framed still and sets `__done`, which the node half rasterises.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  MAIN_STAND, buildGrandstand, standExtent,
  type GrandstandSpec, type RoofStyle, type SeatForm, type SeatLod, type StandMassing,
} from '../src/lib/scene3d/grandstand3d'
import { buildStands3D } from '../src/lib/scene3d/structures3d'
import { SceneMaterials } from '../src/lib/scene3d/materials3d'
import { buildWorldTextures } from '../src/lib/scene3d/textures3d'
import { blendSurfaces, loadStandSkin, type StandSkin } from '../src/lib/scene3d/standtex3d'

declare global {
  interface Window {
    __done?: boolean
    __error?: string
    __scene?: THREE.Scene
    __standStats?: { meshes: number; triangles: number }
    /** The scans, packed into the page by the node half as data: URIs. */
    __standTex?: Record<string, string>
  }
}

const params = new URLSearchParams(location.search)
const shot = params.get('shot') === '1'

const canvas = document.getElementById('gl') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(shot ? 1 : Math.min(2, devicePixelRatio))
renderer.shadowMap.enabled = true
// PCFSoftShadowMap is deprecated in this three version and silently falls back to PCFShadowMap,
// so it is asked for by name rather than through a console warning every reload.
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.outputColorSpace = THREE.SRGBColorSpace

const scene = new THREE.Scene()
window.__scene = scene

/** A sky-and-ground equirect, prefiltered: the ambient every surface here reflects. Procedural
 *  rather than an HDR file, because the probe runs off file:// and a fetch would be blocked. */
function buildEnv(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 256)
  // Less saturated than a photograph's sky, on purpose. A real blue sky IS the ambient in shade and
  // it really does cool everything it lights, but at a scan's own saturation it does more than cool:
  // it drags every warm material toward grey. Measured on the timber, the light reaching a shaded
  // face was (0.65, 0.76, 0.86) per channel, which no albedo can compensate for, since correcting it
  // needs a red above 255.
  grad.addColorStop(0, '#4E7FBE')
  grad.addColorStop(0.44, '#BCD5EC')
  grad.addColorStop(0.5, '#DEE2E2')
  // Desaturated on purpose: bounce off grass IS green, but at the grass's own saturation every
  // shaded concrete face reads as painted green rather than lit by a field.
  grad.addColorStop(0.52, '#7E8078')
  grad.addColorStop(1, '#4C4E49')
  g.fillStyle = grad
  g.fillRect(0, 0, 512, 256)
  // A soft sun disc, so a glossy surface has something to catch.
  const sun = g.createRadialGradient(150, 60, 0, 150, 60, 46)
  sun.addColorStop(0, '#FFFFFF')
  sun.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = sun
  g.fillRect(104, 14, 92, 92)
  const tex = new THREE.CanvasTexture(c)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromEquirectangular(tex).texture
  pmrem.dispose()
  tex.dispose()
  return env
}
scene.environment = buildEnv()
scene.background = new THREE.Color('#8FB6DC')

const sun = new THREE.DirectionalLight('#FFF3DC', 2.6)
sun.position.set(-40, 60, 30)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
scene.add(sun)
scene.add(sun.target)
scene.add(new THREE.HemisphereLight('#D3E2F0', '#7A7A72', 0.42))

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(600, 600),
  new THREE.MeshStandardMaterial({ color: '#5E6B47', roughness: 1 }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// The track it looks at, so the rake reads against something: tarmac at the stand's front face.
// The road lies ON the ground, so height alone can never separate them: a centimetre of lift is
// under the depth buffer's resolution out here and the two sheets stipple through each other. The
// bias is what decides it, exactly as the world's own road stack does it.
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 15),
  new THREE.MeshStandardMaterial({
    color: '#3A3D42',
    roughness: 0.82,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  }),
)
road.rotation.x = -Math.PI / 2
road.position.set(0, 0.01, -9)
road.receiveShadow = true
scene.add(road)

// Near at 0.3 rather than 0.1: the depth buffer's precision is set by the near-far RATIO, and the
// closest any angle here gets is a person's arm length.
const camera = new THREE.PerspectiveCamera(38, 1, 0.3, 1500)
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.target.set(0, 6, 8)

let current: THREE.Group | null = null
let old: THREE.Group | null = null
/** The scanned surfaces, once they have decoded. Null until then, and null whenever the Textures
 *  toggle is off, which is the whole point of the toggle: the flat-colour model is what every
 *  proportion was judged against and it has to stay reachable. */
let skin: StandSkin | null = null
let useSkin = true

/** The stand that is being replaced, stood up beside the new one at the same width and depth, from
 *  the same trackside line. Built straight out of `structures3d`, so what is on screen is the
 *  shipping model and not a redrawing of it.
 *
 *  With its own seat and crowd tiles on it, which are drawn into a canvas from `TILES` and so cost
 *  this page nothing but a `document`. Without them it falls back to flat colour, and comparing a
 *  textured stand against an untextured one would flatter the new model for the wrong reason. */
function buildOld(spec: GrandstandSpec, gapM: number): THREE.Group {
  const ext = standExtent(spec)
  const materials = new SceneMaterials()
  const stand = {
    x: spec.widthM / 2 + gapM + spec.widthM / 2,
    y: ext.depthM / 2,
    w: spec.widthM,
    h: ext.depthM,
    rot: 0,
    fill: '#9AA0A8',
    facing: false,
  }
  return buildStands3D([stand], (m) => m, materials, buildWorldTextures())
}

/** Aim the sun's shadow camera at whatever is currently built. A directional light defaults to an
 *  orthographic frustum of ±5 units, which over a 64 m stand maps a ten-metre patch in the middle
 *  and leaves the rest unshadowed: the sharp-edged dark square on the grass, and the acne striping
 *  on the steps inside it, are both that frustum rather than anything in the model. */
function fitShadow(): void {
  if (!current) return
  const box = new THREE.Box3().setFromObject(current)
  if (old) box.union(new THREE.Box3().setFromObject(old))
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const r = sphere.radius * 1.25
  const cam = sun.shadow.camera
  cam.left = -r
  cam.right = r
  cam.top = r
  cam.bottom = -r
  cam.near = 1
  cam.far = r * 6
  // The light rides with the model, so the frustum stays centred on it whatever the width slider
  // does. Direction is what matters for a sun; the position is only where the frustum sits.
  sun.position.set(sphere.center.x - r * 0.9, sphere.center.y + r * 1.5, sphere.center.z - r * 0.75)
  sun.target.position.copy(sphere.center)
  sun.target.updateMatrixWorld()
  cam.updateProjectionMatrix()
  // Softer than a millimetre bias, and it scales with the frustum: a normal-offset push moves the
  // sample along the surface normal, which is what stops a raked step self-shadowing in stripes.
  sun.shadow.normalBias = Math.max(0.02, r * 0.004)
}

function spec(): GrandstandSpec {
  const num = (id: string, fallback: number) => {
    const el = document.getElementById(id) as HTMLInputElement | null
    return el ? Number(el.value) : fallback
  }
  // The URL wins in shot mode: the bar is still in the DOM behind `body.shot`, so reading the
  // select first would hand every requested massing the picker's default.
  const massing = (shot ? params.get('massing') : null)
    ?? (document.getElementById('massing') as HTMLSelectElement | null)?.value
    ?? MAIN_STAND.massing
  const roof = (shot ? params.get('roof') : null)
    ?? (document.getElementById('roof') as HTMLSelectElement | null)?.value
    ?? MAIN_STAND.roof
  return {
    ...MAIN_STAND,
    massing: massing as StandMassing,
    roof: roof as RoofStyle,
    widthM: num('width', MAIN_STAND.widthM),
    rows: num('rows', MAIN_STAND.rows),
    upperRows: num('upper', MAIN_STAND.upperRows),
    riseM: num('rise', MAIN_STAND.riseM * 100) / 100,
    runM: num('run', MAIN_STAND.runM * 100) / 100,
  }
}

function rebuild(): void {
  for (const g of [current, old]) {
    if (!g) continue
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    scene.remove(g)
  }
  const s = spec()
  const pick = (id: string, fallback: string) => (shot ? params.get(id) : null)
    ?? (document.getElementById(id) as HTMLSelectElement | null)?.value ?? fallback
  const form = pick('seat', 'bucket')
  const lod = pick('lod', 'auto') as SeatLod
  const fill = Number(pick('fill', '90')) / 100
  current = buildGrandstand(
    s, form === 'off' ? null : { form: form as SeatForm, lod }, fill > 0 ? { fill } : null,
    useSkin ? skin : null,
  )
  scene.add(current)
  old = pick('old', '1') === '1' ? buildOld(s, 14) : null
  if (old) scene.add(old)
  fitShadow()
}

/** Count what the last frame actually drew, and say so.
 *
 *  AFTER a render, never at build time: an `LOD` carries all three seat tiers as children and only
 *  decides which one is visible inside `WebGLRenderer.render`. Tallying at build reports every tier
 *  at once, which is a stand and a half that is not on screen. */
function tally(): void {
  if (!current) return
  const s = spec()
  const ext = standExtent(s)
  let meshes = 0
  let triangles = 0
  current.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return
    meshes++
    // An instanced seat bank draws its geometry once per instance, and the seat count IS the cost
    // question here, so the tally has to multiply rather than report one seat's worth.
    const n = o instanceof THREE.InstancedMesh ? o.count : 1
    // Indexed geometry draws index.count/3 triangles, not vertex.count/3: the crowd's quad has four
    // vertices and two triangles, and counting its positions under-reports every spectator.
    const verts = o.geometry.index?.count ?? o.geometry.getAttribute('position').count
    triangles += (verts / 3) * n
  })
  window.__standStats = { meshes, triangles }
  const hud = document.getElementById('hud')
  if (!hud) return
  hud.innerHTML = `<b>${s.massing}</b> / <b>${s.roof}</b> roof\n`
    + `${s.widthM} m wide, ${ext.depthM.toFixed(1)} m deep, ${ext.heightM.toFixed(1)} m tall\n`
    + `rake ${(Math.atan(s.riseM / s.runM) * 180 / Math.PI).toFixed(0)}°`
    + `  rows ${s.rows}${s.massing === 'twoTier' ? ` + ${s.upperRows}` : ''}\n`
    + `<b>${meshes}</b> meshes  <b>${triangles.toLocaleString()}</b> tris drawn`
}

/** Frame the stand from a named angle. The distance comes from the model's own bounding sphere and
 *  the lens, not a guessed multiple of its depth: the width slider spans 20 m to 140 m, and any
 *  fixed number is either a crop at one end or a speck at the other. */
/** Tread height at a row index, for the close-up angles that want to stand in the seating. */
const deckY = (s: GrandstandSpec, row: number) => s.frontWallM + row * s.riseM

function view(angle: string): void {
  const s = spec()
  const ext = standExtent(s)
  const box = new THREE.Box3().setFromObject(current!)
  // The side-by-side has to frame BOTH stands; every other angle is about the new one alone.
  if (angle === 'pair' && old) box.union(new THREE.Box3().setFromObject(old))
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const fitH = sphere.radius / Math.sin((camera.fov * Math.PI) / 360)
  const fitW = fitH / Math.min(1, camera.aspect)
  const r = Math.max(fitH, fitW) * 1.08
  // `under` is the one angle that is NOT a fit: it stands a person's height inside the concourse,
  // which is exactly where a lifted deck has to survive being looked at.
  const dir: Record<string, [number, number, number]> = {
    front: [0, 0.35, -1],
    three: [-0.72, 0.42, -0.85],
    side: [-1, 0.3, 0.1],
    rear: [0, 0.45, 1],
    top: [0.01, 1, 0.15],
    pair: [-0.35, 0.5, -1],
  }
  if (angle === 'under') {
    controls.target.set(0, 2.2, ext.depthM * 0.7)
    camera.position.set(-s.widthM * 0.2, 1.7, ext.depthM * 0.12)
  } else if (angle === 'seat') {
    // Two metres off a seat in the middle of the lower tier: the range the close-up bar is set at.
    const y = deckY(s, s.rows * 0.5)
    controls.target.set(0, y + 0.55, s.runM * s.rows * 0.5)
    camera.position.set(-1.5, y + 1.35, s.runM * s.rows * 0.5 - 2.1)
  } else if (angle === 'band') {
    // Square on the tier transition from the track side, where the concourse wall, its glazing and
    // the upper tier's front edge all have to make sense as one thing.
    const y = deckY(s, s.rows) + s.bandM
    controls.target.set(-4, y - 1.2, s.runM * s.rows + s.setbackM)
    camera.position.set(-14, y + 1.0, s.runM * s.rows - 9)
  } else if (angle === 'crest') {
    // Point-blank on the back of the top row: where a bare riser, a knife-edged parapet or a
    // coplanar sheet has nowhere to hide.
    controls.target.set(-2, ext.heightM - 0.5, ext.depthM - 1.4)
    camera.position.set(-9, ext.heightM + 2.6, ext.depthM - 9)
  } else {
    const d = dir[angle] ?? dir.three
    const len = Math.hypot(d[0], d[1], d[2])
    controls.target.copy(sphere.center)
    camera.position.set(
      sphere.center.x + (d[0] / len) * r,
      sphere.center.y + (d[1] / len) * r,
      sphere.center.z + (d[2] / len) * r,
    )
  }
  camera.lookAt(controls.target)
  controls.update()
}

function resize(): void {
  const w = shot ? 1280 : window.innerWidth
  const h = shot ? 800 : window.innerHeight
  renderer.setSize(w, h, !shot)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

async function main(): Promise<void> {
  if (shot) document.body.classList.add('shot')
  // Loaded before the first build rather than swapped in on arrival: a stand that pops from flat
  // grey to concrete a second after it appears is worse to judge than one that takes a second
  // longer, and the shot path cannot screenshot a half-decoded scene at all.
  if (params.get('tex') !== '0') {
    try {
      skin = await loadStandSkin('tex/', window.__standTex)
      // The ground is a PlaneGeometry, whose UVs already run 0..1 across the whole 600 m sheet, so
      // it tiles by REPEAT rather than by `faceUV` like every surface of the stand does.
      const tiles = 600 / skin.grass.tileM
      for (const map of [skin.grass.albedoMap, skin.grass.normalMap, skin.grass.roughnessMap]) {
        map?.repeat.set(tiles, tiles)
      }
      const grass = new THREE.MeshStandardMaterial({
        map: skin.grass.albedoMap,
        normalMap: skin.grass.normalMap,
        roughnessMap: skin.grass.roughnessMap ?? undefined,
        roughness: 1,
      })
      // 240 repeats across the sheet, so the ground needs breaking up more than the stand does.
      blendSurfaces(grass, skin.grass)
      ground.material = grass
    } catch (err) {
      console.warn(`textures unavailable, falling back to flat colour: ${err}`)
    }
  }
  rebuild()
  resize()
  if (shot) {
    view(params.get('angle') ?? 'three')
    renderer.render(scene, camera)
    tally()
    requestAnimationFrame(() => { window.__done = true })
    return
  }
  view('three')
  for (const id of [
    'massing', 'roof', 'seat', 'lod', 'fill', 'width', 'rows', 'upper', 'rise', 'run',
  ]) {
    document.getElementById(id)?.addEventListener('input', () => {
      const out = document.getElementById(`${id}v`)
      if (out) out.textContent = (document.getElementById(id) as HTMLInputElement).value
      rebuild()
    })
  }
  document.getElementById('tex')?.addEventListener('click', (e) => {
    useSkin = !useSkin
    ;(e.currentTarget as HTMLElement).classList.toggle('on', useSkin)
    rebuild()
  })
  for (const btn of Array.from(document.querySelectorAll('[data-view]'))) {
    btn.addEventListener('click', () => view((btn as HTMLElement).dataset.view!))
  }
  window.addEventListener('resize', resize)
  // The readout follows the camera, because with an auto ladder the triangle count is a function of
  // where you are standing. Every few frames rather than every one: it walks the whole graph.
  let frame = 0
  const tick = () => {
    controls.update()
    renderer.render(scene, camera)
    if (frame++ % 12 === 0) tally()
    requestAnimationFrame(tick)
  }
  tick()
}

main().catch((err) => {
  window.__error = err instanceof Error ? err.message : String(err)
  window.__done = true
})
