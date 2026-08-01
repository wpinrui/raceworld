// Garage name boards in-scene (#3d-port increment 5): the one piece of the world that carries real
// text and real flag artwork, which is why it outlived every other SVG layer. Each board is a thin
// SOLID nameplate mounted flat on the fascia over its bay's mouth: the canvas-drawn face reads from
// the lane, the back and edges are plain plate, so there is no reversed text and no floating sheet.
// The text lands immediately and the flags redraw in as their SVGs arrive.

import * as THREE from 'three'
import { GARAGE_H_M, PIT_WHITE, SIGN_H_M, shortName } from '@/components/race/PitBuilding'
import { flagSvgUrl } from '@/components/world/NationalityFlag'
import { shade } from '@/lib/color'
import type { PitZone } from '@/lib/ui/pit-zone'

/** Texels per metre of board: a name stays crisp at pit-stop zoom. */
const PX_PER_M = 56
const BOARD = shade(PIT_WHITE, 0.78)
const TEXT = '#14181F'
/** How far the board's FACE stands proud of the bay mouth, in metres. */
const PROUD_M = 0.12
/** The plate's thickness: a mounted board, not a floating sheet of paint. */
const THICK_M = 0.06
/** The plate's back and edges: a shade darker than the face, like painted board. */
const PLATE = shade(PIT_WHITE, 0.6)

interface BoardDriver { name: string; nationality?: string }

interface Pt { x: number; y: number }

/** Which way the text runs: left to right AS SEEN FROM THE LANE. The 2D board ordered its ends by
 *  screen-x, which says nothing about a pit straight running north-south; the lane side is the
 *  bay's own out direction, and reading order follows that viewer's screen-right, viewDir x up. */
export function boardFrame(r: Pt[]): { a: Pt; b: Pt; out: Pt } | null {
  if (r.length < 4) return null
  const oL = Math.hypot(r[0].x - r[3].x, r[0].y - r[3].y)
  if (oL < 1e-6) return null
  const out = { x: (r[0].x - r[3].x) / oL, y: (r[0].y - r[3].y) / oL }
  const flip = (r[1].x - r[0].x) * out.y - (r[1].y - r[0].y) * out.x <= 0
  return { a: flip ? r[1] : r[0], b: flip ? r[0] : r[1], out }
}

function drawBoard(
  canvas: HTMLCanvasElement, crew: BoardDriver[], texture: THREE.Texture,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const h = canvas.height
  ctx.fillStyle = BOARD
  ctx.fillRect(0, 0, canvas.width, h)
  const size = h * 0.62
  ctx.font = `600 ${size}px system-ui, sans-serif`
  ctx.fillStyle = TEXT
  ctx.textBaseline = 'middle'
  crew.slice(0, 2).forEach((d, k) => {
    // Centred on the midpoint of its own half of the board, flag and name measured together, so a
    // long surname stays balanced against a short one on the other side: the SVG board's own rule.
    const label = shortName(d.name)
    const flagW = size * 1.33
    const flagH = flagW * 0.75
    const gap = size * 0.34
    const textW = ctx.measureText(label).width
    const x = canvas.width * (0.25 + k * 0.5) - (flagW + gap + textW) / 2
    const flag = flagSvgUrl(d.nationality)
    if (flag) {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        ctx.drawImage(image, x, (h - flagH) / 2, flagW, flagH)
        texture.needsUpdate = true
      }
      // A failed load leaves the neutral plate below, exactly the SVG board's non-ISO fallback.
      image.src = flag
    }
    ctx.fillStyle = '#6B7280'
    ctx.fillRect(x, (h - flagH) / 2, flagW, flagH)
    ctx.fillStyle = TEXT
    ctx.fillText(label, x + flagW + gap, h / 2)
  })
  texture.needsUpdate = true
}

export function buildGarageSigns3D(
  zone: PitZone, u: (m: number) => number, drivers: (i: number) => BoardDriver[],
): THREE.Group {
  const group = new THREE.Group()
  const plate = new THREE.MeshLambertMaterial({ color: PLATE })
  zone.garageFloors.forEach((r, i) => {
    const crew = drivers(i)
    if (crew.length === 0) return
    const frame = boardFrame(r)
    if (!frame) return
    const { a, b, out } = frame
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1e-6) return

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round((len / u(1)) * PX_PER_M))
    canvas.height = Math.max(1, Math.round(SIGN_H_M * PX_PER_M))
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    drawBoard(canvas, crew, texture)

    // A thin box whose +z face carries the texture: local x runs a->b (the lane viewer's
    // screen-right, so the box's own UVs put the text upright and forward), z points out of the
    // bay. Front-side materials throughout: the back shows plate, never mirrored letters.
    const h = u(SIGN_H_M)
    const t = u(THICK_M)
    const face = new THREE.MeshLambertMaterial({ map: texture })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, h, t), [plate, plate, plate, plate, face, plate])
    const ex = (b.x - a.x) / len
    const ez = (b.y - a.y) / len
    mesh.matrix.makeBasis(
      new THREE.Vector3(ex, 0, ez), new THREE.Vector3(0, 1, 0), new THREE.Vector3(out.x, 0, out.y),
    )
    mesh.matrix.setPosition(
      (a.x + b.x) / 2 + out.x * (u(PROUD_M) - t / 2),
      u(GARAGE_H_M) + h / 2,
      (a.y + b.y) / 2 + out.y * (u(PROUD_M) - t / 2),
    )
    mesh.matrixAutoUpdate = false
    mesh.receiveShadow = true
    group.add(mesh)
  })
  return group
}
