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
