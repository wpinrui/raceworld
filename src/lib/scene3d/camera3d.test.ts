import { describe, expect, it } from 'vitest'
import { frameOrtho, parseViewBox } from './camera3d'

describe('parseViewBox', () => {
  it('pads every side', () => {
    expect(parseViewBox('0 0 100 50', 10)).toEqual({ x: -10, y: -10, w: 120, h: 70 })
  })
})

describe('frameOrtho', () => {
  const vb = { x: 0, y: 0, w: 100, h: 50 }

  it('frames the viewBox exactly from straight above at tilt 0', () => {
    const cam = frameOrtho(vb)
    expect([cam.left, cam.right, cam.top, cam.bottom]).toEqual([-50, 50, 25, -25])
    expect(cam.position.x).toBe(50)
    expect(cam.position.z).toBe(25)
    expect(cam.position.y).toBe(2 * 100)
    // North (-z) stays up-screen, which is what keeps the viewBox's y-down sense on screen.
    expect(cam.up.z).toBe(-1)
  })

  it('leans in from screen-south as the tilt grows, keeping the frustum', () => {
    const flat = frameOrtho(vb)
    const tilted = frameOrtho(vb, 24)
    expect(tilted.position.z).toBeGreaterThan(flat.position.z)
    expect(tilted.position.y).toBeLessThan(flat.position.y)
    expect([tilted.left, tilted.right, tilted.top, tilted.bottom]).toEqual([-50, 50, 25, -25])
  })
})
