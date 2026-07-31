// Browser half of the car turntable probe (#3d-port increment 4): one lofted car on bare tarmac
// under the afternoon rig, shot from a named angle. The 3D sibling of scripts/car-preview.ts, and
// the still the height profile in car-mesh.ts is iterated against.

import * as THREE from 'three'
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

/** Camera bearings, degrees round the car: 0 looks at the nose. */
const ANGLES: Record<string, { az: number; elev: number }> = {
  front: { az: 25, elev: 22 },
  side: { az: 90, elev: 16 },
  rear: { az: 205, elev: 22 },
  top: { az: 90, elev: 88 },
}

function main() {
  const q = new URLSearchParams(location.search)
  const colour = `#${q.get('colour') ?? 'E8442E'}`
  const view = ANGLES[q.get('angle') ?? 'front'] ?? ANGLES.front
  const steered = q.has('steer')

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#33383E')
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: '#33383E' }),
  )
  ground.rotateX(-Math.PI / 2)
  ground.receiveShadow = true
  scene.add(ground)

  const car = buildCarMesh(colour)
  if (steered) {
    // A hairpin's worth of lock, inner wheel tighter, so the still can check the pivots.
    car.wheels.fl.rotation.y = -(20 * Math.PI) / 180
    car.wheels.fr.rotation.y = -(23 * Math.PI) / 180
  }
  scene.add(car.group)
  scene.add(buildLightRig(MOODS.afternoon, { x: -300, y: -300, w: 600, h: 600 }))

  const len = SPRITE.len
  const dist = len * 1.35
  const az = (view.az * Math.PI) / 180
  const elev = (view.elev * Math.PI) / 180
  const camera = new THREE.PerspectiveCamera(32, 1.5, 1, dist * 6)
  camera.position.set(
    Math.sin(az) * Math.cos(elev) * dist,
    Math.sin(elev) * dist + 20,
    -Math.cos(az) * Math.cos(elev) * dist,
  )
  camera.lookAt(0, 18, 0)

  const canvas = document.getElementById('gl') as HTMLCanvasElement
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(1)
  renderer.setSize(1200, 800, false)
  renderer.render(scene, camera)
}

try {
  main()
} catch (err) {
  window.__error = err instanceof Error ? (err.stack ?? err.message) : String(err)
}
window.__done = true
