'use client'

import { useEffect, useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendar2026 } from '@/data/calendar'
import { actionGetDriverCareer, actionGetTeamCareer, actionGetWorldOverview } from '@/lib/db/actions'
import { mergeDriverCareer, mergeTeamCareer, type LiveStore } from './merge'
import type { DriverCareer, TeamCareer, WorldOverview } from './types'

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
