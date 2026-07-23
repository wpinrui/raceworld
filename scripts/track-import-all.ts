// Batch-import every circuit covered by the bacinger/f1-circuits GeoJSON dataset (#sim-2d).
// Streams per-circuit progress. Direction is the real-world race direction viewed north-up; the S/F
// anchor is approximate pit-straight coordinates (the importer snaps to the nearest trace vertex, so
// a couple hundred metres of slack is fine). Not in the dataset (need another source or hand-authoring):
// fuji, valencia, korea, india, jerez.
//
//   npx tsx scripts/track-import-all.ts

import { writeFileSync } from 'fs'
import { trackFileContent } from './track-import'

interface Entry { id: string; file: string; dir: 'cw' | 'ccw'; sf: [number, number] }

const CIRCUITS: Entry[] = [
  { id: 'abu-dhabi', file: 'ae-2009', dir: 'ccw', sf: [24.4672, 54.6031] },
  { id: 'argentina', file: 'ar-1952', dir: 'cw', sf: [-34.6943, -58.4593] },
  { id: 'australia', file: 'au-1953', dir: 'cw', sf: [-37.8497, 144.968] },
  { id: 'austria', file: 'at-1969', dir: 'cw', sf: [47.2197, 14.7647] },
  { id: 'azerbaijan', file: 'az-2016', dir: 'ccw', sf: [40.3717, 49.8398] },
  { id: 'bahrain', file: 'bh-2002', dir: 'cw', sf: [26.0325, 50.5106] },
  { id: 'belgium', file: 'be-1925', dir: 'cw', sf: [50.444, 5.967] },
  { id: 'brazil', file: 'br-1940', dir: 'ccw', sf: [-23.7036, -46.6997] },
  { id: 'canada', file: 'ca-1978', dir: 'cw', sf: [45.5, -73.5228] },
  { id: 'china', file: 'cn-2004', dir: 'cw', sf: [31.3389, 121.22] },
  { id: 'estoril', file: 'pt-1972', dir: 'cw', sf: [38.7506, -9.3942] },
  { id: 'hockenheim', file: 'de-1932', dir: 'cw', sf: [49.3278, 8.5661] },
  { id: 'hungary', file: 'hu-1986', dir: 'cw', sf: [47.5789, 19.2486] },
  { id: 'imola', file: 'it-1953', dir: 'ccw', sf: [44.3439, 11.7167] },
  { id: 'indianapolis', file: 'us-1909', dir: 'cw', sf: [39.792, -86.2389] },
  { id: 'italy', file: 'it-1922', dir: 'cw', sf: [45.6156, 9.2811] },
  { id: 'japan', file: 'jp-1962', dir: 'cw', sf: [34.8431, 136.541] },
  { id: 'madrid', file: 'es-2026', dir: 'cw', sf: [40.468, -3.616] },
  { id: 'magny-cours', file: 'fr-1960', dir: 'cw', sf: [46.8642, 3.1633] },
  { id: 'malaysia', file: 'my-1999', dir: 'cw', sf: [2.7608, 101.7382] },
  { id: 'mexico', file: 'mx-1962', dir: 'cw', sf: [19.4042, -99.0907] },
  { id: 'miami', file: 'us-2022', dir: 'ccw', sf: [25.9581, -80.2389] },
  { id: 'monaco', file: 'mc-1929', dir: 'cw', sf: [43.735, 7.4215] },
  { id: 'mugello', file: 'it-1914', dir: 'cw', sf: [43.9975, 11.3719] },
  { id: 'netherlands', file: 'nl-1948', dir: 'cw', sf: [52.3888, 4.5409] },
  { id: 'nurburgring', file: 'de-1927', dir: 'cw', sf: [50.3356, 6.9475] },
  { id: 'paul-ricard', file: 'fr-1969', dir: 'cw', sf: [43.2506, 5.7917] },
  { id: 'portimao', file: 'pt-2008', dir: 'cw', sf: [37.227, -8.6267] },
  { id: 'qatar', file: 'qa-2004', dir: 'cw', sf: [25.49, 51.4542] },
  { id: 'russia', file: 'ru-2014', dir: 'cw', sf: [43.4057, 39.9578] },
  { id: 'saudi-arabia', file: 'sa-2021', dir: 'ccw', sf: [21.6319, 39.1044] },
  { id: 'singapore', file: 'sg-2008', dir: 'ccw', sf: [1.2914, 103.8642] },
  { id: 'spain', file: 'es-1991', dir: 'cw', sf: [41.57, 2.2611] },
  { id: 'turkey', file: 'tr-2005', dir: 'ccw', sf: [40.9517, 29.405] },
  { id: 'usa', file: 'us-2012', dir: 'ccw', sf: [30.1328, -97.6411] },
  { id: 'las-vegas', file: 'us-2023', dir: 'ccw', sf: [36.108, -115.1687] },
]

async function main() {
  let done = 0
  for (const c of CIRCUITS) {
    const url = `https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits/${c.file}.geojson`
    const res = await fetch(url)
    if (!res.ok) {
      console.log(`FAIL ${c.id}: HTTP ${res.status} for ${c.file}`)
      continue
    }
    const geo = await res.json()
    writeFileSync(`src/data/tracks/${c.id}.ts`, trackFileContent(geo, c.id, { sf: c.sf, dir: c.dir }, `${c.file}.geojson`))
    done++
    console.log(`[${done}/${CIRCUITS.length}] ${c.id} <- ${c.file} (${c.dir})`)
  }
  console.log(`done: ${done}/${CIRCUITS.length} circuits imported`)
}

main()
