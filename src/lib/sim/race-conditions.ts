import type { Circuit, WeatherPoint, TyreCompound } from './types'
import { seededRng } from './rng-utils'
import { generateWeatherCurve, generateForecastCurve } from './weather'
import { generateCompoundDeltas, generateTyreBaseLife } from './tyres'

// All of a race's pre-determined conditions, seeded from (year, circuit) so a pre-race preview can
// state the very forecast and tyre picture the race will run. Same seed -> identical conditions every
// time; different races differ because the circuit id (and year) differ. The DISTRIBUTIONS are
// unchanged from the unseeded path — these are the same generators, only made deterministic. Only the
// live race dynamics (car form, team beliefs, driver form, per-set tyre luck, lap wear) stay random.
export function raceConditions(saveSeed: string, year: number, circuit: Circuit): {
  weather: WeatherPoint[]
  forecast: WeatherPoint[]
  compoundDeltas: Record<TyreCompound, number>
  tyreBaseLife: Record<TyreCompound, number>
} {
  const rng = seededRng(`${saveSeed}:${year}:${circuit.id}`)
  const weather = generateWeatherCurve(circuit.laps, rng)
  const forecast = generateForecastCurve(weather, circuit.laps, rng)
  const compoundDeltas = generateCompoundDeltas(rng)
  const tyreBaseLife = generateTyreBaseLife(rng)
  return { weather, forecast, compoundDeltas, tyreBaseLife }
}
