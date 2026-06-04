import type { Circuit } from './types'

// Date math for the season calendar. Races are pinned to the Nth Sunday of the season year
// (Circuit.sundayOfYear), so the same schedule resolves to a real date for any future year —
// the calendar drifts to keep each race on a Sunday near its usual slot. All math is in UTC to
// stay free of the host timezone; the game clock never needs sub-day or local-time precision.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000

// The date (UTC midnight) of the Nth Sunday (1-based) of `year`.
export function nthSundayOfYear(year: number, n: number): Date {
  const jan1Dow = new Date(Date.UTC(year, 0, 1)).getUTCDay() // 0 = Sunday
  const firstSundayDom = 1 + ((7 - jan1Dow) % 7)             // day-of-month of the first Sunday
  return new Date(Date.UTC(year, 0, firstSundayDom + (n - 1) * 7))
}

// Race day for a circuit in a given season year.
export function raceDate(year: number, circuit: Circuit): Date {
  return nthSundayOfYear(year, circuit.sundayOfYear)
}

// --- Serialisable game-clock helpers (the store persists dates as 'YYYY-MM-DD' strings) ---

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function fromISODate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`)
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS)
}

// Whole days from `a` to `b` (b - a); negative if b is earlier.
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

// --- Formatting ---

// "8 Mar" — or "Sun 8 Mar" with weekday, or "8 Mar 2026" with year.
export function formatDate(d: Date, opts?: { weekday?: boolean; year?: boolean }): string {
  const day = d.getUTCDate()
  const mon = MONTHS[d.getUTCMonth()]
  const head = opts?.weekday ? `${WEEKDAYS[d.getUTCDay()]} ` : ''
  const tail = opts?.year ? ` ${d.getUTCFullYear()}` : ''
  return `${head}${day} ${mon}${tail}`
}
