// One material per colour-and-alpha for the whole 3D world (#3d-port). Lambert everywhere: the 2D's
// colours are authored albedo, and the light rig is calibrated so a horizontal surface renders close
// to it. Double-sided because half the world is sheets; transparent entries skip depth writes so the
// coplanar ground stack never sorts against itself.

import * as THREE from 'three'

export class SceneMaterials {
  private cache = new Map<string, THREE.MeshLambertMaterial>()

  /** `decal` marks paint lying ON another surface: always in the transparent pass (so renderOrder,
   *  not height, decides its stacking) and never writing depth (so a hundred coplanar layers cannot
   *  fight). The road ink is entirely decals. */
  get(colour: string, alpha = 1, decal = false): THREE.MeshLambertMaterial {
    const key = `${colour}@${alpha}${decal ? '#decal' : ''}`
    let mat = this.cache.get(key)
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({
        color: colour,
        side: THREE.DoubleSide,
        ...(alpha < 1 || decal ? { transparent: true, opacity: alpha, depthWrite: false } : {}),
      })
      this.cache.set(key, mat)
    }
    return mat
  }
}
