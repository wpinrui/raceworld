export function sampleNormal(mean: number, stddev: number, rng: () => number): number {
  // Box-Muller transform
  const u1 = Math.max(1e-10, rng())
  const u2 = rng()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + stddev * z
}
