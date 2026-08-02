// Trees (#trees): the biggest population in the world, drawn from the imported pack.
//
// Was: a squashed low-poly sphere on a cylinder, two albedo variants, three instanced draws. It read
// as a lollipop from anywhere close and there was nothing to vary but the colour.
//
// Now every tree is a real one out of `treepack3d`, and the three things that make that affordable
// are all here:
//
//  - INSTANCING. One draw call per (kind, piece) however many thousand trees stand on the ground.
//    A wood of 2,300 trees is a couple of dozen draws.
//  - TWO DETAIL TIERS, repacked against the CAMERA on every move. `THREE.LOD` cannot compose with
//    instancing, so the ladder is done by hand: each tree keeps ONE species and swaps between that
//    species' full mesh and its baked impostor as its distance earns it. An update walks the wood
//    and writes each tree into whichever of the two it belongs in, which is a few tens of thousands
//    of float writes: nothing beside re-submitting 18,000 triangles for a tree covering four pixels.
//  - PER-INSTANCE TINT on the near tier. A gentle multiply over the leaf map, enough that a stand
//    is not one flat green, not enough to argue with a photographed leaf.
//
// Absent the pack (tests, and the frames before the download lands) everything falls back to the old
// spheres, so the world is never treeless.

import * as THREE from 'three'
import type { SceneryTree } from '@/lib/ui/track-scenery'
import type { PackKind, TreeFamily, TreeKind, TreePack } from './treepack3d'

/** Canopy tints, multiplied over the canopy map. Both families take a near-white palette, for the
 *  same reason by two routes.
 *
 *  The broadleaf leaf map is a PHOTOGRAPH, already exactly the right green, so its tints sit near
 *  white: a couple of steps cooler, warmer, darker and lighter. Anything stronger fights the photo
 *  and the wood starts reading as painted plastic.
 *
 *  The conifer needle map is near-monochrome, and this palette used to read that as "grey until
 *  something colours it" and hand it a set of mid-dark greens to BE the colour. A multiply cannot do
 *  that. Measured, the needle map's alpha-weighted mean is sRGB (0.235, 0.267, 0.227), which is not
 *  a grey mask waiting for a hue but an already-dark grey-green: multiplying it by #6B8449 took its
 *  linear luminance from 0.054 to 0.011, so a conifer stood eleven times darker than the broadleaf
 *  next to it and read as a black cutout. The tints keep the family's cooler, greener cast, but at a
 *  value that colours the needles instead of crushing them. Conifers still come out the darker tree,
 *  because their map is darker: that difference is now the map's to make, not the palette's. */
const TINTS: Record<TreeFamily, string[]> = {
  broadleaf: ['#FFFFFF', '#EAF2DC', '#D8E4C4', '#F2ECD6', '#C9D8B4', '#E2E8CE'],
  conifer: ['#DDEBC4', '#CBDCAE', '#EAF2D8', '#BCD09C', '#D3E4BA'],
}
/** One broadleaf in this many is caught turning. Warm and desaturating rather than orange:
 *  multiplying a green photograph by orange gives mud, and this is as far as a multiply can honestly
 *  go. Conifers do not turn. */
const AUTUMN_TINT = '#E8C889'
const AUTUMN_IN = 11

/** Distance from the eye, in METRES, inside which a tree is drawn at full detail, and the distance
 *  it has to fall back past before it drops to its impostor. The gap between them is hysteresis:
 *  with one threshold, a tree sitting on the line swaps tier on every camera nudge, and that flicker
 *  is far more visible than the tier change itself.
 *
 *  A tree here is 14k-21k triangles, so this band is a budget as much as a quality dial. Where it
 *  sits was chosen by watching the tier change rather than by arithmetic: near enough that a tree
 *  swapping cards is small in frame, far enough that nothing swaps while it still reads as a tree.
 *
 *  TRIED AT 210/280 AND PUT BACK, on measurement. The near tier was 2.1M triangles, the biggest
 *  single block in the scene, and pulling the band in did remove them: the frame's triangle count
 *  halved. The frame time did not move. Triangles are not what this scene is short of, and swapping
 *  a mesh tree for an impostor trades them for something it IS short of, since a card is alpha-tested
 *  foliage and that is fill and overdraw rather than geometry. Tightening this band costs picture at
 *  the exact distance the impostors are already noticeable, and buys nothing. */
const HERO_IN_M = 260
const HERO_OUT_M = 340

/** How far the eye has to move before the wood is repacked, in metres. A camera drifting a few
 *  centimetres cannot have changed any tree's tier, and the walk is pure waste when it has not. */
const REPACK_EPS_M = 4

/** Deterministic per-tree entropy: the same circuit grows the same wood every session, and no
 *  generator state has to be threaded in from the scenery build. */
function hash2(x: number, y: number): number {
  let h = Math.imul(Math.round(x * 16) ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13) ^ Math.round(y * 16), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** One tree, resolved once at build. Its species is fixed here, so each tier's buffers can be sized
 *  exactly and an update never allocates: it only decides which of the two tiers the tree goes into
 *  this frame, and at what slot. */
interface Standing {
  x: number
  z: number
  colour: THREE.Color
  kind: TreeKind
  /** One transform serves both tiers: the impostor is baked at the tree's own scale, so near and far
   *  share a height and a footprint and the tier change moves nothing. */
  matrix: THREE.Matrix4
}

/** A tree's stance: where it stands on the ground, how high that ground is, and how tall it is.
 *
 *  The elevation is why this is not just a `SceneryTree`. That type describes a tree on the flat
 *  plane and carries a 2D blob path and a variant with it; the far land is not flat, and nothing
 *  out there needs a path. */
export interface TreeStance {
  x: number
  z: number
  /** Ground height under the tree, in world units. */
  y: number
  /** Tree height in metres. */
  h: number
}

/** The transform that stands a species on (x, z) at the tree's own height and a stable random yaw. */
function transformFor(
  t: TreeStance, kind: TreeKind, u: (m: number) => number, seed: number,
): THREE.Matrix4 {
  // The data's `h` is the tree's height in metres; the pack is authored in its own units, so the
  // ratio to the species' natural height is the scale, converted into world units on the way.
  const scale = u(t.h) / kind.near.height
  // A little non-uniform width, so one mesh does not read as one tree stamped over and over. Not
  // enough to bend a trunk visibly: this is a broad canopy against a narrow one, nothing more.
  const wobble = 0.88 + ((seed * 7919) % 1) * 0.26
  return new THREE.Matrix4().compose(
    new THREE.Vector3(t.x, t.y, t.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), seed * Math.PI * 2),
    new THREE.Vector3(scale * wobble, scale, scale * wobble),
  )
}

export interface Trees3D {
  group: THREE.Group
  /** Repack the detail tiers against a new eye. Called wherever the shadow map and the fog are
   *  refitted, i.e. once per camera move, not once per frame. Cheap enough to call on every move and
   *  guarded against a camera that has barely shifted. */
  update(eye: THREE.Vector3): void
}

export interface Trees3DInput {
  /** The imported pack. Absent, no wood is built at all: see `buildTrees3D`. */
  pack?: TreePack | null
  /** Metres per world unit, for reading the detail bands in the scenery's own space. */
  metresPerUnit?: number
  /** The far land's wood (`farland3d`), which is IMPOSTOR-ONLY. It starts past the hero band and
   *  runs to the edge of the world, so no camera the map allows can bring one close enough to earn
   *  a full mesh, and pretending otherwise would size a hero buffer per tree for slots that can
   *  never fill. They also never change tier, so they are written once at build and the per-move
   *  repack below never touches them again. */
  far?: readonly TreeStance[]
}

export function buildTrees3D(
  trees: readonly SceneryTree[], u: (m: number) => number, input: Trees3DInput = {},
): Trees3D {
  const { pack, metresPerUnit = 1, far = [] } = input
  // No pack, no trees. There used to be a fallback here that stood a sphere on a cylinder for every
  // tree, from before the imported wood existed, and it long outlived being useful: it is the only
  // thing in the scene that looks like the placeholder it is, and the pack lands within a second of
  // the map opening. An empty circuit for that second reads as a circuit still loading. A circuit
  // full of green lollipops reads as the game.
  if (!pack || pack.kinds.length === 0) {
    const empty = new THREE.Group()
    empty.name = 'trees'
    return { group: empty, update: () => {} }
  }

  // Species are drawn by WEIGHT, not uniformly: the conifers ride at a fraction of a broadleaf's
  // share. Running totals up front turn each pick into one walk of a thirteen-entry list.
  const cumulative: number[] = []
  let total = 0
  for (const k of pack.kinds) {
    total += k.weight
    cumulative.push(total)
  }

  // Every tree's species, and the tally each tier needs to size its buffers by. Both tiers of a
  // SCENERY species are sized for its whole population, because at any moment that wood can be
  // entirely in one of them: parked at the pit wall, or looking down at the circuit from above.
  // The far land's wood is sized into the impostor tier alone; it can never be anything else.
  const movers: Standing[] = []
  const parked: Standing[] = []
  const capacity = new Map<PackKind, number>()
  const bump = (k: PackKind) => capacity.set(k, (capacity.get(k) ?? 0) + 1)
  const plant = (t: TreeStance, farOnly: boolean) => {
    const seed = hash2(t.x, t.z)
    const roll = seed * total
    let pick = cumulative.findIndex((c) => roll < c)
    if (pick < 0) pick = pack.kinds.length - 1
    const kind = pack.kinds[pick]
    const tints = TINTS[kind.family]
    const turning = kind.family === 'broadleaf' && Math.floor(seed * 1000) % AUTUMN_IN === 0
    ;(farOnly ? parked : movers).push({
      x: t.x,
      z: t.z,
      colour: new THREE.Color(turning ? AUTUMN_TINT : tints[Math.floor(seed * 997) % tints.length]),
      kind,
      matrix: transformFor(t, kind, u, seed),
    })
    if (!farOnly) bump(kind.near)
    bump(kind.far)
  }
  // A `SceneryTree`'s `y` is its second GROUND axis, not a height: the scenery is laid flat.
  for (const t of trees) plant({ x: t.x, z: t.y, y: 0, h: t.h }, false)
  for (const t of far) plant(t, true)

  const group = new THREE.Group()
  group.name = 'trees'
  const meshesOf = new Map<PackKind, THREE.InstancedMesh[]>()
  // Which of the two tiers a buffer belongs to, by identity: the cost probe attributes the wood to
  // the tier it is actually spending in, and near and far are answerable by different levers.
  const impostors = new Set(pack.kinds.map((k) => k.far))
  for (const [kind, count] of capacity) {
    const tier = impostors.has(kind) ? 'far' : 'near'
    const built = kind.pieces.map((piece) => {
      const mesh = new THREE.InstancedMesh(piece.geometry, piece.material, count)
      mesh.name = `tree:${tier}`
      mesh.castShadow = true
      mesh.receiveShadow = true
      // The wood never moves, so three can skip the per-frame matrix walk for the whole population.
      mesh.matrixAutoUpdate = false
      // Instanced bounds cover the whole circuit; per-object culling only ever throws the lot away
      // or keeps it, and the test is not free at this count.
      mesh.frustumCulled = false
      // three only allocates the colour buffer once something asks for it, and every instance has to
      // carry one after that or the untouched slots multiply by black.
      if (piece.tinted) mesh.setColorAt(0, (movers[0] ?? parked[0]).colour)
      // Anything with a CUTOUT sits out the ambient occlusion pass; solid bark stays in it.
      //
      // That pass builds its depth and normals by redrawing the scene under one override material,
      // and an override carries no `alphaTest`, so every leaf CARD writes into it as a solid quad. A
      // crown then occludes itself against rectangles that are not there, which comes back as
      // hard-edged black polygons through the canopy.
      //
      // The far tier is the same fault at the other end of the wood, and worse for being clean: an
      // impostor is three big quads, so it hands the occlusion buffer a flat plate the size of the
      // whole tree where the picture has a cutout crown. Everything the plate covers, sky included,
      // is then shaded as one unoccluded surface, and a distant treeline grows pale rectangles
      // standing over it. Keying off the material's own `alphaTest` rather than off `tinted` catches
      // both tiers: `tinted` answers "does this take the canopy colour", which the impostor declines
      // for its own reason (the tint is already baked into the card), and that is a different
      // question from "is this a cutout".
      //
      // No loss: `shapeCanopy` already bakes a crown's occlusion into its vertex colours, radially
      // and vertically, once at load, and the impostor bake carries those colours onto the card. That
      // is the better answer for foliage anyway, which is a field of depth discontinuities and
      // exactly the input screen-space occlusion turns into noise.
      if ((piece.material as THREE.MeshStandardMaterial).alphaTest > 0) mesh.userData.noAO = true
      group.add(mesh)
      return mesh
    })
    meshesOf.set(kind, built)
  }

  const write = (tier: PackKind, slot: number, s: Standing): void => {
    for (const mesh of meshesOf.get(tier)!) {
      mesh.setMatrixAt(slot, s.matrix)
      if (mesh.instanceColor) mesh.setColorAt(slot, s.colour)
    }
  }

  // The far land's wood, written ONCE into the bottom of each impostor buffer. It cannot change
  // tier and it cannot move, so re-submitting it on every camera nudge would be the whole cost of
  // the far wood for none of its benefit; the repack starts its cursors above this mark instead.
  const baseline = new Map<PackKind, number>()
  for (const s of parked) {
    const slot = baseline.get(s.kind.far) ?? 0
    baseline.set(s.kind.far, slot + 1)
    write(s.kind.far, slot, s)
  }

  const cursors = new Map<PackKind, number>()
  const lastEye = new THREE.Vector3(Infinity, Infinity, Infinity)
  const inSq = (HERO_IN_M / metresPerUnit) ** 2
  const outSq = (HERO_OUT_M / metresPerUnit) ** 2
  // Which tier each tree is currently in, so the hysteresis has something to be hysteretic about.
  const isHero = new Uint8Array(movers.length)

  const update = (eye: THREE.Vector3): void => {
    if (lastEye.distanceToSquared(eye) < (REPACK_EPS_M / metresPerUnit) ** 2) return
    lastEye.copy(eye)
    for (const kind of meshesOf.keys()) cursors.set(kind, baseline.get(kind) ?? 0)

    for (let i = 0; i < movers.length; i++) {
      const s = movers[i]
      const dx = s.x - eye.x
      const dz = s.z - eye.z
      // The eye's height counts: a camera directly overhead is genuinely far from the ground.
      const d2 = dx * dx + eye.y * eye.y + dz * dz
      const hero = isHero[i] ? d2 < outSq : d2 < inSq
      isHero[i] = hero ? 1 : 0
      const tier = hero ? s.kind.near : s.kind.far
      const slot = cursors.get(tier)!
      cursors.set(tier, slot + 1)
      write(tier, slot, s)
    }

    for (const [kind, meshes] of meshesOf) {
      const count = cursors.get(kind)!
      for (const mesh of meshes) {
        mesh.count = count
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
    }
  }

  // A first pack so the world is never blank between build and the first camera move. The eye is a
  // guess; the paint that follows corrects it immediately.
  update(new THREE.Vector3(0, HERO_IN_M / metresPerUnit, 0))
  return { group, update }
}
