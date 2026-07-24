// Per-circuit landscape character (#sim-2d). Bahrain and Spa should not look like the same field
// with the trees moved around, so each circuit carries a biome tag and every generator reads its
// tunables from here. This is data, not branching: adding a biome means adding a row.

export type Biome = 'temperate' | 'farmland' | 'forest' | 'arid' | 'urban' | 'coastal'

export interface BiomePreset {
  /** Altitude ramp, lowest band first. The LAST entry doubles as the base ground colour. */
  ramp: string[]
  /** Ground plane beneath everything, picked from the ramp's low end so bands read as relief. */
  base: string
  /** Relief amplitude in metres — how much apparent height the terrain carries. */
  reliefM: number
  /** Largest landform, in metres. */
  featureM: number
  /** Multiplier on the tree target. */
  trees: number
  /** Multiplier on the building cluster target. */
  buildings: number
  /** Chance a terrain patch is water. */
  water: number
  /** Chance a land parcel is enclosed farmland rather than open/rough ground. */
  fields: number
  /** How tall this venue's tallest buildings get. A street circuit has a skyline; a forest does not. */
  towers: number
  /** Rooftop palette. */
  roofs: string[]
  /** Run-off surfacing: gravel-first for classic circuits, tarmac-first for modern ones. */
  runoff: string[]
}

// Ramps run low (valley floor) to high (ridge). Lit from the top-left throughout, so each band's
// own colour has to carry the altitude read on its own — steps are close in hue, apart in value.
export const BIOMES: Record<Biome, BiomePreset> = {
  temperate: {
    ramp: ['#3D5D2C', '#446733', '#4C713A', '#547B42', '#5D854B', '#679055'],
    base: '#3A5829',
    reliefM: 55, featureM: 900, trees: 3, buildings: 3, water: 0.16, fields: 0.35, towers: 1.0,
    roofs: ['#59616E', '#4E5663', '#665D52', '#57504A', '#7A5147'],
    runoff: ['#8F8568', '#565C66'],
  },
  farmland: {
    ramp: ['#43642F', '#4B6E37', '#54783F', '#5D8248', '#678D52', '#71985D'],
    base: '#3F602C',
    reliefM: 32, featureM: 1200, trees: 2.2, buildings: 2.4, water: 0.14, fields: 0.78, towers: 0.45,
    roofs: ['#6B5F52', '#7A5147', '#5A5348', '#655C50', '#4E5663'],
    runoff: ['#8F8568', '#565C66'],
  },
  forest: {
    ramp: ['#2E4C21', '#355527', '#3C5E2E', '#446836', '#4C723E', '#557C47'],
    base: '#2B481F',
    reliefM: 85, featureM: 750, trees: 4.4, buildings: 1.8, water: 0.2, fields: 0.12, towers: 0.5,
    roofs: ['#54524A', '#5E5548', '#4A4F52', '#665D52', '#57504A'],
    runoff: ['#8F8568', '#6E6A5C'],
  },
  arid: {
    ramp: ['#8B7752', '#95825C', '#9F8D66', '#A99871', '#B3A37C', '#BDAE88'],
    base: '#87734E',
    reliefM: 40, featureM: 1400, trees: 0.35, buildings: 2.6, water: 0, fields: 0.05, towers: 1.1,
    roofs: ['#8C8478', '#9A9184', '#7E766B', '#A39887', '#6F685E'],
    runoff: ['#565C66', '#8F8568'],
  },
  urban: {
    ramp: ['#4B5F39', '#53683F', '#5B7146', '#637A4D', '#6B8354', '#748C5C'],
    base: '#475B36',
    reliefM: 22, featureM: 1100, trees: 1.3, buildings: 5.5, water: 0.1, fields: 0.05, towers: 1.9,
    roofs: ['#59616E', '#4E5663', '#6A7180', '#525A67', '#7A5147'],
    runoff: ['#565C66', '#6E6A5C'],
  },
  coastal: {
    ramp: ['#576343', '#5F6C4B', '#687554', '#717E5D', '#7A8766', '#849170'],
    base: '#535F40',
    reliefM: 45, featureM: 850, trees: 1.6, buildings: 2.6, water: 0.34, fields: 0.2, towers: 1.0,
    roofs: ['#6E7480', '#5C636E', '#7A7266', '#665D52', '#87796B'],
    runoff: ['#8F8568', '#565C66'],
  },
}

export const biomeOf = (b?: Biome): BiomePreset => BIOMES[b ?? 'temperate']

/** Which landscape each circuit sits in. Deliberately kept OUT of the generated files under
 *  src/data/tracks — those carry geometry from the GPS import and are marked "do not hand-edit", so
 *  a re-import would wipe a tag stored there. This is editorial metadata about the venue, not
 *  anything derived from the trace. Anything unlisted falls back to 'temperate'. */
export const CIRCUIT_BIOMES: Record<string, Biome> = {
  'abu-dhabi': 'arid',
  argentina: 'temperate',
  australia: 'coastal', // Albert Park, wrapped around its lake
  austria: 'forest', // the Styrian hills
  azerbaijan: 'urban', // Baku streets
  bahrain: 'arid',
  belgium: 'forest', // the Ardennes
  brazil: 'urban', // Interlagos sits inside São Paulo
  britain: 'farmland', // an airfield in Northamptonshire farmland
  canada: 'coastal', // Île Notre-Dame, ringed by the St Lawrence
  china: 'urban',
  estoril: 'coastal',
  hockenheim: 'forest',
  hungary: 'farmland',
  imola: 'farmland', // Emilia-Romagna countryside
  indianapolis: 'urban',
  italy: 'forest', // Monza's Royal Park
  japan: 'forest', // Suzuka
  'las-vegas': 'urban',
  madrid: 'urban',
  'magny-cours': 'farmland',
  malaysia: 'forest', // Sepang, cut out of tropical plantation
  mexico: 'urban',
  miami: 'coastal',
  monaco: 'urban',
  mugello: 'forest', // Tuscan hills
  netherlands: 'coastal', // Zandvoort's dunes
  nurburgring: 'forest', // the Eifel
  'paul-ricard': 'arid', // dry Provençal scrub
  portimao: 'arid', // the bare Algarve hills
  qatar: 'arid',
  russia: 'coastal', // Sochi, on the Black Sea
  'saudi-arabia': 'coastal', // the Jeddah Corniche
  singapore: 'urban',
  spain: 'temperate',
  turkey: 'temperate',
  usa: 'temperate', // Texas hill country
}
