// One material per colour-and-alpha for the whole 3D world (#3d-port). Lambert everywhere: the 2D's
// colours are authored albedo, and the light rig is calibrated so a horizontal surface renders close
// to it. Double-sided because half the world is sheets; transparent entries skip depth writes so the
// coplanar ground stack never sorts against itself.

import * as THREE from 'three'

/** The depth pull for paint that tops the whole road stack (grid boxes, the pit work pad and its
 *  markings, night glow pools): past the deepest opaque layer (marks, 13). The stack's
 *  polygonOffset is slope-scaled: tilt the camera and the road's bias outgrows any millimetre
 *  lift, so paint that merely floats above it vanishes at every angle but top-down. Every decal
 *  must out-pull the surface it lies on instead of out-climbing it; the road ink does it with its
 *  own painter layer so the kerbs and marks painted over it still win. */
export const DECAL_PULL = 16

export class SceneMaterials {
  private cache = new Map<string, THREE.MeshLambertMaterial>()

  /** `decal` marks paint lying ON another surface: always in the transparent pass (so renderOrder,
   *  not height, decides its stacking) and never writing depth (so a hundred coplanar layers cannot
   *  fight). The road ink is entirely decals.
   *
   *  `layer` biases OPAQUE road layers apart in the depth buffer with polygonOffset, so the painter
   *  stack keeps only millimetres of physical lift: the cars sit ON the road now the camera can lie
   *  low enough to read a hovering tyre, and the depth buffer still separates the sheets at any
   *  precision and any glancing angle. */
  get(colour: string, alpha = 1, decal = false, layer = 0): THREE.MeshLambertMaterial {
    const key = `${colour}@${alpha}${decal ? '#decal' : ''}#${layer}`
    let mat = this.cache.get(key)
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({
        color: colour,
        side: THREE.DoubleSide,
        ...(alpha < 1 || decal ? { transparent: true, opacity: alpha, depthWrite: false } : {}),
        ...(layer > 0 ? {
          polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -2 * layer,
        } : {}),
      })
      this.cache.set(key, mat)
    }
    return mat
  }
}
