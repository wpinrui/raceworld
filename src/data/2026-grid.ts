import { Driver, Team } from '@/lib/sim/types'

// Car pace order based on 2025 constructors standings
export const teams2026: Team[] = [
  { id: 'mercedes', name: 'Mercedes', shortName: 'MER', color: '#27F4D2', carPace: 75 }, // 1st
  { id: 'ferrari', name: 'Ferrari', shortName: 'FER', color: '#E8002D', carPace: 70 }, // 2nd
  { id: 'mclaren', name: 'McLaren', shortName: 'MCL', color: '#FF8000', carPace: 65 }, // 3rd
  { id: 'redbull', name: 'Red Bull', shortName: 'RBR', color: '#3671C6', carPace: 60 }, // 4th
  { id: 'alpine', name: 'Alpine', shortName: 'ALP', color: '#FF87BC', carPace: 55 }, // 5th
  { id: 'racingbulls', name: 'Racing Bulls', shortName: 'RB', color: '#6692FF', carPace: 50 }, // 6th
  { id: 'haas', name: 'Haas', shortName: 'HAA', color: '#B6BABD', carPace: 45 }, // 7th
  { id: 'williams', name: 'Williams', shortName: 'WIL', color: '#64C4FF', carPace: 40 }, // 8th
  { id: 'audi', name: 'Audi', shortName: 'AUD', color: '#BB0020', carPace: 35 }, // 9th
  { id: 'astonmartin', name: 'Aston Martin', shortName: 'AMR', color: '#229971', carPace: 30 }, // 10th
  { id: 'cadillac', name: 'Cadillac', shortName: 'CAD', color: '#94A3B8', carPace: 25 }, // 11th
]

export const drivers2026: Driver[] = [
  // McLaren
  {
    id: 'lando-norris',
    name: 'Lando Norris',
    teamId: 'mclaren',
    // 2025 WDC, slight edge on Piastri in 2026 Canada pace; inconsistency noted in quali errors
    // Good overtaker (aggressive style), consistent race pace when clean
    pace: 91, wetWeatherPace: 87, overtaking: 89, smoothness: 80,
    age: 26, peakPotential: 94, primeEnd: 32, narrativeModifier: 3,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'oscar-piastri',
    name: 'Oscar Piastri',
    teamId: 'mclaren',
    // Faster than Norris in early 2026 by metrics (0.14s quicker in quali, 0.24s/lap in race)
    // But accident-prone in 2026 (Canada crash into Albon); wet Brasil Q3 off in 2025
    pace: 92, wetWeatherPace: 83, overtaking: 82, smoothness: 86,
    age: 25, peakPotential: 95, primeEnd: 31, narrativeModifier: 2,
    contractExpiresAfterSeason: 2026,
  },

  // Ferrari
  {
    id: 'charles-leclerc',
    name: 'Charles Leclerc',
    teamId: 'ferrari',
    // 3rd in 2026 standings, dominant over Hamilton in 2025; wet weather weakness confirmed
    // Repeatedly drags Ferrari beyond its means; elite qualifier
    pace: 93, wetWeatherPace: 80, overtaking: 85, smoothness: 83,
    age: 29, peakPotential: 95, primeEnd: 33, narrativeModifier: 4,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'lewis-hamilton',
    name: 'Lewis Hamilton',
    teamId: 'ferrari',
    // 2025 worst season ever, dominated by Leclerc; BUT 2026 revival — 2nd in Canada,
    // battling Verstappen hard. Career-long wet weather excellence; "last in quali in Las Vegas rain" caveat
    // High smoothness/tyre management reputation remains foundational
    pace: 87, wetWeatherPace: 90, overtaking: 85, smoothness: 93,
    age: 41, peakPotential: 97, primeEnd: 35, narrativeModifier: 7,
    contractExpiresAfterSeason: 2026,
  },

  // Red Bull
  {
    id: 'max-verstappen',
    name: 'Max Verstappen',
    teamId: 'redbull',
    // Universally rated #1 driver by peers and analysts even in 2026 with midfield car
    // 8 wins in 2025 in inferior machinery; wet weather had some uncharacteristic errors in 2025
    // Aggressive overtaker — every analyst cites his overtaking as elite
    pace: 97, wetWeatherPace: 93, overtaking: 97, smoothness: 88,
    age: 28, peakPotential: 98, primeEnd: 34, narrativeModifier: 5,
    contractExpiresAfterSeason: 2028,
  },
  {
    id: 'isack-hadjar',
    name: 'Isack Hadjar',
    teamId: 'redbull',
    // Strong 2025 rookie — podium at Zandvoort, comfortably beat Lawson, Q3 regularly
    // Promoted to Red Bull for 2026, 5th in Canada; sharp overtaker per analysis
    pace: 80, wetWeatherPace: 76, overtaking: 79, smoothness: 75,
    age: 21, peakPotential: 91, primeEnd: 31, narrativeModifier: 2,
    contractExpiresAfterSeason: 2027,
  },

  // Mercedes
  {
    id: 'george-russell',
    name: 'George Russell',
    teamId: 'mercedes',
    // 2nd in 2026 standings but being out-paced by Antonelli; 2 wins + 7 podiums in 2025
    // Consistently rated top 3-5 by all sources; wet weather solid but not elite
    pace: 90, wetWeatherPace: 87, overtaking: 83, smoothness: 87,
    age: 28, peakPotential: 92, primeEnd: 33, narrativeModifier: 2,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'kimi-antonelli',
    name: 'Kimi Antonelli',
    teamId: 'mercedes',
    // Dominant in 2026 — 4 consecutive wins, leads championship by 43pts
    // Faster than Russell in quali and race pace; sprint pole in Miami 2025 showed early promise
    // Still young — some rookie errors but extraordinary trajectory
    pace: 88, wetWeatherPace: 82, overtaking: 78, smoothness: 80,
    age: 19, peakPotential: 95, primeEnd: 31, narrativeModifier: 3,
    contractExpiresAfterSeason: 2027,
  },

  // Aston Martin
  {
    id: 'fernando-alonso',
    name: 'Fernando Alonso',
    teamId: 'astonmartin',
    // Zero points in 2026 so far (car is nowhere), but driver talent unimpeachable
    // Wet weather consistently top 3-5 across multiple seasons; elite overtaker and racecraft
    // 24-0 quali whitewash over Stroll in 2025
    pace: 87, wetWeatherPace: 91, overtaking: 90, smoothness: 91,
    age: 44, peakPotential: 95, primeEnd: 36, narrativeModifier: 10,
    contractExpiresAfterSeason: 2026,
  },
  {
    id: 'lance-stroll',
    name: 'Lance Stroll',
    teamId: 'astonmartin',
    // 0-24 in quali vs Alonso in 2025; Q1 eliminations repeatedly; anonymous
    pace: 61, wetWeatherPace: 63, overtaking: 54, smoothness: 64,
    age: 27, peakPotential: 70, primeEnd: 30, narrativeModifier: -5,
    contractExpiresAfterSeason: 2028,
  },

  // Alpine
  {
    id: 'pierre-gasly',
    name: 'Pierre Gasly',
    teamId: 'alpine',
    // Scored 100% of Alpine's points in 2025; Alpine punching above weight in 2026
    // Verstappen couldn't pass him for 7th in Japan 2026; consistent performer
    pace: 83, wetWeatherPace: 81, overtaking: 79, smoothness: 80,
    age: 30, peakPotential: 86, primeEnd: 32, narrativeModifier: 1,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'franco-colapinto',
    name: 'Franco Colapinto',
    teamId: 'alpine',
    // 6th in Canada 2026 (best F1 result), improving strongly; earned Alpine contract on merit
    // Crash-prone early (Australia wet crash 2025) but developing fast
    pace: 76, wetWeatherPace: 68, overtaking: 73, smoothness: 68,
    age: 22, peakPotential: 86, primeEnd: 30, narrativeModifier: 2,
    contractExpiresAfterSeason: 2026,
  },

  // Williams
  {
    id: 'alexander-albon',
    name: 'Alexander Albon',
    teamId: 'williams',
    // Strong first half of 2025, fell away in second half; Williams struggling in 2026
    // Solid racecraft, decent wet weather; contributed 53% of Williams 2025 points
    pace: 80, wetWeatherPace: 77, overtaking: 76, smoothness: 79,
    age: 30, peakPotential: 84, primeEnd: 32, narrativeModifier: 0,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'carlos-sainz',
    name: 'Carlos Sainz',
    teamId: 'williams',
    // "Mr Smooth Operator" — multiple analyst cites; 2 podiums in 2025 for Williams
    // Williams struggling in 2026 new regs; elite tyre/smoothness rep
    pace: 87, wetWeatherPace: 84, overtaking: 82, smoothness: 91,
    age: 31, peakPotential: 90, primeEnd: 33, narrativeModifier: 3,
    contractExpiresAfterSeason: 2027,
  },

  // Racing Bulls
  {
    id: 'liam-lawson',
    name: 'Liam Lawson',
    teamId: 'racingbulls',
    // Demoted from Red Bull after failing vs Verstappen; comfortably beaten by Hadjar in 2025
    // Still a capable midfield driver but took a clear step back in perception
    pace: 78, wetWeatherPace: 74, overtaking: 76, smoothness: 73,
    age: 24, peakPotential: 86, primeEnd: 30, narrativeModifier: 0,
    contractExpiresAfterSeason: 2026,
  },
  {
    id: 'arvid-lindblad',
    name: 'Arvid Lindblad',
    teamId: 'racingbulls',
    // Scored points in 2026 (Racing Bulls 6th in constructors); limited data but promising
    pace: 70, wetWeatherPace: 66, overtaking: 67, smoothness: 68,
    age: 19, peakPotential: 88, primeEnd: 30, narrativeModifier: 1,
    contractExpiresAfterSeason: 2027,
  },

  // Haas
  {
    id: 'oliver-bearman',
    name: 'Oliver Bearman',
    teamId: 'haas',
    // Beat Ocon statistically in 2025 (very rare for rookie vs established driver)
    // Fearless overtaking cited; 50G crash in Japan 2026 — raw but genuinely fast
    // Mexico 2025: raced Piastri and Verstappen wheel to wheel convincingly
    pace: 76, wetWeatherPace: 71, overtaking: 78, smoothness: 68,
    age: 20, peakPotential: 88, primeEnd: 29, narrativeModifier: 2,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'esteban-ocon',
    name: 'Esteban Ocon',
    teamId: 'haas',
    // Lost teammate battle to rookie Bearman in 2025; scored 1pt in 2026 Canada
    // Solid but unspectacular; Haas 7pts in constructors
    pace: 77, wetWeatherPace: 74, overtaking: 71, smoothness: 76,
    age: 29, peakPotential: 82, primeEnd: 32, narrativeModifier: -1,
    contractExpiresAfterSeason: 2026,
  },

  // Audi
  {
    id: 'nico-hulkenberg',
    name: 'Nico Hulkenberg',
    teamId: 'audi',
    // Top 5 wet weather driver 2025 (Silverstone podium in rain); racecraft and pace management praised
    // 0pts in 2026 so far but Audi is a backmarker; outqualified by Bortoleto in 2025
    pace: 77, wetWeatherPace: 82, overtaking: 72, smoothness: 75,
    age: 38, peakPotential: 80, primeEnd: 32, narrativeModifier: -1,
    contractExpiresAfterSeason: 2026,
  },
  {
    id: 'gabriel-bortoleto',
    name: 'Gabriel Bortoleto',
    teamId: 'audi',
    // Outqualified Hulkenberg in 2025; raw pace evident; 2pts in 2026
    // Converting qualifying pace to race results remains the challenge
    pace: 72, wetWeatherPace: 66, overtaking: 68, smoothness: 68,
    age: 21, peakPotential: 88, primeEnd: 30, narrativeModifier: 1,
    contractExpiresAfterSeason: 2027,
  },

  // Cadillac
  {
    id: 'sergio-perez',
    name: 'Sergio Perez',
    teamId: 'cadillac',
    // 0pts in 2026 with Cadillac; extracted more from car than Bottas in Canada
    // Race management and smoothness still respectable; pace faded significantly in 2024-25
    pace: 78, wetWeatherPace: 76, overtaking: 74, smoothness: 82,
    age: 36, peakPotential: 86, primeEnd: 33, narrativeModifier: -2,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'valtteri-bottas',
    name: 'Valtteri Bottas',
    teamId: 'cadillac',
    // 0pts in 2026; underperformed vs Perez in Canada specifically noted
    pace: 77, wetWeatherPace: 75, overtaking: 70, smoothness: 79,
    age: 36, peakPotential: 84, primeEnd: 32, narrativeModifier: -3,
    contractExpiresAfterSeason: 2027,
  },
]