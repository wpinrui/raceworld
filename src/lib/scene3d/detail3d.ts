// Surface detail (#photoreal increment 2): the grain that stops tarmac being a sheet of grey.
//
// PBR gave every surface a correct RESPONSE to light, but nothing to respond with: one flat colour
// per material, so the road returned one uniform sheen across its whole width. That is the last
// big low-poly tell, and it is fixed with normal and roughness maps rather than more geometry.
//
// Everything here is GENERATED, not shipped. The maps are tiling value noise rasterised to a canvas
// the same way `textures3d` rasterises the scenery tiles, so there is no asset to load, no download,
// and the whole thing is deterministic: the same circuit grains the same way every session.
//
// The UVs are PLANAR, projected straight down from world XZ (`planarUV`). Two reasons, and the
// second is the important one:
//
//  - none of the ground geometry has UVs at all. `GeometrySink` and the ribbon builders emit
//    positions only, so a conventional map has nothing to sample by, and authoring UVs through
//    every builder would be a much larger change for a worse result.
//  - the surfaces that want detail are all horizontal, and a top-down projection makes the grain
//    CONTINUOUS across meshes that have no business showing a seam. Road, run-off, terrain patch
//    and grass are separate geometry sharing one piece of ground; projected this way they share one
//    grain, and the joins between them disappear.

import * as THREE from 'three'

/** Resolution of each generated map. 256 is plenty: this is grain, not readable detail, and it
 *  tiles every couple of metres. */
const MAP_SIZE = 256

/** A generated surface grain, and the world distance one repeat of it covers. */
export interface SurfaceDetail {
  normalMap: THREE.Texture
  /** A near-white multiplier over the surface's authored colour.
   *
   *  The reason the grain reads at all across a whole road. A normal map only bends the SPECULAR
   *  response, so it shows where the sun's reflection lobe happens to land and is invisible
   *  everywhere else: the aggregate appeared in a band across the tarmac and nowhere outside it,
   *  which reads as a defect rather than as a surface. Albedo variation has no such dependence on
   *  where the light or the eye is, so it grains the road evenly and the normals then sharpen
   *  whatever the sun does catch. */
  albedoMap: THREE.Texture
  roughnessMap: THREE.Texture | null
  /** How hard the normals push. */
  normalScale: number
  /** Metres of world one tile spans. Converted to units per track by `planarUV`. */
  tileM: number
}

export interface WorldDetail {
  /** Fine aggregate: the circuit, the pit lane, the aprons. */
  tarmac: SurfaceDetail
  /** Coarser and softer: grass, terrain, run-off, everything off the road. */
  ground: SurfaceDetail
  dispose(): void
}

/** Deterministic LCG. Seeded rather than `Math.random` so a circuit's grain is stable across
 *  sessions and across a rebuild mid-race. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** A wrapping lattice of random values, the base of one noise octave. */
function lattice(n: number, seed: number): Float32Array {
  const next = rng(seed)
  const a = new Float32Array(n * n)
  for (let i = 0; i < a.length; i++) a[i] = next()
  return a
}

/** Smoothstep-interpolated lattice sample at normalised (x, y), wrapping at the edges so the map
 *  tiles without a seam. */
function sampleLattice(a: Float32Array, n: number, x: number, y: number): number {
  const fx = x * n
  const fy = y * n
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const at = (xx: number, yy: number) => a[(((yy % n) + n) % n) * n + (((xx % n) + n) % n)]
  const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx
  const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx
  return top * (1 - sy) + bottom * sy
}

/** Sum of octaves, each half the amplitude and twice the frequency of the last. */
function fbm(octaves: Array<{ lat: Float32Array; n: number; amp: number }>, x: number, y: number): number {
  let total = 0
  let weight = 0
  for (const { lat, n, amp } of octaves) {
    total += sampleLattice(lat, n, x, y) * amp
    weight += amp
  }
  return total / weight
}

function octaves(base: number, count: number, seed: number) {
  return Array.from({ length: count }, (_, i) => ({
    lat: lattice(base << i, seed + i * 7919),
    n: base << i,
    amp: 1 / (1 << i),
  }))
}

/** Rasterise a height field, then differentiate it into a tangent-space normal map.
 *
 *  Central differences with WRAPPING reads, so the normals tile as cleanly as the heights do. The
 *  blue channel is the flat-facing component, which is why an untouched normal map reads as
 *  128/128/255 rather than black. */
function normalTexture(
  height: (x: number, y: number) => number, relief: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = MAP_SIZE
  canvas.height = MAP_SIZE
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(MAP_SIZE, MAP_SIZE)
  const step = 1 / MAP_SIZE
  const wrap = (v: number) => (v + 1) % 1
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const u = x * step
      const v = y * step
      const dx = (height(wrap(u + step), v) - height(wrap(u - step), v)) * relief
      const dy = (height(u, wrap(v + step)) - height(u, wrap(v - step))) * relief
      const len = Math.hypot(dx, dy, 1)
      const i = (y * MAP_SIZE + x) * 4
      image.data[i] = ((-dx / len) * 0.5 + 0.5) * 255
      image.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
      image.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  // NoColorSpace, emphatically: a normal map is a vector field, and sRGB-decoding it bends every
  // normal toward flat.
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

/** A greyscale map spanning `lo`..`hi`, for roughness or for multiplying a colour.
 *
 *  NoColorSpace in both uses. For roughness that is obvious, three reads the green channel as a
 *  number. For albedo it is deliberate: three would otherwise sRGB-decode the map before
 *  multiplying, turning a gentle 0.82 into a 0.65 and dropping the road half a stop. As a straight
 *  linear multiplier the authored range IS the range. */
function scalarTexture(
  value: (x: number, y: number) => number, lo: number, hi: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = MAP_SIZE
  canvas.height = MAP_SIZE
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(MAP_SIZE, MAP_SIZE)
  const step = 1 / MAP_SIZE
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const t = Math.max(0, Math.min(1, value(x * step, y * step)))
      const byte = (lo + (hi - lo) * t) * 255
      const i = (y * MAP_SIZE + x) * 4
      image.data[i] = byte
      image.data[i + 1] = byte
      image.data[i + 2] = byte
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

/** Build the world's grain. Browser-only (it rasterises canvases); the scene builders take it as
 *  OPTIONAL input and fall back to flat materials, so tests never touch a canvas. */
export function buildWorldDetail(): WorldDetail {
  // Tarmac: high-frequency aggregate over a slow undulation, so it reads as chippings laid on a
  // surface that is not quite flat rather than as uniform sandpaper.
  const grit = octaves(32, 3, 1201)
  const swell = octaves(4, 2, 7717)
  const tarmacHeight = (x: number, y: number) => fbm(grit, x, y) * 0.8 + fbm(swell, x, y) * 0.2
  // Roughness varies with the aggregate: the tops of the chippings polish under traffic, the
  // hollows between them stay dull. This is what makes a wet-looking sheen break up instead of
  // sliding across the whole ribbon as one sheet.
  const tarmacWear = octaves(16, 2, 4409)

  // Ground: coarser clumps, much softer. Grass is a deep scatterer, so its detail is about breaking
  // up the silhouette of the light, not about catching highlights.
  const clumps = octaves(8, 3, 3313)

  const tarmac: SurfaceDetail = {
    normalMap: normalTexture(tarmacHeight, 2.6),
    albedoMap: scalarTexture(tarmacHeight, 0.9, 1),
    // A NARROW band, 0.68 to 0.9. The first attempt ran 0.5 to 0.98, and half a unit of roughness
    // between one chipping and the next is not aggregate, it is wet patches: the glossy end caught
    // the sky hard enough to read as puddles scattered over the circuit.
    roughnessMap: scalarTexture((x, y) => fbm(tarmacWear, x, y), 0.68, 0.9),
    normalScale: 0.45,
    tileM: 2.4,
  }
  const ground: SurfaceDetail = {
    normalMap: normalTexture((x, y) => fbm(clumps, x, y), 1.8),
    albedoMap: scalarTexture((x, y) => fbm(clumps, x, y), 0.92, 1),
    roughnessMap: null,
    normalScale: 0.3,
    tileM: 5.5,
  }
  return {
    tarmac,
    ground,
    dispose: () => {
      for (const d of [tarmac, ground]) {
        d.normalMap.dispose()
        d.albedoMap.dispose()
        d.roughnessMap?.dispose()
      }
    },
  }
}

/** Project planar UVs down the Y axis onto a geometry whose positions are already in world space.
 *
 *  Mutates in place and is safe to call once per geometry. Never call it on the grandstand deck or
 *  anything else that authors its own UVs: this would overwrite them. */
export function planarUV(geometry: THREE.BufferGeometry, unitsPerTile: number): void {
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / unitsPerTile
    uv[i * 2 + 1] = position.getZ(i) / unitsPerTile
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
}
