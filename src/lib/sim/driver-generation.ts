import type { Driver } from './types'
import { sampleNormal } from './rng-utils'
import { FAKER_LOCALES, FAKER_LOCALE_CODES } from '@/data/driver-name-pool'

let generatedCounter = 0
let rookieCounter = 0

// Counters reset to 0 whenever the module reloads (server restart, hot reload),
// so pair them with a random suffix to keep generated IDs unique across process
// lifetimes. IDs are opaque keys — never parsed — so the format is free to change.
function idSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}

function pickLocaleIndex(): number {
  return Math.floor(Math.random() * FAKER_LOCALES.length)
}

export function pickName(usedNames: Set<string>): { name: string; nationality: string } {
  for (let attempt = 0; attempt < 40; attempt++) {
    const idx = pickLocaleIndex()
    const f = FAKER_LOCALES[idx]
    const sex = Math.random() < 0.05 ? 'female' : 'male'
    const name = `${f.person.firstName(sex)} ${f.person.lastName()}`
    if (!usedNames.has(name)) {
      usedNames.add(name)
      return { name, nationality: FAKER_LOCALE_CODES[idx] }
    }
  }
  generatedCounter++
  return { name: `Driver ${generatedCounter}`, nationality: 'GB' }
}

export function generateFreeAgentPool(
  count: number,
  year: number,
  existingDrivers: Driver[],
  rng: () => number,
): Driver[] {
  const usedNames = new Set(existingDrivers.map((d) => d.name))
  const pool: Driver[] = []

  for (let i = 0; i < count; i++) {
    generatedCounter++
    const { name, nationality } = pickName(usedNames)

    const age = 17 + Math.floor(rng() * 5)
    const peakPotential = Math.max(55, Math.min(99, Math.round(sampleNormal(72, 10, rng))))
    const statCap = Math.floor(peakPotential * 0.92)
    const paceMean = peakPotential * 0.80
    const pace = Math.max(45, Math.min(statCap, Math.round(sampleNormal(paceMean, 5, rng))))
    const stat = () => Math.max(40, Math.min(statCap, Math.round(sampleNormal(pace - 2, 6, rng))))
    const primeEnd = Math.max(age + 1, Math.round(Math.max(27, Math.min(35, sampleNormal(30, 2, rng)))))

    pool.push({
      id: `gen-${year}-${generatedCounter}-${idSuffix()}`,
      name,
      teamId: '',
      nationality,
      pace,
      wetWeatherPace: stat(),
      overtaking: stat(),
      smoothness: stat(),
      age,
      peakPotential,
      primeEnd,
      narrativeModifier: 0,
      contractExpiresAfterSeason: year - 1,
      seasonsSinceF1Seat: 0,
    })
  }

  return pool
}

export function generateRookie(teamId: string, newYear: number, rng: () => number): Driver {
  rookieCounter++
  const stat = () => Math.max(55, Math.min(78, Math.round(sampleNormal(68, 5, rng))))
  const { name, nationality } = pickName(new Set())
  return {
    id: `rookie-${teamId}-${newYear}-${rookieCounter}-${idSuffix()}`,
    name,
    nationality,
    teamId,
    pace: stat(),
    wetWeatherPace: stat(),
    overtaking: stat(),
    smoothness: stat(),
    age: 19 + Math.floor(rng() * 3),
    peakPotential: Math.max(72, Math.min(92, Math.round(sampleNormal(82, 6, rng)))),
    primeEnd: 29 + Math.floor(rng() * 3),
    narrativeModifier: 0,
    contractExpiresAfterSeason: newYear,
    seasonsSinceF1Seat: 0,
  }
}
