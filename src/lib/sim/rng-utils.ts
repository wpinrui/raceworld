// Deterministic [0,1) generator seeded from a string (fnv1a hash -> mulberry32). The same seed always
// yields the same sequence, so a race's weather can be made reproducible from (year, circuit) — letting
// a pre-race preview state the very forecast the race will run.
export function seededRng(seed: string): () => number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function sampleNormal(mean: number, stddev: number, rng: () => number): number {
  // Box-Muller transform
  const u1 = Math.max(1e-10, rng())
  const u2 = rng()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + stddev * z
}

// Rescale a per-lap probability to a slice covering `frac` of a lap so the per-lap rate is preserved:
// 1 − (1 − p)^frac (the same transform reliability.ts uses per lap). Exactly p at frac = 1, so the
// whole-lap engine path is bit-untouched (#sector-engine).
export function perSliceProb(p: number, frac: number): number {
  return frac === 1 ? p : 1 - (1 - p) ** frac
}

// Exponential distribution via inverse-CDF. Mean is the distribution mean (1/rate);
// returns a non-negative value with a flat right tail. Floor the argument away from 0 so an
// rng() of exactly 1 can't produce log(0) = -Infinity.
export function sampleExponential(mean: number, rng: () => number): number {
  return -mean * Math.log(Math.max(1e-10, 1 - rng()))
}
