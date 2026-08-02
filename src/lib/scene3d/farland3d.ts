// The far land (#farland): hills and woodland past the built world, so a low camera looking up the
// road has something to stop on.
//
// The problem it solves is a geometric one. `buildWorld3D` lays the whole world on ONE flat quad
// running `GROUND_PAD` past the viewBox, which is kilometres, while everything that stands up is
// scattered inside the viewBox plus 260 m (`track-scenery`). So past a couple of hundred metres
// there is nothing at all, and from a low forward camera that emptiness ends in a dead-straight line
// under the haze: the runway that extends forever, seen from the seat rather than from above.
//
// Two pieces, both cheap by construction rather than by any culling:
//
//  - ONE polar mesh, displaced by its own fractal noise, in a single static draw. Its inner rim is
//    tucked under the flat plane and it climbs from there, so the ground the race is run on is
//    untouched: no extra vertices near the circuit, no seam, nothing to fight the painter's stack.
//  - IMPOSTOR trees, and only impostors. The pack already bakes a six-triangle card per species
//    (`treepack3d`) and `trees3d` already swaps every tree onto it past a few hundred metres, so a
//    far wood is more instances in meshes that exist, not a second tree system.

import * as THREE from 'three'
import { biomeOf, type Biome } from '@/lib/ui/biomes'
import { sampleNormal, seededRng } from '@/lib/sim/rng-utils'
import { planarUV } from './detail3d'
import { groundSurface } from './ground3d'
import { ROUGH } from './materials3d'
import type { StandSkin } from './standtex3d'
import type { TreeStance } from './trees3d'

/** How far past the viewBox the scenery plants, which is `track-scenery`'s own margin. Everything
 *  built stands inside the viewBox grown by this, so a circle on that rectangle's diagonal encloses
 *  the lot. */
const SCENERY_REACH_M = 260

/** Metres of level ground between the last thing the scenery plants and the first rise: the land
 *  must not start climbing through a grandstand or a treeline that is already standing there. */
const CLEARANCE_M = 400

/** Over how many metres the land climbs from flat to its full height. Long, because the join has to
 *  disappear: a short ramp puts a visible lip round the circuit where the plane stops being flat. */
const RAMP_M = 1200

/** How far the rise dips BELOW the flat plane at its inner rim, in metres. The belt and the plane
 *  are coplanar there and would fight in the depth buffer; a couple of metres under puts the seam
 *  inside opaque ground instead, and the ramp lifts it clear within its first few samples. */
const DIP_M = 3

/** Peak height as a multiple of the biome's own relief, and feature size as a multiple of its
 *  landform scale (`biomes`). `reliefM` and `featureM` describe the land the circuit is CUT INTO,
 *  which is graded flat around the track by design; what closes a horizon is the country behind
 *  that. Keeping both proportional to the biome is what stops Bahrain growing the Ardennes' hills.
 *
 *  The relief gain is large and has to be, and the reason is angular. A hill of height H at distance
 *  D covers atan(H/D) of the view, and the far land starts a kilometre and a half out: at the 3x
 *  this shipped with, temperate's 165 m subtended about 3 degrees against a 35 degree lens, which is
 *  a swell on the horizon rather than a landform closing it. Nine puts temperate at 495 m and the
 *  Ardennes at 765 m, which is the country those circuits are actually cut into.
 *
 *  Feature size came DOWN at the same time, and for the same view. Landforms 2.2 km across meant one
 *  and a bit of them between the first rise and the haze, so the whole far world was a single slow
 *  curve; at 1.4 the eye gets several ridges receding into each other, which is what reads as
 *  distance. */
const RELIEF_GAIN = 9
const FEATURE_GAIN = 1.4

/** How much further out the first rise can be pushed on a given bearing, as a fraction of the
 *  nominal radius.
 *
 *  Without this the land begins at one radius on every heading, and from the whole-circuit framing
 *  that reads as a crater rim with the track at the bottom. The height field itself is not radially
 *  symmetric and never looks circular; the ENVELOPE is the only part that would, so the envelope is
 *  the part that has to be broken.
 *
 *  OUTWARD only. A swing that could also pull the rise inward would be the more natural-looking
 *  envelope and it is not available: the nominal radius is already the tightest circle that clears
 *  the built world, so any bearing allowed to come inside it grows a hill through a grandstand. */
const BEARING_SWING = 0.45

/** Size of one woodland mass, in metres. Smaller than a landform: a hillside is a patchwork of wood
 *  and open ground, not one or the other. */
const WOOD_FEATURE_M = 800

/** AERIAL PERSPECTIVE, as the half of it the fog cannot do.
 *
 *  Air between the eye and a hill does two things: it scatters the hill's own light out of the path
 *  (attenuation, which is MULTIPLICATIVE) and it scatters skylight into it (airlight, which is
 *  ADDITIVE). `THREE.Fog` is the additive half and the scene already runs it. Nothing was doing the
 *  multiplicative half, which is why the far land came back the same vivid green as the grass at the
 *  camera's feet: the fog's ramp is fitted to the whole world's edge and had barely started by the
 *  time the hills were reached.
 *
 *  So the land gives its own colour up toward a cool grey with distance, and the fog then lays the
 *  sky's own light over the top of that. Ramped from the FIRST RISE rather than from the camera, at
 *  zero where the belt meets the flat ground plane: the two share a material and a scan, and any
 *  haze applied to one and not the other draws a line across the field exactly where they join.
 *
 *  TWO STOPS, not one, and this is the part a single grey gets wrong. Land does not head straight
 *  for blue: it goes dusty and olive first, keeping its own hue while losing the saturation, and
 *  only the ridges past that read as pale blue-grey. A ramp from the scan's own colour to a dirty
 *  olive-brown at the first third, then on to a pale blue-grey at the edge, gives the stacked
 *  layers that say distance, where a straight run to grey gives one flat wash. */
const AERIAL_OPEN = new THREE.Color('#FFFFFF')
const AERIAL_MID = new THREE.Color('#8C8A6E')
const AERIAL_FAR = new THREE.Color('#93A6B5')
/** Where the ramp reaches its middle stop, as a fraction of the span. */
const AERIAL_KNEE = 0.35
/** ...and how far past the first rise that span runs, in metres. */
const AERIAL_FULL_M = 7000

/** The air `t` of the way along that ramp, as the multiply to put over whatever is seen through it.
 *  Shared by the ground and by the town standing on it: two things at one distance are behind the
 *  same air, and giving them separate ramps is how a skyline ends up floating in front of its own
 *  hills. */
function aerialTint(t: number, out: THREE.Color): THREE.Color {
  if (t < AERIAL_KNEE) return out.copy(AERIAL_OPEN).lerp(AERIAL_MID, t / AERIAL_KNEE)
  return out.copy(AERIAL_MID).lerp(AERIAL_FAR, (t - AERIAL_KNEE) / (1 - AERIAL_KNEE))
}

/** Multiplied over the ground scan where the wood is thickest. Distant forest is not grass with
 *  trees on it, it is a darker, cooler green in its own right, and the cards alone cannot say that:
 *  they thin out with distance while the hillside they stand on does not. */
const WOOD_TINT = '#7E8F63'
/** How much of the mask's range the tint fades across, so a wood's edge is a gradient rather than a
 *  contour line drawn on the hill. */
const WOOD_FADE = 0.12

/** Attempted plantings. The forest mask rejects a share of them, and how large a share is the
 *  point: an arid circuit's hills come out bare and a forest circuit's come out covered, off the
 *  same number of rolls.
 *
 *  Seventy thousand, where this shipped at fourteen. Density has to be read against AREA, and the
 *  area is enormous: the belt runs from a kilometre and a half out to the edge of the world, so
 *  fourteen thousand cards over it came out as scattered specimens on open grass rather than as
 *  woodland. What they cost is the argument for spending them. A far tree is one six-triangle card
 *  in a mesh that already exists, it is written once at build and never repacked (`trees3d`), and
 *  the whole population is a few instanced draws however many of them there are. */
const PLANTINGS = 70000

/** Size of one urban mass, in metres. Far larger than a wood, and three octaves rather than four:
 *  a town is one thing with a middle and an edge, not a scatter of hamlets. */
const TOWN_FEATURE_M = 2600

/** Attempted sitings for the distant town, cut down by the urban mask the same way the plantings
 *  are cut by the forest one. */
const SITINGS = 9000

/** A distant building's plan, in metres, and how tall it stands.
 *
 *  Height is drawn on the mass's own DEPTH, not flat across it: a skyline has a middle. A block at
 *  the edge of the sprawl gets the base height, one at the heart of it gets the multiplier, and what
 *  that produces is the shape a city actually cuts against a hill, low and wide with a cluster
 *  standing up out of it. */
const TOWN_PLAN_M = 26
const TOWN_PLAN_SD_M = 9
const TOWN_H_M = 26
const TOWN_H_SD_M = 12
const TOWN_MIN_H_M = 11
const TOWN_CORE_GAIN = 2.6

/** What a distant building is made of before the air gets to it: pale, desaturated, and barely
 *  varied. Concrete and glass at range is one value with a little scatter in it, and anything more
 *  colourful reads as a toy town rather than a city. */
const TOWN_TINT = '#C2C6C9'
const TOWN_TINT_SPREAD = 0.16

/** Far trees are drawn as cards, so their height is all the size they have. Centred on a mature
 *  broadleaf, the same population the scenery plants, with a floor under it: a sapling on a ridge
 *  four kilometres out is a wasted instance. */
const TREE_H_M = 17
const TREE_H_SD_M = 3.4
const TREE_MIN_H_M = 11

/** Rings out from the circuit, and spokes round it. Spaced GEOMETRICALLY in radius so a quad stays
 *  roughly square from the near rim to the far edge: arc length grows with radius, and a uniform
 *  radial step would over-tessellate the far ring and starve the near one.
 *
 *  384 x 72 is 55,296 triangles in one static draw, which is about three of the hero trees this
 *  scene already stands next to the road (`trees3d` puts one at 14k-21k). Raised from 256 x 48 when
 *  the relief went up: a ridge nine times taller is a silhouette rather than a swell, and a
 *  silhouette is the one thing a coarse grid cannot hide. */
const SPOKES = 384
const RINGS = 72

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** Deterministic lattice hash. */
function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return (h ^ (h >>> 15)) >>> 0
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/** GRADIENT noise in [-1, 1], on a unit lattice.
 *
 *  Gradient rather than value: value noise is zero at every lattice point, so its extrema all land
 *  on the lattice and a landscape built from it wears a faint square grid in its ridges. A camera
 *  looking along the ground at a silhouette is the one view that shows that up. */
function gradientNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const dot = (cx: number, cy: number): number => {
    const a = (hash2(ix + cx, iy + cy, seed) / 4294967296) * Math.PI * 2
    return Math.cos(a) * (fx - cx) + Math.sin(a) * (fy - cy)
  }
  const u = fade(fx)
  const v = fade(fy)
  const lo = dot(0, 0) + (dot(1, 0) - dot(0, 0)) * u
  const hi = dot(0, 1) + (dot(1, 1) - dot(0, 1)) * u
  // 2D gradient noise reaches about +/-0.707 with unit gradients; scaled back up to the full range.
  return clamp01((lo + (hi - lo) * v) * 0.7071 + 0.5) * 2 - 1
}

/** Fractal sum of `gradientNoise`, in [0, 1]. */
function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let f = 1
  for (let o = 0; o < octaves; o++) {
    sum += gradientNoise(x * f, y * f, seed + o * 1013) * amp
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return clamp01(0.5 + 0.5 * (sum / norm))
}

/** FNV-1a, to turn a circuit id into the numeric seed the lattice needs. */
function hashSeed(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface FarLand3D {
  /** The hills, as one mesh. */
  group: THREE.Group
  /** Where the wood stands, for `buildTrees3D` to plant as impostors. Carries each tree's ground
   *  height with it, because out here the ground has one. */
  trees: TreeStance[]
}

export interface FarLand3DInput {
  /** The circuit's viewBox in world units: its diagonal bounds everything the scenery plants. */
  view: { x: number; y: number; w: number; h: number }
  /** How far the flat ground plane runs past that viewBox, in units. The far land stops where the
   *  plane does, so the plane's own edge is never the thing on the skyline. */
  pad: number
  metresPerUnit: number
  /** Seeds the landform and the wood, so a circuit grows the same hills every session. */
  circuitId: string
  biome?: Biome
  /** The ground scans. Present, the hills wear the same surface as the field they run out of, which
   *  is what makes the join invisible; absent (tests, and the frames before the download lands)
   *  they take `base` flat. */
  skin?: StandSkin | null
  /** Flat fill for the no-scan path. */
  base: string
}

/** The far land's shape, as the two fields everything here reads: how high the ground is at a point,
 *  and how thick the wood on it is. Split out so the mesh and the planting agree by construction
 *  rather than by two matching copies of the same arithmetic. */
function fieldsFor({ view, metresPerUnit, circuitId, biome }: FarLand3DInput) {
  const bio = biomeOf(biome)
  const u = (m: number) => m / metresPerUnit
  const seed = hashSeed(`farland:${circuitId}`)
  const cx = view.x + view.w / 2
  const cz = view.y + view.h / 2
  // The tightest circle that encloses everything built, and the tightest the land may start at.
  const builtR = Math.hypot(view.w + 2 * u(SCENERY_REACH_M), view.h + 2 * u(SCENERY_REACH_M)) / 2
  const nominal = builtR + u(CLEARANCE_M)
  const featureU = u(bio.featureM * FEATURE_GAIN)
  const woodU = u(WOOD_FEATURE_M)
  const townU = u(TOWN_FEATURE_M)
  const reliefU = u(bio.reliefM * RELIEF_GAIN)
  const rampU = u(RAMP_M)
  const dipU = u(DIP_M)

  /** Where the ground starts to climb on a given bearing, never nearer than `nominal`. Sampled on
   *  the unit circle, so it comes back round to itself at a full turn without any wrapping
   *  arithmetic. */
  const startAt = (theta: number): number => {
    const swing = 0.5 + 0.5 * gradientNoise(Math.cos(theta) * 1.7, Math.sin(theta) * 1.7, seed ^ 0x5bf03635)
    return nominal * (1 + BEARING_SWING * swing)
  }

  const heightAt = (x: number, z: number): number => {
    const dx = x - cx
    const dz = z - cz
    const t = clamp01((Math.hypot(dx, dz) - startAt(Math.atan2(dz, dx))) / rampU)
    if (t <= 0) return -dipU
    const ramp = smoothstep(t)
    return ramp * reliefU * smoothstep(fbm(x / featureU, z / featureU, seed)) - dipU * (1 - ramp)
  }

  // How much of the land carries wood, off the biome's own tree multiplier: 0.35 in the desert to
  // 4.4 in the Ardennes. The mask's own distribution is bell-shaped rather than flat, so the
  // fraction this actually yields is approximate — it is a look, not a quota.
  const cover = clamp01(bio.trees / 6)
  const woodThreshold = 0.5 + (0.5 - cover) * 0.45
  const woodAt = (x: number, z: number): number => fbm(x / woodU, z / woodU, seed ^ 0x1b873593, 4)

  // ...and how much of it is built on, off the biome's building multiplier by the same route: 1.8
  // in the Ardennes to 5.5 in a city. Three octaves rather than the wood's four, on a much larger
  // feature: a town is one mass with a middle, not a scatter of hamlets.
  const townThreshold = 0.5 + (0.5 - clamp01(bio.buildings / 8)) * 0.45
  const townAt = (x: number, z: number): number => fbm(x / townU, z / townU, seed ^ 0x7feb352d, 3)

  return { u, cx, cz, builtR, nominal, heightAt, woodAt, woodThreshold, townAt, townThreshold }
}

/** The hills, as one indexed polar grid. */
function beltGeometry(
  fields: ReturnType<typeof fieldsFor>, inner: number, outer: number,
): THREE.BufferGeometry {
  const { u, cx, cz, heightAt, woodAt, woodThreshold } = fields
  const count = SPOKES * (RINGS + 1)
  const positions = new Float32Array(count * 3)
  const colours = new Float32Array(count * 3)
  const open = new THREE.Color('#FFFFFF')
  const wood = new THREE.Color(WOOD_TINT)
  const air = new THREE.Color()
  const tint = new THREE.Color()
  const aerialSpan = u(AERIAL_FULL_M)
  for (let j = 0; j <= RINGS; j++) {
    const r = inner * (outer / inner) ** (j / RINGS)
    // The air this whole ring is seen through. Radial, so it is one value per ring rather than one
    // per vertex, and zero at the rim where the belt meets the flat plane.
    aerialTint(clamp01((r - inner) / aerialSpan), air)
    for (let i = 0; i < SPOKES; i++) {
      const theta = (i / SPOKES) * Math.PI * 2
      const x = cx + Math.cos(theta) * r
      const z = cz + Math.sin(theta) * r
      const k = (j * SPOKES + i) * 3
      positions[k] = x
      positions[k + 1] = heightAt(x, z)
      positions[k + 2] = z
      // The wood the ground carries, then the air it is seen through. In that order, because that
      // is the order the light meets them.
      tint.copy(open).lerp(wood, clamp01((woodAt(x, z) - woodThreshold) / WOOD_FADE)).multiply(air)
      colours[k] = tint.r
      colours[k + 1] = tint.g
      colours[k + 2] = tint.b
    }
  }
  // Wound so the face normal comes out +y: the ring closes on itself through the modulo, so there
  // is no duplicated seam column to keep in step.
  const index: number[] = []
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SPOKES; i++) {
      const a = j * SPOKES + i
      const b = j * SPOKES + ((i + 1) % SPOKES)
      const c = (j + 1) * SPOKES + ((i + 1) % SPOKES)
      const d = (j + 1) * SPOKES + i
      index.push(a, b, c, a, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  geo.setIndex(index)
  // SMOOTH normals, unlike everything else in this scene: the far land is the one surface out here
  // that is genuinely curved, and per-face normals would facet a hillside into 24,000 flat plates.
  geo.computeVertexNormals()
  return geo
}

/** Where the wood stands. */
function plantWood(
  fields: ReturnType<typeof fieldsFor>, circuitId: string, from: number, to: number,
): TreeStance[] {
  const { cx, cz, heightAt, woodAt, woodThreshold } = fields
  const rng = seededRng(`farland-wood:${circuitId}`)
  const trees: TreeStance[] = []
  for (let i = 0; i < PLANTINGS; i++) {
    // Radius drawn LOG-uniformly, then squared toward the near end. Uniform over the belt's area
    // would put nearly every tree at the back, where it covers a couple of pixels and the haze has
    // it anyway; this spends the instances where a card still reads as a tree, and leaves the far
    // hillsides to carry their wood as colour instead.
    const r = from * (to / from) ** (rng() ** 2)
    const theta = rng() * Math.PI * 2
    const x = cx + Math.cos(theta) * r
    const z = cz + Math.sin(theta) * r
    if (woodAt(x, z) < woodThreshold) continue
    trees.push({
      x,
      z,
      // Clamped at the plane: inside the first rise the ground really is flat, and that band is
      // where the wood matters most — it is the gap between the last of the built world and the
      // first hill.
      y: Math.max(0, heightAt(x, z)),
      h: Math.max(TREE_MIN_H_M, sampleNormal(TREE_H_M, TREE_H_SD_M, rng)),
    })
  }
  return trees
}

/** The distant town, as one instanced box.
 *
 *  BOXES, where the trees out here are cards, and the difference is which one is cheaper to get
 *  right rather than which is cheaper to draw. A card has to solve facing as the camera orbits, and
 *  it needs a silhouette baked for it; the tree pack already bakes one, and there is no equivalent
 *  for a building. A box needs no texture at all, is correct from every bearing, and at twelve
 *  triangles it costs about two cards. Nine thousand sitings cut by the mask is a few thousand
 *  blocks, which is one draw either way.
 *
 *  Nothing more than a solid: no windows, no roof furniture, no colour. Everything here is at least
 *  a kilometre and a half out and behind the aerial ramp, where a window is a fraction of a pixel
 *  and the whole block is on its way to being one flat value. */
function buildTown(
  fields: ReturnType<typeof fieldsFor>, circuitId: string, from: number, to: number,
): THREE.InstancedMesh | null {
  const { u, cx, cz, heightAt, townAt, townThreshold } = fields
  const rng = seededRng(`farland-town:${circuitId}`)
  const air = new THREE.Color()
  const base = new THREE.Color(TOWN_TINT)
  const aerialSpan = u(AERIAL_FULL_M)
  const matrices: THREE.Matrix4[] = []
  const colours: THREE.Color[] = []
  for (let i = 0; i < SITINGS; i++) {
    const r = from * (to / from) ** (rng() ** 2)
    const theta = rng() * Math.PI * 2
    const x = cx + Math.cos(theta) * r
    const z = cz + Math.sin(theta) * r
    const mask = townAt(x, z)
    if (mask < townThreshold) continue
    // How deep into the mass this block sits, which is what decides whether it is a shed on the
    // edge of town or a tower in the middle of it.
    const core = clamp01((mask - townThreshold) / 0.14)
    const h = Math.max(TOWN_MIN_H_M, sampleNormal(TOWN_H_M, TOWN_H_SD_M, rng)) * (1 + TOWN_CORE_GAIN * core)
    const w = Math.max(8, sampleNormal(TOWN_PLAN_M, TOWN_PLAN_SD_M, rng))
    const d = Math.max(8, sampleNormal(TOWN_PLAN_M, TOWN_PLAN_SD_M, rng))
    matrices.push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, Math.max(0, heightAt(x, z)), z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2),
      new THREE.Vector3(u(w), u(h), u(d)),
    ))
    // The same air the ground at this radius is behind, and a little value scatter under it so a
    // block face is not the identical grey as its neighbour's.
    aerialTint(clamp01((r - from) / aerialSpan), air)
    colours.push(new THREE.Color().copy(base)
      .multiplyScalar(1 - TOWN_TINT_SPREAD / 2 + rng() * TOWN_TINT_SPREAD).multiply(air))
  }
  if (matrices.length === 0) return null

  // Unit box with its base on the floor, so an instance's Y scale IS the building's height and it
  // stands on the ground rather than half sunk into it.
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const mesh = new THREE.InstancedMesh(
    geometry, new THREE.MeshStandardMaterial({ roughness: ROUGH.chalk }), matrices.length,
  )
  matrices.forEach((m, i) => {
    mesh.setMatrixAt(i, m)
    mesh.setColorAt(i, colours[i])
  })
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.matrixAutoUpdate = false
  // Instanced bounds cover the whole far world, so the per-object test can only ever keep the lot
  // or throw it, and it is the skyline: it is never the thing to throw.
  mesh.frustumCulled = false
  mesh.userData.noAO = true
  return mesh
}

export function buildFarLand3D(input: FarLand3DInput): FarLand3D {
  const { view, pad, skin, base } = input
  const fields = fieldsFor(input)
  const { u, builtR, nominal } = fields
  // The belt starts at the nearest rise any bearing can have, and finishes at the flat plane's own
  // far CORNER, so no bearing runs out of hill before the plane runs out of ground.
  const outer = Math.hypot(view.w + 2 * pad, view.h + 2 * pad) / 2
  const geometry = beltGeometry(fields, nominal, outer)

  const skinned = skin ? groundSurface(skin, input.biome, { vertexColors: true }) : null
  if (skinned) planarUV(geometry, u(skinned.tileM))
  const material = skinned?.material ?? new THREE.MeshStandardMaterial({
    color: base, roughness: ROUGH.chalk, side: THREE.DoubleSide, vertexColors: true,
  })

  const mesh = new THREE.Mesh(geometry, material)
  // Out of BOTH shadow passes. The sun's map is fitted to what is in shot round the circuit
  // (`refitShadow`), and stretching it over kilometres of hill would cost the cars and the pit lane
  // their resolution to shade a ridge whose own relief the normals already carry.
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.matrixAutoUpdate = false
  // Ambient occlusion is a contact effect and the far land touches nothing; the pass would redraw
  // 24,000 triangles to darken creases four kilometres away that are under a pixel wide.
  mesh.userData.noAO = true

  const group = new THREE.Group()
  group.add(mesh)
  // A town on the far land as well as wood on it. Some of what closes a horizon is landform and
  // some of it is a place: a ridge with a sprawl at its foot reads as somewhere, and a ridge on its
  // own reads as scenery.
  const town = buildTown(fields, input.circuitId, builtR, outer)
  if (town) group.add(town)
  return {
    group,
    // Planting starts where the built world stops rather than at the first hill, so the level band
    // between the two is wooded too. That band is most of what a low camera actually sees down the
    // road, and leaving it bare would just move the empty stretch further out.
    trees: plantWood(fields, input.circuitId, builtR, outer),
  }
}
