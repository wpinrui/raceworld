// Orthographic framing for the 3D race view (#3d-port). Top-down at tilt 0 the frustum is the
// padded viewBox exactly, so a still frames the circuit the way the 2D preview does; tilting leans
// the camera in from screen-south while north (-z) stays up-screen, which is the diorama shot. The
// LIVE camera below instead mirrors the map's own pan/zoom/rotate transform, to the pixel.

import * as THREE from 'three'

export interface ViewBox3D { x: number; y: number; w: number; h: number }

/** The map's camera, as `RaceTrackMap` holds it: viewport-pixel pan, zoom, radians of roll. */
export interface LiveCam { x: number; y: number; z: number; rot: number }

/** Parse an SVG "x y w h" viewBox, padded on every side. */
export function parseViewBox(s: string, pad = 0): ViewBox3D {
  const [x, y, w, h] = s.split(' ').map(Number)
  return { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad }
}

/** An orthographic camera looking at the viewBox's centre: straight down at tilt 0, from screen-south
 *  as the tilt grows. The frustum is the viewBox exactly, so a tilted shot foreshortens the plan by
 *  the tilt's cosine instead of reframing it. Given an `aspect` (the viewer's window, say) the
 *  frustum grows on one axis to letterbox the viewBox inside it instead of stretching it. */
export function frameOrtho(vb: ViewBox3D, tiltDeg = 0, aspect?: number): THREE.OrthographicCamera {
  const cx = vb.x + vb.w / 2
  const cz = vb.y + vb.h / 2
  const d = 2 * Math.max(vb.w, vb.h)
  const t = (tiltDeg * Math.PI) / 180
  let halfW = vb.w / 2
  let halfH = vb.h / 2
  if (aspect) {
    if (aspect > halfW / halfH) halfW = halfH * aspect
    else halfH = halfW / aspect
  }
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 4 * d)
  cam.position.set(cx, d * Math.cos(t), cz + d * Math.sin(t))
  cam.up.set(0, 0, -1)
  cam.lookAt(cx, 0, cz)
  return cam
}

/** What `applyLiveCam` framed, for whoever refits a shadow map to the view. */
export interface LiveFrame {
  /** World point under the viewport centre. */
  cx: number
  cz: number
  /** Frustum half-extents in world units. */
  halfW: number
  halfH: number
}

/** Drive an orthographic camera from the map's own transform. The 2D pipeline is
 *  `translate(centre + cam.xy) rotate(rot) scale(z * ppu) translate(-vbCentre)`, shared verbatim by
 *  the canvas and the DOM overlay; this reproduces it exactly, so the overlay's cars sit on the GL
 *  world to the pixel. `size` is the viewport in CSS pixels, `ppu` the stage's pixels per viewBox
 *  unit at zoom 1. */
export function applyLiveCam(
  camera: THREE.OrthographicCamera, cam: LiveCam, vb: ViewBox3D,
  size: { w: number; h: number }, ppu: number,
): LiveFrame {
  const scale = cam.z * ppu
  const halfW = size.w / 2 / scale
  const halfH = size.h / 2 / scale
  // The world point under the viewport centre: the inverse of the 2D transform at the screen centre.
  const cos = Math.cos(cam.rot)
  const sin = Math.sin(cam.rot)
  const cx = vb.x + vb.w / 2 - (cam.x * cos + cam.y * sin) / scale
  const cz = vb.y + vb.h / 2 - (-cam.x * sin + cam.y * cos) / scale
  const d = 2 * Math.max(vb.w, vb.h)
  camera.left = -halfW
  camera.right = halfW
  camera.top = halfH
  camera.bottom = -halfH
  camera.near = 1
  camera.far = 4 * d
  camera.position.set(cx, d, cz)
  // Screen-up under a rolled camera: the world direction the 2D transform sends to -y on screen.
  camera.up.set(-sin, 0, -cos)
  camera.lookAt(cx, 0, cz)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return { cx, cz, halfW, halfH }
}
