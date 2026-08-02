// The ground stack (#3d-port increment 2): relief bands, the field quilt, terrain patches, run-off
// aprons, lakes and the garage floors, as flat fills at painter lifts — the same order `groundOps`
// paints them in. The organic shapes arrive as path strings and are sampled back to polygons here.

import * as THREE from 'three'
import { shade } from '@/lib/color'
import { biomeOf, type Biome } from '@/lib/ui/biomes'
import type { PitZone } from '@/lib/ui/pit-zone'
import type { Scenery } from '@/lib/ui/track-scenery'
import { ringsToPolys, samplePathRings } from './paths3d'
import { GeometrySink, addPolyCap } from './solids3d'
import { ROUGH, type SceneMaterials } from './materials3d'
import { blendSurfaces, maskWindow, type SkinSurface, type StandSkin } from './standtex3d'
import { planarUV, type SurfaceDetail } from './detail3d'

/** Hedgerow width, matching the 2D's stroke. */
const HEDGEROW_HALF_M = 1.1
const HEDGE = '#1F3318'

/** A path string as flat fills at a height, honouring the even-odd nesting the bands use. */
export function pathFillGeometry(d: string, y: number): THREE.BufferGeometry | null {
  const rings = samplePathRings(d)
  if (rings.length === 0) return null
  const s = new GeometrySink()
  for (const poly of ringsToPolys(rings)) addPolyCap(s, poly.contour, poly.holes, y)
  return s.empty ? null : s.build()
}

/** A closed outline stroked flat: the hedgerow round a field parcel. */
function ringStrokeGeometry(d: string, halfW: number, y: number): THREE.BufferGeometry | null {
  const rings = samplePathRings(d)
  if (rings.length === 0) return null
  const s = new GeometrySink()
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]
      const q = ring[(i + 1) % ring.length]
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
      const nx = (-(q.y - p.y) / len) * halfW
      const nz = ((q.x - p.x) / len) * halfW
      s.quad(
        { x: p.x + nx, y, z: p.y + nz }, { x: q.x + nx, y, z: q.y + nz },
        { x: q.x - nx, y, z: q.y - nz }, { x: p.x - nx, y, z: p.y - nz },
      )
    }
  }
  return s.build()
}

/** Lay the world's base plane: the ground everything else in this file is painted onto.
 *
 *  Two scanned materials rather than one flat fill, and the reason is the same one the relief wash
 *  failed on. A single colour cannot be made to look like ground by any amount of shading, because
 *  what makes real ground read is that it is not all the same MATERIAL: grass in the main, worn
 *  through to bare earth in stretches. `blendSurfaces` mixes the two and cross-fades their colour,
 *  normal and roughness together, so a worn patch is genuinely different ground rather than a
 *  browner shade of the same pixels.
 *
 *  Stochastically sampled (`standtex3d`), which is what makes this survivable at all. The plane is
 *  kilometres across and the tile is eight metres, so a plainly-tiled scan would repeat a
 *  thousand times down one straight, and a repeat at that count is not a texture, it is wallpaper.
 *  Heitz and Neyret's histogram-preserving blend removes the lattice entirely: nothing repeats, at
 *  any scale, at any distance.
 *
 *  The biome decides both halves of the mix: how much earth shows (`BiomePreset.earth`) and which
 *  earth it is (`earthScan`, sand or soil). Between them they are most of what separates one venue's
 *  ground from another's.
 *
 *  Falls back to the flat fill wherever the maps are absent, which is every test and every frame
 *  before the download lands. The world is never groundless. */
export function addGround3D(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  { skin, biome, u, fallback }: {
    /** The loaded scans, or null to take the flat path. */
    skin: StandSkin | null
    biome?: Biome
    u: (m: number) => number
    /** How this ground is laid when there is no scan behind it. */
    fallback: () => void
  },
): void {
  if (!skin) {
    fallback()
    return
  }
  const { material, tileM } = groundSurface(skin, biome)
  // World-projected, exactly as the generated grain is, so the ground and the road running through
  // it share one continuous surface and their join carries no seam.
  planarUV(geometry, u(tileM))
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'ground'
  mesh.receiveShadow = true
  group.add(mesh)
}

/** The skinned material the ground itself wears, as its own builder so anything that has to be the
 *  SAME ground can ask for it: the far land beyond the built world is the same field carrying on,
 *  and a second guess at this mix would show as a colour change at the join.
 *
 *  Returns the tile alongside, because the caller owns the UVs: the projection is world-space
 *  (`planarUV`) and only the caller knows its geometry's units. */
export function groundSurface(
  skin: StandSkin, biome?: Biome,
  /** Extra material flags for a surface that is ground but not the ground plane. */
  opts: { vertexColors?: boolean } = {},
): { material: THREE.MeshStandardMaterial; tileM: number } {
  const bio = biomeOf(biome)
  // Which earth this landscape wears. A loaded surface carries everything a blend needs (its maps,
  // its Gaussianised pair, its tile), so the soil can simply stand in for the sand the grass was
  // specified against.
  const earth = bio.earthScan === 'soil' ? skin.soil : skin.grass.blend
  // A COPY. The loaded skin is shared with every stand in the scene, and both the earth and the mask
  // window are this circuit's answer rather than the scan pair's: writing them back would put the
  // last-built world's biome on all of them.
  const surface: SkinSurface = { ...skin.grass, blend: earth, ...maskWindow(bio.earth) }
  // NO roughness map, and this is the one channel of the scan that is deliberately thrown away.
  //
  // Measured, `grass004-rough` has a mean of 0.263 and reaches 0.0. That is a wet or waxed surface,
  // and multiplied onto the ground it made the single largest object in the scene a near-mirror:
  // the far field returned the sky hard enough to blow out to white, and the sun left a specular
  // pool burnt into the grass. A scan's roughness describes the lit sample in front of the scanner,
  // and a lawn photographed from a foot away genuinely does glint; a field seen from a hundred
  // metres does not, because at that distance the blade-level glints average out to nothing.
  //
  // `chalk` flat, therefore, which is the answer this scene had already reached once: the ground
  // stack was moved to it precisely because grass sheened at grazing angles (`world3d`). The scan
  // supplies the colour and the grain, which is what it is here for; how the surface returns light
  // stays the renderer's decision.
  const material = new THREE.MeshStandardMaterial({
    map: surface.albedoMap,
    normalMap: surface.normalMap,
    normalScale: new THREE.Vector2(surface.normalScale, surface.normalScale),
    roughness: ROUGH.chalk,
    side: THREE.DoubleSide,
    vertexColors: opts.vertexColors ?? false,
  })
  blendSurfaces(material, surface)
  return { material, tileM: surface.tileM }
}

export function buildGroundStack3D(
  scenery: Scenery, pitZone: PitZone | null, u: (m: number) => number,
  materials: SceneMaterials, lift: (layer: number) => number,
  layers: { bands: number; fields: number; terrain: number; runoffs: number; floors: number },
  /** A team's colour lands on its own garage floor, exactly as `pitFloorOps` paints it. */
  garageColors?: (i: number) => string | undefined,
  /** The ground's generated grain, projected per fill. Null leaves every patch smooth. */
  detail: SurfaceDetail | null = null,
): THREE.Group {
  const group = new THREE.Group()
  const add = (geo: THREE.BufferGeometry | null, colour: string, layer: number, alpha = 1) => {
    if (!geo) return
    if (detail) planarUV(geo, u(detail.tileM))
    const mesh = new THREE.Mesh(geo, materials.get(colour, { alpha, layer, detail }))
    mesh.receiveShadow = true
    group.add(mesh)
  }
  for (const b of scenery.bands) {
    add(pathFillGeometry(b.d, lift(layers.bands)), b.fill, layers.bands)
  }
  for (const f of scenery.fields) {
    add(pathFillGeometry(f.d, lift(layers.fields)), f.fill, layers.fields, 0.75)
    add(ringStrokeGeometry(f.d, u(HEDGEROW_HALF_M), lift(layers.fields) + 0.001), HEDGE, layers.fields, 0.35)
  }
  for (const t of scenery.terrain) add(pathFillGeometry(t.d, lift(layers.terrain)), t.fill, layers.terrain)
  for (const r of scenery.runoffs) add(pathFillGeometry(r.d, lift(layers.runoffs)), r.fill, layers.runoffs)
  if (pitZone) {
    // A garage floor sits in the building's own shade in the 2D; the albedo carries that darkening
    // because the recess is too shallow for the real shadow map to supply it.
    const byColour = new Map<string, GeometrySink>()
    pitZone.garageFloors.forEach((r, i) => {
      const team = garageColors?.(i)
      const colour = team ? shade(team, 0.55) : '#2A2F38'
      let s = byColour.get(colour)
      if (!s) {
        s = new GeometrySink()
        byColour.set(colour, s)
      }
      addPolyCap(s, r, [], lift(layers.floors))
    })
    for (const [colour, s] of byColour) add(s.empty ? null : s.build(), colour, layers.floors)
  }
  return group
}
