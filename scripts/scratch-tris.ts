import * as THREE from 'three'
import { buildCarMesh, CAR_TIERS } from '../src/lib/scene3d/car-mesh'

console.log('tier  minPx    tris  calls   build   20 cars: tris / calls')
for (let t = 0; t < CAR_TIERS.length; t++) {
  const t0 = performance.now()
  const car = buildCarMesh('#E8442E', 'medium', t)
  const ms = performance.now() - t0
  let tris = 0
  let calls = 0
  car.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    calls++
    const g = o.geometry as THREE.BufferGeometry
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3
  })
  console.log(
    `L${t}    ${String(CAR_TIERS[t].minPx).padStart(4)}  ${String(tris).padStart(6)}  `
    + `${String(calls).padStart(5)}  ${ms.toFixed(0).padStart(4)}ms   `
    + `${(tris * 20).toLocaleString().padStart(9)} / ${calls * 20}`,
  )
}
