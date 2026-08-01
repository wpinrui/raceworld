// Browser half of the car turntable probe (#3d-port increment 4): one lofted car on bare tarmac
// under the afternoon rig, shot from a named angle. The 3D sibling of scripts/car-preview.ts, and
// the still the height profile in car-mesh.ts is iterated against.
//
// Opened from disk WITHOUT ?shot it is the hand-orbitable car viewer: Ours / Model / Both, livery
// colour, steering lock and a turntable spin, the car sibling of scene3d-viewer.html.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MOODS } from '../src/lib/ui/lighting'
import { SPRITE } from '../src/lib/ui/car-sprite'
import { buildCarLod, buildCarMesh, CAR_TIERS, type CarLod } from '../src/lib/scene3d/car-mesh'
import { historicalGrids } from '../src/data/history/grids'
import { liveryFor } from '../src/data/history/liveries'
import { buildLightRig } from '../src/lib/scene3d/lighting3d'

declare global {
  interface Window {
    __done?: boolean
    __error?: string
  }
}

/** Camera bearings, degrees round the car: 0 looks at the nose. The `o` angles are ORTHOGRAPHIC
 *  elevations sharing one frustum, so a silhouette shot of either car lands on the same pixels and
 *  the node side can composite them into a proportion overlay. */
const ANGLES: Record<string, { az: number; elev: number; ortho?: boolean; dist?: number; at?: [number, number, number] }> = {
  front: { az: 25, elev: 22 },
  side: { az: 90, elev: 16 },
  rear: { az: 205, elev: 22 },
  top: { az: 90, elev: 88 },
  under: { az: 90, elev: -78 },
  cockpit: { az: 38, elev: 42, dist: 0.2, at: [0, 66, -32] },
  cockrear: { az: 148, elev: 30, dist: 0.38, at: [0, 62, -32] },
  cockside: { az: 86, elev: 14, dist: 0.34, at: [0, 62, -32] },
  cockfront: { az: 8, elev: 20, dist: 0.38, at: [0, 62, -32] },
  // POINT BLANK on the front-right tyre (sprite x90, z106, so local z -154). The quarter view puts
  // tread, shoulder and sidewall in one frame, which is the only way to judge a split that is about
  // how two zones differ; the flat one is nearly side-on and low, where the wall's own shading and
  // the shoulder's highlight have nothing else to hide behind.
  tyre: { az: 50, elev: 14, dist: 0.25, at: [90, 34, -154] },
  tyreflat: { az: 84, elev: 4, dist: 0.22, at: [90, 34, -154] },
  oside: { az: 90, elev: 0, ortho: true },
  ofront: { az: 0, elev: 0, ortho: true },
  otop: { az: 90, elev: 89.9, ortho: true },
}

/** The shared ortho frame: wide enough for the car's length, 3:2 like the canvas. */
const ORTHO_HALF_W = 300
const ORTHO_HALF_H = 200
/** The silhouette frame's centre: mid-car, mid-height. */
const ORTHO_CENTRE = new THREE.Vector3(0, 85, -26)

/** The downloaded GLB, geometry only: every shipped material is thrown away and repainted flat, so
 *  the model obeys the same livery-and-light rules as the loft. Normalised to a caller-given length
 *  with the ground at zero, so a comparison shot scales the two cars honestly. */
async function loadModelCar(colour: string, targetLen: number = SPRITE.len): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().loadAsync('../../public/models/f1.glb')
  const car = gltf.scene
  // Models ship plinths and backdrops; the car is what remains. Names first, then a size heuristic:
  // anything whose footprint dwarfs the union of the rest is scenery, not car.
  const doomed: THREE.Object3D[] = []
  car.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3())
      console.log(`glb mesh: ${o.name || '(unnamed)'} ${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)}`)
      const flat = size.y < 0.02 * Math.max(size.x, size.z)
      if (flat || /plane|ground|floor|base|track|road|backdrop/i.test(o.name)) doomed.push(o)
    }
  })
  for (const o of doomed) o.removeFromParent()
  // The file ships ONE material for the whole car, so the split is geometric: vertices inside the
  // four wheel corner zones paint tyre-dark, the rest takes the livery, as vertex colours under a
  // single white-based material.
  car.updateMatrixWorld(true)
  const carBounds = new THREE.Box3().setFromObject(car)
  const carSize = carBounds.getSize(new THREE.Vector3())
  const carMid = carBounds.getCenter(new THREE.Vector3())
  const long = carSize.x >= carSize.z ? 'x' : 'z'
  const lat = long === 'x' ? 'z' : 'x'
  const axles = [
    carBounds.min[long] + carSize[long] * 0.175,
    carBounds.max[long] - carSize[long] * 0.175,
  ]
  const livery = new THREE.Color(colour)
  const dark = new THREE.Color('#16181D')
  const wheelTopY = carBounds.min.y + carSize[long] * 0.185
  const paint = new THREE.MeshLambertMaterial({ color: '#FFFFFF', vertexColors: true })
  const world = new THREE.Vector3()
  car.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const pos = (o.geometry as THREE.BufferGeometry).attributes.position
    const colours = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      world.fromBufferAttribute(pos, i)
      o.localToWorld(world)
      const nearAxle = axles.some((a) => Math.abs(world[long] - a) < carSize[long] * 0.075)
      const outboard = Math.abs(world[lat] - carMid[lat]) > carSize[lat] * 0.29
      const c = nearAxle && outboard && world.y < wheelTopY ? dark : livery
      colours[i * 3] = c.r
      colours[i * 3 + 1] = c.g
      colours[i * 3 + 2] = c.b
    }
    ;(o.geometry as THREE.BufferGeometry).setAttribute('color', new THREE.BufferAttribute(colours, 3))
    o.material = paint
    o.castShadow = true
    o.receiveShadow = true
  })
  const bounds = new THREE.Box3().setFromObject(car)
  const size = bounds.getSize(new THREE.Vector3())
  // Length runs along z in our world; turn the model if it was authored across x. It then faces the
  // way ours does: nose to low z. Verified against the lit pair, where a half-turn "fix" put the
  // two cars tail-to-tail.
  if (size.x > size.z) car.rotation.y = Math.PI / 2
  const scale = targetLen / Math.max(size.x, size.y, size.z)
  car.scale.setScalar(scale)
  const scaled = new THREE.Box3().setFromObject(car)
  const centre = scaled.getCenter(new THREE.Vector3())
  car.position.set(-centre.x, -scaled.min.y, -centre.z)
  const wrap = new THREE.Group()
  wrap.add(car)
  return wrap
}

/** Every mesh under the group repainted flat and unlit: what a silhouette is. */
function toSilhouette(group: THREE.Object3D, colour: string) {
  const flat = new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide })
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = flat
      o.castShadow = false
    }
  })
}

async function shotMain() {
  document.body.classList.add('shot')
  const q = new URLSearchParams(location.search)
  const colour = `#${q.get('colour') ?? 'E8442E'}`
  const view = ANGLES[q.get('angle') ?? 'front'] ?? ANGLES.front
  const steered = q.has('steer')
  const compare = q.has('compare')
  const silhouette = q.get('silhouette')

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(silhouette ? '#FFFFFF' : '#33383E')
  if (!silhouette) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: '#33383E' }),
    )
    ground.rotateX(-Math.PI / 2)
    ground.receiveShadow = true
    scene.add(ground)
  }

  // Which cars stand in the scene: ours, the reference model, or both flanking each other.
  const wantModel = q.has('model') || compare
  const wantOurs = !q.has('model') || compare
  let ours: THREE.Group | null = null
  if (wantOurs) {
    const car = buildCarMesh(colour)
    if (steered && !compare) {
      // A hairpin's worth of lock, inner wheel tighter, so the still can check the pivots.
      car.wheels.fl.rotation.y = -(20 * Math.PI) / 180
      car.wheels.fr.rotation.y = -(23 * Math.PI) / 180
    }
    ours = car.group
    scene.add(ours)
  }
  if (wantModel) {
    // The model is scaled to OUR car's own length and recentred onto OUR car's own midpoint, so
    // every remaining difference in an overlay is proportion, not registration.
    let target: number = SPRITE.len
    let oursMidZ = 0
    if (ours) {
      ours.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(ours)
      const size = bounds.getSize(new THREE.Vector3())
      target = Math.max(size.x, size.z)
      oursMidZ = (bounds.min.z + bounds.max.z) / 2
    }
    const model = await loadModelCar(colour, target)
    model.position.z += oursMidZ
    if (compare && ours) {
      // Flank the pair across the camera's ground-right, snapped to the nearer axis: across the
      // cars for front and rear shots, nose-to-tail for the side shot, and always across for the
      // top, since 170 units clears a car's width and nothing clears two lengths.
      const az = (view.az * Math.PI) / 180
      const right = new THREE.Vector3(Math.cos(az), 0, Math.sin(az))
      const alongX = Math.abs(right.x) > Math.abs(right.z) || view.elev > 45
      const sep = alongX
        ? new THREE.Vector3(Math.sign(right.x) || 1, 0, 0).multiplyScalar(170)
        : new THREE.Vector3(0, 0, Math.sign(right.z)).multiplyScalar(290)
      ours.position.sub(sep)
      model.position.add(sep)
    }
    scene.add(model)
    if (silhouette) toSilhouette(model, `#${silhouette}`)
  }
  if (silhouette && ours) toSilhouette(ours, `#${silhouette}`)
  scene.add(buildLightRig(MOODS.afternoon, { x: -300, y: -300, w: 600, h: 600 }))

  const az = (view.az * Math.PI) / 180
  const elev = (view.elev * Math.PI) / 180
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev),
  )
  let camera: THREE.Camera
  if (view.ortho) {
    const cam = new THREE.OrthographicCamera(-ORTHO_HALF_W, ORTHO_HALF_W, ORTHO_HALF_H, -ORTHO_HALF_H, 1, 2000)
    cam.position.copy(ORTHO_CENTRE).addScaledVector(dir, 800)
    if (view.elev > 45) cam.up.set(0, 0, -1)
    cam.lookAt(ORTHO_CENTRE)
    camera = cam
  } else {
    const dist = SPRITE.len * (view.dist ?? (compare ? 2.6 : 1.5))
    const cam = new THREE.PerspectiveCamera(32, 1.5, 1, dist * 6)
    const at = new THREE.Vector3(...(view.at ?? [0, 18, -20]))
    cam.position.copy(dir).multiplyScalar(dist).add(view.at ? at : new THREE.Vector3(0, 20, 0))
    cam.lookAt(at)
    camera = cam
  }

  const canvas = document.getElementById('gl') as HTMLCanvasElement
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.shadowMap.enabled = !silhouette
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(1)
  renderer.setSize(1200, 800, false)
  renderer.render(scene, camera)
}

/** The hand-orbitable car viewer: rebuilds in place off the bar's controls. */
function viewerMain() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#33383E')
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300_000, 300_000), new THREE.MeshLambertMaterial({ color: '#33383E' }),
  )
  ground.rotateX(-Math.PI / 2)
  ground.receiveShadow = true
  scene.add(ground)
  scene.add(buildLightRig(MOODS.afternoon, { x: -300, y: -300, w: 600, h: 600 }))
  let carRoot = new THREE.Group()
  scene.add(carRoot)

  const canvas = document.getElementById('gl') as HTMLCanvasElement
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight, true)

  // The far plane has to clear a WHOLE-TRACK zoom, not a turntable. Getting a car down to the eight
  // pixels where the block tier takes over needs the camera about 95,000 units out; the old
  // SPRITE.len * 12 put the far plane at 5,760, which clipped the world away at roughly 145 px per
  // car and made every tier below L1 unreachable. Ground grows with it or it ends in mid-air.
  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 1, 400_000)
  camera.position.set(SPRITE.len * 0.55, SPRITE.len * 0.5, -SPRITE.len * 1.25)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 30, -20)
  controls.autoRotateSpeed = 1.6
  controls.minDistance = 60
  controls.maxDistance = 200_000

  // Year and team drive the livery; steer is a slider so any lock can be inspected, not just the
  // one hard-coded angle a toggle gave.
  const yearSel = document.getElementById('year') as HTMLSelectElement
  const teamSel = document.getElementById('team') as HTMLSelectElement
  const steerInput = document.getElementById('steer') as HTMLInputElement
  const steerOut = document.getElementById('steerv') as HTMLSpanElement
  const swatch = document.getElementById('swatch') as HTMLSpanElement

  for (const g of historicalGrids) {
    const opt = document.createElement('option')
    opt.value = String(g.year)
    opt.textContent = String(g.year)
    yearSel.append(opt)
  }
  yearSel.value = String(historicalGrids[historicalGrids.length - 1].year)

  const gridFor = (year: number) =>
    historicalGrids.find((g) => g.year === year) ?? historicalGrids[historicalGrids.length - 1]

  const fillTeams = () => {
    const keep = teamSel.value
    teamSel.replaceChildren()
    for (const t of gridFor(Number(yearSel.value)).teams) {
      const opt = document.createElement('option')
      opt.value = t.id
      opt.textContent = t.name
      teamSel.append(opt)
    }
    // Hold the same constructor across a year change where it stayed on the grid.
    if ([...teamSel.options].some((o) => o.value === keep)) teamSel.value = keep
  }

  const currentPaint = () => {
    const year = Number(yearSel.value)
    const team = gridFor(year).teams.find((t) => t.id === teamSel.value) ?? gridFor(year).teams[0]
    return liveryFor(team.id, year, team.color)
  }

  // LOD harness. A fleet stands on the grid so the frame cost is the cost of a real field, not of
  // one hero car, and every metric that decides a tier is on screen while you drag the camera.
  const fleetSel = document.getElementById('fleet') as HTMLSelectElement
  const lockSel = document.getElementById('lock') as HTMLSelectElement
  const tintBtn = document.getElementById('tint') as HTMLButtonElement
  const hud = document.getElementById('hud') as HTMLDivElement
  /** One per tier, so a locked or auto-picked level is visible as a colour rather than inferred. */
  const TIER_TINT = ['#FF4D4D', '#FFA33D', '#FFE24D', '#5BD75B', '#4DA6FF']
  let tinted = false
  let lods: CarLod[] = []
  const liveryPaint = new Map<THREE.MeshLambertMaterial, number>()

  const rebuild = () => {
    const paint = currentPaint()
    swatch.replaceChildren(...Object.values(paint).map((c) => {
      const i = document.createElement('i')
      i.style.background = c
      return i
    }))
    const lock = Number(steerInput.value)
    steerOut.textContent = `${lock}°`

    const count = Number(fleetSel.value)
    const fresh = new THREE.Group()
    // ONE build per livery, then clones: Object3D.clone shares geometry and material, so a field of
    // sixty costs one car's build time and sixty transforms.
    const master = buildCarLod(paint)
    lods = []
    const cols = Math.ceil(Math.sqrt(count))
    for (let i = 0; i < count; i++) {
      const lod: CarLod = i === 0 ? master : { ...master, group: master.group.clone(true), tier: 0 }
      if (i > 0) {
        // A clone's children are fresh objects, so its tier switching needs its own handles.
        const tiers = lod.group.children
        tiers.forEach((t, k) => { t.visible = k === 0 })
        lod.show = (px: number) => {
          let next = CAR_TIERS.length - 1
          for (let t = 0; t < CAR_TIERS.length; t++) {
            if (px >= CAR_TIERS[t].minPx) { next = t; break }
          }
          if (next !== lod.tier) {
            tiers[lod.tier].visible = false
            tiers[next].visible = true
            lod.tier = next
          }
          return next
        }
      }
      lod.steer((-lock * Math.PI) / 180, (-lock * 1.15 * Math.PI) / 180)
      lod.group.position.set(
        ((i % cols) - (cols - 1) / 2) * SPRITE.len * 1.35,
        0,
        (Math.floor(i / cols) - (cols - 1) / 2) * SPRITE.len * 1.5,
      )
      lods.push(lod)
      fresh.add(lod.group)
    }
    carRoot.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        ;(o.geometry as THREE.BufferGeometry).dispose()
        const m = o.material
        for (const mat of Array.isArray(m) ? m : [m]) mat.dispose()
      }
    })
    scene.remove(carRoot)
    carRoot = fresh
    scene.add(carRoot)
  }

  /** Pixels a car LENGTH covers on screen at a given point: the number every tier switches on.
   *  Projects two points a car apart at that depth, so it stays honest under both a dolly and a
   *  field-of-view change, which distance alone does not. */
  const pxPerLength = (at: THREE.Vector3): number => {
    const depth = camera.position.distanceTo(at)
    const worldPerPx = (2 * Math.tan((camera.fov * Math.PI) / 360) * depth) / renderer.domElement.clientHeight
    return SPRITE.len / worldPerPx
  }

  // A wheel dolly is multiplicative, so out at whole-track range one notch swallows several tiers
  // and you can never settle ON a switch. This slider drives the camera to an exact car length in
  // pixels instead, which is the number the tiers actually switch on: park it at 26 and then 24 and
  // the L3/L4 pop is a single click apart.
  const zoomInput = document.getElementById('zoom') as HTMLInputElement
  const zoomOut = document.getElementById('zoomv') as HTMLSpanElement
  const ZOOM_MIN = 3
  const ZOOM_MAX = 900
  const zoomToPx = (v: number) => ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** (v / 1000)
  // Applied in the frame loop, AFTER controls.update(), not from the handler: OrbitControls rewrites
  // the camera every frame, so a one-shot move made here is undone before it is ever drawn.
  let pendingZoom: number | null = null
  zoomInput.addEventListener('input', () => { pendingZoom = zoomToPx(Number(zoomInput.value)) })
  const applyZoom = () => {
    if (pendingZoom === null) return
    const height = renderer.domElement.clientHeight
    const depth = (SPRITE.len * height) / (pendingZoom * 2 * Math.tan((camera.fov * Math.PI) / 360))
    // Direction FIRST: `copy(target)` mutates position, so reading it afterwards yields a zero
    // vector and parks the camera exactly on its own target.
    const dir = camera.position.clone().sub(controls.target).normalize()
    camera.position.copy(controls.target).addScaledVector(dir, depth)
    pendingZoom = null
  }
  const showZoom = (px: number) => { zoomOut.textContent = `${px.toFixed(0)} px/car` }

  tintBtn.addEventListener('click', () => {
    tinted = !tinted
    tintBtn.classList.toggle('on', tinted)
    if (!tinted) {
      for (const [mat, hex] of liveryPaint) mat.color.setHex(hex)
      liveryPaint.clear()
    }
  })
  fleetSel.addEventListener('change', rebuild)

  yearSel.addEventListener('change', () => {
    fillTeams()
    rebuild()
  })
  teamSel.addEventListener('change', rebuild)
  steerInput.addEventListener('input', rebuild)
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight, true)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  })

  fillTeams()
  rebuild()

  const at = new THREE.Vector3()
  let frames = 0
  let fps = 0
  let since = performance.now()
  const tick = () => {
    controls.update()
    applyZoom()
    const forced = Number(lockSel.value)
    const histogram = new Array(CAR_TIERS.length).fill(0)
    let midPx = 0
    for (const lod of lods) {
      lod.group.getWorldPosition(at)
      const px = pxPerLength(at)
      midPx += px / lods.length
      // A lock still runs through `show`, so what you are looking at is always a tier the auto
      // picker could have chosen, never a fourth thing that only exists while locked.
      histogram[lod.show(forced < 0 ? px : CAR_TIERS[forced].minPx + 0.01)]++
      if (tinted) {
        lod.group.traverse((o) => {
          if (!(o instanceof THREE.Mesh) || o.parent?.visible === false) return
          const mat = o.material as THREE.MeshLambertMaterial
          // Clones share materials with their master, so tinting MUTATES the livery. Keep the paint
          // it came with, or turning the toggle off leaves a permanently red-and-green field.
          if (!liveryPaint.has(mat)) liveryPaint.set(mat, mat.color.getHex())
          mat.color.set(TIER_TINT[lod.tier])
        })
      }
    }
    renderer.render(scene, camera)
    showZoom(midPx)

    frames++
    const now = performance.now()
    if (now - since > 400) {
      fps = (frames * 1000) / (now - since)
      frames = 0
      since = now
      const info = renderer.info.render
      const metresPerCar = SPRITE.len / 96
      hud.innerHTML = [
        `<b>${fps.toFixed(0).padStart(3)}</b> fps    ${lods.length} cars`,
        `${(info.triangles / 1000).toFixed(1).padStart(7)}k triangles`,
        `${String(info.calls).padStart(8)} draw calls`,
        `${midPx.toFixed(0).padStart(8)} px per car length`,
        `${(midPx / metresPerCar).toFixed(1).padStart(8)} px per metre`,
        '',
        ...CAR_TIERS.map((t, i) => {
          const n = histogram[i]
          return `L${i} >=${String(t.minPx).padStart(3)}px  ${String(n).padStart(3)}  ${'#'.repeat(Math.min(40, n))}`
        }),
      ].join('\n')
    }
    requestAnimationFrame(tick)
  }
  tick()
}

;(async () => {
  try {
    if (new URLSearchParams(location.search).has('shot')) await shotMain()
    else viewerMain()
  } catch (err) {
    window.__error = err instanceof Error ? (err.stack ?? err.message) : String(err)
  }
  window.__done = true
})()
