import type { RaceState, Driver, Team, RaceResult } from './types'
import { getPoints } from './points'

// Build the persisted RaceResult[] from a finished race state. Shared by the live
// race screen and the headless "simulate ahead" path so both produce identical rows.
export function buildRaceResults(raceState: RaceState, drivers: Driver[], teams: Team[]): RaceResult[] {
  return raceState.drivers
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((ds) => {
      const driver = drivers.find((d) => d.id === ds.driverId)
      const team = driver ? teams.find((t) => t.id === driver.teamId) : undefined
      const qr = raceState.qualifyingResults.find((q) => q.driverId === ds.driverId)
      // stintHistory only holds stints CLOSED by a pit stop; append the open stint the
      // driver was on at the flag or at retirement, so a no-stop DNF still shows a stint.
      const stints = ds.stintLap > 0
        ? [...ds.stintHistory, { compound: ds.currentTyre.compound, laps: ds.stintLap }]
        : ds.stintHistory
      return {
        driverId: ds.driverId, driverName: driver?.name ?? ds.driverId,
        teamId: driver?.teamId ?? '', teamName: team?.name ?? '',
        gridPosition: qr?.gridPosition ?? 0,
        finishPosition: ds.retired ? null : ds.position,
        points: getPoints(ds.retired ? null : ds.position),
        form: ds.form,
        lapsCompleted: ds.lapTimes.length, totalTime: ds.retired ? null : ds.totalTime,
        dnf: ds.retired, stints,
        q1Time: qr?.q1Time ?? null, q2Time: qr?.q2Time ?? null, q3Time: qr?.q3Time ?? null,
      } satisfies RaceResult
    })
}
