import { describe, it, expect, vi, afterEach } from 'vitest'
import { useRaceStore } from './race-store'
import { initRaceState } from '@/lib/sim/race'
import { SECTORS_PER_LAP, PIT_SECTOR } from '@/lib/sim/sector'
import type { Driver, Team, Circuit, QualifyingResult } from '@/lib/sim/types'

// tickSector's carried pit overrides (#sector-engine): a one-shot god-mode force-pit issued on an
// early sector must survive to the pit sector (the only slice the sim reads it on) and be consumed
// there, not silently dropped by the next tick.

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function makeDriver(id: string, teamId: string, pace: number): Driver {
  return {
    id, name: id, teamId,
    nationality: 'GB', gender: 'male',
    pace, wetWeatherPace: pace, overtaking: pace, smoothness: pace, consistency: pace,
    confidence: 5,
    age: 25, peakPotential: 80, primeEnd: 30,
    narrativeModifier: 0, contractExpiresAfterSeason: 2030,
  }
}

const CIRCUIT: Circuit = {
  id: 'testring', name: 'Testring', code: 'TST', location: 'Testville', country: 'GB',
  laps: 12, flatModifier: 0, sundayOfYear: 1,
}
const DRIVERS = [makeDriver('d1', 'tA', 85), makeDriver('d2', 'tA', 80)]
const TEAMS: Team[] = [{ id: 'tA', name: 'tA', shortName: 'TA', nationality: 'GB', color: '#F00', carPace: 80 }]
const QUALI: QualifyingResult[] = DRIVERS.map((d, i) => ({
  driverId: d.id, gridPosition: i + 1, bestTime: 80 + i * 0.1, q1Time: null, q2Time: null, q3Time: null,
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tickSector carried pit overrides', () => {
  it('holds a one-shot force-pit until the pit sector, applies it there, then clears it', () => {
    vi.spyOn(Math, 'random').mockImplementation(lcg(2))
    const forms = { d1: 5, d2: 5 }
    const raceState = { ...initRaceState(DRIVERS, TEAMS, CIRCUIT, QUALI, [], forms, 2025), phase: 'racing' as const }
    useRaceStore.setState({
      raceState, drivers: DRIVERS, teams: TEAMS, selectedCircuit: CIRCUIT,
      pitCommands: {}, carriedPitActions: [],
    })
    const store = () => useRaceStore.getState()

    // Sector 0 tick carrying nothing, then the force-pit issued on the sector-1 tick.
    store().tickSector()
    store().tickSector([{ type: 'force-pit', driverId: 'd1', compound: 'hard' }])
    expect(store().carriedPitActions).toEqual([{ type: 'force-pit', driverId: 'd1', compound: 'hard' }])

    // Intervening sectors keep carrying it.
    while ((store().raceState!.currentSector ?? 0) !== PIT_SECTOR) {
      store().tickSector()
      expect(store().carriedPitActions).toHaveLength(1)
    }

    // The pit-sector tick consumes it: the stop lands this lap and the carry is cleared.
    const lapBeing = store().raceState!.currentLap
    store().tickSector()
    expect(store().carriedPitActions).toEqual([])
    const d1 = store().raceState!.drivers.find((d) => d.driverId === 'd1')!
    expect(d1.lastPitLap).toBe(lapBeing)
    expect(d1.currentTyre.compound).toBe('hard')
    expect(d1.pitStops).toBe(1)
    expect(store().raceState!.currentSector).toBe(0)
    expect(store().raceState!.currentLap).toBe(lapBeing + 1)
  })

  it('ticks a full lap in exactly eight sectors and appends one lap time', () => {
    vi.spyOn(Math, 'random').mockImplementation(lcg(7))
    const forms = { d1: 5, d2: 5 }
    const raceState = { ...initRaceState(DRIVERS, TEAMS, CIRCUIT, QUALI, [], forms, 2025), phase: 'racing' as const }
    useRaceStore.setState({
      raceState, drivers: DRIVERS, teams: TEAMS, selectedCircuit: CIRCUIT,
      pitCommands: {}, carriedPitActions: [],
    })
    for (let i = 0; i < SECTORS_PER_LAP; i++) useRaceStore.getState().tickSector()
    const state = useRaceStore.getState().raceState!
    expect(state.currentLap).toBe(2)
    for (const d of state.drivers) {
      expect(d.lapTimes).toHaveLength(1)
      expect(d.sectorTimes).toHaveLength(SECTORS_PER_LAP)
    }
  })
})
