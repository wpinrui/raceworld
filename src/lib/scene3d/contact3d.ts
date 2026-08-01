// The car's contact occlusion (#photoreal): the darkening a car puts on the road directly under
// itself, which no shadow map is going to give you.
//
// The sun already casts a real shadow, and it is a good one. What it cannot do is the tight stuff:
// at a 68-degree sun that shadow lies OFF to one side, and the map's texel is 15cm across a racing
// framing, so the few centimetres between a floor and the tarmac and the dark ring where a tyre
// meets the road are both far below what it can resolve. Those are ambient occlusion, not shadow:
// they are there whatever the sun is doing, and they are what makes a car sit IN the road rather
// than on top of it.
//
// So it is a decal, generated and parented to the car. Not SSAO: a depth-normal prepass and an
// EffectComposer to darken a patch whose shape is known in advance and never changes is a great
// deal of pipeline for one effect, and it would still resolve the floor gap poorly.

import * as THREE from 'three'
import { SPRITE } from '@/lib/ui/car-sprite'
import { DECAL_PULL } from './materials3d'

/** The patch's half-extents in SPRITE UNITS, the frame the car mesh is built in (x across, z along,
 *  nose at low z). Wider and longer than the car so the penumbra has somewhere to fade out. */
const HALF_W = 150
const HALF_L = 292

/** Where the tyres touch, from `SPRITE.wheels` recentred on the sprite's middle: the front axle
 *  108 units ahead of centre, the rear 138 behind, each 90 out from the centreline. */
const AXLE_FRONT = SPRITE.wheels[0][1] - SPRITE.cy
const AXLE_REAR = SPRITE.wheels[2][1] - SPRITE.cy
const HALF_TRACK = SPRITE.cx - SPRITE.wheels[0][0]

/** How dark the patch goes at its very darkest, before the material's own opacity scales it. Not
 *  black: this is occluded AMBIENT, and a car does not seal the road off from the sky. */
const MAX_OCCLUSION = 0.62

/** Resolution of the generated patch. Small on purpose: every edge in it is a penumbra, so there is
 *  no detail to lose and a big texture would only cost memory per circuit. */
const TEX_W = 128
const TEX_H = 256

interface Blob {
  x: number
  z: number
  /** Semi-axes, sprite units. */
  ax: number
  az: number
  /** 0..1 of `MAX_OCCLUSION` at the centre. */
  strength: number
}

/** What occludes what. The floor is a long soft shadow down the car's spine; each tyre is a tight
 *  dark ring where rubber meets road, which is the cue that actually reads as CONTACT. */
const BLOBS: Blob[] = [
  { x: 0, z: -6, ax: 74, az: 196, strength: 0.72 },
  ...[AXLE_FRONT, AXLE_REAR].flatMap((z) => [-HALF_TRACK, HALF_TRACK].map((x) => ({
    x, z, ax: 42, az: 54, strength: 1,
  }))),
]

/** Smooth 1-at-centre, 0-at-edge falloff over a normalised radius. */
function falloff(t: number): number {
  if (t >= 1) return 0
  return 1 - t * t * (3 - 2 * t)
}

/** The occlusion alpha at a point in the car's own frame. */
function occlusionAt(x: number, z: number): number {
  let most = 0
  for (const b of BLOBS) {
    const t = Math.hypot((x - b.x) / b.ax, (z - b.z) / b.az)
    most = Math.max(most, falloff(t) * b.strength)
  }
  return most * MAX_OCCLUSION
}

/** The occlusion, written into the colour channels.
 *
 *  Into COLOUR, not into alpha, however wrong that reads: three's `alphaMap` samples the GREEN
 *  channel (`diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g`), not the alpha one. Putting it
 *  in alpha where it belongs multiplies every texel's opacity by a green of zero, and the patch is
 *  invisible everywhere, which is exactly how it first shipped. */
function occlusionTexture(): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_W
  canvas.height = TEX_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const image = ctx.createImageData(TEX_W, TEX_H)
  for (let py = 0; py < TEX_H; py++) {
    for (let px = 0; px < TEX_W; px++) {
      const x = ((px + 0.5) / TEX_W - 0.5) * 2 * HALF_W
      // `PlaneGeometry` laid flat by `rotateX(-90)` sends its v=1 edge to LOW z, which is the nose.
      const z = (0.5 - (py + 0.5) / TEX_H) * 2 * HALF_L
      const i = (py * TEX_W + px) * 4
      const occl = occlusionAt(x, z) * 255
      image.data[i] = occl
      image.data[i + 1] = occl
      image.data[i + 2] = occl
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

/** One shared texture and geometry, one material per car.
 *
 *  Per car because the material carries the fade: `CarField3D.setOpacity` retires a car by dimming
 *  it, and its shadow has to dim with it rather than with everyone else's. */
export class ContactShadows {
  private texture: THREE.CanvasTexture | null
  private geometry: THREE.PlaneGeometry | null = null
  private materials: THREE.MeshBasicMaterial[] = []

  constructor() {
    this.texture = occlusionTexture()
    if (!this.texture) return
    this.geometry = new THREE.PlaneGeometry(2 * HALF_W, 2 * HALF_L).rotateX(-Math.PI / 2)
  }

  /** A patch for one car, to be parented to the car's WRAP (which takes position and yaw) and never
   *  to its chassis (which rolls and dives). A contact shadow lies on the road; it does not lean
   *  into corners with the bodywork. Null where no canvas exists, which is every test. */
  create(): THREE.Mesh | null {
    if (!this.texture || !this.geometry) return null
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      alphaMap: this.texture,
      transparent: true,
      depthWrite: false,
      // Occlusion is not a lit surface and not a hazed one: it is a multiplier on what is already
      // there, so neither the fog nor the tone curve has any business touching it.
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -DECAL_PULL,
      polygonOffsetUnits: -2 * DECAL_PULL,
    })
    this.materials.push(material)
    const mesh = new THREE.Mesh(this.geometry, material)
    // Above every road decal (the ink stack numbers into the low hundreds, the night pools sit at
    // 950) and below the fences at 1000.
    mesh.renderOrder = 960
    mesh.receiveShadow = false
    mesh.castShadow = false
    return mesh
  }

  dispose(): void {
    this.texture?.dispose()
    this.geometry?.dispose()
    for (const m of this.materials) m.dispose()
    this.materials = []
  }
}
