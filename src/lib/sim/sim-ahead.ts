import { useSeasonStore } from '@/lib/store/season-store'
import { useRaceStore } from '@/lib/store/race-store'
import { calendar2026 } from '@/data/calendar'
import { isOffSeason } from './types'
import { buildRaceResults } from './race-results'
import { actionCreateSeason, actionFlushRaceResult } from '@/lib/db/actions'

// Headlessly simulate full race weekends from the current round up to (but not
// including) `targetRound`, recording + flushing each, leaving the season pre-race at
// the target. Yields to the event loop between races so the home screen repaints live
// (each recordRaceResult updates the season store). Stops if the season ends first.
export async function simulateUntilRound(targetRound: number, onRace?: (round: number) => void): Promise<void> {
  const total = calendar2026.length

  while (true) {
    const season = useSeasonStore.getState()
    if (season.phase === 'idle' || isOffSeason(season.phase)) break
    if (season.currentRound >= targetRound) break

    const round = season.currentRound
    const circuit = calendar2026[round - 1]
    if (!circuit) break
    const grid = season.drivers.filter((d) => d.teamId !== '')

    // Run the full race headlessly through the race engine.
    const race = useRaceStore.getState()
    race.loadFromSeason(grid, season.teams, circuit.id)
    race.initSession() // qualifying → pre-race
    const rs = useRaceStore.getState().raceState
    if (!rs) break
    useRaceStore.setState({ raceState: { ...rs, phase: 'racing' } })
    let guard = 0
    while (useRaceStore.getState().raceState?.phase === 'racing' && guard++ < 3000) {
      useRaceStore.getState().tickLap()
    }
    const finished = useRaceStore.getState().raceState
    if (!finished) break

    const results = buildRaceResults(finished, grid, season.teams)

    // Record (applies progression/upgrades, writes the round) and persist to the DB.
    season.recordRaceResult(results)
    let dbSeasonId = useSeasonStore.getState().dbSeasonId
    if (!dbSeasonId) {
      dbSeasonId = await actionCreateSeason(season.year)
      useSeasonStore.getState().setDbSeasonId(dbSeasonId)
    }
    // Post-race attribute snapshots for the ratings-progression chart.
    const snapshots = useSeasonStore.getState().drivers
      .filter((d) => d.teamId !== '')
      .map((d) => ({ driverId: d.id, pace: d.pace, wetWeatherPace: d.wetWeatherPace, overtaking: d.overtaking, smoothness: d.smoothness }))
    const lapData = finished.drivers.map((ds) => ({
      driverId: ds.driverId,
      driverName: grid.find((d) => d.id === ds.driverId)?.name ?? ds.driverId,
      lapTimes: ds.lapTimes,
    }))
    await actionFlushRaceResult(dbSeasonId, round, circuit.id, circuit.name, results, snapshots, lapData)

    // Advance (handles end-of-season on the final round) and clear the race engine.
    useSeasonStore.getState().advanceRound()
    useRaceStore.getState().resetSession()

    onRace?.(round)
    // Let React paint the updated standings/calendar before the next race.
    await new Promise((resolve) => setTimeout(resolve, 0))

    if (round >= total) break // season just ended
  }
}
