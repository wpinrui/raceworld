'use client'

import { useEffect, useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { calendarForYear } from '@/data/calendars'
import {
  actionGetDriverCareer, actionGetTeamCareer, actionGetWorldOverview,
  actionGetDriverSeason, actionGetTeamSeason, actionGetRaceClassification,
  actionGetDriverHonours, actionGetTeamHonours,
} from '@/lib/db/actions'
import type { Feat } from '@/lib/stats/types'
import { mergeDriverCareer, mergeTeamCareer, augmentHonoursWithLiveTitle, liveChampionRow, type LiveStore } from './merge'
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
    raceResults: s.raceResults, calendar: calendarForYear(s.year), statHistory: s.statHistory,
  }
}

export function useDriverCareer(id: string) {
  const live = useLiveStore()
  // Track which id the fetched row belongs to, so `loading` is derived (true until the row for the
  // current id has arrived) instead of flipped by a synchronous setState inside the effect.
  const [loaded, setLoaded] = useState<{ id: string; db: DriverCareer | null } | null>(null)

  useEffect(() => {
    let on = true
    actionGetDriverCareer(id).then((d) => { if (on) setLoaded({ id, db: d }) })
    return () => { on = false }
  }, [id])

  const db = loaded?.id === id ? loaded.db : null
  const loading = loaded?.id !== id
  const career = db ? mergeDriverCareer(db, live) : null
  const notFound = !!career && career.seasons.length === 0 && career.attributes === null
  return { career: notFound ? null : career, loading }
}

export function useTeamCareer(id: string) {
  const live = useLiveStore()
  const [loaded, setLoaded] = useState<{ id: string; db: TeamCareer | null } | null>(null)

  useEffect(() => {
    let on = true
    actionGetTeamCareer(id).then((d) => { if (on) setLoaded({ id, db: d }) })
    return () => { on = false }
  }, [id])

  const db = loaded?.id === id ? loaded.db : null
  const loading = loaded?.id !== id
  const career = db ? mergeTeamCareer(db, live) : null
  const notFound = !!career && career.seasons.length === 0 && career.currentSquad === null
  return { career: notFound ? null : career, loading }
}

// Drill-down: the live (current) season is built from the store; archived seasons
// are fetched from the DB. `year` decides which source to use.
export function useDriverSeason(id: string, year: number) {
  const live = useLiveStore()
  const isLive = year === live.year
  const [loaded, setLoaded] = useState<{ key: string; db: DriverSeasonDetail | null } | null>(null)
  const key = `${id}:${year}`

  useEffect(() => {
    if (isLive) return
    let on = true
    actionGetDriverSeason(id, year).then((d) => { if (on) setLoaded({ key: `${id}:${year}`, db: d }) })
    return () => { on = false }
  }, [id, year, isLive])

  if (isLive) return { detail: buildLiveDriverSeason(id, live), loading: false }
  const db = loaded?.key === key ? loaded.db : null
  return { detail: db, loading: loaded?.key !== key }
}

export function useTeamSeason(id: string, year: number) {
  const live = useLiveStore()
  const isLive = year === live.year
  const [loaded, setLoaded] = useState<{ key: string; db: TeamSeasonDetail | null } | null>(null)
  const key = `${id}:${year}`

  useEffect(() => {
    if (isLive) return
    let on = true
    actionGetTeamSeason(id, year).then((d) => { if (on) setLoaded({ key: `${id}:${year}`, db: d }) })
    return () => { on = false }
  }, [id, year, isLive])

  if (isLive) return { detail: buildLiveTeamSeason(id, live), loading: false }
  const db = loaded?.key === key ? loaded.db : null
  return { detail: db, loading: loaded?.key !== key }
}

export function useRaceClassification(year: number, round: number) {
  const live = useLiveStore()
  const isLive = year === live.year
  const [loaded, setLoaded] = useState<{ key: string; db: RaceClassification | null } | null>(null)
  const key = `${year}:${round}`

  useEffect(() => {
    if (isLive) return
    let on = true
    actionGetRaceClassification(year, round).then((d) => { if (on) setLoaded({ key: `${year}:${round}`, db: d }) })
    return () => { on = false }
  }, [year, round, isLive])

  if (isLive) return { classification: buildLiveRaceClassification(round, live), loading: false }
  const db = loaded?.key === key ? loaded.db : null
  return { classification: db, loading: loaded?.key !== key }
}

// Career feats/records for an entity, from the archived stats DB, with a live-clinched
// current-season title folded in so the Honours panel reflects it before archiving.
export function useEntityHonours(kind: 'driver' | 'team', id: string) {
  const live = useLiveStore()
  const [loaded, setLoaded] = useState<{ key: string; feats: Feat[] } | null>(null)
  const key = `${kind}:${id}`

  useEffect(() => {
    let on = true
    const fetcher = kind === 'driver' ? actionGetDriverHonours : actionGetTeamHonours
    fetcher(id).then((f) => { if (on) setLoaded({ key: `${kind}:${id}`, feats: f }) })
    return () => { on = false }
  }, [kind, id])

  const dbFeats = loaded?.key === key ? loaded.feats : []
  return { feats: augmentHonoursWithLiveTitle(dbFeats, kind, id, live), loading: loaded?.key !== key }
}

export function useWorldOverview() {
  const live = useLiveStore()
  const [data, setData] = useState<WorldOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let on = true
    actionGetWorldOverview().then((d) => { if (on) { setData(d); setLoading(false) } })
    return () => { on = false }
  }, [])

  // Prepend a current-season row to the champions roll once a title is clinched.
  const row = liveChampionRow(live)
  const merged = data && row && !data.championsRoll.some((r) => r.year === row.year)
    ? { ...data, championsRoll: [row, ...data.championsRoll] }
    : data

  return { data: merged, loading }
}
