import { describe, expect, it } from 'vitest'
import {
  BODY_H_M, LEVEL, SPRITE, STRAIGHT, TRACK_M, UNITS_PER_M, WHEELBASE_M, bodyTransform, carAttitude,
  carLight, shadowTransform, sheenTransform, steerAngles, steerTransform,
} from './car-sprite'
import { MOODS, dirAt, shadowReach } from './lighting'
import { hexToRgb } from '@/lib/color'

/** Apply a `translate(x y)` / `scale(x y)` transform list to a point, left to right as SVG does. */
function applyTransform(list: string, px: number, py: number): { x: number; y: number } {
  let x = px
  let y = py
  const ops = [...list.matchAll(/(translate|scale|rotate)\(([^)]*)\)/g)].reverse()
  for (const [, op, args] of ops) {
    const a = args.trim().split(/[\s,]+/).map(Number)
    if (op === 'translate') { x += a[0]; y += a[1] ?? 0 }
    else if (op === 'scale') { x *= a[0]; y *= a[1] ?? a[0] }
    else {
      const th = (a[0] * Math.PI) / 180
      const cx = a[1] ?? 0
      const cy = a[2] ?? 0
      const dx = x - cx
      const dy = y - cy
      x = cx + dx * Math.cos(th) - dy * Math.sin(th)
      y = cy + dx * Math.sin(th) + dy * Math.cos(th)
    }
  }
  return { x, y }
}

describe('carLight', () => {
  it('throws the shadow along the light, as far as the body is tall', () => {
    const l = MOODS.afternoon
    const { shadow } = carLight(l)
    const d = dirAt(l.azimuth)
    const reach = shadowReach(l) * BODY_H_M * UNITS_PER_M
    expect(shadow.x).toBeCloseTo(d.x * reach, 10)
    expect(shadow.y).toBeCloseTo(d.y * reach, 10)
    // A car is the lowest thing on the circuit: its shadow stays under it, not out across the tarmac.
    expect(Math.hypot(shadow.x, shadow.y)).toBeLessThan(SPRITE.len * 0.2)
  })

  it('is never filled with black, because a real shadow is lit by the sky', () => {
    for (const mood of Object.values(MOODS)) {
      const [r, g, b] = hexToRgb(carLight(mood).shadow.fill)
      expect(r + g + b).toBeGreaterThan(0)
      expect(b).toBeGreaterThan(r) // blue-violet, matching every other shadow in the world
    }
  })

  it('runs the sheen from the sun to the shaded flank, through the sprite centre', () => {
    const l = MOODS.afternoon
    const { sheen } = carLight(l)
    const d = dirAt(l.azimuth)
    expect((sheen.x1 + sheen.x2) / 2).toBeCloseTo(SPRITE.cx, 10)
    expect((sheen.y1 + sheen.y2) / 2).toBeCloseTo(SPRITE.cy, 10)
    // Stop 0 is the bright end, so it must sit on the side the light ARRIVES from.
    const toStart = { x: sheen.x1 - SPRITE.cx, y: sheen.y1 - SPRITE.cy }
    expect(toStart.x * d.x + toStart.y * d.y).toBeLessThan(0)
  })

  it('orders the sheen stops and keeps the bright end brightest', () => {
    const { sheen } = carLight(MOODS.afternoon)
    for (let i = 1; i < sheen.stops.length; i++) {
      expect(sheen.stops[i].offset).toBeGreaterThanOrEqual(sheen.stops[i - 1].offset)
    }
    expect(sheen.stops[0].opacity).toBeGreaterThan(0)
    expect(sheen.stops[sheen.stops.length - 1].opacity).toBeGreaterThan(0)
    // The middle of the body is left alone: the livery has to survive this.
    const mid = sheen.stops.filter((s) => s.offset > 0.4 && s.offset < 0.6)
    expect(mid.length).toBeGreaterThan(0)
    for (const s of mid) expect(s.opacity).toBe(0)
  })

  it('flattens under overcast and lifts under a hard sun', () => {
    const dull = carLight(MOODS.overcast)
    const hard = carLight(MOODS.afternoon)
    const peak = (stops: { opacity: number }[]) => Math.max(...stops.map((s) => s.opacity))
    expect(peak(dull.sheen.stops)).toBeLessThan(peak(hard.sheen.stops))
    expect(dull.shadow.opacity).toBeLessThan(hard.shadow.opacity)
  })

  it('tints the highlight with the light: cream under a warm sun, blue-white under a cold sky', () => {
    const warm = hexToRgb(carLight({ ...MOODS.afternoon, warmth: 0.8 }).sheen.stops[0].color)
    expect(warm[0]).toBeGreaterThan(warm[2])
    const cool = hexToRgb(carLight({ ...MOODS.afternoon, warmth: -0.8 }).sheen.stops[0].color)
    expect(cool[2]).toBeGreaterThan(cool[0])
  })
})

describe('shadowTransform', () => {
  const light = carLight(MOODS.afternoon)

  it('leaves the offset alone when the sprite is not turned', () => {
    const { x, y } = applyTransform(shadowTransform(light, 0), 0, 0)
    expect(x).toBeCloseTo(light.shadow.x, 2)
    expect(y).toBeCloseTo(light.shadow.y, 2)
  })

  it('keeps the shadow pointing the same way in the WORLD at every heading', () => {
    // Undo the sprite's own rotation the way the browser will: the offset the transform asks for,
    // rotated BY the sprite's rotation, has to come back out as the world offset every time. Slack of
    // 0.05 sprite units, which is what the transform strings' two decimal places are worth.
    for (const rot of [0, 0.4, 1.2, Math.PI, 4.5, -2.2]) {
      const p = applyTransform(shadowTransform(light, rot), 0, 0)
      const wx = p.x * Math.cos(rot) - p.y * Math.sin(rot)
      const wy = p.x * Math.sin(rot) + p.y * Math.cos(rot)
      expect(wx).toBeCloseTo(light.shadow.x, 1)
      expect(wy).toBeCloseTo(light.shadow.y, 1)
    }
  })
})

describe('sheenTransform', () => {
  it('counter-rotates about the same centre the sprite turns about', () => {
    for (const rot of [0.3, 1.9, -0.7]) {
      // A point offset from the centre, counter-rotated then rotated back by the sprite, returns.
      const p = applyTransform(sheenTransform(rot), SPRITE.cx + 100, SPRITE.cy)
      const dx = p.x - SPRITE.cx
      const dy = p.y - SPRITE.cy
      expect(dx * Math.cos(rot) - dy * Math.sin(rot)).toBeCloseTo(100, 1)
      expect(dx * Math.sin(rot) + dy * Math.cos(rot)).toBeCloseTo(0, 1)
    }
    // The centre itself never moves.
    const c = applyTransform(sheenTransform(1.1), SPRITE.cx, SPRITE.cy)
    expect(c.x).toBeCloseTo(SPRITE.cx, 6)
    expect(c.y).toBeCloseTo(SPRITE.cy, 6)
  })

  it('slides the highlight toward the flank that lifts, and not at all on a level car', () => {
    const level = applyTransform(sheenTransform(0, LEVEL), SPRITE.cx, SPRITE.cy)
    expect(level.x).toBeCloseTo(SPRITE.cx, 6)
    // A right-hander rolls the car onto its left, lifting the right flank into the light.
    const right = applyTransform(sheenTransform(0, carAttitude(1, 0)), SPRITE.cx, SPRITE.cy)
    expect(right.x).toBeGreaterThan(SPRITE.cx)
    const left = applyTransform(sheenTransform(0, carAttitude(-1, 0)), SPRITE.cx, SPRITE.cy)
    expect(left.x).toBeLessThan(SPRITE.cx)
    // Braking and traction pitch the car; they do not move the highlight across it.
    const braking = applyTransform(sheenTransform(0, carAttitude(0, -1)), SPRITE.cx, SPRITE.cy)
    expect(braking.x).toBeCloseTo(SPRITE.cx, 6)
    expect(braking.y).toBeCloseTo(SPRITE.cy, 6)
  })

  it('slides in the CAR frame, so the ramp keeps facing the sun whatever the heading', () => {
    // The rotation the transform applies must not change when the car takes on roll.
    const att = carAttitude(1, 0)
    for (const rot of [0.6, 2.4]) {
      const plain = applyTransform(sheenTransform(rot), SPRITE.cx + 100, SPRITE.cy)
      const rolled = applyTransform(sheenTransform(rot, att), SPRITE.cx + 100, SPRITE.cy)
      // Same rotation, pure offset between them.
      expect(rolled.x - plain.x).toBeCloseTo(-att.roll * 1.6, 1)
      expect(rolled.y - plain.y).toBeCloseTo(0, 1)
    }
  })
})

describe('carAttitude', () => {
  it('sits level with no load on the car', () => {
    expect(carAttitude(0, 0)).toEqual(LEVEL)
  })

  it('leans away from the corner', () => {
    expect(carAttitude(1, 0).roll).toBeLessThan(0) // right-hander: body goes to the car's left
    expect(carAttitude(-1, 0).roll).toBeGreaterThan(0)
    expect(carAttitude(0.5, 0).roll).toBeCloseTo(carAttitude(1, 0).roll / 2, 10)
  })

  it('dips toward the nose under braking and settles back under power', () => {
    expect(carAttitude(0, -1).pitch).toBeLessThan(0) // the nose is at low y in sprite space
    expect(carAttitude(0, 1).pitch).toBeGreaterThan(0)
  })

  it('foreshortens the car under load either way, because any pitch angle does', () => {
    expect(carAttitude(0, -1).squash).toBeLessThan(1)
    expect(carAttitude(0, 1).squash).toBeLessThan(1)
    expect(carAttitude(0, 0).squash).toBe(1)
  })

  it('stays subtle enough to read as a car and not as a rubber toy', () => {
    // Exaggerated, but the body may never move so far that it reads as a skid rather than a lean:
    // measured against the car's own length, nothing shifts by more than a twentieth of it.
    for (const [lat, long] of [[1, 1], [-1, -1], [1, -1]]) {
      const a = carAttitude(lat, long)
      expect(Math.abs(a.roll)).toBeLessThan(SPRITE.len * 0.05)
      expect(Math.abs(a.pitch)).toBeLessThan(SPRITE.len * 0.05)
      expect(a.squash).toBeGreaterThan(0.95)
    }
  })
})

describe('steerAngles', () => {
  it('points the wheels straight ahead on a straight', () => {
    expect(steerAngles(0)).toEqual(STRAIGHT)
    expect(steerAngles(NaN)).toEqual(STRAIGHT)
  })

  it('turns the wheels the way the corner goes', () => {
    const right = steerAngles(1 / 30)
    expect(right.left).toBeGreaterThan(0)
    expect(right.right).toBeGreaterThan(0)
    const left = steerAngles(-1 / 30)
    expect(left.left).toBeLessThan(0)
    expect(left.right).toBeLessThan(0)
    // Mirror image of each other, corner for corner.
    expect(left.left).toBeCloseTo(-right.right, 10)
    expect(left.right).toBeCloseTo(-right.left, 10)
  })

  it('gives the INNER wheel more lock than the outer, which is Ackermann', () => {
    const right = steerAngles(1 / 20)
    expect(Math.abs(right.right)).toBeGreaterThan(Math.abs(right.left))
    const left = steerAngles(-1 / 20)
    expect(Math.abs(left.left)).toBeGreaterThan(Math.abs(left.right))
  })

  it('is the angle the radius actually demands of this wheelbase', () => {
    const r = 40
    const { left, right } = steerAngles(1 / r)
    const deg = (rad: number) => (rad * 180) / Math.PI
    expect(right).toBeCloseTo(deg(Math.atan(WHEELBASE_M / (r - TRACK_M / 2))), 10)
    expect(left).toBeCloseTo(deg(Math.atan(WHEELBASE_M / (r + TRACK_M / 2))), 10)
  })

  it('asks for more lock the tighter the corner', () => {
    const locks = [400, 120, 50, 25, 12].map((r) => steerAngles(1 / r).right)
    for (let i = 1; i < locks.length; i++) expect(locks[i]).toBeGreaterThan(locks[i - 1])
    // A fast sweep is nearly straight, a hairpin is obvious. Both are what a real car does.
    expect(locks[0]).toBeLessThan(1)
    expect(locks[locks.length - 1]).toBeGreaterThan(8)
  })

  it('winds on extra lock with the cornering load, because tyres need a slip angle', () => {
    const r = 1 / 60
    const unloaded = steerAngles(r)
    const loaded = steerAngles(r, 2.5)
    expect(loaded.right).toBeGreaterThan(unloaded.right)
    expect(loaded.left).toBeGreaterThan(unloaded.left)
    // Proportional to the load: twice the g, twice the extra.
    const half = steerAngles(r, 1.25)
    expect(loaded.right - unloaded.right).toBeCloseTo(2 * (half.right - unloaded.right), 10)
  })

  it('gives the slip angle to the whole axle, leaving Ackermann to the geometry', () => {
    const r = 1 / 40
    const gap = (s: { left: number; right: number }) => s.right - s.left
    // Both wheels gain the same slip angle, so the difference BETWEEN them is untouched by load.
    expect(gap(steerAngles(r, 3))).toBeCloseTo(gap(steerAngles(r)), 10)
  })

  it('takes the corner direction from the curvature, never from the load', () => {
    // A left-hander under load still steers left, whichever sign the load arrives with.
    for (const g of [2.5, -2.5]) {
      const s = steerAngles(-1 / 40, g)
      expect(s.left).toBeLessThan(0)
      expect(s.right).toBeLessThan(0)
    }
    expect(steerAngles(-1 / 40, 2.5)).toEqual(steerAngles(-1 / 40, -2.5))
  })

  it('ignores a load it cannot use', () => {
    expect(steerAngles(1 / 40, NaN)).toEqual(steerAngles(1 / 40, 0))
  })

  it('never exceeds full lock, whatever nonsense the curvature or the load is', () => {
    for (const c of [1, 10, 1e6, -1e6]) {
      const s = steerAngles(c, 40)
      expect(Math.abs(s.left)).toBeLessThanOrEqual(28)
      expect(Math.abs(s.right)).toBeLessThanOrEqual(28)
      expect(Number.isFinite(s.left)).toBe(true)
      expect(Number.isFinite(s.right)).toBe(true)
    }
  })
})

describe('steerTransform', () => {
  it('pivots the wheel about its own axle, so the tyre turns in place', () => {
    const axle = SPRITE.wheels[1]
    const at = applyTransform(steerTransform(15, axle), axle[0], axle[1])
    expect(at.x).toBeCloseTo(axle[0], 6)
    expect(at.y).toBeCloseTo(axle[1], 6)
    // The front of the tyre swings toward the car's right for a positive (right-hand) angle.
    const front = applyTransform(steerTransform(15, axle), axle[0], axle[1] - 40)
    expect(front.x).toBeGreaterThan(axle[0])
    expect(front.y).toBeGreaterThan(axle[1] - 40)
  })
})

describe('bodyTransform', () => {
  it('does nothing at all to a level car', () => {
    const p = applyTransform(bodyTransform(LEVEL), 40, 90)
    expect(p.x).toBeCloseTo(40, 6)
    expect(p.y).toBeCloseTo(90, 6)
  })

  it('squashes about the sprite centre, not the origin', () => {
    const att = carAttitude(0, -1)
    const c = applyTransform(bodyTransform(att), SPRITE.cx, SPRITE.cy)
    expect(c.x).toBeCloseTo(SPRITE.cx + att.roll, 2)
    expect(c.y).toBeCloseTo(SPRITE.cy + att.pitch, 2)
    // The nose comes in toward the centre rather than the whole car sliding up the screen.
    const nose = applyTransform(bodyTransform(att), SPRITE.cx, 0)
    expect(nose.y).toBeGreaterThan(att.pitch)
  })

  it('shifts the body sideways under roll', () => {
    const att = carAttitude(1, 0)
    const p = applyTransform(bodyTransform(att), SPRITE.cx, SPRITE.cy)
    expect(p.x).toBeLessThan(SPRITE.cx)
    expect(p.y).toBeCloseTo(SPRITE.cy, 6)
  })
})
