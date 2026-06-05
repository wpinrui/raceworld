import { Driver, Team } from '@/lib/sim/types'

// Car pace order based on 2025 constructors standings
export const teams2026: Team[] = [
  { id: 'mercedes', name: 'Mercedes', shortName: 'MER', nationality: 'DE', color: '#00D2BE', carPace: 75 }, // 1st
  { id: 'ferrari', name: 'Ferrari', shortName: 'FER', nationality: 'IT', color: '#DC0000', carPace: 70 }, // 2nd
  { id: 'mclaren', name: 'McLaren', shortName: 'MCL', nationality: 'GB', color: '#FF8000', carPace: 65 }, // 3rd
  { id: 'redbull', name: 'Red Bull', shortName: 'RBR', nationality: 'AT', color: '#0E1C5C', carPace: 60 }, // 4th
  { id: 'alpine', name: 'Alpine', shortName: 'ALP', nationality: 'FR', color: '#FF73B3', carPace: 55 }, // 5th
  { id: 'racingbulls', name: 'Racing Bulls', shortName: 'RB', nationality: 'IT', color: '#1634CB', carPace: 50 }, // 6th
  { id: 'haas', name: 'Haas', shortName: 'HAA', nationality: 'US', color: '#E4E7EB', carPace: 45 }, // 7th
  { id: 'williams', name: 'Williams', shortName: 'WIL', nationality: 'GB', color: '#1A3C8E', carPace: 40 }, // 8th
  { id: 'audi', name: 'Audi', shortName: 'AUD', nationality: 'DE', color: '#8C1C3A', carPace: 35 }, // 9th
  { id: 'astonmartin', name: 'Aston Martin', shortName: 'AMR', nationality: 'GB', color: '#1E5B45', carPace: 30 }, // 10th
  { id: 'cadillac', name: 'Cadillac', shortName: 'CAD', nationality: 'US', color: '#C99A2E', carPace: 25 }, // 11th
]

export const drivers2026: Driver[] = [
  // McLaren
  {
    id: 'lando-norris',
    name: 'Lando Norris',
    teamId: 'mclaren',
    nationality: 'GB',
    gender: 'male',
    pace: 91, wetWeatherPace: 87, overtaking: 89, smoothness: 80,
    age: 26, peakPotential: 94, primeEnd: 32, narrativeModifier: 3,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'oscar-piastri',
    name: 'Oscar Piastri',
    teamId: 'mclaren',
    nationality: 'AU',
    gender: 'male',
    pace: 92, wetWeatherPace: 83, overtaking: 82, smoothness: 86,
    age: 25, peakPotential: 95, primeEnd: 31, narrativeModifier: 2,
    contractExpiresAfterSeason: 2026,
  },

  // Ferrari
  {
    id: 'charles-leclerc',
    name: 'Charles Leclerc',
    teamId: 'ferrari',
    nationality: 'MC',
    gender: 'male',
    pace: 93, wetWeatherPace: 80, overtaking: 85, smoothness: 83,
    age: 29, peakPotential: 95, primeEnd: 33, narrativeModifier: 4,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'lewis-hamilton',
    name: 'Lewis Hamilton',
    teamId: 'ferrari',
    nationality: 'GB',
    gender: 'male',
    pace: 87, wetWeatherPace: 90, overtaking: 85, smoothness: 93,
    age: 41, peakPotential: 97, primeEnd: 35, narrativeModifier: 7,
    contractExpiresAfterSeason: 2026,
  },

  // Red Bull
  {
    id: 'max-verstappen',
    name: 'Max Verstappen',
    teamId: 'redbull',
    nationality: 'NL',
    gender: 'male',
    pace: 97, wetWeatherPace: 93, overtaking: 97, smoothness: 88,
    age: 28, peakPotential: 98, primeEnd: 34, narrativeModifier: 5,
    contractExpiresAfterSeason: 2028,
  },
  {
    id: 'isack-hadjar',
    name: 'Isack Hadjar',
    teamId: 'redbull',
    nationality: 'FR',
    gender: 'male',
    pace: 80, wetWeatherPace: 76, overtaking: 79, smoothness: 75,
    age: 21, peakPotential: 91, primeEnd: 31, narrativeModifier: 2,
    contractExpiresAfterSeason: 2027,
  },

  // Mercedes
  {
    id: 'george-russell',
    name: 'George Russell',
    teamId: 'mercedes',
    nationality: 'GB',
    gender: 'male',
    pace: 90, wetWeatherPace: 87, overtaking: 83, smoothness: 87,
    age: 28, peakPotential: 92, primeEnd: 33, narrativeModifier: 2,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'kimi-antonelli',
    name: 'Kimi Antonelli',
    teamId: 'mercedes',
    nationality: 'IT',
    gender: 'male',
    pace: 88, wetWeatherPace: 82, overtaking: 78, smoothness: 80,
    age: 19, peakPotential: 95, primeEnd: 31, narrativeModifier: 3,
    contractExpiresAfterSeason: 2027,
  },

  // Aston Martin
  {
    id: 'fernando-alonso',
    name: 'Fernando Alonso',
    teamId: 'astonmartin',
    nationality: 'ES',
    gender: 'male',
    pace: 87, wetWeatherPace: 91, overtaking: 90, smoothness: 91,
    age: 44, peakPotential: 95, primeEnd: 36, narrativeModifier: 10,
    contractExpiresAfterSeason: 2026,
  },
  {
    id: 'lance-stroll',
    name: 'Lance Stroll',
    teamId: 'astonmartin',
    nationality: 'CA',
    gender: 'male',
    pace: 61, wetWeatherPace: 63, overtaking: 54, smoothness: 64,
    age: 27, peakPotential: 70, primeEnd: 30, narrativeModifier: -5,
    contractExpiresAfterSeason: 2028,
  },

  // Alpine
  {
    id: 'pierre-gasly',
    name: 'Pierre Gasly',
    teamId: 'alpine',
    nationality: 'FR',
    gender: 'male',
    pace: 83, wetWeatherPace: 81, overtaking: 79, smoothness: 80,
    age: 30, peakPotential: 86, primeEnd: 32, narrativeModifier: 1,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'franco-colapinto',
    name: 'Franco Colapinto',
    teamId: 'alpine',
    nationality: 'AR',
    gender: 'male',
    pace: 76, wetWeatherPace: 68, overtaking: 73, smoothness: 68,
    age: 22, peakPotential: 86, primeEnd: 30, narrativeModifier: 2,
    contractExpiresAfterSeason: 2026,
  },

  // Williams
  {
    id: 'alexander-albon',
    name: 'Alexander Albon',
    teamId: 'williams',
    nationality: 'TH',
    gender: 'male',
    pace: 80, wetWeatherPace: 77, overtaking: 76, smoothness: 79,
    age: 30, peakPotential: 84, primeEnd: 32, narrativeModifier: 0,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'carlos-sainz',
    name: 'Carlos Sainz',
    teamId: 'williams',
    nationality: 'ES',
    gender: 'male',
    pace: 87, wetWeatherPace: 84, overtaking: 82, smoothness: 91,
    age: 31, peakPotential: 90, primeEnd: 33, narrativeModifier: 3,
    contractExpiresAfterSeason: 2027,
  },

  // Racing Bulls
  {
    id: 'liam-lawson',
    name: 'Liam Lawson',
    teamId: 'racingbulls',
    nationality: 'NZ',
    gender: 'male',
    pace: 78, wetWeatherPace: 74, overtaking: 76, smoothness: 73,
    age: 24, peakPotential: 86, primeEnd: 30, narrativeModifier: 0,
    contractExpiresAfterSeason: 2026,
  },
  {
    id: 'arvid-lindblad',
    name: 'Arvid Lindblad',
    teamId: 'racingbulls',
    nationality: 'GB',
    gender: 'male',
    pace: 70, wetWeatherPace: 66, overtaking: 67, smoothness: 68,
    age: 19, peakPotential: 88, primeEnd: 30, narrativeModifier: 1,
    contractExpiresAfterSeason: 2027,
  },

  // Haas
  {
    id: 'oliver-bearman',
    name: 'Oliver Bearman',
    teamId: 'haas',
    nationality: 'GB',
    gender: 'male',
    pace: 76, wetWeatherPace: 71, overtaking: 78, smoothness: 68,
    age: 20, peakPotential: 88, primeEnd: 29, narrativeModifier: 2,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'esteban-ocon',
    name: 'Esteban Ocon',
    teamId: 'haas',
    nationality: 'FR',
    gender: 'male',
    pace: 77, wetWeatherPace: 74, overtaking: 71, smoothness: 76,
    age: 29, peakPotential: 82, primeEnd: 32, narrativeModifier: -1,
    contractExpiresAfterSeason: 2026,
  },

  // Audi
  {
    id: 'nico-hulkenberg',
    name: 'Nico Hulkenberg',
    teamId: 'audi',
    nationality: 'DE',
    gender: 'male',
    pace: 77, wetWeatherPace: 82, overtaking: 72, smoothness: 75,
    age: 38, peakPotential: 80, primeEnd: 32, narrativeModifier: -1,
    contractExpiresAfterSeason: 2026,
  },
  {
    id: 'gabriel-bortoleto',
    name: 'Gabriel Bortoleto',
    teamId: 'audi',
    nationality: 'BR',
    gender: 'male',
    pace: 72, wetWeatherPace: 66, overtaking: 68, smoothness: 68,
    age: 21, peakPotential: 88, primeEnd: 30, narrativeModifier: 1,
    contractExpiresAfterSeason: 2027,
  },

  // Cadillac
  {
    id: 'sergio-perez',
    name: 'Sergio Perez',
    teamId: 'cadillac',
    nationality: 'MX',
    gender: 'male',
    pace: 78, wetWeatherPace: 76, overtaking: 74, smoothness: 82,
    age: 36, peakPotential: 86, primeEnd: 33, narrativeModifier: -2,
    contractExpiresAfterSeason: 2027,
  },
  {
    id: 'valtteri-bottas',
    name: 'Valtteri Bottas',
    teamId: 'cadillac',
    nationality: 'FI',
    gender: 'male',
    pace: 77, wetWeatherPace: 75, overtaking: 70, smoothness: 79,
    age: 36, peakPotential: 84, primeEnd: 32, narrativeModifier: -3,
    contractExpiresAfterSeason: 2027,
  },
]
