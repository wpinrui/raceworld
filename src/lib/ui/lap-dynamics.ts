// The lap's dynamics, recovered from the speed profile that already drives the cars round it
// (#sim-2d). That profile was built from the racing line, used to turn lap time into distance, and
// then thrown away, so the renderer knew where a car was but not that it was hard on the brakes for
// turn one. Same three-pass physics as before (corner limits from curvature, a traction-limited
// forward pass, a braking-limited backward pass) now also returning the speed and the two
// accelerations it computed on the way.
//
// The accelerations are worked out in ARC space, per metre of track, never per frame of animation.
// A race played at 4x speed moves the sprites four times as fast, so anything differentiated against
// the wall clock would report four times the cornering load and peg every car on full lean. Arc space
// asks a different question -- how hard is this CORNER -- and gets the same answer at any race speed.

/** Equal-distance stations the lap is cut into. Roughly one every 20m on a real circuit. */
export const PROFILE_N = 256

export interface LapPhysics {
  /** Straight-line top speed, track units per second. */
  vTop: number
  /** Slowest a car is ever placed, so a hairpin cannot stop it dead. */
  vFloor: number
  /** Lateral grip: sets each corner's speed via v = sqrt(aLat / kappa). */
  aLat: number
  /** Traction limit out of a corner. */
  aAccel: number
  /** Braking limit into one. */
  aBrake: number
}

export interface LapDynamics {
  /** Cumulative normalised lap TIME at each station, N+1 long. Inverting it turns a time fraction
   *  into a distance fraction, which is what places the cars. */
  time: Float64Array
  /** Speed at each station, track units per second. */
  speed: Float64Array
  /** Signed lateral acceleration as a fraction of the grip limit: +1 is a right-hand corner taken at
   *  the limit, -1 a left-hander. Right and left are as SEEN, in the y-down screen frame. */
  lat: Float64Array
  /** Signed longitudinal acceleration as a fraction of the relevant limit: -1 is maximum braking,
   *  +1 maximum acceleration. */
  long: Float64Array
  /** Signed path curvature in 1/track-unit, positive where the track bends to the car's right. This is
   *  the GEOMETRIC truth about the corner, for anything that has to be physically possible rather than
   *  merely tuned -- steering angle, above all. See the note where it is computed. */
  curvature: Float64Array
}

/** The profile's physics in REAL units (m/s, m/s^2). Every track is driven by these same limits,
 *  converted into its own units, which is what makes one circuit's corners genuinely slower than
 *  another's rather than every lap looking the same shape. */
const PHYSICS_M: LapPhysics = { vTop: 87, vFloor: 10, aLat: 14, aAccel: 12.75, aBrake: 41 }

/** Those limits in a given track's units. */
export function trackPhysics(metresPerUnit: number): LapPhysics {
  return {
    vTop: PHYSICS_M.vTop / metresPerUnit,
    vFloor: PHYSICS_M.vFloor / metresPerUnit,
    aLat: PHYSICS_M.aLat / metresPerUnit,
    aAccel: PHYSICS_M.aAccel / metresPerUnit,
    aBrake: PHYSICS_M.aBrake / metresPerUnit,
  }
}

const clamp1 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v)

/** Wrapped linear read of a per-station array at a fraction round the lap. The stations are ~20m
 *  apart, which a car crosses several times a second: stepping between them pops, so sample between.
 */
export function sampleLap(arr: Float64Array, frac: number): number {
  const n = arr.length
  if (n === 0) return 0
  const x = (((frac % 1) + 1) % 1) * n
  const i = Math.floor(x)
  const f = x - i
  return arr[i % n] * (1 - f) + arr[(i + 1) % n] * f
}

/** Lateral load in g at a lap fraction: v^2 * curvature, converted into real units. This is what the
 *  front tyres actually have to generate, and therefore how much slip angle has to be dialled in on top
 *  of the bare steering geometry. Signed like the corner. */
export function lateralG(d: LapDynamics, frac: number, metresPerUnit: number): number {
  const v = sampleLap(d.speed, frac)
  return (v * v * sampleLap(d.curvature, frac) * metresPerUnit) / 9.81
}

/** `pts` are equally spaced round a CLOSED path of total length `len`, in track units. */
export function lapDynamics(pts: readonly { x: number; y: number }[], len: number, p: LapPhysics): LapDynamics {
  const n = pts.length
  const ds = len / n
  const v = new Float64Array(n)
  // Signed curvature: positive where the track turns clockwise on screen, i.e. to the car's right.
  // The old profile took its magnitude immediately, which is why the renderer could never tell a
  // left-hander from a right one.
  //
  // TWO curvatures, and they differ by exactly two. `dth` is the turn between the chord tangents at
  // stations i-1 and i+1, which are 2*ds of arc apart, so the real curvature is dth / (2*ds). The
  // profile has always divided by 4*ds, i.e. cornered on half the truth, and every corner speed on this
  // branch was tuned by eye around that. So `kappa` keeps the shipped arithmetic untouched, and the
  // geometric value is exported alongside it for the things that have to be physically possible.
  const kappa = new Float64Array(n)
  const curvature = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 2 + n) % n]
    const b = pts[i]
    const c = pts[(i + 2) % n]
    const in_ = Math.atan2(b.y - a.y, b.x - a.x)
    const out = Math.atan2(c.y - b.y, c.x - b.x)
    let dth = out - in_
    if (dth > Math.PI) dth -= 2 * Math.PI
    if (dth < -Math.PI) dth += 2 * Math.PI
    kappa[i] = dth / (4 * ds)
    curvature[i] = dth / (2 * ds)
    v[i] = Math.max(p.vFloor, Math.min(p.vTop, Math.sqrt(p.aLat / Math.max(Math.abs(kappa[i]), 1e-9))))
  }
  // Twice round, so the passes agree across the lap seam rather than leaving a step in it.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * p.aAccel * ds))
    }
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * p.aBrake * ds))
    }
  }

  const time = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) time[i + 1] = time[i] + ds / ((v[i] + v[(i + 1) % n]) / 2)
  const total = time[n]
  for (let i = 0; i <= n; i++) time[i] /= total

  const lat = new Float64Array(n)
  const long = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    lat[i] = clamp1((v[i] * v[i] * kappa[i]) / p.aLat)
    // v * dv/ds IS dv/dt, without ever asking what t is.
    const a = v[i] * ((v[(i + 1) % n] - v[(i - 1 + n) % n]) / (2 * ds))
    long[i] = clamp1(a / (a < 0 ? p.aBrake : p.aAccel))
  }
  return { time, speed: v, lat, long, curvature }
}
