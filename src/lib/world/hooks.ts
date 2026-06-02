'use client'

import { useEffect, useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import {
  actionGetDriverCareer, actionGetTeamCareer, actionGetWorldOverview,
  actionGetDriverSeason, actionGetTeamSeason, actionGetRaceClassification,
} from '@/lib/db/actions'
import { mergeDriverCareer, mergeTeamCareer, type LiveStore } from './merge'
import { buildLiveDriverSeason, buildLiveTeamSeason, buildLiveRaceClassification } from './live-season'
import type {
  DriverCareer, TeamCareer, WorldOverview,
  DriverSeasonDetail, TeamSeasonDetail, RaceClassification,
} from './types'

function useLiveStore(): LiveStore {
  const s = useSeasonStore()
  return {
    year: s.year, drivers: s.drivers, teams: s.teams,
    driverStandings: s.driverStandings, constructorStandings: s.constructorStandings,
    raceResults: s.raceResults, calendar: calendar2026,
  }
}

export function useDriverCareer(id: string) {
  const live = useLiveStore()
  const [db, setDb] = useState<DriverCareer | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let on = true
    setLoading(true)
    actionGetDriverCareer(id).then((d) => { if (on) { setDb(d); setLoading(false) } })
    return () => { on = false }
  }, [id])

  const career = db ? mergeDriverCareer(db, live) : null
  const notFound = !!career && career.seasons.length === 0 && career.attributes === null
  return { career: notFound ? null : career, loading }
}

export function useTeamCareer(id: string) {
  const live = useLiveStore()
  const [db, setDb] = useState<TeamCareer | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let on = true
    setLoading(true)
    actionGetTeamCareer(id).then((d) => { if (on) { setDb(d); setLoading(false) } })
    return () => { on = false }
  }, [id])

  const career = db ? mergeTeamCareer(db, live) : null
  const notFound = !!career && career.seasons.length === 0 && career.currentSquad === null
  return { career: notFound ? null : career, loading }
}

// Drill-down: the live (current) season is built from the store; archived seasons
// are fetched from the DB. `year` decides which source to use.
export function useDriverSeason(id: string, year: number) {
  const live = useLiveStore()
  const isLive = year === live.year
  const [db, setDb] = useState<DriverSeasonDetail | null>(null)
  const [loading, setLoading] = useState(!isLive)

  useEffect(() => {
    if (isLive) return
    let on = true
    setLoading(true)
    actionGetDriverSeason(id, year).then((d) => { if (on) { setDb(d); setLoading(false) } })
    return () => { on = false }
  }, [id, year, isLive])

  if (isLive) return { detail: buildLiveDriverSeason(id, live), loading: false }
  return { detail: db, loading }
}

export function useTeamSeason(id: string, year: number) {
  const live = useLiveStore()
  const isLive = year === live.year
  const [db, setDb] = useState<TeamSeasonDetail | null>(null)
  const [loading, setLoading] = useState(!isLive)

  useEffect(() => {
    if (isLive) return
    let on = true
    setLoading(true)
    actionGetTeamSeason(id, year).then((d) => { if (on) { setDb(d); setLoading(false) } })
    return () => { on = false }
  }, [id, year, isLive])

  if (isLive) return { detail: buildLiveTeamSeason(id, live), loading: false }
  return { detail: db, loading }
}

export function useRaceClassification(year: number, round: number) {
  const live = useLiveStore()
  const isLive = year === live.year
  const [db, setDb] = useState<RaceClassification | null>(null)
  const [loading, setLoading] = useState(!isLive)

  useEffect(() => {
    if (isLive) return
    let on = true
    setLoading(true)
    actionGetRaceClassification(year, round).then((d) => { if (on) { setDb(d); setLoading(false) } })
    return () => { on = false }
  }, [year, round, isLive])

  if (isLive) return { classification: buildLiveRaceClassification(round, live), loading: false }
  return { classification: db, loading }
}

export function useWorldOverview() {
  const [data, setData] = useState<WorldOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let on = true
    actionGetWorldOverview().then((d) => { if (on) { setData(d); setLoading(false) } })
    return () => { on = false }
  }, [])

  return { data, loading }
}
