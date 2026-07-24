import { describe, it, expect, vi } from 'vitest'
import { initRaceState } from './race'
import { LiveRace, LIVE_DT } from './live'
import type { Driver, Team, Circuit, QualifyingResult, RaceState } from './types'

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32 }
}
function makeDriver(id: string, teamId: string, pace: number): Driver {
  return { id, name: id, teamId, nationality: 'GB', gender: 'male', pace, wetWeatherPace: pace,
    overtaking: pace, smoothness: pace, consistency: pace, confidence: 5, age: 25,
    peakPotential: 80, primeEnd: 30, narrativeModifier: 0, contractExpiresAfterSeason: 2030 }
}
function makeTeam(id: string, carPace: number): Team {
  return { id, name: id, shortName: id.slice(0, 3).toUpperCase(), nationality: 'GB', color: '#F00', carPace }
}
const CIRCUIT: Circuit = { id: 'testring', name: 'T', code: 'TST', location: 'x', country: 'GB', laps: 40, flatModifier: 0, sundayOfYear: 1 }
// Wide pace spread so the leaders lap the tail.
const DRIVERS: Driver[] = [
  makeDriver('d1','tA',95), makeDriver('d2','tA',93), makeDriver('d3','tB',80), makeDriver('d4','tB',78),
  makeDriver('d5','tC',60), makeDriver('d6','tC',55), makeDriver('d7','tD',40), makeDriver('d8','tD',35),
]
const TEAMS: Team[] = [makeTeam('tA',95), makeTeam('tB',75), makeTeam('tC',50), makeTeam('tD',30)]
const quali = (): QualifyingResult[] => DRIVERS.map((d,i)=>({ driverId:d.id, gridPosition:i+1, bestTime:80+i*0.1, q1Time:null,q2Time:null,q3Time:null }))
function freshState(seed: number): RaceState {
  vi.spyOn(Math,'random').mockImplementation(lcg(seed))
  const forms = Object.fromEntries(DRIVERS.map((d)=>[d.id,5]))
  return { ...initRaceState(DRIVERS,TEAMS,CIRCUIT,quali(),[],forms,2025), phase:'racing' }
}

describe('scratch: live engine probes', () => {
  it('reports blue-flag activations and lapping', () => {
    let blue = 0, racing = 0, maxLapsDown = 0, lapDiffSeen = 0
    for (const seed of [1,2,3,5,8,13]) {
      const live = new LiveRace(freshState(seed), DRIVERS, TEAMS, CIRCUIT, 2025)
      let g = 0
      while (live.phase === 'racing' && g++ < 400000) {
        live.step(LIVE_DT)
        for (const c of live.cars) {
          if (c.passing?.cost === 'blueflag') blue++
          if (c.passing?.cost === 'pass') racing++
          maxLapsDown = Math.max(maxLapsDown, c.ds.lapsDown)
        }
        const alive = live.cars.filter(c=>!c.ds.retired && !c.finished)
        if (alive.length > 1) {
          const mx = Math.max(...alive.map(c=>c.pos)), mn = Math.min(...alive.map(c=>c.pos))
          lapDiffSeen = Math.max(lapDiffSeen, mx - mn)
        }
      }
      vi.restoreAllMocks()
    }
    console.log('BLUEFLAG_ACTIVATIONS', blue, 'RACING_PASS_ACTIVATIONS', racing, 'MAX_LAPSDOWN', maxLapsDown, 'MAX_POS_SPREAD', lapDiffSeen.toFixed(2))
    expect(true).toBe(true)
  })

  it('reports classification vs laps completed at the flag', () => {
    const violations: string[] = []
    for (const seed of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]) {
      const live = new LiveRace(freshState(seed), DRIVERS, TEAMS, CIRCUIT, 2025)
      let g = 0
      while (live.phase === 'racing' && g++ < 400000) live.step(LIVE_DT)
      const snap = live.snapshot()
      const run = snap.drivers.filter(d=>!d.retired)
      for (let i=1;i<run.length;i++) {
        if (run[i].lapTimes.length > run[i-1].lapTimes.length) {
          violations.push(`seed ${seed}: P${run[i-1].position} ${run[i-1].driverId} ${run[i-1].lapTimes.length} laps ahead of P${run[i].position} ${run[i].driverId} ${run[i].lapTimes.length} laps`)
        }
      }
      vi.restoreAllMocks()
    }
    console.log('CLASSIFICATION_VIOLATIONS', violations.length)
    for (const v of violations.slice(0,10)) console.log('  ', v)
    expect(true).toBe(true)
  })
})
