// Build drill-down detail for the CURRENT (unarchived) season straight from the
// Zustand store, mirroring the DB-backed actions for archived seasons. Client-safe.

import type { LiveStore } from './merge'
import type {
  DriverSeasonDetail, DriverSeasonRace, TeamSeasonDetail, TeamSeasonRace,
  RaceClassification, RaceClassificationRow,
} from './types'

export function buildLiveDriverSeason(driverId: string, store: LiveStore): DriverSeasonDetail | null {
  const live = store.drivers.find((d) => d.id === driverId)
  const races: DriverSeasonRace[] = []
  store.raceResults.forEach((round, i) => {
    const r = round.find((x) => x.driverId === driverId)
    if (!r) return
    races.push({
      round: i + 1,
      circuitId: store.calendar[i]?.id ?? `r${i + 1}`,
      circuitName: store.calendar[i]?.name ?? `Round ${i + 1}`,
      gridPosition: r.gridPosition,
      finishPosition: r.dnf ? null : r.finishPosition,
      dnf: r.dnf,
      points: r.points,
      lapsCompleted: r.lapsCompleted,
      q1: r.q1Time, q2: r.q2Time, q3: r.q3Time,
      stints: r.stints,
    })
  })
  if (races.length === 0 && !live) return null

  const totals = races.reduce(
    (acc, r) => ({
      races: acc.races + 1,
      wins: acc.wins + (r.finishPosition === 1 ? 1 : 0),
      podiums: acc.podiums + (r.finishPosition != null && r.finishPosition <= 3 ? 1 : 0),
      points: acc.points + r.points,
      poles: acc.poles + (r.gridPosition === 1 ? 1 : 0),
      dnfs: acc.dnfs + (r.dnf ? 1 : 0),
    }),
    { races: 0, wins: 0, podiums: 0, points: 0, poles: 0, dnfs: 0 },
  )
  const team = store.teams.find((t) => t.id === live?.teamId)
  const champIdx = store.driverStandings.findIndex((s) => s.driverId === driverId)
  return {
    driverId,
    driverName: live?.name ?? driverId,
    year: store.year,
    teamId: live?.teamId ?? '',
    teamName: team?.name ?? 'Free Agent',
    championshipFinish: champIdx >= 0 ? champIdx + 1 : null,
    inProgress: true,
    totals,
    races,
  }
}

export function buildLiveTeamSeason(teamId: string, store: LiveStore): TeamSeasonDetail | null {
  const live = store.teams.find((t) => t.id === teamId)
  const byRound = new Map<number, TeamSeasonRace>()
  const driverNames = new Map<string, string>()
  let wins = 0, podiums = 0, points = 0

  store.raceResults.forEach((round, i) => {
    for (const r of round) {
      if (r.teamId !== teamId) continue
      driverNames.set(r.driverId, r.driverName)
      if (r.finishPosition === 1 && !r.dnf) wins++
      if (!r.dnf && r.finishPosition != null && r.finishPosition <= 3) podiums++
      points += r.points
      if (!byRound.has(i + 1)) {
        byRound.set(i + 1, {
          round: i + 1,
          circuitId: store.calendar[i]?.id ?? `r${i + 1}`,
          circuitName: store.calendar[i]?.name ?? `Round ${i + 1}`,
          cars: [], points: 0,
        })
      }
      const entry = byRound.get(i + 1)!
      entry.cars.push({
        driverId: r.driverId, driverName: r.driverName, gridPosition: r.gridPosition,
        finishPosition: r.dnf ? null : r.finishPosition, dnf: r.dnf, points: r.points,
      })
      entry.points += r.points
    }
  })
  if (byRound.size === 0 && !live) return null

  const squad = store.drivers.filter((d) => d.teamId === teamId)
  for (const d of squad) if (!driverNames.has(d.id)) driverNames.set(d.id, d.name)
  const ci = store.constructorStandings.findIndex((s) => s.teamId === teamId)
  for (const e of byRound.values()) e.cars.sort((a, b) => (a.finishPosition ?? 99) - (b.finishPosition ?? 99))

  return {
    teamId,
    teamName: live?.name ?? teamId,
    year: store.year,
    finalPosition: ci >= 0 ? ci + 1 : null,
    inProgress: true,
    totals: { races: byRound.size, wins, podiums, points },
    drivers: [...driverNames].map(([driverId, driverName]) => ({ driverId, driverName })),
    races: [...byRound.values()].sort((a, b) => a.round - b.round),
  }
}

export function buildLiveRaceClassification(round: number, store: LiveStore): RaceClassification | null {
  const results = store.raceResults[round - 1]
  if (!results || results.length === 0) return null
  const rows: RaceClassificationRow[] = results
    .map((r) => ({
      driverId: r.driverId, driverName: r.driverName, teamId: r.teamId, teamName: r.teamName,
      gridPosition: r.gridPosition, finishPosition: r.dnf ? null : r.finishPosition, dnf: r.dnf,
      points: r.points, lapsCompleted: r.lapsCompleted, totalTime: r.totalTime,
      q1: r.q1Time, q2: r.q2Time, q3: r.q3Time, stints: r.stints,
    }))
    .sort((a, b) => {
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1
      return (a.finishPosition ?? 99) - (b.finishPosition ?? 99)
    })
  return {
    year: store.year, round,
    circuitId: store.calendar[round - 1]?.id ?? `r${round}`,
    circuitName: store.calendar[round - 1]?.name ?? `Round ${round}`,
    inProgress: true, rows,
  }
}
