import type { Driver } from '@/lib/sim/types'
import { hexToRgb } from '@/lib/color'

// Team Manager mode: shared, framework-agnostic helpers. The mode itself (teamManagerMode + playerTeamId)
// lives on the season store; the per-talent on/off toggles live on the settings store.

// ---- Talents (Settings toggles that re-enable a god-mode power, default OFF) -----------------------------
export type TalentId =
  | 'driver-tuning'   // edit your own drivers' ratings/age/potential/narrative
  | 'contract-desk'   // extend / release / sign to your seats outside the market windows
  | 'peak-form'       // set your drivers to maximum form
  | 'scout-network'   // reveal exact Overall / Potential / ratings of EVERY driver
  | 'data-room'       // reveal power-ranking media breakdown + true pre-season test pace
  | 'met-office'      // reveal the true weather forecast
  | 'chief-engineer'  // your car upgrades never fail
  | 'chief-aero'      // each upgrade adds 1.25 car pace per race of development
  | 'tyre-telemetry'  // reveal true tyre life (clear air vs traffic), pace-vs-wear, and the perfect strategy
  | 'race-engineer'   // simulate the rest of the race for each pit option's finishing-position odds

// `icon` is a lucide-react export name; the Settings UI maps it to the component. `teamOnly` talents act on
// a team you run (seats / car development), so they're hidden in Driver mode (where you race a single car).
export const TALENTS: { id: TalentId; name: string; icon: string; tooltip: string; teamOnly?: boolean }[] = [
  { id: 'driver-tuning', name: 'Driver Tuning', icon: 'SlidersHorizontal', tooltip: "Directly adjust your own drivers' ratings, age, potential and narrative." },
  { id: 'contract-desk', name: 'Contract Desk', icon: 'Handshake', tooltip: 'Extend, release or sign drivers to your seats outside the normal market windows.', teamOnly: true },
  { id: 'peak-form', name: 'Peak Form', icon: 'Flame', tooltip: 'Set your drivers to maximum form before a session.' },
  { id: 'scout-network', name: 'Scout Network', icon: 'Telescope', tooltip: 'Reveal the exact Overall, Potential and underlying ratings of every driver on the grid.' },
  { id: 'data-room', name: 'Data Room', icon: 'BarChart3', tooltip: 'Reveal the power-ranking media breakdown and the true pre-season test pace.' },
  { id: 'met-office', name: 'Met Office', icon: 'CloudSun', tooltip: 'Reveal the true weather forecast instead of the imperfect outlook.' },
  { id: 'chief-engineer', name: 'Chief Engineer', icon: 'Wrench', tooltip: 'Your car upgrades never fail.', teamOnly: true },
  { id: 'chief-aero', name: 'Chief Aerodynamicist', icon: 'Wind', tooltip: 'Every upgrade gains 1.25 car pace per race of development (a 3-race upgrade gains 3.75, a 6-race upgrade 7.5).', teamOnly: true },
  { id: 'tyre-telemetry', name: 'Tyre Telemetry', icon: 'Gauge', tooltip: 'Reveal your cars’ true tyre life in clear air and traffic, the pace-vs-wear curve, and the perfect-information strategy.' },
  { id: 'race-engineer', name: 'Race Engineer', icon: 'Radio', tooltip: 'Pause to simulate the rest of the race and see each pit option’s finishing-position odds for your cars.' },
]

// ---- Fog of war (ratings hidden unless Scout Network is on) ---------------------------------------------
export type RatingGrade = 'A' | 'B' | 'C' | 'D'

// Overall / Potential collapse to a letter band: 90+ A, 80+ B, 70+ C, else D.
export function ratingGrade(value: number): RatingGrade {
  if (value >= 90) return 'A'
  if (value >= 80) return 'B'
  if (value >= 70) return 'C'
  return 'D'
}

export const RATING_KEYS = ['pace', 'wetWeatherPace', 'overtaking', 'smoothness', 'consistency'] as const
export type RatingKey = (typeof RATING_KEYS)[number]

// A de-numbered slider normalises to the driver's OWN best rating: a full bar = this driver's strongest
// attribute, the rest scaled to it. Shows the profile (where they're strong/weak) without leaking the
// absolute level. Returns a 0–1 fill.
export function normalisedRatingFill(driver: Driver, key: RatingKey): number {
  const best = Math.max(...RATING_KEYS.map((k) => driver[k]))
  if (best <= 0) return 0
  return Math.max(0, Math.min(1, driver[key] / best))
}

// ---- Your-team highlight (colour-tinted row, contrast-checked) ------------------------------------------
// A subtle team-colour wash for the player's rows. Alpha scales DOWN for brighter team colours so the
// blended row stays dark enough for white text to read; a solid colour bar pins the left edge.
function tintAlpha(r: number, g: number, b: number): number {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255 // 0 (dark) – 1 (bright)
  return 0.12 + (1 - lum) * 0.14 // 0.12 for bright colours, up to ~0.26 for dark ones
}

// `light` is a softer version of the same accent (thinner, translucent bar + ~half the tint) — used in
// Driver mode for your TEAMMATE's row, so your own row stays the strong accent and theirs reads as related.
export function teamHighlightStyle(color: string, light = false): { backgroundColor: string; boxShadow: string } {
  const [r, g, b] = hexToRgb(color)
  const a = tintAlpha(r, g, b) * (light ? 0.45 : 1)
  const bar = light ? `inset 2px 0 0 rgba(${r}, ${g}, ${b}, 0.5)` : `inset 3px 0 0 ${color}`
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`, boxShadow: bar }
}

// Opaque equivalent of the row tint, for sticky cells that need a solid background (they'd otherwise let
// horizontally-scrolled content show through). Blends the same tint over the panel base so it matches the
// semi-transparent wash on the rest of the row exactly.
export function teamHighlightSolid(color: string, baseHex = '#1E2431'): string {
  const [r, g, b] = hexToRgb(color)
  const [br, bg, bb] = hexToRgb(baseHex)
  const a = tintAlpha(r, g, b)
  const mix = (c: number, base: number) => Math.round(base * (1 - a) + c * a)
  return `rgb(${mix(r, br)}, ${mix(g, bg)}, ${mix(b, bb)})`
}
