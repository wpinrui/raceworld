// The source tree pack, loaded once and conformed to this scene's rules (#trees).
//
// This is the one shipped ASSET in a world that otherwise generates everything, and it earns the
// exception: photographed bark and leaf sprigs are the one surface a procedure cannot fake, and ten
// hand-built broadleaf trees give the treeline a variety no parameter sweep would.
//
// What arrives is not usable as-is, so most of this file is correction:
//
//  - the leaf material is authored `alphaMode: BLEND`, which does not write depth. Blended leaves
//    sort per-draw, so a canopy turns to soup from most angles and casts no usable shadow. Switched
//    to alpha TEST, which is both correct here and what the era did.
//  - each tree is a bark mesh and a leaf mesh under a shared parent, laid out in a ROW in the source
//    scene. Geometry is re-origined onto the foot of the TRUNK (not the centre of the bounding box,
//    which a lopsided canopy drags well off the bole) so an instance transform yaws about the trunk
//    instead of swinging the tree round a point in mid-air.
//  - nothing in the pack is low-poly. A tree is 14k-21k triangles, which is fine for the handful
//    close to the camera and impossible for the two thousand behind them, so the far tier is BAKED
//    HERE: each tree is rendered once from the side and once from above into a two-cell atlas, and
//    stands at distance as three quads. 18,552 triangles becomes 6.
//
// The impostor bakes ALBEDO, not a lit frame. A baked-lit card would keep its noon shading through
// dusk and glow through night, and this world has moods; an unlit bake on a standard material lets
// the far wood take the same sun as everything else.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { bulgeNormals } from './normals3d'

/** Served from `public/`, so these are plain URLs and Next does not process them. */
const BROADLEAF_URL = '/models/trees.glb'
const CONIFER_URL = '/models/low_poly_forest_tree_pack.glb'

/** The conifer pack's trunk/canopy pairings, read off its own layout: every other combination
 *  stands a canopy beside a bare pole. Its fourth pair is a broadleaf and is left where it is, the
 *  broadleaf pack having ten better ones. */
const CONIFER_PAIRS = [
  ['Tree_Trunk_01', 'Tree_Branches_01001'],
  ['Tree_Trunk_01001', 'Tree_Branches_01'],
  ['Tree_Trunk_01002', 'Tree_Branches_01002'],
] as const

/** Share of the population each family takes, per species. Ten broadleaves at 1 against three
 *  conifers at 0.55 puts roughly one tree in seven under needles: enough to break a wall of one
 *  leaf shape, not enough to turn an English circuit into a plantation. */
const BROADLEAF_WEIGHT = 1
const CONIFER_WEIGHT = 0.55

/** Alpha cutoff on the canopy. Low enough to keep the soft edge of a leaf, high enough that the
 *  map's feathered matte does not leave a fringe of near-transparent pixels writing depth in front
 *  of whatever stands behind the tree. */
const ALPHA_TEST = 0.45

/** Side of one impostor atlas cell, in pixels. The card is a few dozen pixels tall by the time a
 *  tree is far enough to be wearing one, so 256 is already generous; it exists to survive the
 *  moment of the tier change, not to be read. */
const IMPOSTOR_PX = 256

/** How far an impostor card's normals bend out of the card towards the crown they stand for. */
const IMPOSTOR_BULGE = 0.5

/** How far up the trunk to look when finding the foot, as a fraction of the bark mesh's height.
 *  The bottom slice of the bark IS the bole where it meets the ground, and its centroid is the point
 *  the tree should turn about. */
const FOOT_SLICE = 0.04

/** One drawable piece of a kind: a geometry, the material it shares with every other instance of
 *  it, and whether it takes the per-instance canopy tint. */
export interface PackPiece {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  /** Canopies take the colour multiply; bark recoloured green stops being bark. */
  tinted: boolean
}

/** One thing that can stand on the ground, at one detail tier. */
export interface PackKind {
  name: string
  pieces: PackPiece[]
  /** Natural height in the pack's own units, so a caller asking for a 14m tree knows what to scale
   *  by. The pack is not authored in metres and does not need to be: every tree is scaled to the
   *  height the scenery data already carries. */
  height: number
  /** Natural canopy radius, in the same units, for clearance. */
  radius: number
  tris: number
}

/** Which palette a species takes. The two packs' canopy maps are opposites: the broadleaf leaf map
 *  is a full-colour PHOTOGRAPH already the right green, the conifer needle map is a near-monochrome
 *  MASK that is grey until something colours it. One tint palette cannot serve both. */
export type TreeFamily = 'broadleaf' | 'conifer'

/** One tree, at both tiers. The two are the SAME tree, so a tier change is a change of detail and
 *  never a change of species. */
export interface TreeKind {
  near: PackKind
  far: PackKind
  family: TreeFamily
  /** Relative share of the population. Conifers ride at a fraction of a broadleaf's weight: they are
   *  seasoning on an English treeline, not the treeline. */
  weight: number
}

export interface TreePack {
  kinds: TreeKind[]
  dispose(): void
}

/** Roughness floor on a canopy. The broadleaf pack ships its leaves at 0.5, and a half-rough
 *  dielectric under a baked sky environment carries a broad specular lobe: every leaf catching the
 *  sun blew out toward white while the crown behind it stayed near-black. Foliage is matte, and the
 *  conifer needles already arrive at 1, so this is a floor and not an assignment. */
const FOLIAGE_ROUGHNESS = 0.9

/** Leaves arrive BLEND. Alpha TEST puts them back in the opaque pass: hard-edged foliage, correct
 *  depth against itself, and a shadow worth casting. Bark is opaque already. */
export function conform(material: THREE.Material, foliage: boolean): void {
  const m = material as THREE.MeshStandardMaterial
  // The pack's authored base colour is not ours to keep. It arrives as a `baseColorFactor` MULTIPLY
  // over the map, and the broadleaf bark ships (0.617, 0.604, 0.515): a 0.60 darkening laid over an
  // already dark photograph.
  //
  // MEASURED, on the maps themselves. The bark map's mean is sRGB (0.372, 0.337, 0.250), a linear
  // luminance of 0.1065, which is at the bottom of what real bark is (0.10 to 0.15). The factor took
  // it to 0.064, half of anything real, and rendered in its own canopy's shade that came out at 0.041
  // against lit grass at 0.147: 28%, which is the near-black trunk. The shading was right and the
  // surface was wrong.
  //
  // Blanket rather than aimed at the one material, and the conifer pack is the reason it can be:
  // every material in it authors (1,1,1,1) already, as does the broadleaf canopy, so this bites
  // exactly the one surface that earned it and is a no-op everywhere else. Its own trunk map sits at
  // 0.0965 untouched, which is where the broadleaf bark lands once the factor is gone: the packs
  // agree with each other after this and disagreed before it.
  //
  // Same standing as the metalness and roughness overrides below, which have always thrown away what
  // the pack authored because those values only fight this light rig.
  m.color.setScalar(1)
  if (foliage) {
    m.transparent = false
    m.alphaTest = ALPHA_TEST
    m.depthWrite = true
    m.roughness = Math.max(m.roughness, FOLIAGE_ROUGHNESS)
    // Leaf cards have no back: both faces have to light, or half the canopy goes black.
    m.side = THREE.DoubleSide
    // The shadow pass needs the cutout too, else every tree casts its bounding cards as solid.
    m.shadowSide = THREE.DoubleSide
    // Canopies carry their occlusion in the vertex colours (`bakeCanopyAO`), which the shader
    // multiplies with the material colour and the per-instance tint alike.
    m.vertexColors = true
  }
  // Vegetation is not metal, and the pack ships both materials at a half-metallic default that only
  // fights the light rig.
  m.metalness = 0
  m.needsUpdate = true
}

/** The centroid of the bark's lowest slice: where the trunk meets the ground, which is the point a
 *  tree has to turn and scale about. The bounding box centre is not it — a canopy that leans drags
 *  it metres off the bole, and every instance then swings on an invisible pivot beside the tree. */
function trunkFoot(bark: THREE.BufferGeometry): { x: number; z: number } {
  bark.computeBoundingBox()
  const box = bark.boundingBox!
  const cut = box.min.y + (box.max.y - box.min.y) * FOOT_SLICE
  const pos = bark.attributes.position
  let x = 0
  let z = 0
  let n = 0
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > cut) continue
    x += pos.getX(i)
    z += pos.getZ(i)
    n++
  }
  return n > 0
    ? { x: x / n, z: z / n }
    : { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 }
}

/** How dark the deepest interior of a canopy goes, and how fast the shading falls off from the
 *  outer shell towards the core. */
/** MEASURED, and raised from 0.55. At that value the bake was a 45% crush on the crown's interior,
 *  laid over a leaf map already at 0.171 linear luminance and under a per-instance tint averaging
 *  0.81, and the three compounded to a typical leaf albedo of 0.099 against the 0.15 to 0.20 real
 *  foliage sits at. The interior went to 0.073, which is bark.
 *
 *  It is also the same volume cue TWICE. `bulgeNormals` above lends every leaf its crown's normal,
 *  so the outer shell already shades like the surface of the volume and the interior already faces
 *  away from the light: the radial darkening was re-stating in albedo what the normals state in
 *  shading. A fifth is a trim on top of that, which is what this is meant to be, and it lifts the
 *  interior 49% while leaving the sunlit shell within 5% of where it was. */
const AO_CORE = 0.78
const AO_FALLOFF = 1.6
/** How dark the underside of a canopy goes relative to its top. A light touch, no more: the crown
 *  normal below darkens an underside by pointing it at the ground, which is the same shading arrived
 *  at honestly, and at this gradient's old strength the two multiplied and the crown went black. */
const AO_UNDER = 0.9

/** Occlusion and crown normals, baked into the canopy over its own ellipsoid.
 *
 *  Both are things the pack does NOT ship, and the normals are the half that was making the wood
 *  look unlit. A leaf card's normal describes the CARD, and the cards face every direction at once:
 *  over a whole canopy they average to nothing. Measured on this pack, the mean leaf normal has a Y
 *  of -0.07 and agrees with the outward direction of its own crown by -0.10, which is to say not at
 *  all. Half of every crown faced away from the sun and took no diffuse light. Measured on the
 *  Silverstone eye shot, turning the sun OFF ENTIRELY moved the canopy's mean luminance by 6%: the
 *  wood was lit almost wholly by ambient, which is exactly why it read as a flat dark mass with no
 *  sunward side at any hour of any mood.
 *
 *  So the crown lends each leaf its normal, weighted by how far out of the crown the leaf sits. The
 *  outer shell shades like the surface of the volume it is; the interior keeps its own card facing,
 *  where "outward" is noise anyway. The sun then models a tree the way it models everything else in
 *  the world, and an underside is dark because it faces the ground.
 *
 *  The occlusion rides along in the vertex colours, off the same ellipsoid:
 *   - RADIAL: how far out of the crown's core a leaf sits. The outer shell catches the sky, the
 *     interior is shadowed by every leaf outside it.
 *   - VERTICAL: how high up the crown a leaf sits. Now a trim rather than the whole volume cue,
 *     because the normals carry that.
 *
 *  Screen-space AO is the wrong instrument for the occlusion half: alpha-tested foliage is a field
 *  of depth discontinuities, precisely the input SSAO turns into noise, and it would cost frame time
 *  on every pixel of the scene to fix one kind of object. This is free, and evaluated once at load.
 *
 *  The colours multiply with the material colour and the per-instance tint, so all three compose. */
function shapeCanopy(geometry: THREE.BufferGeometry): void {
  // The weight is the radius itself: the shell shades fully as the crown, the core keeps its own
  // card facing, and most leaves land between the two, which keeps a crown from going billiard-ball
  // smooth. The radii come back for the occlusion below, off the same ellipsoid.
  const radius = bulgeNormals(geometry, (r) => r)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const pos = geometry.attributes.position
  const height = Math.max(box.max.y - box.min.y, 1e-6)
  const colours = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const shell = AO_CORE + (1 - AO_CORE) * Math.pow(radius[i], AO_FALLOFF)
    const up = AO_UNDER + (1 - AO_UNDER) * ((pos.getY(i) - box.min.y) / height)
    const ao = shell * up
    colours[i * 3] = ao
    colours[i * 3 + 1] = ao
    colours[i * 3 + 2] = ao
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
}

/** One tree's parts, before they are re-origined and measured. */
interface RawPart {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  foliage: boolean
}

/** Assembles one kind from its parts: pivot onto the trunk's foot, sit it on the ground, bake the
 *  canopy's occlusion, and measure what came out. */
function assemble(name: string, parts: RawPart[]): PackKind {
  const bark = parts.find((p) => !p.foliage) ?? parts[0]
  const foot = trunkFoot(bark.geometry)
  const box = new THREE.Box3()
  let tris = 0
  const pieces = parts.map(({ geometry, material, foliage }) => {
    geometry.translate(-foot.x, 0, -foot.z)
    geometry.computeBoundingBox()
    box.union(geometry.boundingBox!)
    const idx = geometry.index
    tris += (idx ? idx.count : geometry.attributes.position.count) / 3
    if (foliage) shapeCanopy(geometry)
    return { geometry, material, tinted: foliage }
  })
  // Sit the tree on the ground by its BARK, not by the union of its parts.
  //
  // Several of these trees have leaf cards that hang BELOW the foot of the trunk (one drops 5.5
  // units under a bole that starts at -2.6). Sitting the union box on the ground lifts the whole
  // tree by however far its lowest drooping leaf hangs, which floated exactly those trees a metre
  // or two into the air and left the rest correct. The trunk's foot is the ground contact; leaves
  // are allowed to hang past it, because that is what leaves do.
  const drop = bark.geometry.boundingBox!.min.y
  if (Math.abs(drop) > 1e-4) {
    for (const p of pieces) {
      p.geometry.translate(0, -drop, 0)
      p.geometry.computeBoundingBox()
    }
    box.translate(new THREE.Vector3(0, -drop, 0))
  }
  return {
    name,
    pieces,
    // Height ABOVE THE GROUND, which is now y=0, rather than the span of the bounding box: leaves
    // permitted to hang below the foot must not count towards how tall the tree is, or a tree with
    // a drooping skirt would be scaled short to compensate for its own hem.
    height: box.max.y,
    radius: Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z),
    tris,
  }
}

/** Every mesh in a file, flattened out of the node hierarchy with its world transform baked in.
 *  Baking is required, not tidiness: an importer's Z-up correction and a pack's row layout both live
 *  on ancestor nodes, so a raw geometry read comes back on its side or metres from the origin.
 *
 *  Foliage is identified HERE, in one pass over the source materials, before anything is conformed.
 *  The test is `transparent`, and `conform` clears it: with the check inline in the collect loop,
 *  the first tree to use a shared leaf material classified correctly and every tree after it read
 *  the already-corrected material and called its canopy bark.
 *
 *  The test is the material's own CUTOUT, never its name. A name test read the broadleaf pack's bark
 *  as foliage — its bark material is called `branches` — and every one of the ten broadleaf trunks
 *  then took the canopy's occlusion bake and the canopy's green per-instance tint on top of an
 *  already dark bark map. That is what turned the trunks black. Both packs mark every cutout canopy
 *  `transparent` and every trunk opaque, so the flag alone separates them; `alphaTest` covers a pack
 *  that authors its canopy glTF `MASK` instead of `BLEND`. */
function flatten(root: THREE.Object3D): { name: string; parent: THREE.Object3D; part: RawPart }[] {
  root.updateWorldMatrix(true, true)
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o) })
  const materialOf = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material[0] : m.material)
  const foliage = new Set<THREE.Material>()
  for (const m of meshes) {
    const mat = materialOf(m) as THREE.MeshStandardMaterial
    if (mat.transparent || mat.alphaTest > 0) foliage.add(mat)
  }
  const conformed = new Set<THREE.Material>()
  return meshes.map((m) => {
    const geometry = (m.geometry as THREE.BufferGeometry).clone()
    geometry.applyMatrix4(m.matrixWorld)
    // Lightmap UV sets nothing here samples, and they are pure memory across every instance.
    geometry.deleteAttribute('uv1')
    geometry.deleteAttribute('uv2')
    const material = materialOf(m)
    const isFoliage = foliage.has(material)
    if (!conformed.has(material)) {
      conformed.add(material)
      conform(material, isFoliage)
    }
    return {
      // An importer suffixes each mesh with its material; the node name is the readable half.
      name: (m.parent?.name || m.name).replace(/_[A-Za-z_0-9]*_0$/, ''),
      parent: m.parent ?? m,
      part: { geometry, material, foliage: isFoliage },
    }
  })
}

/** Trees authored as a bark child and a leaf child under one parent node: `trees.glb`. */
function collectByParent(root: THREE.Object3D): PackKind[] {
  const grouped = new Map<THREE.Object3D, RawPart[]>()
  const names = new Map<THREE.Object3D, string>()
  for (const { parent, part } of flatten(root)) {
    const list = grouped.get(parent)
    if (list) list.push(part)
    else {
      grouped.set(parent, [part])
      names.set(parent, parent.name)
    }
  }
  return [...grouped].map(([parent, parts]) => assemble(names.get(parent) ?? 'tree', parts))
}

/** Trees whose trunk and canopy are separate top-level meshes that have to be paired up by name.
 *  Read off the conifer pack's own layout: every other combination stands a canopy beside a pole. */
function collectByPairs(root: THREE.Object3D, pairs: readonly (readonly [string, string])[]): PackKind[] {
  const by = new Map(flatten(root).map((f) => [f.name, f.part]))
  return pairs
    .map(([trunk, canopy]) => {
      const parts = [by.get(trunk), by.get(canopy)].filter((p): p is RawPart => !!p)
      return parts.length === 2 ? assemble(trunk, parts) : null
    })
    .filter((k): k is PackKind => k !== null)
}

/** Bakes one tree into a two-cell atlas: side view left, top view right, both unlit albedo on
 *  transparent. Rendered through a throwaway context, read back to a canvas, and handed on as a
 *  plain texture, so nothing here holds a second live WebGL context for the session. */
function bakeAtlas(kinds: PackKind[]): THREE.CanvasTexture[] {
  const canvas = document.createElement('canvas')
  canvas.width = IMPOSTOR_PX * 2
  canvas.height = IMPOSTOR_PX
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const target = new THREE.WebGLRenderTarget(IMPOSTOR_PX, IMPOSTOR_PX, {
    colorSpace: THREE.SRGBColorSpace,
  })
  const scene = new THREE.Scene()
  const pixels = new Uint8Array(IMPOSTOR_PX * IMPOSTOR_PX * 4)
  const out: THREE.CanvasTexture[] = []

  for (const kind of kinds) {
    const group = new THREE.Group()
    // Unlit albedo: the card is lit by the world's own sun once it is standing in it, and a baked
    // noon frame would refuse to go dark at dusk.
    const flat = kind.pieces.map(({ geometry, material }) => {
      const src = material as THREE.MeshStandardMaterial
      const mat = new THREE.MeshBasicMaterial({
        map: src.map,
        color: src.color,
        transparent: true,
        alphaTest: src.alphaTest || 0.02,
        side: THREE.DoubleSide,
        // The canopy's baked occlusion rides into the impostor with it, so the far tier keeps the
        // same volume the near one has instead of flattening back out at the tier change. Only
        // where there IS one: a material told to read vertex colours off a geometry without them
        // samples nothing and renders the mesh black.
        vertexColors: !!geometry.getAttribute('color'),
      })
      group.add(new THREE.Mesh(geometry, mat))
      return mat
    })
    scene.add(group)

    // A square frame around the whole tree, so both cells share one scale and the quads below can
    // be built from the same number.
    const side = Math.max(kind.height, kind.radius * 2)
    const cy = kind.height / 2
    const cam = new THREE.OrthographicCamera(-side / 2, side / 2, side / 2, -side / 2, 0.1, side * 4)
    const sheet = document.createElement('canvas')
    sheet.width = IMPOSTOR_PX * 2
    sheet.height = IMPOSTOR_PX
    const ctx = sheet.getContext('2d')!

    const views: [THREE.Vector3, THREE.Vector3, number][] = [
      // Side: eye out along +Z, world up. The card the tree wears from the road.
      [new THREE.Vector3(0, cy, side * 2), new THREE.Vector3(0, 1, 0), 0],
      // Top: straight down, +Z falling down the image, for the map view where a crossed pair of
      // vertical cards would read as an X.
      [new THREE.Vector3(0, side * 2 + cy, 0), new THREE.Vector3(0, 0, -1), 1],
    ]
    for (const [eye, up, cell] of views) {
      cam.position.copy(eye)
      cam.up.copy(up)
      cam.lookAt(0, cy, 0)
      renderer.setRenderTarget(target)
      renderer.clear()
      renderer.render(scene, cam)
      renderer.readRenderTargetPixels(target, 0, 0, IMPOSTOR_PX, IMPOSTOR_PX, pixels)
      // `readRenderTargetPixels` hands back bottom-up rows; the ImageData goes in flipped so the
      // atlas reads the same way up as every other texture.
      const img = ctx.createImageData(IMPOSTOR_PX, IMPOSTOR_PX)
      for (let y = 0; y < IMPOSTOR_PX; y++) {
        const src = (IMPOSTOR_PX - 1 - y) * IMPOSTOR_PX * 4
        img.data.set(pixels.subarray(src, src + IMPOSTOR_PX * 4), y * IMPOSTOR_PX * 4)
      }
      ctx.putImageData(img, cell * IMPOSTOR_PX, 0)
    }

    const tex = new THREE.CanvasTexture(sheet)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    out.push(tex)

    scene.remove(group)
    for (const m of flat) m.dispose()
  }

  target.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
  return out
}

/** The far tier's geometry: two crossed vertical cards reading the atlas's side cell, and one
 *  horizontal card at canopy height reading its top cell. Six triangles, one draw, and it holds up
 *  from the road and from straight above alike. */
function impostorGeometry(kind: PackKind): THREE.BufferGeometry {
  const side = Math.max(kind.height, kind.radius * 2)
  const h = side / 2
  const cy = kind.height / 2
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  // Left cell is the side view, right cell the top. A half-texel inset stops the two bleeding into
  // each other under mip filtering.
  const eps = 0.5 / (IMPOSTOR_PX * 2)
  const card = (
    corners: [number, number, number][], normal: [number, number, number], cell: 0 | 1,
  ) => {
    const u0 = cell * 0.5 + eps
    const u1 = cell * 0.5 + 0.5 - eps
    const uvs: [number, number][] = [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      for (const i of [a, b, c]) {
        pos.push(...corners[i])
        nor.push(...normal)
        uv.push(...uvs[i])
      }
    }
  }
  // Vertical card facing +Z, then the same rotated a quarter turn to face +X.
  card([[-h, cy - h, 0], [h, cy - h, 0], [h, cy + h, 0], [-h, cy + h, 0]], [0, 0, 1], 0)
  card([[0, cy - h, h], [0, cy - h, -h], [0, cy + h, -h], [0, cy + h, h]], [1, 0, 0], 0)
  // Horizontal card at canopy height, wound so its face is up.
  card([[-h, cy, h], [h, cy, h], [h, cy, -h], [-h, cy, -h]], [0, 1, 0], 1)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  // The far tier's share of `shapeCanopy`. A quad is born with one flat normal, so three cards take
  // the sun as three flat plates: the two vertical ones face sideways, catch a grazing sun and a
  // grazing sky, and a distant treeline goes dark and stays dark whichever way the light comes from.
  // Bulging them makes the cards shade like the round thing they stand in for, so the far wood
  // lights the way the near wood does and the tier change does not announce itself. Half and half
  // rather than the near tier's ramp: a card that keeps some of its own facing still turns to the
  // light as the tree yaws, and with only six triangles there is no core to protect.
  bulgeNormals(geo, () => IMPOSTOR_BULGE)
  geo.computeBoundingBox()
  return geo
}

let pending: Promise<TreePack> | null = null

/** Where the pack is read from. Overridable because the preview probe runs off file://, where
 *  `public/` is not a served root and the .glb sits beside the page instead. */
export interface TreePackUrls {
  broadleaf?: string
  conifer?: string
}

/** Loads and conforms both packs, once per session. The promise is cached rather than the result, so
 *  two components mounting at the same time share one download instead of racing.
 *
 *  A missing or unreadable conifer pack is not fatal: the broadleaves stand on their own, and a
 *  treeless world would be a much worse failure than a treeline of one family. */
export function loadTreePack(urls: TreePackUrls = {}): Promise<TreePack> {
  if (pending) return pending
  const loader = new GLTFLoader()
  pending = Promise.all([
    loader.loadAsync(urls.broadleaf ?? BROADLEAF_URL),
    loader.loadAsync(urls.conifer ?? CONIFER_URL).catch(() => null),
  ]).then(([broadleaf, conifer]) => {
    const families: { near: PackKind; family: TreeFamily; weight: number }[] = [
      ...collectByParent(broadleaf.scene)
        .map((near) => ({ near, family: 'broadleaf' as const, weight: BROADLEAF_WEIGHT })),
      ...(conifer ? collectByPairs(conifer.scene, CONIFER_PAIRS) : [])
        .map((near) => ({ near, family: 'conifer' as const, weight: CONIFER_WEIGHT })),
    ]
    // One bake pass over every species at once, so the throwaway context is created and destroyed
    // exactly once however many packs went in.
    const atlases = bakeAtlas(families.map((f) => f.near))
    const kinds = families.map(({ near: n, family, weight }, i) => ({
      family,
      weight,
      near: n,
      far: {
        name: `${n.name}-impostor`,
        pieces: [{
          geometry: impostorGeometry(n),
          material: new THREE.MeshStandardMaterial({
            map: atlases[i],
            alphaTest: ALPHA_TEST,
            side: THREE.DoubleSide,
            shadowSide: THREE.DoubleSide,
            roughness: 1,
            metalness: 0,
          }),
          // The atlas already carries the canopy's baked occlusion; multiplying a per-instance tint
          // over it again would double variation the near tier applied once.
          tinted: false,
        }],
        height: n.height,
        radius: n.radius,
        tris: 6,
      },
    }))
    const pack: TreePack = {
      kinds,
      dispose() {
        const seen = new Set<THREE.Material>()
        for (const k of pack.kinds) {
          for (const tier of [k.near, k.far]) {
            for (const p of tier.pieces) {
              p.geometry.dispose()
              if (seen.has(p.material)) continue
              seen.add(p.material)
              for (const v of Object.values(p.material)) {
                if (v instanceof THREE.Texture) v.dispose()
              }
              p.material.dispose()
            }
          }
        }
      },
    }
    return pack
  })
  return pending
}
