// Shape primitives for the procedural world (#sim-2d): organic blobs and building footprints.
// Split out of track-scenery.ts to keep that file focused on PLACEMENT (where things go) while this
// one holds FORM (what they look like), and to keep both under the 500-line cap.

export interface SceneryPart { dx: number; dy: number; w: number; h: number }

type Vec = { x: number; y: number }

/** Smooth closed path through jittered points (quadratic through midpoints). */
export function smoothClosed(pts: Vec[]): string {
  const n = pts.length
  const mid = (a: Vec, b: Vec) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const m0 = mid(pts[n - 1], pts[0])
  let d = `M ${m0.x.toFixed(1)} ${m0.y.toFixed(1)}`
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n])
    d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${m.x.toFixed(1)} ${m.y.toFixed(1)}`
  }
  return d + ' Z'
}

/** A lumpy closed blob: an ellipse whose radii are jittered per lobe, then smoothed. The repo's
 *  stand-in for noise — terrain patches, runoff aprons and tree canopies are all built from it.
 *  Lobes span [jBase, jBase + jSpan] of the nominal radii, so the drawn shape can exceed rx/ry. */
export function blobPath(
  cx: number, cy: number, rx: number, ry: number, rot: number, rng: () => number,
  n = 10, jBase = 0.65, jSpan = 0.6,
): string {
  const pts: Vec[] = []
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const k = jBase + rng() * jSpan
    const ex = Math.cos(a) * rx * k
    const ey = Math.sin(a) * ry * k
    pts.push({ x: cx + ex * cos - ey * sin, y: cy + ex * sin + ey * cos })
  }
  return smoothClosed(pts)
}

/** The narrowest wing any archetype produces, as a fraction of the overall footprint. Used to reject
 *  an archetype whose limbs would come out as slivers at the chosen building size. */
const ARCHETYPE_MIN_FRACTION = 0.28

/** Ten footprint archetypes as unions of rectangles: slab, L, T, U, H, Z, cross, courtyard,
 *  tower-on-podium, stepped terrace. Every part stays inside the overall w x h. */
export function buildingParts(type: number, w: number, h: number): SceneryPart[] {
  switch (type % 10) {
    case 1: return [
      { dx: 0, dy: -h * 0.25, w, h: h * 0.5 },
      { dx: -w * 0.25, dy: h * 0.25, w: w * 0.5, h: h * 0.5 },
    ]
    case 2: return [
      { dx: 0, dy: -h * 0.25, w, h: h * 0.5 },
      { dx: 0, dy: h * 0.25, w: w * 0.4, h: h * 0.5 },
    ]
    case 3: return [
      { dx: 0, dy: -h * 0.3, w, h: h * 0.4 },
      { dx: -w * 0.35, dy: h * 0.15, w: w * 0.3, h: h * 0.7 },
      { dx: w * 0.35, dy: h * 0.15, w: w * 0.3, h: h * 0.7 },
    ]
    case 4: return [
      { dx: -w * 0.35, dy: 0, w: w * 0.3, h },
      { dx: w * 0.35, dy: 0, w: w * 0.3, h },
      { dx: 0, dy: 0, w: w * 0.4, h: h * 0.35 },
    ]
    case 5: return [
      { dx: -w * 0.2, dy: -h * 0.22, w: w * 0.6, h: h * 0.45 },
      { dx: w * 0.2, dy: h * 0.22, w: w * 0.6, h: h * 0.45 },
    ]
    case 6: return [
      { dx: 0, dy: 0, w, h: h * 0.4 },
      { dx: 0, dy: 0, w: w * 0.4, h },
    ]
    case 7: {
      const tw = w * ARCHETYPE_MIN_FRACTION
      const th = h * ARCHETYPE_MIN_FRACTION
      return [
        { dx: 0, dy: -h / 2 + th / 2, w, h: th },
        { dx: 0, dy: h / 2 - th / 2, w, h: th },
        { dx: -w / 2 + tw / 2, dy: 0, w: tw, h },
        { dx: w / 2 - tw / 2, dy: 0, w: tw, h },
      ]
    }
    case 8: return [
      { dx: 0, dy: 0, w, h },
      { dx: w * 0.18, dy: -h * 0.12, w: w * 0.42, h: h * 0.5 },
    ]
    case 9: return [
      { dx: -w * 0.28, dy: -h * 0.2, w: w * 0.44, h: h * 0.6 },
      { dx: 0, dy: 0, w: w * 0.44, h: h * 0.6 },
      { dx: w * 0.28, dy: h * 0.2, w: w * 0.44, h: h * 0.6 },
    ]
    default: return [{ dx: 0, dy: 0, w, h }]
  }
}

/** Pick an archetype whose thinnest limb still reads as a building at this size. The articulated
 *  types cut wings down to ~0.28 of the footprint, so on a small building they came out as slivers
 *  a few metres across — part of why the clusters looked like debris rather than architecture. */
export function pickArchetype(w: number, h: number, minPartM: number, mpu: number, roll: number): number {
  const thinnest = Math.min(w, h) * ARCHETYPE_MIN_FRACTION * mpu
  // Below the threshold only the solid archetypes (slab, tower-on-podium) stay legible.
  if (thinnest < minPartM) return roll < 0.5 ? 0 : 8
  return Math.floor(roll * 10)
}
