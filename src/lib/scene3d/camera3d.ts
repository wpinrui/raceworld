// Orthographic framing for the 3D race view (#3d-port increment 1). Top-down at tilt 0 the frustum
// is the padded viewBox exactly, so a still frames the circuit the way the 2D preview does; tilting
// leans the camera in from screen-south while north (-z) stays up-screen, which is the diorama shot.

import * as THREE from 'three'

export interface ViewBox3D { x: number; y: number; w: number; h: number }

/** Parse an SVG "x y w h" viewBox, padded on every side. */
export function parseViewBox(s: string, pad = 0): ViewBox3D {
  const [x, y, w, h] = s.split(' ').map(Number)
  return { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad }
}

/** An orthographic camera looking at the viewBox's centre: straight down at tilt 0, from screen-south
 *  as the tilt grows. The frustum stays the viewBox, so a tilted shot foreshortens the plan by the
 *  tilt's cosine instead of reframing it. */
export function frameOrtho(vb: ViewBox3D, tiltDeg = 0): THREE.OrthographicCamera {
  const cx = vb.x + vb.w / 2
  const cz = vb.y + vb.h / 2
  const d = 2 * Math.max(vb.w, vb.h)
  const t = (tiltDeg * Math.PI) / 180
  const cam = new THREE.OrthographicCamera(-vb.w / 2, vb.w / 2, vb.h / 2, -vb.h / 2, 1, 4 * d)
  cam.position.set(cx, d * Math.cos(t), cz + d * Math.sin(t))
  cam.up.set(0, 0, -1)
  cam.lookAt(cx, 0, cz)
  return cam
}
