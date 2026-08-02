import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyLiveCam, applyOrbitCam, frameOrtho, groundPoint, parseViewBox,
  type LiveCam, type OrbitCam,
} from './camera3d'

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

  it('letterboxes into a given aspect instead of stretching', () => {
    // The viewBox is 2:1; a square window must widen nothing and heighten the frustum.
    const cam = frameOrtho(vb, 0, 1)
    expect([cam.left, cam.right, cam.top, cam.bottom]).toEqual([-50, 50, 50, -50])
    // A wider-than-viewBox window grows the width instead.
    const wide = frameOrtho(vb, 0, 4)
    expect([wide.left, wide.right, wide.top, wide.bottom]).toEqual([-100, 100, 25, -25])
  })
})

describe('applyLiveCam', () => {
  /** The 2D pipeline, verbatim: viewport centre, camera pan, roll, zoom, viewBox units. What the
   *  canvas transform and the world div both do, and what the GL camera must therefore also do. */
  const screen2D = (
    p: { x: number; y: number }, cam: LiveCam, vb: { x: number; y: number; w: number; h: number },
    size: { w: number; h: number }, ppu: number,
  ) => {
    const s = cam.z * ppu
    const dx = (p.x - (vb.x + vb.w / 2)) * s
    const dy = (p.y - (vb.y + vb.h / 2)) * s
    const cos = Math.cos(cam.rot)
    const sin = Math.sin(cam.rot)
    return {
      x: size.w / 2 + cam.x + dx * cos - dy * sin,
      y: size.h / 2 + cam.y + dx * sin + dy * cos,
    }
  }

  const screen3D = (
    p: { x: number; y: number }, camera: THREE.OrthographicCamera, size: { w: number; h: number },
  ) => {
    const ndc = new THREE.Vector3(p.x, 0, p.y).project(camera)
    return { x: (ndc.x * 0.5 + 0.5) * size.w, y: (1 - (ndc.y * 0.5 + 0.5)) * size.h }
  }

  it('projects every world point onto the same pixel as the 2D transform, at any pan zoom and roll', () => {
    const vb = { x: -10, y: -18, w: 282, h: 460 }
    const size = { w: 1280, h: 720 }
    const ppu = size.w / vb.w * 0.8
    const camera = new THREE.OrthographicCamera()
    const cams: LiveCam[] = [
      { x: 0, y: 0, z: 1, rot: 0 },
      { x: 120, y: -60, z: 3.5, rot: 0.7 },
      { x: -300, y: 45, z: 0.4, rot: -2.2 },
      { x: 18, y: 240, z: 12, rot: 3.05 },
    ]
    const points = [{ x: 0, y: 0 }, { x: 131, y: 205 }, { x: -10, y: 442 }, { x: 260, y: 17 }]
    for (const cam of cams) {
      applyLiveCam(camera, cam, vb, size, ppu)
      for (const p of points) {
        const a = screen2D(p, cam, vb, size, ppu)
        const b = screen3D(p, camera, size)
        expect(b.x).toBeCloseTo(a.x, 3)
        expect(b.y).toBeCloseTo(a.y, 3)
      }
    }
  })

  it('projects ground points at pitch 0 exactly as the orthographic transform did', () => {
    // Straight down, every ground point sits at the same view depth, so the perspective divide is
    // one uniform scale: the DOM overlay keeps riding the very same numbers through the tilt-less
    // default. This is the continuity proof for the perspective swap.
    const vb = { x: -10, y: -18, w: 282, h: 460 }
    const size = { w: 1280, h: 720 }
    const ppu = 3.1
    const ortho = new THREE.OrthographicCamera()
    const persp = new THREE.PerspectiveCamera()
    const cams: Array<[LiveCam, OrbitCam]> = [
      [{ x: 0, y: 0, z: 2, rot: 0.7 }, { tx: 0, tz: 0, rot: 0.7, pitch: 0, z: 2 }],
      [{ x: 0, y: 0, z: 9, rot: -1.9 }, { tx: 0, tz: 0, rot: -1.9, pitch: 0, z: 9 }],
    ]
    const points = [{ x: 40, y: 12 }, { x: -3, y: -80 }, { x: 55, y: 61 }]
    for (const [live, orbit] of cams) {
      // Same target: the live cam's pan is zero, so its target is the vb centre; aim the orbit there.
      applyLiveCam(ortho, live, vb, size, ppu)
      applyOrbitCam(persp, { ...orbit, tx: vb.x + vb.w / 2, tz: vb.y + vb.h / 2 }, size, ppu)
      for (const p of points) {
        const a = new THREE.Vector3(p.x, 0, p.y).project(ortho)
        const b = new THREE.Vector3(p.x, 0, p.y).project(persp)
        expect(b.x).toBeCloseTo(a.x, 5)
        expect(b.y).toBeCloseTo(a.y, 5)
      }
    }
  })

  it('pitches in from screen-south of the target and unprojects the centre back to it', () => {
    const persp = new THREE.PerspectiveCamera()
    const cam: OrbitCam = { tx: 120, tz: 300, rot: 0, pitch: 0.6, z: 4 }
    const size = { w: 1000, h: 700 }
    applyOrbitCam(persp, cam, size, 2)
    expect(persp.position.z).toBeGreaterThan(300)
    expect(persp.position.y).toBeGreaterThan(0)
    const centre = groundPoint(persp, size, 500, 350)!
    expect(centre.x).toBeCloseTo(120, 4)
    expect(centre.z).toBeCloseTo(300, 4)
    // A pixel above centre lands FURTHER up the world than one below by the foreshortening.
    const upPx = groundPoint(persp, size, 500, 250)!
    const downPx = groundPoint(persp, size, 500, 450)!
    const dUp = Math.hypot(upPx.x - 120, upPx.z - 300)
    const dDown = Math.hypot(downPx.x - 120, downPx.z - 300)
    expect(dUp).toBeGreaterThan(dDown)
  })

  it('orbits the ground under the target, not the plane at zero', () => {
    // A circuit that climbs puts its road well above the datum. The camera has to rise with it or
    // the target sits underground and the whole frame tips off the thing it is following.
    const persp = new THREE.PerspectiveCamera()
    const cam: OrbitCam = { tx: 120, tz: 300, rot: 0, pitch: 0.6, z: 4 }
    const size = { w: 1000, h: 700 }
    const hill = 25
    applyOrbitCam(persp, cam, size, 2)
    const flatY = persp.position.y
    applyOrbitCam(persp, cam, size, 2, hill)
    expect(persp.position.y).toBeCloseTo(flatY + hill, 6)
    // And it still looks AT the target, which is now on the hill.
    const centre = groundPoint(persp, size, 500, 350, () => hill)!
    expect(centre.x).toBeCloseTo(120, 3)
    expect(centre.z).toBeCloseTo(300, 3)
  })

  it('picks the point on the TERRAIN under a pixel, not where a flat plane would put it', () => {
    const persp = new THREE.PerspectiveCamera()
    const cam: OrbitCam = { tx: 0, tz: 0, rot: 0, pitch: 1.2, z: 4 }
    const size = { w: 1000, h: 700 }
    applyOrbitCam(persp, cam, size, 2)
    // A ridge rising away from the camera: a ray aimed up the frame meets it EARLIER than it would
    // meet the plane at zero, which is the whole error a flat pick makes on a hillside.
    const ridge = (_x: number, z: number) => Math.max(0, -z) * 0.3
    const flat = groundPoint(persp, size, 500, 200)!
    const hit = groundPoint(persp, size, 500, 200, ridge)!
    expect(Math.hypot(hit.x, hit.z)).toBeLessThan(Math.hypot(flat.x, flat.z))
    // And it lands ON the surface: marching it again from the answer changes nothing.
    expect(ridge(hit.x, hit.z)).toBeGreaterThan(0)
  })

  it('reports the framed world rect for the shadow refit', () => {
    const camera = new THREE.OrthographicCamera()
    const frame = applyLiveCam(
      camera, { x: 0, y: 0, z: 2, rot: 0 }, { x: 0, y: 0, w: 100, h: 100 },
      { w: 400, h: 200 }, 4,
    )
    expect(frame.cx).toBe(50)
    expect(frame.cz).toBe(50)
    expect(frame.halfW).toBe(25)
    expect(frame.halfH).toBe(12.5)
  })
})
