// One material per colour-and-alpha for the whole 3D world (#3d-port). Lambert everywhere: the 2D's
// colours are authored albedo, and the light rig is calibrated so a horizontal surface renders close
// to it. Double-sided because half the world is sheets; transparent entries skip depth writes so the
// coplanar ground stack never sorts against itself.

import * as THREE from 'three'

export class SceneMaterials {
  private cache = new Map<string, THREE.MeshLambertMaterial>()

  get(colour: string, alpha = 1): THREE.MeshLambertMaterial {
    const key = `${colour}@${alpha}`
    let mat = this.cache.get(key)
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({
        color: colour,
        side: THREE.DoubleSide,
        ...(alpha < 1 ? { transparent: true, opacity: alpha, depthWrite: false } : {}),
      })
      this.cache.set(key, mat)
    }
    return mat
  }
}
