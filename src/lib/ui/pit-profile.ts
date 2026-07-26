// #sim-2d — the pit complex's outline in (arc, lateral) space, and how it is cut into stretches.
//
// The complex is RECTILINEAR in this space: horizontal runs at a constant offset from the lane, joined
// by vertical steps at a constant arc position. That is what makes cutting it exact rather than an
// intersection problem, and cutting it is the whole point: at racing zoom the building is several
// viewports long, so a whole-complex fill hands the rasteriser a path whose every edge reaches far
// outside the shot. Same trick, and the same reason, as `roadArcs` cutting the circuit.

export interface PitNode {
  /** Arc position along the pit lane's centreline, in viewBox units. */
  s: number
  /** Offset from that centreline, in metres, toward the garages. */
  lat: number
}

const EPS = 1e-9

/** Insert a vertex wherever a station falls inside a horizontal run.
 *
 *  A cut has to land on a vertex the WHOLE outline already carries. Without that the whole ring and the
 *  union of its stretches disagree by a chord's sagitta wherever the lane curves, which is the two
 *  renderers drawing different buildings. Vertical steps are left alone: a station cannot fall inside
 *  one. */
export function subdivide(run: readonly PitNode[], stations: readonly number[]): PitNode[] {
  if (run.length < 2) return [...run]
  const out: PitNode[] = []
  for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i]
    const b = run[i + 1]
    out.push(a)
    if (Math.abs(a.lat - b.lat) > EPS) continue
    const lo = Math.min(a.s, b.s)
    const hi = Math.max(a.s, b.s)
    const inside = stations.filter((s) => s > lo + EPS && s < hi - EPS).sort((p, q) => p - q)
    if (a.s > b.s) inside.reverse()
    for (const s of inside) out.push({ s, lat: a.lat })
  }
  out.push(run[run.length - 1])
  return out
}

/** The part of a run that lies between two arc stations, in the run's own direction.
 *
 *  Horizontal runs are cut at the bound. A vertical step survives only if its station is STRICTLY
 *  inside: clamping one to the bound instead leaves a zero-width slit in the ring, and a slit's two
 *  edges come back out of `sweptRing` as a wall face standing on nothing. Dropping it costs nothing,
 *  because a step exactly on the bound is supplied by the edge that closes the ring there anyway.
 *
 *  Horizontal runs that clip to a single point go the same way, for the same reason: they would leave
 *  the run opening at a lateral offset it does not actually reach. */
export function runIn(run: readonly PitNode[], lo: number, hi: number): PitNode[] {
  const out: PitNode[] = []
  const push = (s: number, lat: number) => {
    const last = out[out.length - 1]
    if (last && Math.abs(last.s - s) < EPS && Math.abs(last.lat - lat) < EPS) return
    out.push({ s, lat })
  }
  for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i]
    const b = run[i + 1]
    if (Math.abs(a.lat - b.lat) < EPS) {
      const c0 = Math.max(Math.min(a.s, b.s), lo)
      const c1 = Math.min(Math.max(a.s, b.s), hi)
      if (c1 - c0 <= EPS) continue
      if (a.s <= b.s) {
        push(c0, a.lat)
        push(c1, a.lat)
      } else {
        push(c1, a.lat)
        push(c0, a.lat)
      }
    } else if (a.s > lo + EPS && a.s < hi - EPS) {
      push(a.s, a.lat)
      push(a.s, b.lat)
    }
  }
  return out
}
