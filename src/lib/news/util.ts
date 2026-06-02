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
  return tmpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = slots[k]
    return v == null ? '' : String(v)
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
