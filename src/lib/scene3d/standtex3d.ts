// Scanned PBR sets for the grandstand, loaded into the project's existing `SurfaceDetail` shape so
// they go through `surface()` exactly like the procedurally generated grain in `detail3d` does.
//
// Two decisions worth stating, because both are about what a scan is FOR here.
//
// The concretes use their photographed albedo. A stand is mostly concrete, concrete is neutral, and
// the blotching and staining in a real scan is the thing no procedural grain gets right.
//
// Everything else is grain-only: the normal and roughness maps are taken and the albedo is thrown
// away, replaced with white so the model's own authored colour comes through unchanged. A corrugated
// steel scan is galvanised or rusted, a fabric scan is whatever colour that awning was, and a plastic
// scan is not the team's seat blue. What those scans are worth is the RIB, the WEAVE and the GRAIN,
// which live in the normal map. Taking their colour too would be letting a stranger's paint chart
// decide what the circuit looks like.

import * as THREE from 'three'
import type { SurfaceDetail } from './detail3d'

/** A scanned surface, optionally with a second scan mixed into it.
 *
 *  Blending two scans is the answer to the thing macro variation can only soften: one scan is one
 *  piece of concrete, and a whole stand made of it is a whole stand made of one piece of concrete.
 *  Two, mixed by a mask far larger than either tile, gives areas that are genuinely different
 *  material rather than the same material at a different brightness. */
export interface SkinSurface extends SurfaceDetail {
  blend?: SkinBlend
  /** The smoothstep window on the mask. Its position is what decides how MUCH of the second scan
   *  appears; its width is how hard the patch edges are. */
  maskLow: number
  maskHigh: number
  /** How big the mask's patches are, in metres. Wants to be several times the tile. */
  maskM: number
  /** How this surface is read out of its map. */
  sampling: Sampling
  /** Stochastic sampling only: the Gaussianised colour map and the lookup that inverts it. */
  gaussMap?: THREE.Texture
  lutMap?: THREE.Texture
}

/** The second scan. It carries its own Gaussianised pair because it is sampled by the SAME technique
 *  as the surface it mixes into: sampling it plainly would leave its own lattice showing inside every
 *  patch of it, which is the detiling half-done. */
export interface SkinBlend extends SurfaceDetail {
  gaussMap?: THREE.Texture
  lutMap?: THREE.Texture
}

/** How a tiling map is sampled, which is the whole question of how visible its repeat is.
 *
 *  `plain` is one fetch and one lattice. `tile` randomises each tile of that lattice, four fetches,
 *  and suits surfaces with faint structure worth keeping (concrete's form lines) and no extreme
 *  minification. `stochastic` removes the lattice entirely, three fetches plus a lookup, and needs a
 *  Gaussianised copy of the map built offline; it is for stochastic natural surfaces seen at every
 *  distance, which here means the ground. */
export type Sampling = 'plain' | 'tile' | 'stochastic'

/** Coverage to a smoothstep window. The mask is a ratio centred on 0.5, so sliding the window off
 *  centre is what makes a scan rare or dominant; the width stays put, because that is the softness
 *  of a patch edge and not its size.
 *
 *  Exported because the ground re-solves it per biome. A stand is a stand wherever it is built, but
 *  the ratio of grass to bare earth is most of what separates a forest circuit from a desert one,
 *  and that is a biome's call rather than a fixed property of the scan pair (`world3d`). */
export function maskWindow(coverage: number): { maskLow: number; maskHigh: number } {
  const centre = 0.5 + (0.5 - coverage) * 0.09
  return { maskLow: centre - 0.028, maskHigh: centre + 0.028 }
}

/** Every surface of a stand that has a scan behind it. */
export interface StandSkin {
  /** Horizontal concrete: treads, risers, gangway steps, the walked-on surfaces. */
  deck: SkinSurface
  /** Vertical concrete: rear wall, piers, towers, the rained-on surfaces. */
  wall: SkinSurface
  /** Painted structural steel: trusses, masts, rails, mullions. */
  steel: SkinSurface
  /** Profiled metal roof decking. The ribs are the whole point. */
  roof: SkinSurface
  /** The canopy's coated fabric. */
  membrane: SkinSurface
  /** Moulded seat plastic. */
  seat: SkinSurface
  /** Timber cladding on the stair towers. */
  wood: SkinSurface
  /** The ground the stand sits on. Probe scenery rather than part of the stand. */
  grass: SkinSurface
}

interface SkinSpec {
  set: string
  /** Metres of world one tile of this map spans. */
  tileM: number
  normalScale: number
  /** Take the scan's colour as well as its grain. */
  albedo: boolean
  /** Longest edge worth shipping, in pixels.
   *
   *  Derived from the tile size and the closest the camera gets, not picked by eye. The probe's
   *  tightest angle is two metres off a surface, where one metre of world spans about 580 screen
   *  pixels, so a map only has to resolve `580 x tileM` texels to be pixel-exact there. The seat's
   *  tile is 320 mm, so 256 px is already 800 texels per metre; the deck's is 2 m, so it wants 1024.
   *  Shipping everything at the deck's resolution would be four times the bytes for detail nothing
   *  can see. */
  maxPx: number
  /** A second scan mixed into this one: how big its patches are and roughly what fraction of the
   *  surface they cover. Coverage is approximate, since it comes out of a mask built from the base
   *  map's own statistics rather than from a uniform distribution. */
  blend?: { set: string; tileM: number; maskM: number; coverage: number }
  sampling: Sampling
}

const SPEC: Record<keyof StandSkin, SkinSpec> = {
  // The CLEAN board-formed scan is the base for both, with a weathered one mixed in sparingly over
  // it. That is the way round a real stand is: mostly sound concrete, with staining where rain has
  // found a route down it. Inverted, with the weathered scan as the base, a new stand reads as a
  // derelict one.
  deck: {
    set: 'concrete046', tileM: 2.2, normalScale: 0.85, albedo: true, maxPx: 1024,
    blend: { set: 'concrete042a', tileM: 2, maskM: 13, coverage: 0.22 }, sampling: 'tile',
  },
  wall: {
    set: 'concrete046', tileM: 3, normalScale: 0.9, albedo: true, maxPx: 1024,
    blend: { set: 'concrete044a', tileM: 3.2, maskM: 17, coverage: 0.28 }, sampling: 'tile',
  },
  steel: {
    set: 'metal038', tileM: 1.1, normalScale: 0.55, albedo: false, maxPx: 512, sampling: 'plain',
  },
  // The scan carries TEN ribs across its tile, so the tile size IS the rib pitch divided by ten: at
  // a metre they were 100 mm slats, correct for wall cladding and invisible on a roof fifteen metres
  // up. Five metres puts them at 500 mm, wider than any decking is rolled but sized for how a roof is
  // actually SEEN here, which is from across a circuit. The normal is pushed hard because those ribs
  // ARE the profile: there is no geometry behind them.
  //
  // Plain sampling, deliberately: the ribs are a periodic structure and randomising the tiles would
  // break the one thing this map is for. Roof decking really does repeat exactly.
  roof: {
    set: 'corrugatedsteel005', tileM: 5, normalScale: 1.35, albedo: false, maxPx: 512,
    sampling: 'plain',
  },
  membrane: {
    set: 'fabric036', tileM: 0.55, normalScale: 0.5, albedo: false, maxPx: 512, sampling: 'plain',
  },
  seat: {
    set: 'plastic015b', tileM: 0.32, normalScale: 0.45, albedo: false, maxPx: 256,
    sampling: 'plain',
  },
  // Cladding boards, so the grain runs UP the tower: the scan's grain is vertical in texture space
  // and `faceUV` maps a wall's v to world y whichever way that wall faces, so every face of the box
  // gets it standing the right way with no special casing. Per-tile randomisation only mirrors, never
  // rotates, which is what keeps that true.
  // A 2.8 m tile, not the 1.2 it started at. The scan is a fine veneer grain, and at a metre it
  // resolved to a hairline stripe that read as brushed metal rather than as timber. Boards on a
  // building are read from across a circuit, so the grain has to be sized for that; the tile size is
  // the only control over it, since the grain's scale is baked into the scan.
  wood: {
    set: 'wood058', tileM: 2.8, normalScale: 0.7, albedo: true, maxPx: 1024, sampling: 'tile',
  },
  // The ground is the surface seen at every distance from a metre to half a kilometre, and no amount
  // of modulating a lattice survives that, so it gets the full stochastic treatment. It keeps its
  // blend partner as well: detiling and blending answer DIFFERENT questions, one being "does this
  // surface repeat" and the other "is it all the same material", and a verge worn through to dirt in
  // stretches is the second one.
  // A TWO metre tile, not the four it started at, and the blade is what sets it. A scan of turf is a
  // photograph of a patch about a metre across, so stretching it over four puts every blade at four
  // times life size: from a racing camera that is coarse tussock rather than mown grass, and from
  // the air it is the reason individual blades were still resolving at a hundred metres up, where
  // real grass has long since averaged into a field. Halving the tile halves the blade, which both
  // sizes it correctly underfoot and puts it under a pixel far sooner from above. The blend and the
  // mask come down with it, so the ratio of patch to tile that was tuned here is preserved.
  //
  // The normals come down with it, 0.8 to 0.4. A scan's normal map describes blade-deep relief, and
  // this is the one surface in the world looked at from directly above with the sun high: that is
  // the geometry least able to hide a strong normal, because every bump is lit square on and throws
  // its own little shadow. At full strength the shading speckle sat on top of the albedo's own and
  // the two together read as noise rather than as grass. The generated ground grain this replaced
  // ran at 0.3 for the same reason.
  grass: {
    set: 'grass004', tileM: 2, normalScale: 0.4, albedo: true, maxPx: 512, sampling: 'stochastic',
    blend: { set: 'ground037', tileM: 2.3, maskM: 20, coverage: 0.33 },
  },
}

const fileOf = (spec: { set: string }, channel: string) =>
  `${spec.set}-${channel}.${channel === 'normal' ? 'png' : 'jpg'}`

/** Exactly the maps `loadStandSkin` will ask for, and how big each needs to be.
 *
 *  Exported so a caller that has to deliver them some other way (the probe inlines them, because a
 *  page on file:// cannot make a GL texture out of a file:// image) packs the same list rather than
 *  keeping its own copy of which scan feeds which surface. The colour map of a grain-only set is
 *  never requested, so it is never packed either. */
export function skinFiles(): { file: string; maxPx: number; normal: boolean }[] {
  const out: { file: string; maxPx: number; normal: boolean }[] = []
  const seen = new Set<string>()
  const add = (file: string, maxPx: number) => {
    if (seen.has(file)) return
    seen.add(file)
    out.push({ file, maxPx, normal: file.endsWith('.png') })
  }
  for (const spec of Object.values(SPEC)) {
    for (const channel of ['color', 'normal', 'rough']) {
      if (channel === 'color' && !spec.albedo) continue
      add(fileOf(spec, channel), spec.maxPx)
    }
    if (spec.sampling === 'stochastic') {
      add(`${spec.set}-gauss.png`, spec.maxPx)
      // The lookup is 256x1 and must not be resized: every texel of it is a distinct entry in a
      // function table, and halving it halves the histogram's resolution.
      add(`${spec.set}-lut.png`, 0)
    }
    // A blend partner is always a full colour surface: it is there to BE a different material, so
    // taking only its grain would blend a scan with a tinted copy of the first one.
    if (spec.blend) {
      for (const channel of ['color', 'normal', 'rough']) {
        add(fileOf(spec.blend, channel), spec.maxPx)
      }
      if (spec.sampling === 'stochastic') {
        add(`${spec.blend.set}-gauss.png`, spec.maxPx)
        add(`${spec.blend.set}-lut.png`, 0)
      }
    }
  }
  return out
}

/** One white texel, standing in for an albedo map that is deliberately not used. `surface()` reads
 *  `detail.albedoMap` whenever a detail is given, so suppressing a scan's colour means handing it
 *  something that multiplies to nothing rather than passing a flag down through the material. */
function whiteTexture(): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** The inverse-histogram lookup. Clamped and unmipped, because it is a function table rather than an
 *  image: wrapping it would join the darkest value to the brightest, and mipping it would average
 *  neighbouring entries into values the input never contained. sRGB, because what it stores IS the
 *  original colour map's bytes and they have to decode exactly as that map's would. */
function lookup(tex: THREE.Texture): THREE.Texture {
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function configure(tex: THREE.Texture, srgb: boolean): THREE.Texture {
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  // The UVs come out of `faceUV` already divided by the tile size, so they run to whatever the
  // surface is wide in tiles. The repeat stays at one and the wrap does the tiling.
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  // Grazing angles are most of what a ground plane IS: a 600 m sheet seen from a metre up is almost
  // entirely minified sideways, and without anisotropy the mip chain collapses it to a flat wash.
  tex.anisotropy = 16
  return tex
}

/** Break up a tiling texture with a low-frequency multiply of itself.
 *
 *  A 2 m tile across a 64 m stand repeats thirty-two times, and the eye finds that instantly: it is
 *  not the texture that reads as fake, it is the RHYTHM. The fix is not a bigger tile, which just
 *  trades repetition for softness, but a second variation at a scale far larger than the repeat, so
 *  no two areas of wall are the same brightness even where they are the same pixels.
 *
 *  The same map supplies it, sampled about eight times larger and with its axes swapped so the macro
 *  pattern cannot line up with the base one. Multiplying around the map's own mean keeps the average
 *  where the albedo normalisation put it and only redistributes it, which is why this darkens nothing
 *  overall. One extra texture fetch, no extra texture memory, no second UV set. */
export function breakTiling(mat: THREE.Material, scale = 0.13, amount = 0.55): void {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      #ifdef USE_MAP
        // Two octaves, an octave and a half apart and both off-axis, because ONE of these is itself
        // a repeating pattern: at a single macro scale the variation lands in its own regular grid,
        // coarser than the tiling it was hiding but just as findable. Beating two periods that share
        // no common multiple over the size of a stand is what stops a rhythm forming at all.
        float macroA = texture2D( map, vMapUv.yx * ${scale.toFixed(4)} ).g;
        float macroB = texture2D( map, vMapUv * ${(scale * 2.7).toFixed(4)} + 0.37 ).g;
        diffuseColor.rgb *= 1.0
          + ${amount.toFixed(4)} * ( macroA - 0.55 )
          + ${(amount * 0.55).toFixed(4)} * ( macroB - 0.55 );
      #endif`,
    )
  }
  // Two materials compiling different shaders must not be handed each other's program.
  mat.customProgramCacheKey = () => `macro-${scale}-${amount}`
}

/** Shared GLSL: a cheap 4-component hash of a tile index, and the triangle grid the stochastic
 *  sampler partitions space on. */
const HASH_GLSL = `
vec4 standHash4( vec2 p ) {
  return fract( sin( vec4(
    1.0 + dot( p, vec2( 37.0, 17.0 ) ),
    2.0 + dot( p, vec2( 11.0, 47.0 ) ),
    3.0 + dot( p, vec2( 41.0, 29.0 ) ),
    4.0 + dot( p, vec2( 23.0, 31.0 ) ) ) ) * 103.0 );
}
`

/** Technique A: sample a tiling texture with a per-tile random offset and mirror.
 *
 *  This is the one that actually removes the lattice rather than modulating it. Each tile of the
 *  repeat gets its own hashed offset and its own sign flip in x and y, so no two tiles show the same
 *  crop of the scan and the grid stops existing. The four corner tiles are sampled and cross-faded
 *  across the tile interior, because differently-offset neighbours do not line up at their shared
 *  border and a hard switch there is just a different, worse seam.
 *
 *  `textureGrad` throughout, and this is not optional: the derivatives have to come from the ORIGINAL
 *  continuous UVs. Left to work it out itself the hardware sees a UV that jumps at every tile edge,
 *  reads that as an enormous rate of change and picks the smallest mip, which draws a bright seam
 *  along every tile boundary in the distance.
 *
 *  Four fetches per map. The known weakness is that the per-tile hash aliases under heavy
 *  minification, which is why this is on walls rather than on the ground. */
const TILE_BREAK_GLSL = `
vec4 standTileBreak( sampler2D samp, vec2 uv ) {
  vec2 iuv = floor( uv );
  vec2 fuv = fract( uv );
  vec4 ofa = standHash4( iuv + vec2( 0.0, 0.0 ) );
  vec4 ofb = standHash4( iuv + vec2( 1.0, 0.0 ) );
  vec4 ofc = standHash4( iuv + vec2( 0.0, 1.0 ) );
  vec4 ofd = standHash4( iuv + vec2( 1.0, 1.0 ) );
  vec2 ddx = dFdx( uv );
  vec2 ddy = dFdy( uv );
  ofa.zw = sign( ofa.zw - 0.5 );
  ofb.zw = sign( ofb.zw - 0.5 );
  ofc.zw = sign( ofc.zw - 0.5 );
  ofd.zw = sign( ofd.zw - 0.5 );
  vec2 uva = uv * ofa.zw + ofa.xy;
  vec2 uvb = uv * ofb.zw + ofb.xy;
  vec2 uvc = uv * ofc.zw + ofc.xy;
  vec2 uvd = uv * ofd.zw + ofd.xy;
  vec2 b = smoothstep( 0.25, 0.75, fuv );
  return mix(
    mix( textureGrad( samp, uva, ddx * ofa.zw, ddy * ofa.zw ),
         textureGrad( samp, uvb, ddx * ofb.zw, ddy * ofb.zw ), b.x ),
    mix( textureGrad( samp, uvc, ddx * ofc.zw, ddy * ofc.zw ),
         textureGrad( samp, uvd, ddx * ofd.zw, ddy * ofd.zw ), b.x ), b.y );
}
`

/** Technique D: histogram-preserving stochastic sampling (Heitz & Neyret, HPG 2018).
 *
 *  Space is partitioned on a triangle grid; each vertex gets its own random translation of the
 *  texture; every pixel blends the three whose triangle it is inside. That alone would be a soft,
 *  washed-out average, because averaging three samples of a distribution shrinks its variance. The
 *  trick is that the sampled map has been remapped offline so each channel is GAUSSIAN, and Gaussians
 *  are closed under linear combination: the blend is exact there, needing only a rescale by
 *  `1 / sqrt(w1^2 + w2^2 + w3^2)` to restore the variance the weights removed. The result is then put
 *  back through the inverse of that remapping, held in a 256-wide lookup, which returns the input's
 *  own histogram exactly. Contrast, edges and colour range all survive.
 *
 *  Three fetches plus three LUT reads for the colour. Nothing repeats, at any scale, ever. */
const STOCHASTIC_GLSL = `
void standTriGrid( vec2 uv, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3 ) {
  uv *= 3.464;
  vec2 skewed = vec2( uv.x - uv.y * 0.57735027, uv.y * 1.15470054 );
  vec2 baseId = floor( skewed );
  vec3 t = vec3( fract( skewed ), 0.0 );
  t.z = 1.0 - t.x - t.y;
  if ( t.z > 0.0 ) {
    w = vec3( t.z, t.y, t.x );
    v1 = baseId;
    v2 = baseId + vec2( 0.0, 1.0 );
    v3 = baseId + vec2( 1.0, 0.0 );
  } else {
    w = vec3( -t.z, 1.0 - t.y, 1.0 - t.x );
    v1 = baseId + vec2( 1.0, 1.0 );
    v2 = baseId + vec2( 1.0, 0.0 );
    v3 = baseId + vec2( 0.0, 1.0 );
  }
}

/** How far into minification this pixel is, 0 near to 1 far, as the footprint in TILES per pixel.
 *
 *  This is the correction the technique needs to survive being looked at from the air, and it is
 *  needed BECAUSE the technique works. Mipmapping answers minification by averaging, which is right:
 *  a hundred blades of grass under one pixel are one colour, not a hundred. Histogram-preserving
 *  blending exists to undo exactly that averaging, and it cannot tell the difference between
 *  contrast lost to the three-way blend, which it should restore, and contrast lost to the mip
 *  chain, which it must not. Left alone it re-inflates every mip level back to the full range of the
 *  original scan, so a field seen from two hundred metres up keeps the per-blade contrast of a
 *  photograph taken from one metre and reads as static.
 *
 *  So the stochastic term is faded out as the footprint grows, back to an ordinary filtered sample.
 *  Nothing is lost by that: the whole purpose of the detiling is to hide a lattice, and by the far
 *  end of this ramp a tile is a few pixels of an almost flat mip level, with no structure left in it
 *  to give a lattice away.
 *
 *  The window is in tile units so it holds whatever tile a surface is authored at. At the ground's
 *  two metres it runs from a pixel covering six centimetres to one covering forty. */
float standMinify( vec2 ddx, vec2 ddy ) {
  return smoothstep( 0.03, 0.20, max( length( ddx ), length( ddy ) ) );
}

vec3 standStochastic( sampler2D gaussMap, sampler2D lutMap, sampler2D plainMap, vec2 uv ) {
  vec2 ddx = dFdx( uv );
  vec2 ddy = dFdy( uv );
  float far = standMinify( ddx, ddy );
  // textureGrad rather than texture2D on the far branch: the gradients are explicit, which is what
  // makes the sample legal inside non-uniform control flow.
  if ( far >= 0.998 ) return textureGrad( plainMap, uv, ddx, ddy ).rgb;
  vec3 w;
  vec2 v1, v2, v3;
  standTriGrid( uv, w, v1, v2, v3 );
  vec3 g = w.x * textureGrad( gaussMap, uv + standHash4( v1 ).xy, ddx, ddy ).rgb
         + w.y * textureGrad( gaussMap, uv + standHash4( v2 ).xy, ddx, ddy ).rgb
         + w.z * textureGrad( gaussMap, uv + standHash4( v3 ).xy, ddx, ddy ).rgb;
  g = ( g - 0.5 ) * inversesqrt( dot( w, w ) ) + 0.5;
  vec3 near = vec3(
    texture2D( lutMap, vec2( g.r, 0.5 ) ).r,
    texture2D( lutMap, vec2( g.g, 0.5 ) ).g,
    texture2D( lutMap, vec2( g.b, 0.5 ) ).b );
  if ( far <= 0.002 ) return near;
  return mix( near, textureGrad( plainMap, uv, ddx, ddy ).rgb, far );
}

/** The same grid and offsets, blended plainly. For normal and roughness, which are low-contrast
 *  enough that the variance loss does not read, and which have no meaningful histogram to preserve.
 *
 *  Fades the same way, and for a sharper reason: a normal map re-inflated across a minified surface
 *  is a field of shading noise standing in for geometry that is far too small to see. */
vec3 standStochasticPlain( sampler2D samp, vec2 uv ) {
  vec2 ddx = dFdx( uv );
  vec2 ddy = dFdy( uv );
  float far = standMinify( ddx, ddy );
  if ( far >= 0.998 ) return textureGrad( samp, uv, ddx, ddy ).rgb;
  vec3 w;
  vec2 v1, v2, v3;
  standTriGrid( uv, w, v1, v2, v3 );
  vec3 near = w.x * textureGrad( samp, uv + standHash4( v1 ).xy, ddx, ddy ).rgb
            + w.y * textureGrad( samp, uv + standHash4( v2 ).xy, ddx, ddy ).rgb
            + w.z * textureGrad( samp, uv + standHash4( v3 ).xy, ddx, ddy ).rgb;
  if ( far <= 0.002 ) return near;
  return mix( near, textureGrad( samp, uv, ddx, ddy ).rgb, far );
}
`

/** Mix a second scan into a material, patch by patch.
 *
 *  Where `breakTiling` redistributes one scan's brightness, this swaps the MATERIAL: colour, normal
 *  and roughness all cross-fade together, so a patch of clean concrete is genuinely a different
 *  surface from the stained concrete around it rather than a lighter version of the same pixels.
 *
 *  The mask is two low-frequency samples of the base map with a smoothstep across them, so it costs
 *  no extra texture and its patches are metres wide while both scans tile every couple of metres.
 *  Every chunk it patches (`map`, `roughnessmap`, the tangent-space branch of `normal_fragment_maps`)
 *  is inlined into the same `main`, so the mask is computed once at the diffuse stage and simply read
 *  by the two that come after it. */
export function blendSurfaces(mat: THREE.Material, base: SkinSurface): void {
  const blend = base.blend
  const mode = base.sampling
  if (mode === 'plain' && !blend) return
  const uvScale = blend ? base.tileM / blend.tileM : 1
  const maskScale = base.tileM / Math.max(base.maskM, 0.001)
  const u = uvScale.toFixed(5)

  /** How one map is read, given the sampling technique in force. Base and blend go through the SAME
   *  path: leaving the second scan on plain tiling puts its own lattice inside every patch of it,
   *  which is detiling done to one of the two materials on screen. */
  const read = (
    map: string, uv: string, scaled: boolean,
    /** The Gaussianised pair, for the one map that has a histogram worth preserving. */
    histogram?: { gauss: string; lut: string },
  ): string => {
    const at = scaled ? `${uv} * ${u}` : uv
    if (mode === 'stochastic') {
      // The histogram-preserving path is for the COLOUR alone. The lookup inverts that map's own
      // distribution, and a normal or a roughness has no share in it: pushing a normal through it
      // remaps a tangent basis centred on 0.5 onto the colour's median instead, which tilts every
      // normal on the surface by a fixed amount and lights the whole thing off-axis. Those two go
      // through the same triangle grid with the same offsets, blended plainly.
      return histogram
        ? `standStochastic( ${histogram.gauss}, ${histogram.lut}, ${map}, ${at} )`
        : `standStochasticPlain( ${map}, ${at} )`
    }
    if (mode === 'tile') return `standTileBreak( ${map}, ${at} ).rgb`
    return `texture2D( ${map}, ${at} ).rgb`
  }
  const colour = (b: boolean) => read(b ? 'blendMap' : 'map', 'vMapUv', b, {
    gauss: b ? 'blendGaussMap' : 'gaussMap', lut: b ? 'blendLutMap' : 'lutMap',
  })
  const normal = (b: boolean) => read(b ? 'blendNormalMap' : 'normalMap', 'vNormalMapUv', b)
  const rough = (b: boolean) => `${read(b ? 'blendRoughnessMap' : 'roughnessMap', 'vRoughnessMapUv', b)}.g`

  /** Mix base and blend, taking only one of the two branches wherever the mask has settled.
   *
   *  Not a micro-optimisation: each side is four or three texture fetches, and the mask is smoothed
   *  so the overwhelming majority of pixels sit at exactly 0 or 1 in the middle of a patch. The
   *  branch is coherent across whole patches, so it genuinely halves the sampling cost rather than
   *  making both wavefronts pay for both. `textureGrad` is what allows it: its gradients are
   *  explicit, so unlike an ordinary sample it is legal in non-uniform control flow. */
  const mix3 = (a: string, b: string) => `standBlend <= 0.002 ? ${a}
    : standBlend >= 0.998 ? ${b}
    : mix( ${a}, ${b}, standBlend )`

  mat.onBeforeCompile = (shader) => {
    let prelude = HASH_GLSL
    if (mode === 'tile') prelude += TILE_BREAK_GLSL
    if (mode === 'stochastic') {
      prelude += STOCHASTIC_GLSL
      shader.uniforms.gaussMap = { value: base.gaussMap }
      shader.uniforms.lutMap = { value: base.lutMap }
      prelude = `uniform sampler2D gaussMap;
uniform sampler2D lutMap;
${prelude}`
    }
    if (blend) {
      shader.uniforms.blendMap = { value: blend.albedoMap }
      shader.uniforms.blendNormalMap = { value: blend.normalMap }
      shader.uniforms.blendRoughnessMap = { value: blend.roughnessMap ?? blend.albedoMap }
      prelude = `uniform sampler2D blendMap;
uniform sampler2D blendNormalMap;
uniform sampler2D blendRoughnessMap;
${prelude}`
      if (mode === 'stochastic') {
        shader.uniforms.blendGaussMap = { value: blend.gaussMap }
        shader.uniforms.blendLutMap = { value: blend.lutMap }
        prelude = `uniform sampler2D blendGaussMap;
uniform sampler2D blendLutMap;
${prelude}`
      }
    }
    shader.fragmentShader = prelude + shader.fragmentShader

    // The mask is computed once here and read by the roughness and normal chunks after it, since all
    // three are inlined into the same `main`.
    const mask = blend
      ? `
        float maskA = texture2D( map, vMapUv.yx * ${maskScale.toFixed(5)} ).g;
        float maskB = texture2D( map, vMapUv * ${(maskScale * 2.3).toFixed(5)} + 0.31 ).g;
        // The RATIO of the two samples, not their level. Thresholding the level needs a window
        // matched to how bright the map happens to be, and that is a trap: a colour map is uploaded
        // as sRGB, so the shader is handed the LINEAR value, and a concrete whose mean reads 0.66 in
        // an image editor arrives here as 0.39. A window picked against the sRGB numbers sat entirely
        // above every value the shader ever saw, pinning the mask at zero and turning the blend off
        // completely, while looking perfectly reasonable in the source.
        //
        // A ratio has no such dependence. It is centred on 0.5 whatever the map's brightness or
        // colour space, so one window works for pale concrete and dark grass alike.
        standBlend = smoothstep( ${base.maskLow.toFixed(4)}, ${base.maskHigh.toFixed(4)},
          maskA / max( maskA + maskB, 1e-4 ) );`
      : ''

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `float standBlend = 0.0;
      #ifdef USE_MAP
        ${mask}
        diffuseColor.rgb *= ${blend ? mix3(colour(false), colour(true)) : colour(false)};
      #endif`,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `float roughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        roughnessFactor *= ${blend ? mix3(rough(false), rough(true)) : rough(false)};
      #endif`,
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
      `vec3 mapN = ( ${blend ? mix3(normal(false), normal(true)) : normal(false)} ) * 2.0 - 1.0;`,
    )
  }
  mat.customProgramCacheKey = () =>
    `skin-${mode}-${uvScale}-${maskScale}-${base.maskLow}-${blend ? 1 : 0}`
}

/** Load every set. `base` is the directory the converted maps sit in, with a trailing slash: a URL
 *  under the app, a relative path beside the page under the probe.
 *
 *  Resolves once every map is decoded, so a caller can build a scene knowing the textures are there
 *  rather than watching them pop in one at a time. */
export function loadStandSkin(
  base: string, inline?: Record<string, string>,
): Promise<StandSkin> {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager()
    const loader = new THREE.TextureLoader(manager)
    /** An inlined `data:` URI wins over the path.
     *
     *  Not an optimisation, a requirement, wherever the page is opened straight off disk. A file://
     *  document is a unique origin, so a file:// image is cross-origin data, and WebGL refuses to
     *  upload a tainted image: `texSubImage2D` throws SecurityError and the sampler reads black. A
     *  roughness map reading zero is a mirror, which is what the whole stand turns into. A `data:`
     *  URI is not cross-origin and does not taint, so it is the only way in without a browser flag. */
    const url = (file: string) => inline?.[file] ?? `${base}${file}`
    // The probe page is opened straight off file://, where every document is its own opaque origin
    // and any CORS-mode fetch is refused outright. An `<img>` is only a CORS request if it is ASKED
    // to be one, so the fix is for the crossorigin attribute never to be set.
    //
    // `undefined`, not `''`. three guards the assignment with `if (this.crossOrigin !== undefined)`
    // (ImageLoader.js:152), so undefined is the only value that leaves the attribute off the element
    // altogether. An empty string is not "no value": per the HTML spec `crossorigin=""` is the
    // Anonymous state, exactly the same as `crossorigin="anonymous"`, which is what was being
    // refused. The loader's own default is 'anonymous' too, so this has to be cleared explicitly.
    ;(loader as { crossOrigin?: string }).crossOrigin = undefined
    const white = whiteTexture()
    const skin = {} as StandSkin
    for (const key of Object.keys(SPEC) as (keyof StandSkin)[]) {
      const spec = SPEC[key]
      const blend = spec.blend
      skin[key] = {
        maskM: blend?.maskM ?? 0,
        ...maskWindow(blend?.coverage ?? 0.5),
        sampling: spec.sampling,
        ...(spec.sampling === 'stochastic' ? {
          gaussMap: configure(loader.load(url(`${spec.set}-gauss.png`)), false),
          lutMap: lookup(loader.load(url(`${spec.set}-lut.png`))),
        } : {}),
        blend: blend ? {
          albedoMap: configure(loader.load(url(fileOf(blend, 'color'))), true),
          normalMap: configure(loader.load(url(fileOf(blend, 'normal'))), false),
          roughnessMap: configure(loader.load(url(fileOf(blend, 'rough'))), false),
          normalScale: spec.normalScale,
          tileM: blend.tileM,
          ...(spec.sampling === 'stochastic' ? {
            gaussMap: configure(loader.load(url(`${blend.set}-gauss.png`)), false),
            lutMap: lookup(loader.load(url(`${blend.set}-lut.png`))),
          } : {}),
        } : undefined,
        albedoMap: spec.albedo
          ? configure(loader.load(url(fileOf(spec, 'color'))), true)
          : white,
        normalMap: configure(loader.load(url(fileOf(spec, 'normal'))), false),
        roughnessMap: configure(loader.load(url(fileOf(spec, 'rough'))), false),
        normalScale: spec.normalScale,
        tileM: spec.tileM,
      }
    }
    manager.onLoad = () => resolve(skin)
    manager.onError = (url) => reject(new Error(`texture failed: ${url}`))
  })
}
