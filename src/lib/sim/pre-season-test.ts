import type { Driver, Team, Circuit, TyreCompound, FuelBand, PreSeasonTest, PreSeasonTestEntry } from './types'
import { effectiveCarPace } from './car-rating'

// Dry compounds available for a test run.
const DRY_COMPOUNDS: TyreCompound[] = ['soft', 'medium', 'hard']

// Dry-compound lap-time delta, mirroring engine.ts compoundDeltas.
const COMPOUND_DELTA: Record<string, number> = { soft: 0, medium: 0.7, hard: 1.5 }

// Fuel load is randomised across this lap-equivalent range; heavier = slower.
const MIN_FUEL_LAPS = 8
const MAX_FUEL_LAPS = 66

function fuelBand(fuelLaps: number): FuelBand {
  if (fuelLaps <= 22) return 'light'
  if (fuelLaps <= 37) return 'medium'
  if (fuelLaps <= 52) return 'heavy'
  return 'full'
}

// Pick the team's lead runner for testing: the higher-pace of its drivers.
function leadDriver(drivers: Driver[], teamId: string): Driver | undefined {
  return drivers
    .filter((d) => d.teamId === teamId)
    .sort((a, b) => b.pace - a.pace)[0]
}

// A single dry, fresh-tyre, no-traffic lap — the clean subset of engine.ts's
// computeLapTime. Car pace, tyre compound and fuel load are the only movers,
// so fuel/tyre randomness deliberately obscures the true relative car pace.
function testLapTime(carPace: number, driverPace: number, compound: TyreCompound, fuelLaps: number, flatModifier: number, rng: () => number): number {
  const carMod = (75 - carPace) / 25
  const driverMod = -((driverPace - 75) / 5) * 0.1
  const fuelMod = fuelLaps * 0.05
  const compoundDelta = COMPOUND_DELTA[compound]
  const noise = rng() * 0.3
  return 100 + carMod + driverMod + fuelMod + compoundDelta + flatModifier + noise
}

export function runPreSeasonTest(
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  rng: () => number,
): PreSeasonTest {
  const entries: PreSeasonTestEntry[] = []

  for (const team of teams) {
    const driver = leadDriver(drivers, team.id)
    if (!driver) continue

    const compound = DRY_COMPOUNDS[Math.floor(rng() * DRY_COMPOUNDS.length)]
    const fuelLaps = MIN_FUEL_LAPS + Math.floor(rng() * (MAX_FUEL_LAPS - MIN_FUEL_LAPS + 1))
    const lapTime = testLapTime(effectiveCarPace(team, circuit.straightness), driver.pace, compound, fuelLaps, circuit.flatModifier, rng)

    entries.push({
      teamId: team.id,
      teamName: team.name,
      driverId: driver.id,
      driverName: driver.name,
      tyre: compound,
      fuelBand: fuelBand(fuelLaps),
      lapTime: Math.round(lapTime * 1000) / 1000,
      carPace: team.carPace,
    })
  }

  entries.sort((a, b) => a.lapTime - b.lapTime)
  return { circuitName: circuit.name, entries }
}
