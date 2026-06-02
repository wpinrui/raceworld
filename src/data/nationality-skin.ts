// Coarse nationality -> avatar skin-tone heuristic for the generated DiceBear fallback.
//
// This is an intentional approximation for a procedurally-generated cartoon avatar,
// NOT a claim about any individual. It only affects drivers WITHOUT a real photo or a
// god-mode photoUrl override, and any driver can be given an explicit photo instead.
// Tones use DiceBear avataaars' palette (hex without '#').

const TONES = {
  pale: 'ffdbb4',
  light: 'edb98a',
  tanned: 'fd9841',
  brown: 'd08b5b',
  darkBrown: 'ae5d29',
  black: '614335',
} as const

type Tone = (typeof TONES)[keyof typeof TONES]

// ISO 3166-1 alpha-2 -> tone. Unlisted nationalities fall back to DEFAULT_TONE.
const BY_NATIONALITY: Record<string, Tone> = {
  // Northern / Eastern Europe
  GB: TONES.light, IE: TONES.pale, DE: TONES.pale, NL: TONES.pale, BE: TONES.light,
  FR: TONES.light, AT: TONES.pale, CH: TONES.pale, DK: TONES.pale, SE: TONES.pale,
  NO: TONES.pale, FI: TONES.pale, PL: TONES.pale, CZ: TONES.pale, RU: TONES.pale,
  UA: TONES.pale,
  // Southern Europe
  IT: TONES.light, ES: TONES.light, PT: TONES.light, MC: TONES.light, GR: TONES.light,
  // Latin America
  BR: TONES.brown, AR: TONES.light, MX: TONES.tanned, CO: TONES.tanned, VE: TONES.tanned,
  CL: TONES.light, UY: TONES.light,
  // North America / Oceania
  US: TONES.light, CA: TONES.light, AU: TONES.light, NZ: TONES.light,
  // Middle East / North Africa
  AE: TONES.tanned, SA: TONES.tanned, QA: TONES.tanned, BH: TONES.tanned, TR: TONES.tanned,
  // Africa (Sub-Saharan)
  ZA: TONES.brown, NG: TONES.darkBrown, GH: TONES.darkBrown, KE: TONES.darkBrown,
  // Asia
  JP: TONES.light, CN: TONES.light, KR: TONES.light, TH: TONES.tanned, IN: TONES.brown,
  ID: TONES.tanned, MY: TONES.tanned, SG: TONES.light,
}

const DEFAULT_TONE: Tone = TONES.light

export function skinToneFor(nationality: string): Tone {
  return BY_NATIONALITY[nationality?.toUpperCase()] ?? DEFAULT_TONE
}
