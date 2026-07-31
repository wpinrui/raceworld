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
import { buildCarMesh } from '../src/lib/scene3d/car-mesh'
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
  cockpit: { az: 38, elev: 42, dist: 0.2, at: [0, 66, -32] },
  cockrear: { az: 148, elev: 30, dist: 0.38, at: [0, 62, -32] },
  cockside: { az: 86, elev: 14, dist: 0.34, at: [0, 62, -32] },
  cockfront: { az: 8, elev: 20, dist: 0.38, at: [0, 62, -32] },
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
    new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: '#33383E' }),
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

  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 1, SPRITE.len * 12)
  camera.position.set(SPRITE.len * 0.55, SPRITE.len * 0.5, -SPRITE.len * 1.25)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 30, -20)
  controls.autoRotateSpeed = 1.6

  const buttons = {
    ours: document.getElementById('ours') as HTMLButtonElement,
    model: document.getElementById('model') as HTMLButtonElement,
    both: document.getElementById('both') as HTMLButtonElement,
    steer: document.getElementById('steer') as HTMLButtonElement,
    spin: document.getElementById('spin') as HTMLButtonElement,
  }
  const colourInput = document.getElementById('colour') as HTMLInputElement
  let mode: 'ours' | 'model' | 'both' = 'ours'
  let steered = false
  let building = 0

  const rebuild = async () => {
    const token = ++building
    const colour = colourInput.value
    const fresh = new THREE.Group()
    if (mode !== 'model') {
      const car = buildCarMesh(colour)
      if (steered) {
        car.wheels.fl.rotation.y = -(20 * Math.PI) / 180
        car.wheels.fr.rotation.y = -(23 * Math.PI) / 180
      }
      if (mode === 'both') car.group.position.x = -170
      fresh.add(car.group)
    }
    if (mode !== 'ours') {
      const model = await loadModelCar(colour)
      if (mode === 'both') model.position.x = 170
      fresh.add(model)
    }
    if (token !== building) return
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

  const setMode = (next: typeof mode) => {
    mode = next
    for (const key of ['ours', 'model', 'both'] as const) {
      buttons[key].classList.toggle('on', key === mode)
    }
    void rebuild()
  }
  buttons.ours.addEventListener('click', () => setMode('ours'))
  buttons.model.addEventListener('click', () => setMode('model'))
  buttons.both.addEventListener('click', () => setMode('both'))
  buttons.steer.addEventListener('click', () => {
    steered = !steered
    buttons.steer.classList.toggle('on', steered)
    void rebuild()
  })
  buttons.spin.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate
    buttons.spin.classList.toggle('on', controls.autoRotate)
  })
  colourInput.addEventListener('change', () => void rebuild())
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight, true)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  })

  buttons.ours.classList.add('on')
  void rebuild()
  const tick = () => {
    controls.update()
    renderer.render(scene, camera)
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
