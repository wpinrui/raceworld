import { Driver, Team } from '@/lib/sim/types'

// Car pace order based on 2025 constructors standings
export const teams2026: Team[] = [
  { id: 'mercedes',    name: 'Mercedes',       shortName: 'MER', color: '#27F4D2', carPace: 75 }, // 1st
  { id: 'ferrari',     name: 'Ferrari',        shortName: 'FER', color: '#E8002D', carPace: 70 }, // 2nd
  { id: 'mclaren',     name: 'McLaren',        shortName: 'MCL', color: '#FF8000', carPace: 65 }, // 3rd
  { id: 'redbull',     name: 'Red Bull',       shortName: 'RBR', color: '#3671C6', carPace: 60 }, // 4th
  { id: 'alpine',      name: 'Alpine',         shortName: 'ALP', color: '#FF87BC', carPace: 55 }, // 5th
  { id: 'racingbulls', name: 'Racing Bulls',   shortName: 'RB',  color: '#6692FF', carPace: 50 }, // 6th
  { id: 'haas',        name: 'Haas',           shortName: 'HAA', color: '#B6BABD', carPace: 45 }, // 7th
  { id: 'williams',    name: 'Williams',       shortName: 'WIL', color: '#64C4FF', carPace: 40 }, // 8th
  { id: 'audi',        name: 'Audi',           shortName: 'AUD', color: '#BB0020', carPace: 35 }, // 9th
  { id: 'cadillac',    name: 'Cadillac',       shortName: 'CAD', color: '#94A3B8', carPace: 30 }, // 10th (new entrant, 0 pts)
  { id: 'astonmartin', name: 'Aston Martin',   shortName: 'AMR', color: '#229971', carPace: 25 }, // 11th (0 pts)
]

export const drivers2026: Driver[] = [
  // McLaren
  {
    id: 'lando-norris',
    name: 'Lando Norris',
    teamId: 'mclaren',
    pace: 92, wetWeatherPace: 85, overtaking: 88, smoothness: 84,
    age: 26, peakPotential: 94, primeEnd: 32, narrativeModifier: 3,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'oscar-piastri',
    name: 'Oscar Piastri',
    teamId: 'mclaren',
    pace: 89, wetWeatherPace: 82, overtaking: 84, smoothness: 87,
    age: 25, peakPotential: 93, primeEnd: 31, narrativeModifier: 2,
    contractExpiresAfterSeason: 2026,
  },

  // Ferrari
  {
    id: 'charles-leclerc',
    name: 'Charles Leclerc',
    teamId: 'ferrari',
    pace: 91, wetWeatherPace: 87, overtaking: 86, smoothness: 82,
    age: 29, peakPotential: 93, primeEnd: 33, narrativeModifier: 4,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'lewis-hamilton',
    name: 'Lewis Hamilton',
    teamId: 'ferrari',
    pace: 90, wetWeatherPace: 94, overtaking: 88, smoothness: 95,
    age: 41, peakPotential: 97, primeEnd: 35, narrativeModifier: 8,
    contractExpiresAfterSeason: 2026,
  },

  // Red Bull
  {
    id: 'max-verstappen',
    name: 'Max Verstappen',
    teamId: 'redbull',
    pace: 97, wetWeatherPace: 96, overtaking: 95, smoothness: 90,
    age: 28, peakPotential: 98, primeEnd: 34, narrativeModifier: 5,
    contractExpiresAfterSeason: 2028,
  },
  {
    id: 'isack-hadjar',
    name: 'Isack Hadjar',
    teamId: 'redbull',
    pace: 75, wetWeatherPace: 71, overtaking: 72, smoothness: 72,
    age: 21, peakPotential: 89, primeEnd: 31, narrativeModifier: 1,
    contractExpiresAfterSeason: 2027,
  },

  // Mercedes
  {
    id: 'george-russell',
    name: 'George Russell',
    teamId: 'mercedes',
    pace: 88, wetWeatherPace: 87, overtaking: 82, smoothness: 86,
    age: 28, peakPotential: 91, primeEnd: 33, narrativeModifier: 2,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'kimi-antonelli',
    name: 'Kimi Antonelli',
    teamId: 'mercedes',
    pace: 72, wetWeatherPace: 68, overtaking: 65, smoothness: 70,
    age: 19, peakPotential: 89, primeEnd: 31, narrativeModifier: 2,
    contractExpiresAfterSeason: 2027,
  },

  // Aston Martin
  {
    id: 'fernando-alonso',
    name: 'Fernando Alonso',
    teamId: 'astonmartin',
    pace: 88, wetWeatherPace: 90, overtaking: 85, smoothness: 92,
    age: 44, peakPotential: 95, primeEnd: 36, narrativeModifier: 10,
    contractExpiresAfterSeason: 2026,
  },
  {
    id: 'lance-stroll',
    name: 'Lance Stroll',
    teamId: 'astonmartin',
    pace: 62, wetWeatherPace: 60, overtaking: 55, smoothness: 65,
    age: 27, peakPotential: 70, primeEnd: 30, narrativeModifier: -5,
    contractExpiresAfterSeason: 2028,
  },

  // Alpine
  {
    id: 'pierre-gasly',
    name: 'Pierre Gasly',
    teamId: 'alpine',
    pace: 82, wetWeatherPace: 80, overtaking: 78, smoothness: 79,
    age: 30, peakPotential: 85, primeEnd: 32, narrativeModifier: 1,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'franco-colapinto',
    name: 'Franco Colapinto',
    teamId: 'alpine',
    pace: 74, wetWeatherPace: 70, overtaking: 72, smoothness: 71,
    age: 22, peakPotential: 85, primeEnd: 30, narrativeModifier: 2,
    contractExpiresAfterSeason: 2026,
  },

  // Williams
  {
    id: 'alexander-albon',
    name: 'Alexander Albon',
    teamId: 'williams',
    pace: 81, wetWeatherPace: 78, overtaking: 77, smoothness: 80,
    age: 30, peakPotential: 84, primeEnd: 32, narrativeModifier: 0,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'carlos-sainz',
    name: 'Carlos Sainz',
    teamId: 'williams',
    pace: 87, wetWeatherPace: 84, overtaking: 83, smoothness: 88,
    age: 31, peakPotential: 90, primeEnd: 33, narrativeModifier: 3,
    contractExpiresAfterSeason: 2027,
  },

  // Racing Bulls
  {
    id: 'liam-lawson',
    name: 'Liam Lawson',
    teamId: 'racingbulls',
    pace: 80, wetWeatherPace: 76, overtaking: 78, smoothness: 75,
    age: 24, peakPotential: 88, primeEnd: 30, narrativeModifier: 1,
    contractExpiresAfterSeason: 2026,
  },
  {
    id: 'arvid-lindblad',
    name: 'Arvid Lindblad',
    teamId: 'racingbulls',
    pace: 68, wetWeatherPace: 64, overtaking: 65, smoothness: 67,
    age: 19, peakPotential: 87, primeEnd: 30, narrativeModifier: 1,
    contractExpiresAfterSeason: 2027,
  },

  // Haas
  {
    id: 'oliver-bearman',
    name: 'Oliver Bearman',
    teamId: 'haas',
    pace: 73, wetWeatherPace: 69, overtaking: 70, smoothness: 72,
    age: 20, peakPotential: 86, primeEnd: 29, narrativeModifier: 2,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'esteban-ocon',
    name: 'Esteban Ocon',
    teamId: 'haas',
    pace: 78, wetWeatherPace: 75, overtaking: 72, smoothness: 77,
    age: 29, peakPotential: 82, primeEnd: 32, narrativeModifier: -1,
    contractExpiresAfterSeason: 2026,
  },

  // Audi
  {
    id: 'nico-hulkenberg',
    name: 'Nico Hulkenberg',
    teamId: 'audi',
    pace: 76, wetWeatherPace: 72, overtaking: 70, smoothness: 74,
    age: 38, peakPotential: 80, primeEnd: 32, narrativeModifier: -2,
    contractExpiresAfterSeason: 2026,
  },
  {
    id: 'gabriel-bortoleto',
    name: 'Gabriel Bortoleto',
    teamId: 'audi',
    pace: 69, wetWeatherPace: 64, overtaking: 66, smoothness: 67,
    age: 21, peakPotential: 86, primeEnd: 30, narrativeModifier: 1,
    contractExpiresAfterSeason: 2027,
  },

  // Cadillac
  {
    id: 'sergio-perez',
    name: 'Sergio Perez',
    teamId: 'cadillac',
    pace: 82, wetWeatherPace: 79, overtaking: 78, smoothness: 83,
    age: 36, peakPotential: 86, primeEnd: 33, narrativeModifier: -2,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'valtteri-bottas',
    name: 'Valtteri Bottas',
    teamId: 'cadillac',
    pace: 79, wetWeatherPace: 76, overtaking: 72, smoothness: 80,
    age: 36, peakPotential: 84, primeEnd: 32, narrativeModifier: -3,
    contractExpiresAfterSeason: 2027,
  },
]
