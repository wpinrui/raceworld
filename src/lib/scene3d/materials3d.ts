// One material per colour-and-finish for the whole 3D world (#photoreal). Standard everywhere: the
// 2D's colours are authored albedo, the light rig is calibrated so a horizontal surface renders
// close to it, and the baked sky supplies the ambient and the reflections through
// `scene.environment`. Double-sided because half the world is sheets; transparent entries skip
// depth writes so the coplanar ground stack never sorts against itself.
//
// Standard, not Lambert, and this file is why the switch had to be all at once: Lambert ignores
// `envMap` entirely, so a half-converted world would have had the sky lighting some of it and not
// the rest. Every mesh in the scene comes through here or through `surface` below.

import * as THREE from 'three'

/** The depth pull for paint that tops the whole road stack (grid boxes, the pit work pad and its
 *  markings, night glow pools): past the deepest opaque layer (marks, 13). The stack's
 *  polygonOffset is slope-scaled: tilt the camera and the road's bias outgrows any millimetre
 *  lift, so paint that merely floats above it vanishes at every angle but top-down. Every decal
 *  must out-pull the surface it lies on instead of out-climbing it; the road ink does it with its
 *  own painter layer so the kerbs and marks painted over it still win. */
export const DECAL_PULL = 16

/** How rough a surface is, 0 mirror to 1 chalk. Named rather than numeric at the call sites,
 *  because the whole value of moving off Lambert is that a kerb and a windscreen stop being the
 *  same material, and that difference should be legible in the code that places them.
 *
 *  Deliberately no value under 0.3. A near-mirror needs an environment with something in it to
 *  reflect, and this one holds sky and cloud, no ground and no grandstands: below about 0.3 a
 *  surface starts mirroring blank sky at angles where a real one would be showing the pit wall. */
export const ROUGH = {
  /** Glass, polished bodywork, standing water. */
  gloss: 0.32,
  /** Painted metal: barriers, signage plate, garage fascia. */
  paint: 0.55,
  /** The default. Dry tarmac, kerb paint, concrete. */
  matte: 0.78,
  /** Grass, gravel, cloth, foliage: no coherent reflection at all. */
  chalk: 1,
} as const

/** Per-material control of how much environment a surface reflects is NOT available while the sky
 *  is mounted as `scene.environment`. three overwrites `envMapIntensity` outright in that case
 *  (`WebGLRenderer`: `material.envMap === null && scene.environment !== null` -> assign
 *  `scene.environmentIntensity`), so any value set here is discarded before the draw. Getting it
 *  back would mean assigning `envMap` on every material and re-assigning it on every mood change.
 *
 *  Not worth it so far: `roughness` alone carries the difference between a kerb and a windscreen,
 *  and the one case that wanted it, grass sheening at grazing angles, was solved by moving the
 *  ground stack to `chalk`. */

export interface SurfaceOpts {
  /** 0..1, default opaque. Below 1 the material stops writing depth. */
  alpha?: number
  /** Default `ROUGH.matte`. */
  roughness?: number
  /** 0 dielectric, 1 metal. A metal has no diffuse at all, so it renders BLACK without an
   *  environment to reflect; only pass 1 where the scene is guaranteed one. */
  metalness?: number
  /** Marks paint lying ON another surface: always in the transparent pass (so renderOrder, not
   *  height, decides its stacking) and never writing depth (so a hundred coplanar layers cannot
   *  fight). The road ink is entirely decals. */
  decal?: boolean
  /** Biases OPAQUE road layers apart in the depth buffer with polygonOffset, so the painter stack
   *  keeps only millimetres of physical lift: the cars sit ON the road now the camera can lie low
   *  enough to read a hovering tyre, and the depth buffer still separates the sheets at any
   *  precision and any glancing angle. */
  layer?: number
  /** A repeating tile, where the surface has one. */
  map?: THREE.Texture | null
}

/** Build one surface. The single place in the codebase that decides what a lit material IS. */
export function surface(colour: string, opts: SurfaceOpts = {}): THREE.MeshStandardMaterial {
  const { alpha = 1, roughness = ROUGH.matte, metalness = 0, decal = false, layer = 0, map } = opts
  return new THREE.MeshStandardMaterial({
    color: colour,
    side: THREE.DoubleSide,
    roughness,
    metalness,
    ...(map ? { map } : {}),
    ...(alpha < 1 || decal ? { transparent: true, opacity: alpha, depthWrite: false } : {}),
    ...(layer > 0 ? {
      polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -2 * layer,
    } : {}),
  })
}

export class SceneMaterials {
  private cache = new Map<string, THREE.MeshStandardMaterial>()

  /** Cached by everything that distinguishes one material from another, so a circuit's thousand
   *  road sheets share a handful of them. */
  get(colour: string, alpha = 1, decal = false, layer = 0, roughness = ROUGH.chalk): THREE.MeshStandardMaterial {
    const key = `${colour}@${alpha}${decal ? '#decal' : ''}#${layer}#${roughness}`
    let mat = this.cache.get(key)
    if (!mat) {
      mat = surface(colour, { alpha, decal, layer, roughness })
      this.cache.set(key, mat)
    }
    return mat
  }
}
