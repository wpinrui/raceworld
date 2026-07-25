// Increment B of the fake-3D plan (#sim-2d): the CARS obey the same fake sun as the world they sit
// in. They are the thing the player watches for two hours and they were the flattest object on the
// screen, because a sprite that is rotated whole carries its own shading round with it -- which is
// precisely what reads as a sticker laid on the tarmac.
//
// So the shading is described in WORLD terms here and turned back out of the sprite's own rotation
// every frame. Two pieces do that: a contact shadow displaced along the light exactly as every solid
// in the world is, and a sheen across the bodywork that stays pointed at the sun while the car turns
// underneath it.
//
// Everything is in the sprite's own viewBox units, so it is free at any zoom, and pure, so the
// preview script, the tests and the live map all get the same numbers.

import { dirAt, shadowFill, shadowOpacity, shadowReach, type Lighting } from './lighting'
import { rgbToHex } from '@/lib/color'

/** Real car length. Rendered at true scale through each layout's metresPerUnit. */
export const CAR_LENGTH_M = 5.63
/** Uniform sprite shrink (proportions untouched). Everything car-locked multiplies by this:
 *  footprint, crew wheel anchors, tyre props, collision clearances. */
export const CAR_SCALE = 0.85

/** The sprite's own coordinate system (designs/F1 car.dc.html), measured off the artwork. */
export const SPRITE = {
  viewBox: '-16 0 272 520',
  aspect: 272 / 520,
  /** Front wing tip to rear wing: the drawn car spans the viewBox's full height. */
  len: 520,
  /** Centre of the viewBox, which is the point the sprite is rotated about. */
  cx: 120,
  cy: 260,
  /** Tyre centres: front axle at y=108, rear at y=398, each 90 units off the centreline. */
  wheels: [[30, 108], [210, 108], [30, 398], [210, 398]],
} as const

/** Sprite units per metre of real car. */
export const UNITS_PER_M = SPRITE.len / (CAR_LENGTH_M * CAR_SCALE)

/** The height the light actually sees: the engine cover, not the airbox tip. What matters is that the
 *  car throws a SHORT shadow -- it is the lowest thing on the circuit, and a contact shadow that
 *  reaches as far as a grandstand's would float the car off the ground instead of planting it. */
export const BODY_H_M = 0.55

export interface SheenStop {
  offset: number
  color: string
  opacity: number
}

export interface CarLight {
  /** Contact-shadow displacement in sprite units, along the world light, plus its sky-lit colour. */
  shadow: { x: number; y: number; fill: string; opacity: number }
  /** The ramp across the bodywork, as gradient endpoints in sprite units and its stops. */
  sheen: { x1: number; y1: number; x2: number; y2: number; stops: SheenStop[] }
}

/** How far the sheen's gradient runs either side of centre: the bodywork's own half-diagonal, so the
 *  ramp covers the car at any rotation without wasting range on empty space. */
const SHEEN_SPAN = 150

/** Sunlight's own colour. Warm light leaves a cream highlight, a cool sky a blue-white one; the
 *  shaded flank gets the same desaturated blue-violet every shadow in the world is filled with,
 *  because both are lit by the sky rather than by nothing. */
function litWhite(l: Lighting): string {
  const w = Math.max(-1, Math.min(1, l.warmth))
  return rgbToHex(
    Math.round(255 - Math.max(0, -w) * 18),
    Math.round(255 - Math.abs(w) * 8),
    Math.round(255 - Math.max(0, w) * 34),
  )
}

export function carLight(l: Lighting): CarLight {
  const d = dirAt(l.azimuth)
  const reach = shadowReach(l) * BODY_H_M * UNITS_PER_M
  // Overcast flattens the ramp toward nothing: no sun, no shiny side.
  const flat = 1 - l.ambient * 0.55
  const lit = litWhite(l)
  const dark = shadowFill(l)
  return {
    shadow: { x: d.x * reach, y: d.y * reach, fill: dark, opacity: shadowOpacity(l) },
    sheen: {
      // `azimuth` is the direction light TRAVELS, so the lit flank is the one it arrives from and the
      // ramp runs from there to the shaded side.
      x1: SPRITE.cx - d.x * SHEEN_SPAN,
      y1: SPRITE.cy - d.y * SHEEN_SPAN,
      x2: SPRITE.cx + d.x * SHEEN_SPAN,
      y2: SPRITE.cy + d.y * SHEEN_SPAN,
      stops: [
        { offset: 0, color: lit, opacity: 0.2 * flat },
        // The hot line along the shoulder, in from the edge where a rounded body actually catches it.
        { offset: 0.17, color: lit, opacity: 0.44 * flat },
        { offset: 0.46, color: lit, opacity: 0 },
        { offset: 0.54, color: dark, opacity: 0 },
        { offset: 1, color: dark, opacity: 0.46 * flat },
      ],
    },
  }
}

/** The shadow is displaced along the WORLD light, but it lives inside a sprite that has been rotated
 *  to the car's heading, so the displacement is turned back out of that rotation. */
export function shadowTransform(light: CarLight, spriteRot: number): string {
  const { x, y } = light.shadow
  const c = Math.cos(spriteRot)
  const s = Math.sin(spriteRot)
  return `translate(${(x * c + y * s).toFixed(2)} ${(-x * s + y * c).toFixed(2)})`
}

/** Counter-rotation that holds the sheen still against the world while the sprite turns under it.
 *  About the sprite's centre, which is the same point the sprite itself is rotated about. */
export function sheenTransform(spriteRot: number): string {
  return `rotate(${((-spriteRot * 180) / Math.PI).toFixed(2)} ${SPRITE.cx} ${SPRITE.cy})`
}

/** Sprite units of body movement at the limit, and the fraction the car foreshortens by. Deliberately
 *  bigger than life: a real car's body moves a couple of centimetres, which is a third of a pixel at
 *  racing zoom, so the cue has to be exaggerated to exist at all. */
const ROLL_UNITS = 10
const PITCH_UNITS = 6
const SQUASH = 0.018

export interface Attitude {
  /** Lateral body shift in sprite units; positive is toward the car's right. */
  roll: number
  /** Longitudinal shift in sprite units; negative is toward the nose. */
  pitch: number
  /** Longitudinal scale: any pitch angle foreshortens the car seen from above. */
  squash: number
}

export const LEVEL: Attitude = { roll: 0, pitch: 0, squash: 1 }

/** Negating zero gives -0, which reaches the DOM as a transform reading `translate(-0.00 -0.00)`. */
const noNegZero = (v: number) => (v === 0 ? 0 : v)

/** Body language from the lap's own dynamics: `lat` and `long` are the normalised accelerations out of
 *  lapDynamics, so +1 lat is a right-hander at the grip limit and -1 long is maximum braking.
 *
 *  A car leans AWAY from the corner and dips its nose under the brakes. Seen from directly above,
 *  both read as the body sliding over a shadow and a set of wheels that stay where they were. */
export function carAttitude(lat: number, long: number): Attitude {
  return {
    roll: noNegZero(-lat * ROLL_UNITS),
    pitch: noNegZero(long * PITCH_UNITS),
    squash: 1 - Math.abs(long) * SQUASH,
  }
}

/** Scale about the sprite's centre, not its origin, or the car would swim up the screen under load. */
export function bodyTransform(a: Attitude): string {
  return `translate(${a.roll.toFixed(2)} ${a.pitch.toFixed(2)}) `
    + `translate(${SPRITE.cx} ${SPRITE.cy}) scale(1 ${a.squash.toFixed(4)}) translate(${-SPRITE.cx} ${-SPRITE.cy})`
}
