// The one repair every geometry in this world needs before a lit material can render it
// (#photoreal).
//
// `normalize( vNormal )` is the first executable line of three's lit fragment shader, and GLSL
// `normalize` of a zero vector is 0/0, which is NaN. So a single zero-length vertex normal poisons
// every pixel it reaches.
//
// Zero normals are not exotic here: they are what BOTH normal generators leave behind on a
// zero-area triangle. `computeVertexNormals` and `toCreasedNormals` each sum the face normals
// around a vertex and then call `Vector3.normalize`, whose `divideScalar( length || 1 )` guard
// turns a zero sum into a zero vector rather than a NaN one. That is a sane thing for the CPU to
// do and a fatal thing to hand a shader. The circuit builders emit thousands of zero-area
// triangles as a matter of course: a dashed kerb whose block lands on a repeated polyline point,
// a ribbon through a doubled sample, a triangulated fill with a collinear ear.
//
// Drawn straight to the canvas the damage was one black dot per bad vertex, which is why this sat
// in the geometry unnoticed through the whole 3D port. It only became visible when the frame
// started being POST-PROCESSED: a blur spreads one NaN texel across its entire kernel, and every
// tap it touches goes NaN too, so a dot becomes a solid black block the size of the kernel. That
// is the black-squares artifact, and this is its cause, not the bloom that revealed it.
//
// Repairing the normal is the fix rather than dropping the triangle. A zero-area triangle covers no
// pixel centre and costs three vertices; it is waste, but it is not wrong, and pruning it would mean
// changing what every builder emits. The vertex only needs a value that is finite and unit length.

import * as THREE from 'three'

/** Replace every unusable vertex normal with world up, in place.
 *
 *  World up, specifically, because the vertices that need it fall into two groups and it is right
 *  or harmless for both. On the ground (kerbs, ink, lane paint, every road sheet) all geometry lies
 *  in the XZ plane, so up IS the correct normal and the repaired vertex shades exactly like its
 *  neighbours. On anything standing, a zero normal only ever arrives on a zero-area triangle, which
 *  covers no pixel centre; the value has to be finite, and beyond that nothing looks at it.
 *
 *  Unusable is measured by LENGTH rather than by testing the three axes against zero, which catches
 *  the non-finite cases in the same expression: `Math.hypot` of a NaN axis is NaN and of an infinite
 *  one is Infinity, and neither passes the finite-and-positive test.
 *
 *  Returns the same geometry so it can be dropped into a builder's return line. */
export function repairNormals(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const normal = geometry.getAttribute('normal')
  if (!normal) return geometry
  for (let i = 0; i < normal.count; i++) {
    const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
    if (length > 0 && Number.isFinite(length)) continue
    normal.setXYZ(i, 0, 1, 0)
  }
  return geometry
}

/** Bulge a mesh's vertex normals outward from its own centre, in place.
 *
 *  For geometry that stands in for a VOLUME while being built out of flat pieces: a canopy of leaf
 *  cards, an impostor's crossed quads. A card's own normal describes the CARD, and a pile of cards
 *  facing every direction at once averages to nothing, so the object as a whole takes almost no
 *  directional light. It goes flat and dark and stays flat and dark whichever way the sun moves,
 *  because half of it always faces away. Lending each vertex the direction out of the object's own
 *  centre makes the pile shade like the round thing it stands for: a lit side, a shaded side, and an
 *  underside that is dark because it points at the ground.
 *
 *  `weight` says how much of that outward direction a vertex takes, given how far out of the
 *  object's own ellipsoid it sits (0 at the centre, 1 at the extreme). Returning the radius itself
 *  hands the shell fully to the volume and leaves the core its own facing, where "outward" is noise
 *  anyway; returning a constant treats every vertex alike, which is what a handful of quads wants.
 *
 *  The ellipsoid is the geometry's own bounding box, so a tall narrow conifer and a broad oak are
 *  each measured by their own proportions instead of against a shared sphere. The outward DIRECTION
 *  is taken unsquashed, in world proportions: light does not care that the crown is taller than it
 *  is wide.
 *
 *  Returns the normalised ellipsoid radius per vertex, which is the same quantity an occlusion bake
 *  over the same shape needs, so a caller doing both walks the geometry once. */
export function bulgeNormals(
  geometry: THREE.BufferGeometry, weight: (radius: number) => number,
): Float32Array {
  const pos = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const radii = new Float32Array(pos ? pos.count : 0)
  if (!pos) return radii
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const cx = (box.min.x + box.max.x) / 2
  const cy = (box.min.y + box.max.y) / 2
  const cz = (box.min.z + box.max.z) / 2
  const rx = Math.max(box.max.x - cx, 1e-6)
  const ry = Math.max(box.max.y - cy, 1e-6)
  const rz = Math.max(box.max.z - cz, 1e-6)
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - cx
    const dy = pos.getY(i) - cy
    const dz = pos.getZ(i) - cz
    const ex = dx / rx
    const ey = dy / ry
    const ez = dz / rz
    const r = Math.min(1, Math.sqrt(ex * ex + ey * ey + ez * ez))
    radii[i] = r
    if (!normal) continue
    const out = Math.hypot(dx, dy, dz)
    // A vertex sitting exactly on the centre has no outward direction to lend it.
    if (out < 1e-6) continue
    const w = weight(r)
    const nx = normal.getX(i) * (1 - w) + (dx / out) * w
    const ny = normal.getY(i) * (1 - w) + (dy / out) * w
    const nz = normal.getZ(i) * (1 - w) + (dz / out) * w
    const len = Math.hypot(nx, ny, nz)
    // A card whose own normal points exactly back down its outward direction cancels at w = 0.5.
    // Rare, and it leaves the vertex its original normal, which is finite and unit length.
    if (len > 1e-6) normal.setXYZ(i, nx / len, ny / len, nz / len)
  }
  if (normal) normal.needsUpdate = true
  return radii
}
