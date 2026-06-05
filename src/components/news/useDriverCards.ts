'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSeasonStore } from '@/lib/store/season-store'
import { foldLiveSeason, type DriverCareer } from '@/lib/news/engine'
import { actionGetDriverCareers } from '@/lib/news/actions'
import { buildDriverCardResolver, type DriverCardResolver } from './LinkedText'

// Hover-card data for the live season's drivers, for wrapping driver names in article prose. Pulls the
// roster + standings from the store and folds the in-progress season onto the archived career totals
// (the same source the newsroom uses). Names not on the live grid resolve to null, so they stay plain
// links (e.g. an archived-season story read in the newsroom).
export function useLiveDriverCards(): DriverCardResolver {
  const drivers = useSeasonStore((s) => s.drivers)
  const driverStandings = useSeasonStore((s) => s.driverStandings)
  const year = useSeasonStore((s) => s.year)
  const raceResults = useSeasonStore((s) => s.raceResults)
  const champion = useSeasonStore((s) => s.endOfSeasonSummary?.driverChampion)
  const [careerBase, setCareerBase] = useState<Record<string, DriverCareer>>({})
  useEffect(() => {
    actionGetDriverCareers(year - 1).then(setCareerBase).catch(() => setCareerBase({}))
  }, [year])
  const careers = useMemo(
    () => foldLiveSeason(careerBase, year, raceResults, champion ?? undefined),
    [careerBase, year, raceResults, champion],
  )
  return useMemo(
    () => buildDriverCardResolver({ drivers, driverStandings, year, careers }),
    [drivers, driverStandings, year, careers],
  )
}
