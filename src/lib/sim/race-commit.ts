import { useSeasonStore } from '@/lib/store/season-store'
import { useRaceStore } from '@/lib/store/race-store'
import { calendarForYear } from '@/data/calendars'
import { buildRaceResults } from './race-results'
import { actionCreateSeason, actionFlushRaceResult } from '@/lib/db/actions'

// Commit the finished race held in the race store: apply it to the season (progression/upgrades),
// persist it to the archive DB, then advance the round (or end the season). Shared by the match-mode
// "End Race" CTA. No-op unless a race is actually finished. Returns true once committed.
export async function commitCurrentRace(): Promise<boolean> {
  const race = useRaceStore.getState()
  const rs = race.raceState
  if (!rs || rs.phase !== 'finished') return false

  const season = useSeasonStore.getState()
  const round = season.currentRound
  const circuit = calendarForYear(season.year)[round - 1]
  if (!circuit) return false

  const results = buildRaceResults(rs, race.drivers, race.teams, season.year)
  season.recordRaceResult(results)

  let dbSeasonId = useSeasonStore.getState().dbSeasonId
  if (!dbSeasonId) {
    dbSeasonId = await actionCreateSeason(season.year)
    useSeasonStore.getState().setDbSeasonId(dbSeasonId)
  }
  // Post-race attribute snapshots for the career ratings-progression chart.
  const snapshots = useSeasonStore.getState().drivers
    .filter((d) => d.teamId !== '')
    .map((d) => ({ driverId: d.id, pace: d.pace, wetWeatherPace: d.wetWeatherPace, overtaking: d.overtaking, smoothness: d.smoothness, consistency: d.consistency }))
  await actionFlushRaceResult(dbSeasonId, round, circuit.id, circuit.name, results, snapshots)

  useSeasonStore.getState().advanceRound()
  useRaceStore.getState().resetSession()
  return true
}
