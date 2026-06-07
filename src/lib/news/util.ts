// Deterministic helpers for the templated news engine. Everything is seeded by a string
// key so an article's wording is stable across renders (no flicker, no per-visit cost).

export function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Pick a stable variant from a list, keyed by seed.
export function pick<T>(arr: readonly T[], seed: string): T {
  return arr[hash(seed) % arr.length]
}

// Stable yes/no gate at the given percent chance (0-100), keyed by seed. Used for the
// "random event conditioned on something" flavour pieces so not every eligible condition
// fires every round, but the same condition always resolves the same way.
export function chance(seed: string, pct: number): boolean {
  return hash(seed + ':gate') % 100 < pct
}

// Substitute {slot} tokens. Missing slots render empty.
export function fill(tmpl: string, slots: Record<string, string | number>): string {
  const valOf = (k: string) => { const v = slots[k]; return v == null ? '' : String(v) }
  // A substituted value reads with a vowel sound if it starts with a vowel (proper nouns: Audi,
  // Alpine, Antonelli) or with an ordinal/number that sounds vowel-initial (8th, 11th, 18th, 80th).
  // English oddities like "a European" never appear as token values, so the letter test is safe.
  const vowelSound = (s: string) => /^[aeiou]/i.test(s) || /^(8|11|18)/.test(s)
  // Substitute {token}s with two agreements applied automatically:
  //  - a preceding indefinite article ("a"/"an") is corrected to the value ("a {team}" -> "an Audi");
  //  - a trailing possessive ("{team}'s") follows the name rule (s-ending names take a bare
  //    apostrophe: "Mercedes'", "Williams'"; others take "'s": "Russell's").
  return tmpl.replace(/\b([Aa])n? (\{(\w+)\})|\{(\w+)\}('s)?/g, (_m, art, _tok, k1, k2, possSuffix) => {
    if (art !== undefined) {
      const val = valOf(k1)
      const an = vowelSound(val)
      return `${art === 'A' ? (an ? 'An' : 'A') : (an ? 'an' : 'a')} ${val}`
    }
    const val = valOf(k2)
    if (possSuffix) return /s$/i.test(val) ? `${val}'` : `${val}'s`
    return val
  })
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1] || fullName
}

// "Lando, Oscar and Max" style join.
export function listJoin(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function plural(n: number, one: string, many = one + 's'): string {
  return n === 1 ? one : many
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// Build a sentence/paragraph by picking one fragment from each pool (seeded per pool),
// filling {slot} tokens, dropping empties, and joining with spaces. This is how we get
// "72-variations" feel cheaply: a paragraph of 4 pools with ~5 fragments each is 5^4 =
// 625 combinations from a few dozen authored strings. Each pool is seeded independently
// off the article id, so the wording is stable across renders but varies per article.
export function compose(seed: string, slots: Record<string, string | number>, ...pools: string[][]): string {
  return pools
    .map((pool, i) => fill(pick(pool, `${seed}|c${i}`), slots).trim())
    .filter(Boolean)
    .join(' ')
}

// Gendered pronoun slots for templated copy, resolved from a driver's gender. Absent gender reads as
// male (the historical default for unlabelled entries). Singular forms, so templates pair them with
// singular verbs ("the seat {they} wanted", "{they} is settled").
export function pronouns(gender: string | undefined): Record<string, string> {
  const f = gender === 'female'
  return {
    they: f ? 'she' : 'he', they_cap: f ? 'She' : 'He',
    them: f ? 'her' : 'him', their: f ? 'her' : 'his', their_cap: f ? 'Her' : 'His',
    theirs: f ? 'hers' : 'his', themself: f ? 'herself' : 'himself', theyre: f ? "she's" : "he's",
  }
}

// Small seeded PRNG (mulberry32) so we can run the sim's market logic deterministically
// for silly-season speculation — same season state always projects the same rumours.
export function mulberry32(seedStr: string): () => number {
  let a = hash(seedStr)
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
