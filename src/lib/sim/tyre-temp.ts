// Tyre temperature + push-curve model (#sim-overhaul). All pure functions; the race loop owns the state.
//
// `tyreTemp` is normalised so the optimal WINDOW is [0,1]: 0 = basement, 1 = ceiling, <0 = too cold, >1 =
// too hot. `intensity` ∈ [-2,+2] is how hard the driver is pushing: back off (-2), ease off (-1), normal
// (0), push (+1), max (+2). Pushing is quicker but heats + wears the tyres; backing off is slower but cools
// + conserves. Over the window costs WEAR; under the window costs PACE. A better `tyreWarming` car keeps its
// tyres in the window more easily (slower drift out at the edges, faster recovery back in).

export const TEMP = {
  WARM_RATE: 0.12,      // temp change per intensity step per lap
  RECOVER: 0.15,        // restoring drift back toward the window when outside it (× warming factor)
  EDGE_BAND: 0.25,      // how close to an edge (in temp units) the tolerance damping starts
  PUSH_PACE: 0.18,      // s/lap faster per intensity step (pushing is quicker)
  PUSH_WEAR: 0.2,       // wear-multiplier change per intensity step
  OVERHEAT_WEAR: 0.8,   // extra wear multiplier per unit of temp over the ceiling
  COLD_PACE: 1.0,       // s/lap pace penalty per unit of temp under the basement
  FRESH_TEMP: 0.1,      // a freshly-fitted tyre starts here (low in the window, wants warming)
  MIN: -0.5, MAX: 1.5,  // hard clamp on temp
} as const

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

// 0.3 (poor warming) → 1.0 (great warming): scales the tolerance + recovery effects.
const warmingFactor = (tyreWarming: number) => 0.3 + 0.7 * (clamp(tyreWarming, 0, 100) / 100)

// Pace delta from push intensity (negative = faster). Folds into the car's clean-air pace.
export function pacePush(intensity: number): number {
  return -TEMP.PUSH_PACE * intensity
}

// Wear multiplier from push intensity, INDEPENDENT of the temperature window: pushing wears more, backing
// off less. Clamped so neither extreme is absurd.
export function pushWearMult(intensity: number): number {
  return clamp(1 + TEMP.PUSH_WEAR * intensity, 0.5, 1.6)
}

// Pace penalty (s/lap, added to lap time) for running UNDER the window — cold tyres are slow.
export function coldPenalty(temp: number): number {
  return temp < 0 ? TEMP.COLD_PACE * -temp : 0
}

// Wear multiplier for running OVER the window — overheating shreds the tyre. 1 inside/under the window.
export function overheatWearMult(temp: number): number {
  return temp > 1 ? 1 + TEMP.OVERHEAT_WEAR * (temp - 1) : 1
}

// One lap's temperature change. Push raises/lowers temp by intensity, damped near the edge it's heading
// into (better-warming cars are more tolerant); plus a restoring pull back toward the window when outside.
export function tempDrift(intensity: number, temp: number, tyreWarming: number): number {
  const w = warmingFactor(tyreWarming)

  let edge = 1
  if (intensity > 0 && temp > 1 - TEMP.EDGE_BAND) {
    // pushing near/over the ceiling: a better car rises slower (more tolerant) — (a)
    const prox = clamp((temp - (1 - TEMP.EDGE_BAND)) / TEMP.EDGE_BAND, 0, 1)
    edge = 1 - w * prox
  } else if (intensity < 0 && temp < TEMP.EDGE_BAND) {
    // cooling near/under the basement: a better car cools slower (stays in the window longer) — (c)
    const prox = clamp((TEMP.EDGE_BAND - temp) / TEMP.EDGE_BAND, 0, 1)
    edge = 1 - w * prox
  }
  const push = TEMP.WARM_RATE * intensity * edge

  let recover = 0
  if (temp < 0) recover = TEMP.RECOVER * w * -temp          // warms faster when too cold — (b)
  else if (temp > 1) recover = -TEMP.RECOVER * w * (temp - 1) // cools faster when too hot — (d)

  return push + recover
}

export function nextTyreTemp(temp: number, intensity: number, tyreWarming: number): number {
  return clamp(temp + tempDrift(intensity, temp, tyreWarming), TEMP.MIN, TEMP.MAX)
}

// Per-lap wear multiplier from the car's tyre-wear rating: higher = slower wear. Centered ~60 so an average
// car is ≈1.0, with a gentle spread (to be sim-tuned).
export function tyreWearRatingMult(tyreWear: number): number {
  return clamp(1 - (clamp(tyreWear, 0, 100) - 60) / 150, 0.7, 1.4)
}
