// Garage name boards in-scene (#3d-port increment 5): the one piece of the world that carries real
// text and real flag artwork, which is why it outlived every other SVG layer. Each board is a
// canvas-drawn texture on a quad standing in its bay's mouth plane, proud of the fascia like a
// mounted signboard; the text lands immediately and the flags redraw in as their SVGs arrive.

import * as THREE from 'three'
import { GARAGE_H_M, PIT_WHITE, SIGN_H_M, shortName } from '@/components/race/PitBuilding'
import { flagSvgUrl } from '@/components/world/NationalityFlag'
import { shade } from '@/lib/color'
import type { PitZone } from '@/lib/ui/pit-zone'

/** Texels per metre of board: a name stays crisp at pit-stop zoom. */
const PX_PER_M = 56
const BOARD = shade(PIT_WHITE, 0.78)
const TEXT = '#14181F'
/** How far the board stands proud of the bay mouth, in metres. */
const PROUD_M = 0.12

interface BoardDriver { name: string; nationality?: string }

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
  const y0 = u(GARAGE_H_M)
  const y1 = y0 + u(SIGN_H_M)
  zone.garageFloors.forEach((r, i) => {
    const crew = drivers(i)
    if (crew.length === 0 || r.length < 4) return
    // The bay's FRONT edge, run so the text reads left to right from the lane, as the SVG board did.
    const rev = r[1].x < r[0].x
    const a = rev ? r[1] : r[0]
    const b = rev ? r[0] : r[1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1e-6) return
    // Proud of the mouth, along the out-of-bay direction the doors offset against.
    const outX = ((r[0].x - r[3].x) / (Math.hypot(r[0].x - r[3].x, r[0].y - r[3].y) || 1)) * u(PROUD_M)
    const outY = ((r[0].y - r[3].y) / (Math.hypot(r[0].x - r[3].x, r[0].y - r[3].y) || 1)) * u(PROUD_M)

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round((len / u(1)) * PX_PER_M))
    canvas.height = Math.max(1, Math.round(SIGN_H_M * PX_PER_M))
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    drawBoard(canvas, crew, texture)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      a.x + outX, y1, a.y + outY, b.x + outX, y1, b.y + outY,
      b.x + outX, y0, b.y + outY, a.x + outX, y0, a.y + outY,
    ], 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2))
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({
      map: texture, side: THREE.DoubleSide,
    }))
    mesh.receiveShadow = true
    group.add(mesh)
  })
  return group
}
