// The race map's fake light (#sim-2d). A top-down view carries no depth of its own, so every 3D cue
// on screen is an agreement between objects: they all throw shadows the same way, extrude the same
// way, and shade the same faces. That agreement used to be one frozen constant, obeyed only by the
// buildings and grandstands, which is why the map read as a diagram.
//
// Four scalars describe the whole thing. Everything else derives from them, so time of day, weather
// mood and night are DATA rather than separate rendering paths.

import { hexToRgb, rgbToHex } from '@/lib/color'

export interface Lighting {
  /** Radians: the direction light TRAVELS across the map, so shadows point this way. */
  azimuth: number
  /** 0..1. 1 = sun overhead (short shadows), 0.15 = low sun (long raking shadows). */
  elevation: number
  /** -1 cool/blue .. +1 golden. Warms lit faces and cools shadows, as real skylight does. */
  warmth: number
  /** 0..1. Overcast fills shadows in: high ambient = faint, soft, low contrast. */
  ambient: number
}

export type Mood = 'midday' | 'afternoon' | 'dusk' | 'overcast' | 'night'

const NW = (5 * Math.PI) / 12 // down-and-right on screen, i.e. the sun sits up-and-left

/** Named presets. `afternoon` is the default dry-race look: long shadows, warm light, cool shade. */
export const MOODS: Record<Mood, Lighting> = {
  midday: { azimuth: NW, elevation: 0.8, warmth: 0, ambient: 0.35 },
  afternoon: { azimuth: NW, elevation: 0.35, warmth: 0.4, ambient: 0.25 },
  dusk: { azimuth: NW + 0.5, elevation: 0.18, warmth: 0.75, ambient: 0.3 },
  overcast: { azimuth: NW, elevation: 0.6, warmth: -0.2, ambient: 0.75 },
  night: { azimuth: NW, elevation: 0.5, warmth: -0.5, ambient: 0.55 },
}

/** How far a shadow reaches per metre of height: cot(altitude), the real relationship. `elevation`
 *  maps to the sun's angle above the horizon, so 0.35 is a 31-degree sun casting a shadow ~1.6x an
 *  object's height, and 0.8 is nearly overhead. Clamped so a near-horizon sun can't throw a shadow
 *  clear across the circuit. */
export function shadowReach(l: Lighting): number {
  const altitude = Math.max(0.05, Math.min(1, l.elevation)) * (Math.PI / 2)
  return Math.max(0.15, Math.min(3, 1 / Math.tan(altitude)))
}

/** Shadow displacement for an object of the given height, in metres of world space. */
export function shadowOffset(l: Lighting, heightM: number): { x: number; y: number } {
  const reach = shadowReach(l) * heightM
  return { x: Math.cos(l.azimuth) * reach, y: Math.sin(l.azimuth) * reach }
}

/** Unit vector along the light, for extruded wall faces. */
export function lightDir(l: Lighting): { x: number; y: number } {
  return { x: Math.cos(l.azimuth), y: Math.sin(l.azimuth) }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Shadows are lit by the sky, never by nothing — so they are a desaturated blue-violet, and they
 *  go bluer as the light warms. Pure black is the single biggest tell of a flat 2D render. */
export function shadowFill(l: Lighting): string {
  const t = clamp01((l.warmth + 1) / 2)
  return rgbToHex(
    Math.round(mix(20, 26, t)),
    Math.round(mix(24, 22, t)),
    Math.round(mix(38, 56, t)),
  )
}

/** Directional shadows: strong under a hard sun, nearly gone under overcast. */
export function shadowOpacity(l: Lighting): number {
  return clamp01(0.45 * (1 - l.ambient) + 0.08)
}

/** Tint a surface colour by how much light it catches: +1 fully lit, -1 fully shaded. */
export function tintFace(hex: string, l: Lighting, exposure: number): string {
  const [r, g, b] = hexToRgb(hex)
  // Lit faces gain, shaded faces lose; ambient compresses the range toward flat.
  const gain = 1 + exposure * 0.42 * (1 - l.ambient * 0.6)
  // Warm light pushes lit surfaces to amber and shaded ones to blue.
  const warm = l.warmth * exposure * 26
  const ch = (v: number, d: number) => Math.max(0, Math.min(255, Math.round(v * gain + d)))
  return rgbToHex(ch(r, warm), ch(g, warm * 0.45), ch(b, -warm * 0.7))
}

/** The sunlit top surface of a solid — roofs, canopy tops. */
export const litFace = (hex: string, l: Lighting): string => tintFace(hex, l, 0.55)

/** The extruded wall running away from the sun. */
export const shadeFace = (hex: string, l: Lighting): string => tintFace(hex, l, -0.7)

/** Darker still, for the outline around an extruded silhouette. */
export const edgeFace = (hex: string, l: Lighting): string => tintFace(hex, l, -1)
