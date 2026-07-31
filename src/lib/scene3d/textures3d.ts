// Tile textures for the 3D world (#3d-port increment 2): the same `TILES` the 2D rasterises into
// canvas patterns, wrapped as repeating textures. Browser-only (it needs a document); the pure scene
// builders take these as OPTIONAL input and fall back to flat colour, so tests never touch a canvas.

import * as THREE from 'three'
import { TILES } from '@/lib/ui/scenery-paint'

/** Texels per metre: seats and crowd dots span fractions of a metre, and stay crisp to a closer
 *  zoom than the map allows. */
const PX_PER_M = 16

export function tileTexture(name: string): THREE.Texture | null {
  const spec = TILES[name]
  if (!spec) return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(spec.w * PX_PER_M))
  canvas.height = Math.max(1, Math.round(spec.h * PX_PER_M))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  spec.draw(ctx, (m) => m * PX_PER_M)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  // Deck UVs are authored in metres; the repeat turns metres into tile counts.
  tex.repeat.set(1 / spec.w, 1 / spec.h)
  if (spec.rot) tex.rotation = (spec.rot * Math.PI) / 180
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export interface WorldTextures {
  seats: THREE.Texture | null
  crowd: THREE.Texture | null
}

export function buildWorldTextures(): WorldTextures {
  return { seats: tileTexture('tm-seats'), crowd: tileTexture('tm-crowd') }
}
