// One material per colour-and-finish for the whole 3D world (#photoreal). Standard everywhere: the
// 2D's colours are authored albedo, the light rig is calibrated so a horizontal surface renders
// close to it, and the baked environment supplies the ambient and the reflections through
// `scene.environment` (the sky at first; the world itself since `bakeWorldEnv`). Double-sided
// because half the world is sheets; transparent entries skip depth writes so the coplanar ground
// stack never sorts against itself.
//
// Standard, not Lambert, and this file is why the switch had to be all at once: Lambert ignores
// `envMap` entirely, so a half-converted world would have had the sky lighting some of it and not
// the rest. Every mesh in the scene comes through here or through `surface` below. The one step
// past standard is `LACQUER`, which builds a physical material for the two-lobe finish car paint is.

import * as THREE from 'three'
import type { SurfaceDetail } from './detail3d'

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
 *  Deliberately no value under 0.3, and it STAYS that way now the environment has the world in it
 *  (`bakeWorldEnv`). Not because a sharper reflection would be wrong out here, but because this is
 *  the BASE coat, and a livery has to read as its authored colour: drop the base toward a mirror
 *  and the team's blue becomes whatever the pit wall is. Where a surface genuinely wants a sharp
 *  lobe, it gets one from `LACQUER` on top, which is how real paint does it. */
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

/** The clear coat over a livery: a thin near-mirror lacquer sitting on the colour coat.
 *
 *  A race car's finish is TWO lobes, and the single-lobe standard material can only ever average
 *  them into one wrong answer: an authored `ROUGH.paint` reads as a slightly shiny wall, and
 *  anything glossier than that bleaches the livery out. Splitting them gives both at once, the
 *  colour staying flat and readable underneath while the lacquer throws the hard sun streak that
 *  slides down a sidepod as the car turns. That streak is most of what "expensive car paint" means
 *  on screen, and it costs one extra lobe rather than any change to the base colour.
 *
 *  Near 1 rather than a fraction: clear coat is clear, and a partial one is a material that is
 *  half-lacquered, not one that is lightly lacquered. The roughness is where the finish lives, and
 *  0.08 is polished-but-not-chrome: sharp enough to hold the sun as a streak rather than a smear,
 *  soft enough that the reflected pit wall stays a suggestion. */
export const LACQUER = { clearcoat: 1, clearcoatRoughness: 0.08 } as const

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
  /** Generated grain: normal and roughness maps, projected by `planarUV` on the geometry side.
   *  Where the surface's roughness comes from a map, the scalar `roughness` still multiplies it. */
  detail?: SurfaceDetail | null
  /** How much clear coat sits over the colour, 0 none to 1 fully lacquered. Above 0 the surface is
   *  built as a `MeshPhysicalMaterial` (which IS a standard material, with the second lobe) rather
   *  than a plain standard one. Spread `LACQUER` rather than picking numbers here. */
  clearcoat?: number
  /** How sharp that lacquer is, 0 mirror to 1 chalk. Ignored without `clearcoat`. */
  clearcoatRoughness?: number
  /** How much of the standard 4% dielectric reflection this surface actually returns, 1 by default.
   *  Below 1 the surface is built as a `MeshPhysicalMaterial`, like `clearcoat`. */
  specular?: number
  /** Multiply the colour by a per-vertex one: shading baked into the mesh, for a gradient that
   *  wants no texture and no extra triangles (the tyre sidewall's fall into the rim).
   *
   *  The geometry MUST carry a `color` attribute. A material that opts in without one does not
   *  render unshaded, it renders BLACK: WebGL hands the shader a zero for an attribute it cannot
   *  find, and zero times the colour is nothing. */
  vertexColors?: boolean
}

/** Build one surface. The single place in the codebase that decides what a lit material IS. */
export function surface(colour: string, opts: SurfaceOpts = {}): THREE.MeshStandardMaterial {
  const {
    alpha = 1, roughness = ROUGH.matte, metalness = 0, decal = false, layer = 0, map, detail,
    clearcoat = 0, clearcoatRoughness = 0, specular = 1, vertexColors = false,
  } = opts
  // Physical only where a second lobe was ASKED for, or where the first one is being turned down:
  // it compiles a longer shader and every surface out here that is not car paint or tarmac wants a
  // plain single lobe at the standard strength.
  const physical = clearcoat > 0 || specular < 1
  const Material = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial
  return new Material({
    color: colour,
    ...(clearcoat > 0 ? { clearcoat, clearcoatRoughness } : {}),
    ...(specular < 1 ? { specularIntensity: specular } : {}),
    side: THREE.DoubleSide,
    roughness,
    metalness,
    vertexColors,
    // An explicit tile wins: the grandstand's seats are its surface, and graining them would be
    // painting one texture over another.
    ...(map ? { map } : detail ? { map: detail.albedoMap } : {}),
    ...(detail ? {
      normalMap: detail.normalMap,
      normalScale: new THREE.Vector2(detail.normalScale, detail.normalScale),
      ...(detail.roughnessMap ? { roughnessMap: detail.roughnessMap } : {}),
    } : {}),
    ...(alpha < 1 || decal ? { transparent: true, opacity: alpha, depthWrite: false } : {}),
    ...(layer > 0 ? {
      polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -2 * layer,
    } : {}),
  })
}

export class SceneMaterials {
  private cache = new Map<string, THREE.MeshStandardMaterial>()

  /** Cached by everything that distinguishes one material from another, so a circuit's thousand
   *  road sheets share a handful of them. An options object rather than a row of positional flags:
   *  the fifth unlabelled argument in a row of five was already unreadable at the call sites. */
  get(colour: string, opts: SurfaceOpts = {}): THREE.MeshStandardMaterial {
    const {
      alpha = 1, roughness = ROUGH.chalk, metalness = 0, decal = false, layer = 0, detail,
      clearcoat = 0, clearcoatRoughness = 0, specular = 1, vertexColors = false,
    } = opts
    // Keyed on the grain's IDENTITY, not its tile size: the kerb's corrugation and the tarmac's
    // aggregate are different surfaces that could perfectly well be authored at the same scale, and
    // a size-keyed cache would hand the second one the first one's maps.
    const key = `${colour}@${alpha}#${roughness}#${metalness}${decal ? '#decal' : ''}#${layer}`
      + `#${detail ? detail.normalMap.uuid : 'flat'}#${clearcoat}/${clearcoatRoughness}~${specular}`
      + `${vertexColors ? '#vc' : ''}`
    let mat = this.cache.get(key)
    if (!mat) {
      mat = surface(colour, {
        alpha, roughness, metalness, decal, layer, detail, clearcoat, clearcoatRoughness, specular,
        vertexColors,
      })
      this.cache.set(key, mat)
    }
    return mat
  }
}
