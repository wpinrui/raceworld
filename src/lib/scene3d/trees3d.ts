// Trees (#3d-port increment 2): the biggest population in the world, as three instanced draws.
// The 2D paints each canopy as a gradient blob over a lifted trunk stroke and merges every shadow
// into one path; here a tree is a squashed low-poly sphere on a cylinder and the sun does the rest.

import * as THREE from 'three'
import type { SceneryTree } from '@/lib/ui/track-scenery'
import { ROUGH, surface } from './materials3d'

/** Canopy albedo per variant: the 2D's radial gradient blended mid-to-rim, because the sun lights
 *  the crown's top back up to the gradient's mid tone and the albedo has to leave it room. Judged
 *  against the 2D stills, where the pure mid stop rendered a size too bright. */
const CANOPY = ['#416830', '#59672C'] as const
const TRUNK = '#6B5138'

/** Drawn canopy radius relative to the bounding `r` the data carries. The blob's lobes reach the
 *  bound; a sphere at the nominal radius read a size smaller than the 2D canopy beside it. */
const CANOPY_OF_R = 1.0
/** Canopy vertical squash: a deciduous crown is wider than it is tall. */
const SQUASH = 0.68

export function buildTrees3D(trees: readonly SceneryTree[], u: (m: number) => number): THREE.Group {
  const group = new THREE.Group()
  const byVariant: SceneryTree[][] = [[], []]
  for (const t of trees) byVariant[t.variant].push(t)

  const canopyGeo = new THREE.SphereGeometry(1, 8, 6)
  const trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 5)
  const m = new THREE.Matrix4()

  const trunkMat = surface(TRUNK, { roughness: ROUGH.chalk })
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length)
  let ti = 0

  byVariant.forEach((set, variant) => {
    if (set.length === 0) return
    const mat = surface(CANOPY[variant], { roughness: ROUGH.chalk })
    const canopies = new THREE.InstancedMesh(canopyGeo, mat, set.length)
    set.forEach((t, i) => {
      const r = t.r * CANOPY_OF_R
      const rv = r * SQUASH
      // The data's height is the whole tree: canopy top at u(h), crown hanging below it.
      const centreY = Math.max(rv, u(t.h) - rv)
      m.makeScale(r, rv, r).setPosition(t.x, centreY, t.y)
      canopies.setMatrixAt(i, m)
      const rad = Math.max(u(0.4), t.r * 0.17)
      m.makeScale(rad, centreY, rad).setPosition(t.x, centreY / 2, t.y)
      trunks.setMatrixAt(ti++, m)
    })
    canopies.castShadow = true
    canopies.receiveShadow = true
    group.add(canopies)
  })
  trunks.count = ti
  trunks.castShadow = true
  trunks.receiveShadow = true
  group.add(trunks)
  return group
}
