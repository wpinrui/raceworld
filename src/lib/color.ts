// Hex ↔ RGB primitives shared by the colour-tinting helpers (team-highlight wash, performance-chart
// shades, teammate-H2H bar contrast). Accepts #rgb / #rrggbb, with or without the leading '#'; a
// malformed channel parses to 0.

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6).padEnd(6, '0')
  return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0]
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/** Scale every channel toward black (mul < 1) or white (mul > 1), clamped. One contract for every
 * caller: the map's livery accents and the scenery's extruded wall faces previously each had their
 * own `shade`, with the SAME NAME and DIFFERENT meanings — one took a delta, the other a multiplier. */
export function shade(hex: string, mul: number): string {
  const [r, g, b] = hexToRgb(hex)
  const ch = (x: number) => Math.max(0, Math.min(255, Math.round(x * mul)))
  return rgbToHex(ch(r), ch(g), ch(b))
}
