// Orthographic framing for the 3D race view (#3d-port). Top-down at tilt 0 the frustum is the
// padded viewBox exactly, so a still frames the circuit the way the 2D preview does; tilting leans
// the camera in from screen-south while north (-z) stays up-screen, which is the diorama shot. The
// LIVE camera below instead mirrors the map's own pan/zoom/rotate transform, to the pixel.

import * as THREE from 'three'

export interface ViewBox3D { x: number; y: number; w: number; h: number }

/** The map's camera, as `RaceTrackMap` holds it: viewport-pixel pan, zoom, radians of roll. */
export interface LiveCam { x: number; y: number; z: number; rot: number }

/** The live view's free camera (#3d-port increment 5): a target on the ground, orbited. `rot` keeps
 *  the old roll's meaning exactly; `pitch` is new, 0 = straight down. `z` keeps the old zoom's
 *  meaning: stage pixels per world unit at the target, through the stage's own ppu. */
export interface OrbitCam {
  tx: number
  tz: number
  rot: number
  /** Radians off vertical, 0 = top-down. */
  pitch: number
  z: number
}

/** The perspective's vertical field of view. Narrow-ish: the map is a diorama, not an action cam. */
const LIVE_FOV = 35

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

/** Drive the live PerspectiveCamera from the orbit state. At pitch 0 it looks straight down from
 *  the distance that makes ground points project EXACTLY as the old orthographic transform did
 *  (every ground point sits at the same view depth, so the perspective divide is one uniform
 *  scale), which is what lets the DOM overlay keep riding the same numbers. Pitching leans the
 *  camera in from screen-south of the target, orbiting it. */
export function applyOrbitCam(
  camera: THREE.PerspectiveCamera, cam: OrbitCam, size: { w: number; h: number }, ppu: number,
  /** How high the ground is under the orbit target. The camera orbits the road, and on a circuit
   *  that climbs a hill the road is not at zero: leave this out and the target sits underground on
   *  every rise, which tips the whole frame off the circuit it is supposed to be following. */
  groundY = 0,
): LiveFrame {
  const scale = cam.z * ppu
  const halfW = size.w / 2 / scale
  const halfH = size.h / 2 / scale
  const distance = halfH / Math.tan(((LIVE_FOV / 2) * Math.PI) / 180)
  const sin = Math.sin(cam.rot)
  const cos = Math.cos(cam.rot)
  const lean = Math.sin(cam.pitch) * distance
  camera.fov = LIVE_FOV
  camera.aspect = size.w / size.h
  camera.near = Math.max(0.05, distance * 0.02)
  // Looking down, the ground in shot is a bounded patch and sixty distances of reach is plenty.
  // Leaning toward the horizon the world runs away to its own edge instead, and the far plane has
  // to follow: at racing zoom a fixed 60 cuts the ground off at 3km, well inside the plane's own
  // 16km, and everything past the cut has to be buried under haze thick enough to fog the middle
  // distance too. Depth precision barely notices the change. For a standard projection it is set by
  // the NEAR plane, and going from 60 distances to two thousand moves `1/near - 1/far` by three
  // hundredths of a percent.
  camera.far = distance * 60 / Math.max(0.03, Math.cos(cam.pitch) ** 2)
  camera.position.set(
    cam.tx + lean * sin, groundY + Math.cos(cam.pitch) * distance, cam.tz + lean * cos,
  )
  camera.up.set(-sin, 0, -cos)
  camera.lookAt(cam.tx, groundY, cam.tz)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  // The ground rect in shot, generously: pitching stretches the far half of the view across more
  // world than the frustum's target-plane cut, and the shadow box must cover what is seen.
  const reach = 1 / Math.max(0.2, Math.cos(cam.pitch))
  return { cx: cam.tx, cz: cam.tz, halfW: halfW * reach, halfH: halfH * reach }
}

/** Steps the terrain march takes before giving up. Sixty covers the far plane at any pitch the map
 *  allows without ever being a cost worth thinking about: this runs on a click and a wheel notch. */
const MARCH_STEPS = 60

/** Where a viewport pixel's ray meets the ground, for zoom-at-pointer and any picking to come.
 *
 *  `ground` turns this from a ray-plane intersection into a ray-TERRAIN one. Without it, zooming at
 *  the pointer on a hillside walks the view toward where the hill would be if it were flat, which at
 *  a low camera on a climbing circuit is tens of metres off the thing under the cursor.
 *
 *  Marched rather than solved: the surface is a kernel over the circuit's profile blended into a
 *  fractal, so there is nothing to solve against. A coarse walk to the first step that ends up under
 *  the ground, then a few bisections to land on it. */
export function groundPoint(
  camera: THREE.PerspectiveCamera, size: { w: number; h: number }, px: number, py: number,
  ground?: (x: number, y: number) => number,
): { x: number; z: number } | null {
  const ndc = new THREE.Vector3((px / size.w) * 2 - 1, 1 - (py / size.h) * 2, 0.5)
  ndc.unproject(camera)
  const dir = ndc.sub(camera.position).normalize()
  if (Math.abs(dir.y) < 1e-9) return null
  const flat = -camera.position.y / dir.y
  if (!ground) {
    if (flat <= 0) return null
    return { x: camera.position.x + dir.x * flat, z: camera.position.z + dir.z * flat }
  }
  const at = (t: number) => ({
    x: camera.position.x + dir.x * t,
    y: camera.position.y + dir.y * t,
    z: camera.position.z + dir.z * t,
  })
  // March out to twice the distance the flat plane would have been, which bounds any hill the
  // corridor can raise between the eye and it; a downhill ray still finds its ground inside that.
  const reach = flat > 0 ? flat * 2 : camera.far
  let previous = 0
  for (let i = 1; i <= MARCH_STEPS; i++) {
    const t = (reach * i) / MARCH_STEPS
    const p = at(t)
    if (p.y <= ground(p.x, p.z)) {
      let lo = previous
      let hi = t
      for (let k = 0; k < 16; k++) {
        const mid = (lo + hi) / 2
        const q = at(mid)
        if (q.y <= ground(q.x, q.z)) hi = mid
        else lo = mid
      }
      const hit = at(hi)
      return { x: hit.x, z: hit.z }
    }
    previous = t
  }
  return null
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
