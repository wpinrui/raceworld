// The racing line the cars actually drive (#sim-2d), solved once per circuit.
//
// Lifted out of the map component so it can run WITHOUT a DOM: it used to take an SVGPathElement and
// call getPointAtLength, which meant the one piece of geometry the whole track surface hangs off could
// only be produced inside a live browser. Everything downstream of it -- rubber in the line, brake-zone
// marks, marbles -- is therefore previewable and testable now.
//
// The only thing it needs from a path is "where are you at arc length s", so that is all it asks for.

import type { Vec } from './geom'

/** Anything that can say how long it is and where it is at a given arc length. The map hands over an
 *  SVGPathElement's own geometry; a script hands over a polyline walker. */
export interface ArcPath {
  length: number
  at: (s: number) => Vec
}

/** Walk a closed polyline by arc length, so a trace out of the track data can stand in for a path
 *  element. Linear between stations, which is what the trace already is. */
export function polylineArc(pts: readonly Vec[]): ArcPath {
  const n = pts.length
  const cum = [0]
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1]
    const b = pts[i % n]
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const length = cum[n]
  return {
    length,
    at: (s: number) => {
      const t = ((s % length) + length) % length
      // Binary search the station whose segment contains t.
      let lo = 0
      let hi = n
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1
        if (cum[mid] <= t) lo = mid
        else hi = mid
      }
      const a = pts[lo]
      const b = pts[(lo + 1) % n]
      const seg = cum[lo + 1] - cum[lo] || 1
      const f = (t - cum[lo]) / seg
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
    },
  }
}

export interface RacingLine {
  /** Path data, for a renderer to stroke or sample. */
  d: string
  /** The solved stations, in order, closed: the same points the path data is built from. */
  pts: Vec[]
  /** How far each station sits from the CENTRELINE, in track units, positive to the right of travel.
   *
   *  Anything drawn relative to the line needs this to stay on the road. The line itself runs up to 4m off
   *  centre, so a band placed 4m outside THAT is 8m out, which is off the tarmac entirely -- and that is
   *  exactly what happened at corner entries, where the line is already at the outer limit. */
  lateral: Float64Array
}

// How much of the track's width the racing line may use, each side of the centreline: half the tarmac
// minus half a car and a margin.
export const RACE_LINE_HALF_M = 4.0

// Sample the centreline at n stations: points, right normals, and signed curvature (right turn > 0).
function sampleCentre(center: ArcPath, len: number, n: number) {
  const c: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n; i++) c.push(center.at((i / n) * len))
  const ds = len / n
  const r: Array<{ x: number; y: number }> = []
  const kappa = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = c[(i - 1 + n) % n]
    const b = c[(i + 1) % n]
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
    r.push({ x: -(b.y - a.y) / d, y: (b.x - a.x) / d }) // right of travel
    const hIn = Math.atan2(c[i].y - a.y, c[i].x - a.x)
    const hOut = Math.atan2(b.y - c[i].y, b.x - c[i].x)
    let dth = hOut - hIn
    if (dth > Math.PI) dth -= 2 * Math.PI
    if (dth < -Math.PI) dth += 2 * Math.PI
    kappa[i] = dth / ds
  }
  return { c, r, kappa, ds }
}

// Minimise CURVATURE, not length: a midpoint-pull relaxation is curve-shortening flow, whose optimum
// is the taut string, i.e. the SHORTEST way round, hugging the insides. The fastest line minimises
// sum(kappa^2). In the lateral domain, path curvature ~ centreline kappa minus the lateral second
// derivative; Gauss-Seidel on that quartic system's stationarity equations (update = ds^2/6 times the
// discrete laplacian of kappa), clamped to the corridor, converges to the true minimum-curvature line:
// out wide, apex, out wide. A resolution ladder gets the long-range shape cheaply at the coarse level;
// a whisper of centring spring breaks the degeneracy on straights (any straight line has zero kappa).
export function buildRacingLine(center: ArcPath, metresPerUnit: number): RacingLine {
  const len = center.length
  const targetN = Math.min(1200, Math.max(256, Math.round(len / (6 / metresPerUnit))))
  const ladder: number[] = []
  for (let n = targetN; n > 150; n = Math.ceil(n / 2)) ladder.push(n)
  if (ladder.length === 0) ladder.push(targetN)
  ladder.reverse() // coarse -> fine
  const w = RACE_LINE_HALF_M / metresPerUnit

  let a = new Float64Array(ladder[0])
  let prevN = ladder[0]
  for (let li = 0; li < ladder.length; li++) {
    const n = ladder[li]
    const { kappa: kc, ds } = sampleCentre(center, len, n)
    if (li > 0) {
      // Upsample the previous level's laterals (linear, wrapping).
      const up = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        const x = (i / n) * prevN
        const j = Math.floor(x) % prevN
        const f = x - Math.floor(x)
        up[i] = a[j] * (1 - f) + a[(j + 1) % prevN] * f
      }
      a = up
    }
    prevN = n
    const inv2 = 1 / (ds * ds)
    const lap = (i: number) => (a[(i - 1 + n) % n] - 2 * a[i] + a[(i + 1) % n]) * inv2
    // Path curvature: kc PLUS a'' â€” shifting toward the inside of a turn tightens it.
    const k = new Float64Array(n)
    for (let i = 0; i < n; i++) k[i] = kc[i] + lap(i)

    const sweeps = li === 0 ? 4000 : 900
    const OMEGA = 1.4
    const SPRING = 0.0008
    for (let pass = 0; pass < sweeps; pass++) {
      const fwd = pass % 2 === 0
      for (let s = 0; s < n; s++) {
        const i = fwd ? s : n - 1 - s
        const ip = (i - 1 + n) % n
        const inx = (i + 1) % n
        // Stationarity of sum(kappa^2) wrt a_i: a_i <- a_i - ds^2/6 * (discrete laplacian of kappa).
        const step = -((k[ip] - 2 * k[i] + k[inx]) * ds * ds) / 6
        const next = Math.max(-w, Math.min(w, (a[i] + OMEGA * step) / (1 + SPRING)))
        if (next !== a[i]) {
          a[i] = next
          // kappa depends on laterals at i-1, i, i+1: refresh the three affected stations.
          k[ip] = kc[ip] + lap(ip)
          k[i] = kc[i] + lap(i)
          k[inx] = kc[inx] + lap(inx)
        }
      }
    }
  }

  const { c, r } = sampleCentre(center, len, prevN)
  const pts = c.map((p, i) => ({ x: p.x + r[i].x * a[i], y: p.y + r[i].y * a[i] }))
  return { pts, lateral: a, d: `M ${pts.map((q) => `${q.x.toFixed(2)} ${q.y.toFixed(2)}`).join(' L ')} Z` }
}
