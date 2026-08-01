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

/** Resolution of a generated map, for everything that is not the road. 256 is plenty: this is
 *  grain, not readable detail, and it tiles every couple of metres. */
const MAP_SIZE = 256

/** ...and the ROAD's, which is four times the pixels for the same grain at twice the tile.
 *
 *  Resolution and tile size are one decision, not two: what fixes the grain's SCALE is the texel,
 *  and what sets how often a player sees the same arrangement of stones twice is the tile. At 256
 *  over 0.8 m the texel was 3.1 mm and the aggregate was right, but the road repeated every 80 cm,
 *  which at the zoom this scene allows is a visible weave. Doubling both holds the texel at 3.1 mm
 *  and halves how often the pattern comes round. */
const ROAD_MAP_SIZE = 512

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
  /** Road PAINT: the white boundary lines, the apron edge, the start line. The aggregate registered
   *  through a coat of paint, which is a whisper of what the bare surface beside it shows. */
  paint: SurfaceDetail
  /** Coarser and softer: grass, terrain, run-off, everything off the road. */
  ground: SurfaceDetail
  /** Rendered concrete and painted panel: everything that STANDS UP. */
  wall: SurfaceDetail
  /** The kerbs' transverse corrugation. Sampled through LOFTED uvs, not `planarUV`. */
  kerb: SurfaceDetail
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

/** A square scalar field: the noise a map is rasterised from, carried WITH its own width.
 *
 *  Width travels with the samples because it is no longer one number. The road rasterises at 512 and
 *  everything else at 256, and a bare array that has to be paired with the right size by whoever
 *  reads it is a wrapping bug waiting to happen: read a 512 field at 256 and the map comes out as
 *  the top-left quarter of itself, tiled, which is the exact artefact this whole file exists to
 *  avoid. */
interface Field {
  data: Float32Array
  size: number
}

/** Sample a noise function over the whole tile, then STRETCH the result to fill 0..1.
 *
 *  The normalisation is the point. An fbm sums several octaves and divides by their weight, so like
 *  any average it piles up near the middle: a nominally 0..1 field actually occupies roughly 0.3 to
 *  0.7. Any curve applied to it therefore lands on far less contrast than its numbers suggest, which
 *  is precisely how the tarmac came out flat. Measured: pushing the albedo map's range from 0.94..1
 *  all the way to 0..1 moved the rendered variation by half a grey level, because the FIELD had no
 *  variation left to give once the grain ramp had crushed it.
 *
 *  Sampling into an array also makes the normal map four times cheaper: it needs four reads per
 *  texel to difference, and those were four fresh fbm evaluations before. */
function buildField(size: number, sample: (x: number, y: number) => number): Field {
  const data = new Float32Array(size * size)
  const step = 1 / size
  let lo = Infinity
  let hi = -Infinity
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = sample((x + 0.5) * step, (y + 0.5) * step)
      data[y * size + x] = v
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  const span = hi - lo || 1
  for (let i = 0; i < data.length; i++) data[i] = (data[i] - lo) / span
  return { data, size }
}

/** Read a field with wrapping, so everything derived from it tiles as cleanly as it does. */
function at({ data, size }: Field, x: number, y: number): number {
  const cx = ((x % size) + size) % size
  const cy = ((y % size) + size) % size
  return data[cy * size + cx]
}

/** Apply a transform across a field in place, and re-stretch: a ramp that crushes most of the range
 *  leaves the survivors bunched, and they have to be spread back out to be worth anything. */
function shape(field: Field, curve: (v: number) => number): Field {
  const { data } = field
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < data.length; i++) {
    const v = curve(data[i])
    data[i] = v
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const span = hi - lo || 1
  for (let i = 0; i < data.length; i++) data[i] = (data[i] - lo) / span
  return field
}

/** Sharpen a smooth noise field into distinct grains.
 *
 *  Value noise interpolated smoothly gives soft blobs flowing into each other, which is why the road
 *  read as rippled water rather than as chippings: every light area faded into its neighbour and
 *  nothing had an edge. Real aggregate is the opposite, hard little stones with dark bitumen between
 *  them, so the field is pushed through a steep ramp that keeps the top of the range and crushes the
 *  rest toward the matrix. `bias` sets how much of the field survives as stone. */
function grains(v: number, bias: number): number {
  const t = Math.max(0, Math.min(1, (v - bias) / (1 - bias)))
  return t * t * (3 - 2 * t)
}

/** Sum of octaves, each half the amplitude and twice the frequency of the last.
 *
 *  Build the octaves ONCE and close over them. `octaves()` seeds a fresh lattice per call, and
 *  `buildField` calls its sampler 65,536 times: a set built inside the sampler is 65,536 lattices,
 *  billions of rng steps, and a browser tab that never reaches `load`. */
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
function normalTexture(height: Field, relief: number): THREE.CanvasTexture {
  const { size } = height
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(height, x + 1, y) - at(height, x - 1, y)) * relief
      const dy = (at(height, x, y + 1) - at(height, x, y - 1)) * relief
      const len = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
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
function scalarTexture(value: Field, lo: number, hi: number): THREE.CanvasTexture {
  const { size } = value
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.max(0, Math.min(1, at(value, x, y)))
      const byte = (lo + (hi - lo) * t) * 255
      const i = (y * size + x) * 4
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

/** Put one of a surface's maps on its OWN tile size, `factor` times the surface's base one.
 *
 *  The cheapest anti-tiling trick there is, and it costs literally nothing: no extra texture, no
 *  extra sample, no shader. three gives `map`, `normalMap` and `roughnessMap` an independent UV
 *  transform each (`mapTransform`, `normalMapTransform`, `roughnessMapTransform`), so three maps
 *  sharing one projected UV do not have to share one scale.
 *
 *  Worth doing because a repeat is not really spotted by its texture, it is spotted by COINCIDENCE.
 *  All three road maps came off one field at one tile, so the same albedo blob sat under the same
 *  normal bump under the same patch of polish every 0.8 m, and that triple is a landmark the eye
 *  locks onto immediately. Detuned, each map still repeats on its own, but the arrangement they make
 *  together only comes round where all three coincide, which at these factors is kilometres.
 *
 *  Factors are chosen to be poor rational approximations of each other and are always ABOVE 1: a map
 *  scaled down is a map pushed past the texel it was authored for, which is where aliasing lives.
 *
 *  NOT for a map whose features have to land on the albedo's, which is why the kerb never gets this:
 *  its corrugation IS its shape, and sliding the ridges off the paint they are moulded into would be
 *  a defect rather than a disguise.
 *
 *  MEASURED on Britain, as the autocorrelation of the high-passed road at the tile's own period:
 *  +0.577 at 0.8 m before this and the bigger map, +0.259 at 1.6 m after. Under half the signal, at
 *  twice the spacing. */
export function detune<T extends THREE.Texture>(tex: T, factor: number): T {
  tex.repeat.set(1 / factor, 1 / factor)
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
  //
  // The tile is 1.6 m, and every octave here is sized off that ONE number: 512 texels across it is a
  // 3.1 mm texel, the base lattice's 128 cells are 12.5 mm apart and the second octave's 256 are
  // 6.3 mm. That band, 6 to 13 mm, is the size real chippings are, and the coarse end carries the
  // amplitude because the coarse end IS the stone.
  //
  // It used to be a 3.6 m tile with four octaves, which put the dominant grain at 56 mm — gravel,
  // not asphalt — and then ran the last two octaves at 14 mm and 7 mm against a 14 mm texel. Content
  // finer than a texel cannot be resolved, so those two never rendered as anything but uncorrelated
  // per-texel hash on top: the road read as television static laid over a bed of pebbles. Two
  // octaves is the most a map can carry without one of them landing under Nyquist.
  const grit = octaves(128, 2, 1201)
  // Sharpened, and with most of the field pushed down into the bitumen: the stones are the minority
  // of the surface, which is what a real one looks like.
  // Built, then SHAPED and re-stretched, so the grain ramp yields real contrast rather than
  // whatever narrow band fbm's own averaging happened to leave behind.
  const gritField = shape(
    buildField(ROAD_MAP_SIZE, (x, y) => fbm(grit, x, y)), (v) => grains(v, 0.42),
  )
  // Roughness varies WITH the aggregate: chipping tops polish under traffic, the hollows between
  // them stay dull. At the same frequency, so it never becomes a landmark of its own.
  const wear = octaves(128, 2, 4409)
  const wearField = buildField(ROAD_MAP_SIZE, (x, y) => fbm(wear, x, y))

  // Ground: coarser than tarmac because grass is, but nowhere near as coarse as it was. Grass is a
  // deep scatterer, so its detail is about breaking up the light, not about catching highlights.
  const clump = octaves(32, 3, 3313)
  const clumpField = buildField(MAP_SIZE, (x, y) => fbm(clump, x, y))

  // Metres of world one tile of the road's grain spans. Shared by the tarmac and the paint laid on
  // it, so the two are projected at the same scale and a white line's faint texture lines up with
  // the aggregate it runs beside instead of drifting against it.
  const ROAD_TILE_M = 1.6

  const tarmac: SurfaceDetail = {
    // Relief 1.6 against the 2.6 it was, because the SAME relief is a much steeper surface once the
    // features are a few texels wide rather than a few dozen: `normalTexture` differences over two
    // texels, so the slope it reads scales with how fast the field moves per texel, and the field
    // now crosses a whole stone in four of them. 1.6 through a 0.1 normalScale lands the flanks near
    // 9 degrees, which is a millimetre of chipping standing proud of a twelve millimetre stone.
    //
    // Detuned to 1.31 tiles, i.e. a 2.10 m repeat against the albedo's 1.60 m. The relief is read
    // against the FIELD's own texel either way, so stretching it only makes the modelled chippings
    // 16 mm instead of 12, still squarely aggregate, and it buys the bumps coming off the stones
    // they were cut from. Nobody can see which bump belongs to which stone at one centimetre; they
    // can very much see the pair of them arriving together twice in a row.
    normalMap: detune(normalTexture(gritField, 1.6), 1.31),
    // A WIDE albedo range, and this is the change that matters most. Aggregate is bright stone
    // against near-black bitumen: measured against a photograph, a real surface runs most of the
    // way from black to mid-grey, while this map ran 0.94 to 1.0, a six percent wobble. All the
    // visible variation was therefore coming from the normal map, and normal-map variation is
    // SHADING, which is smooth and directional and reads as ripples on water rather than as stones.
    // Put the contrast in the albedo and the surface stops being lit and starts being made of
    // something. `ROAD_TARMAC` is lightened to match, since this now averages well below 1.
    albedoMap: scalarTexture(gritField, 0.2, 1),
    // A NARROW band, 0.68 to 0.9. The first attempt ran 0.5 to 0.98, and half a unit of roughness
    // between one chipping and the next is not aggregate, it is wet patches: the glossy end caught
    // the sky hard enough to read as puddles scattered over the circuit.
    //
    // Detuned furthest of the three, to a 2.77 m repeat. It is the softest map of the three (a plain
    // two-octave field with no grain ramp on it), so it is the one whose broad light and dark
    // patches the eye is most able to match against their copy down the road.
    roughnessMap: detune(scalarTexture(wearField, 0.68, 0.9), 1.73),
    normalScale: 0.1,
    tileM: ROAD_TILE_M,
  }
  // Paint is a SURFACE, not a window onto the one underneath. A track's boundary line, the apron's
  // edge and the start line were all being handed the tarmac's own maps, so a white line came out
  // mottled from a fifth brightness to full and corrugated with aggregate: the one thing on the
  // ground that is meant to read as a clean painted edge was the noisiest thing in the frame.
  //
  // Not flat either. Line paint is rolled onto a rough road and takes some of it, so this keeps the
  // grit field and almost none of its strength: a tenth of the albedo swing and a thirtieth of the
  // relief. Built from the same field at the same tile, so what little shows registers with the
  // aggregate on either side of the line rather than reading as a second, unrelated surface.
  //
  // Its own normal texture rather than the tarmac's, even at the same relief. `SceneMaterials`
  // keys on the normal map's identity alone, so two details sharing one map but differing in
  // albedo or strength are indistinguishable to the cache.
  //
  // Detuned on the same factor as the tarmac's, so a white line and the road either side of it
  // agree about which map sits at which scale.
  const paint: SurfaceDetail = {
    normalMap: detune(normalTexture(gritField, 1.6), 1.31),
    albedoMap: scalarTexture(gritField, 0.93, 1),
    roughnessMap: null,
    normalScale: 0.03,
    tileM: ROAD_TILE_M,
  }
  // Grass takes the detune too. Its albedo barely varies (0.9 to 1) so it was never the loud case,
  // but a 9 m tile is a 9 m tile and the trick is free.
  const ground: SurfaceDetail = {
    normalMap: detune(normalTexture(clumpField, 1.8), 1.31),
    albedoMap: scalarTexture(clumpField, 0.9, 1),
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
  const renderField = buildField(MAP_SIZE, (x, y) => fbm(render, x, y))
  const wall: SurfaceDetail = {
    normalMap: detune(normalTexture(renderField, 1.4), 1.31),
    albedoMap: scalarTexture(renderField, 0.84, 1),
    roughnessMap: null,
    normalScale: 0.5,
    tileM: 4.5,
  }

  // The kerb's corrugation, and the one map here that is a FEATURE rather than a grain: the ridges
  // are what a kerb is to look at, and they live in a map because at 18mm deep and 300mm apart they
  // would cost more triangles than the rest of the circuit put together.
  //
  // Regular on purpose, against the anti-tiling rule above: a kerb's ridges ARE evenly spaced, so
  // the repeat is the subject rather than the tell. Only the fbm term breaks it up, and only enough
  // to keep the concrete from reading as extruded plastic.
  //
  // The field varies down V ALONE, which is what makes the ridges transverse: `kerb3d` lofts its
  // UVs along the strip (V the arc, U the width) instead of projecting them from world XZ, so the
  // corrugation crosses every kerb's own direction of travel rather than pointing one fixed way
  // across the whole map.
  //
  // The one surface here that must NOT be detuned: all three of its maps describe one set of
  // physical ridges, and sliding them onto different scales would put the dirt and the polish
  // somewhere other than the grooves and crowns they belong to.
  const RIDGES_PER_TILE = 4
  const cast = octaves(48, 3, 6151)
  const kerbField = buildField(MAP_SIZE, (x, y) => (
    0.5 - 0.5 * Math.cos(2 * Math.PI * RIDGES_PER_TILE * y) + 0.16 * fbm(cast, x, y)
  ))
  const kerb: SurfaceDetail = {
    // Relief 2, and this one is derived rather than dialled in. One tile is 1.2 m across 256 texels,
    // so a texel is 4.7 mm; the cosine's steepest slope is 0.049 of the field's range per texel, and
    // `normalTexture` differences over two of them. An 18 mm ridge therefore wants
    // 0.018 * 0.049 / 0.0047 / 2 ≈ 0.094 rad of tilt per unit of relief, which lands the flanks at
    // the ~10 degrees a real kerb's are cut to.
    normalMap: normalTexture(kerbField, 2),
    // Narrow, and biased bright: this is paint, not aggregate. The dirt collects in the grooves,
    // which is the one place a kerb's colour honestly varies.
    albedoMap: scalarTexture(kerbField, 0.78, 1),
    // Inverted on purpose (`lo` above `hi`): tyres polish the ridge tops and never touch the floor
    // between them. Multiplied by ROUGH.matte at the call site, so the kerb runs 0.61 to 0.78.
    roughnessMap: scalarTexture(kerbField, 1, 0.78),
    // Full strength, where every other map here is a fraction of it. The others are grain, meant to
    // disturb a surface; this one IS the surface's shape.
    normalScale: 1,
    tileM: 1.2,
  }

  return {
    tarmac,
    paint,
    ground,
    wall,
    kerb,
    dispose: () => {
      for (const d of [tarmac, paint, ground, wall, kerb]) {
        d.normalMap.dispose()
        d.albedoMap.dispose()
        d.roughnessMap?.dispose()
      }
    },
  }
}

/** The TREAD's grain, and the only generated map on the car.
 *
 *  A moulded slick is not a polished surface. It carries the mould's own texture plus a lap's worth
 *  of graining, and that is what stops the shoulder throwing one unbroken highlight the whole way
 *  round the tyre: a perfect silhouette streak is the single loudest thing left saying "this is a
 *  surface of revolution in a renderer".
 *
 *  Much finer than anything in the world, and pushed much less hard. A tile is five centimetres
 *  against the tarmac's three and a half metres, and the normals are a fifth of the strength: this
 *  is meant to disturb the specular sweep, not to be looked at.
 *
 *  Memoised at module scope rather than hung off `WorldDetail`, and deliberately NEVER disposed. One
 *  pair of 256px maps serves every tyre in the field, and a scene teardown that disposed them would
 *  leave the next scene's tyres sampling a dead texture. */
let rubber: SurfaceDetail | null | undefined

export function rubberDetail(): SurfaceDetail | null {
  if (rubber !== undefined) return rubber
  // No 2D canvas, no maps: node and jsdom both land here, and every consumer falls back to the flat
  // material it had before. jsdom in particular HAS a document and returns null for the context,
  // so the presence of `document` alone is not the question worth asking.
  if (typeof document === 'undefined' || !document.createElement('canvas').getContext('2d')) {
    rubber = null
    return rubber
  }
  // Three octaves topping out at 128 cells across 256 texels, so the finest feature is still two
  // texels wide: at a 5cm tile that is grain from a fifth of a millimetre up to two, which is the
  // scale rubber actually grains at.
  const pores = octaves(32, 3, 5077)
  const poreField = buildField(MAP_SIZE, (x, y) => fbm(pores, x, y))
  rubber = {
    normalMap: normalTexture(poreField, 1.8),
    // Barely there, against the tarmac's 0.2..1. Rubber's colour is uniform and the work here is
    // being done by the normals; a wide range would read as a dirty tyre rather than a grained one.
    albedoMap: scalarTexture(poreField, 0.88, 1),
    // None. The tread's polish is one number for the whole band (`rubber3d`), because that is what
    // a scrubbed slick is: evenly polished, and glossier than everything around it.
    roughnessMap: null,
    normalScale: 0.22,
    tileM: 0.05,
  }
  return rubber
}

/** Multiply a geometry's existing UVs, turning a 0..1 parameterisation into a tile count.
 *
 *  For the surfaces that DO author their own UVs, where `planarUV` and `faceUV` would be wrong: a
 *  lathe and a cylinder already run U round the axis and V along it, seam included, and all they
 *  lack is the scale that makes one repeat cover a fixed distance of surface rather than the whole
 *  part. Scaling the attribute rather than the texture's `repeat` keeps a big tyre and a small one
 *  grained at the same size while sharing one map. */
export function scaleUV(geometry: THREE.BufferGeometry, u: number, v: number): void {
  const uv = geometry.getAttribute('uv')
  if (!uv) return
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v)
  uv.needsUpdate = true
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
