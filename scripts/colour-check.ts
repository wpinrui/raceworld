// Plan/verify the team-colour palette (run: npx tsx scripts/colour-check.ts).
// Defines an identity colour per marque, then flags any same-season pair that is too close to tell apart.
import { historicalGrids } from '../src/data/history/grids'

// Identity colour per marque (team NAME). Curated for recognisability across that name's history;
// where a season would clash, the lower-profile team is nudged to a distinct but still on-brand shade.
export const PALETTE: Record<string, string> = {
  // Long-running marques (iconic identity)
  Ferrari: '#DC0000',
  McLaren: '#FF8000',        // papaya, applied to every era
  Williams: '#1A3C8E',       // Williams navy
  Mercedes: '#00D2BE',       // petronas teal
  'Red Bull': '#0E1C5C',     // deep navy (clear of Williams navy + black)
  Renault: '#FFD800',        // Renault yellow
  Alpine: '#2293D6',         // Alpine blue
  'Aston Martin': '#1E5B45', // British racing green
  Haas: '#B6BABD',           // grey/white
  Jordan: '#C99A1A',         // Jordan bronze-gold (clear of papaya + Renault yellow)
  Benetton: '#00A650',       // Benetton green
  Sauber: '#7A1228',         // Sauber burgundy (early red, clear of Ferrari + the green cluster)
  'BMW Sauber': '#005EB8',   // BMW blue
  'Alfa Romeo': '#8B1A1A',   // Alfa rosso (dark)
  Jaguar: '#0B5E33',         // British racing green (darker)
  Toyota: '#C3C8CC',         // Toyota white/silver
  Honda: '#6E2C91',          // distinct (kept clear of the red cluster)
  BAR: '#C2007A',            // 555 cerise
  'Toro Rosso': '#3F9BE0',   // bright blue (clear of BMW blue + the navies)
  AlphaTauri: '#8693A8',     // light slate (clear of Williams navy)
  'Racing Bulls': '#1634CB', // bright blue
  'Force India': '#FF73B3',  // BWT pink
  'Racing Point': '#FF73B3', // BWT pink
  Lotus: '#C8A100',          // JPS black & gold -> gold
  Caterham: '#0E7A47',       // Caterham green
  // Earlier / shorter-lived marques
  Ligier: '#3A6FE0',         // Gitanes royal blue (clear of Williams navy)
  Prost: '#3A6FE0',          // Prost royal blue (same lineage)
  Tyrrell: '#2AA8E0',        // light blue
  Stewart: '#7C97C4',        // tartan steel
  Footwork: '#D86018',       // burnt orange
  Arrows: '#E33000',         // Orange-sponsor vermilion (clear of papaya)
  Minardi: '#3A3D42',        // dark gunmetal (Minardi black, but visible on dark panels)
  Forti: '#BCD000',          // lime
  Lola: '#E5405A',           // rose-red
  // 2000s/2010s newcomers
  Spyker: '#C46210',         // burnt orange (Spyker)
  Midland: '#D63A1F',        // red-orange
  'Super Aguri': '#0E8C7A',  // teal (clear of Honda purple)
  Virgin: '#C81E5B',         // crimson
  Marussia: '#C81E5B',       // crimson (same lineage)
  Manor: '#C81E5B',          // crimson (same lineage)
  HRT: '#8A8F94',            // grey (plain backmarker, clear of the red cluster)
  Brawn: '#B5D200',          // Brawn fluoro lime/white
  // 2026 newcomers
  Audi: '#8C1C3A',           // dark carmine (clear of Ferrari)
  Cadillac: '#C99A2E',       // Cadillac crest gold (visible, distinct on the 2026 grid)
}

// Per-season overrides (keyed by `${year}:${name}`) for era-specific liveries that win over the marque
// default. Use sparingly, only when a team's era livery is iconic enough to deserve its own colour.
export const OVERRIDES: Record<string, string> = {
  '2024:Sauber': '#00E701', // Kick Sauber fluoro green
  '2025:Sauber': '#00E701', // Kick Sauber fluoro green
}

export const colourFor = (year: number, name: string): string | undefined =>
  OVERRIDES[`${year}:${name}`] ?? PALETTE[name]

// Perceptual-ish distance (redmean weighting). 0 = identical; ~764 max.
function dist(a: string, b: string): number {
  const ca = parseInt(a.slice(1), 16), cb = parseInt(b.slice(1), 16)
  const r1 = (ca >> 16) & 255, g1 = (ca >> 8) & 255, b1 = ca & 255
  const r2 = (cb >> 16) & 255, g2 = (cb >> 8) & 255, b2 = cb & 255
  const rm = (r1 + r2) / 2
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db)
}

const THRESH = 90 // below this, two swatches read as the same colour
let missing = 0
let clashes = 0
for (const g of historicalGrids) {
  const cols = g.teams.map((t) => ({ name: t.name, c: colourFor(g.year, t.name) }))
  for (const t of cols) if (!t.c) { console.log(`MISSING palette for ${t.name} (${g.year})`); missing++ }
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
    if (!cols[i].c || !cols[j].c) continue
    const d = dist(cols[i].c, cols[j].c)
    if (d < THRESH) { console.log(`CLASH ${g.year}: ${cols[i].name} ${cols[i].c} vs ${cols[j].name} ${cols[j].c}  (d=${d.toFixed(0)})`); clashes++ }
  }
}
console.log(`\n${missing} missing, ${clashes} clashes (threshold ${THRESH})`)
