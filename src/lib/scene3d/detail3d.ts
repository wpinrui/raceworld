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

/** Anisotropic filtering on every generated map, and it earns its keep here more than in most
 *  scenes: the camera can lie ten degrees off the horizon with the road running away to a haze
 *  three kilometres out, which is the exact case trilinear filtering handles worst. Without it the
 *  grain mips into flat grey a short way up the straight. three clamps this to whatever the device
 *  actually supports, so asking for 16 is safe anywhere. */
const ANISOTROPY = 16

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
  /** Rendered concrete and painted panel: everything that STANDS UP. */
  wall: SurfaceDetail
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
  tex.anisotropy = ANISOTROPY
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
  tex.anisotropy = ANISOTROPY
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

/** Build the world's grain. Browser-only (it rasterises canvases); the scene builders take it as
 *  OPTIONAL input and fall back to flat materials, so tests never touch a canvas. */
export function buildWorldDetail(): WorldDetail {
  // HIGH FREQUENCY ONLY, in every map here, and that is the rule that matters.
  //
  // A tiled map gives itself away through its LOW frequencies. Fine grain repeating every few
  // metres is invisible, because the eye has no landmark to match against its neighbour; one broad
  // blotch per tile is a landmark, and once the eye finds it repeating down a straight the whole
  // surface reads as wallpaper. This map used to carry a four-cell "swell" at a fifth of its
  // amplitude for the look of a surface that is not quite flat, and that single term was the
  // tiling: one soft lump stamped every 2.4 metres, a hundred times down the pit straight.
  //
  // So the undulation is gone, the roughness field moved from 15cm blobs to aggregate scale, and
  // the grass clumps went the same way. Anything a player could match to its copy is the enemy.
  const grit = octaves(64, 3, 1201)
  const tarmacHeight = (x: number, y: number) => fbm(grit, x, y)
  // Roughness varies WITH the aggregate: chipping tops polish under traffic, the hollows between
  // them stay dull. At the same frequency, so it never becomes a landmark of its own.
  const tarmacWear = octaves(64, 2, 4409)

  // Ground: coarser than tarmac because grass is, but nowhere near as coarse as it was. Grass is a
  // deep scatterer, so its detail is about breaking up the light, not about catching highlights.
  const clumps = octaves(32, 3, 3313)

  const tarmac: SurfaceDetail = {
    normalMap: normalTexture(tarmacHeight, 2.6),
    albedoMap: scalarTexture(tarmacHeight, 0.94, 1),
    // A NARROW band, 0.68 to 0.9. The first attempt ran 0.5 to 0.98, and half a unit of roughness
    // between one chipping and the next is not aggregate, it is wet patches: the glossy end caught
    // the sky hard enough to read as puddles scattered over the circuit.
    roughnessMap: scalarTexture((x, y) => fbm(tarmacWear, x, y), 0.68, 0.9),
    normalScale: 0.28,
    tileM: 3.6,
  }
  const ground: SurfaceDetail = {
    normalMap: normalTexture((x, y) => fbm(clumps, x, y), 1.8),
    albedoMap: scalarTexture((x, y) => fbm(clumps, x, y), 0.92, 1),
    roughnessMap: null,
    normalScale: 0.3,
    tileM: 9,
  }
  // Walls want COARSER detail than the ground, which is the opposite of the first guess. Aggregate
  // works underfoot because the camera gets within a metre of it; a building is twenty metres away
  // at its closest and usually much further, so 4cm render texture is sub-pixel before it is ever
  // seen and mips straight back to the flat fill it was meant to replace. Panel and staining scale,
  // 30cm and up, is what actually survives the distance a building is viewed from.
  //
  // The anti-tiling rule relaxes here too: a wall is a few tiles across, not a few hundred like a
  // straight, so there is no long run for the eye to find the repeat in.
  const render = octaves(12, 3, 8837)
  const wall: SurfaceDetail = {
    normalMap: normalTexture((x, y) => fbm(render, x, y), 1.4),
    albedoMap: scalarTexture((x, y) => fbm(render, x, y), 0.84, 1),
    roughnessMap: null,
    normalScale: 0.5,
    tileM: 4.5,
  }

  return {
    tarmac,
    ground,
    wall,
    dispose: () => {
      for (const d of [tarmac, ground, wall]) {
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

/** Project planar UVs per TRIANGLE, off whichever axis that triangle most faces.
 *
 *  The vertical counterpart to `planarUV`. A top-down projection is useless on anything standing up:
 *  a wall parallel to the view axis gets its whole height crushed into one line of texels and reads
 *  as vertical smearing. Triplanar blending in the shader is the usual answer, but it is not needed
 *  here. `GeometrySink` and `toCreasedNormals` both leave geometry NON-INDEXED, so every triangle
 *  owns its three vertices outright and can be given its own projection with no risk of fighting a
 *  neighbour over a shared vertex. Adjacent coplanar faces pick the same axis and stay continuous;
 *  the projection only switches where a surface turns past 45 degrees, which is a corner, where a
 *  texture seam is invisible anyway.
 *
 *  Reads LOCAL coordinates, unlike `planarUV`. Structures are built at the origin and then placed
 *  and rotated, and a wall's grain should be fixed to the wall rather than sliding across it as the
 *  building turns.
 *
 *  Indexed geometry is left alone: sharing a vertex between two faces that want different
 *  projections has no correct answer, and nothing in this scene builds walls that way. */
export function faceUV(geometry: THREE.BufferGeometry, unitsPerTile: number): void {
  if (geometry.index) return
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (let t = 0; t + 2 < position.count; t += 3) {
    a.fromBufferAttribute(position, t)
    b.fromBufferAttribute(position, t + 1)
    c.fromBufferAttribute(position, t + 2)
    normal.copy(ab.subVectors(b, a)).cross(ac.subVectors(c, a))
    const nx = Math.abs(normal.x)
    const ny = Math.abs(normal.y)
    const nz = Math.abs(normal.z)
    for (let v = 0; v < 3; v++) {
      const p = v === 0 ? a : v === 1 ? b : c
      // Drop the dominant axis and keep the other two: a floor is read from above, a wall from
      // whichever side it faces.
      const [s, u] = ny >= nx && ny >= nz ? [p.x, p.z] : nx >= nz ? [p.z, p.y] : [p.x, p.y]
      uv[(t + v) * 2] = s / unitsPerTile
      uv[(t + v) * 2 + 1] = u / unitsPerTile
    }
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
}
