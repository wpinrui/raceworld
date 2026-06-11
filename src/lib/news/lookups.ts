import type { NewsContext } from './engine'

// Small shared lookups over the NewsContext that the producers lean on: display names, the car-pace rank
// and its tier word, and the per-circuit colour traits. Carved out of engine.ts.

export function teamName(ctx: NewsContext, id: string): string {
  return ctx.teams.find((t) => t.id === id)?.name ?? id
}

export function circuit(ctx: NewsContext, round: number): string {
  const name = ctx.calendar[round - 1]?.name
  return name ? name.replace(/\bGP\b/, 'Grand Prix') : `Round ${round}`
}

// Real-world track characteristics, keyed by circuit id. Unfalsifiable against the game (we
// model no track type), so safe to use as preview colour. One entry per 2026 circuit.
export const CIRCUIT_TRAITS: Record<string, string> = {
  australia: 'the flowing rhythm of Albert Park',
  china: 'the long, energy-sapping corners of Shanghai',
  japan: 'the fast esses of Suzuka',
  bahrain: 'the abrasive Bahrain surface',
  'saudi-arabia': 'the high-speed walls of Jeddah',
  miami: 'the Miami heat',
  madrid: 'the fast street sweeps of the Madring',
  monaco: 'the tight streets of Monaco',
  spain: 'the aero-hungry corners of Barcelona',
  canada: 'the stop-start rhythm of Montreal',
  austria: 'the short, punchy Red Bull Ring',
  britain: 'the high-speed sweeps of Silverstone',
  belgium: 'the long lap and fickle weather of Spa',
  hungary: 'the twisty, sweltering Hungaroring',
  netherlands: 'the banking of Zandvoort',
  italy: 'the low-downforce blast of Monza',
  azerbaijan: 'the long straight and unforgiving walls of Baku',
  singapore: 'the heat and humidity of Singapore',
  usa: 'the bumps and elevation of Austin',
  mexico: 'the thin air of Mexico City',
  brazil: 'the altitude and changeable skies of Interlagos',
  'las-vegas': 'the cold desert night of Las Vegas',
  qatar: 'the relentless high-speed corners of Lusail',
  'abu-dhabi': 'the smooth Yas Marina tarmac',
}

// car-pace rank: 1 = fastest car on the grid. Meaningless for archived contexts (carPace 0).
export function paceRank(ctx: NewsContext, teamId: string): number {
  const sorted = [...ctx.teams].sort((a, b) => b.carPace - a.carPace)
  return sorted.findIndex((t) => t.id === teamId) + 1
}

export function tierWord(rank: number, total: number): string {
  if (rank <= Math.max(2, total / 3)) return 'front-running'
  if (rank <= (2 * total) / 3) return 'midfield'
  return 'backmarker'
}
