import type { TeammateH2H, TeammateH2HSeason, H2HRecord } from './types'

// One race in which the subject driver shared a garage with a teammate. Normalized so the
// same aggregator serves both archived (DB) and live (store) data.
export interface H2HRaceRow {
  year: number
  teamName: string
  teammateId: string
  teammateName: string
  myGrid: number
  myFinish: number | null
  myDnf: boolean
  myPoints: number
  mateGrid: number
  mateFinish: number | null
  mateDnf: boolean
  matePoints: number
}

function blank(): H2HRecord {
  return { races: 0, qualSelf: 0, qualMate: 0, raceSelf: 0, raceMate: 0, pointsSelf: 0, pointsMate: 0 }
}

function applyRow(rec: H2HRecord, row: H2HRaceRow): void {
  rec.races++
  if (row.myGrid < row.mateGrid) rec.qualSelf++
  else if (row.mateGrid < row.myGrid) rec.qualMate++
  if (!row.myDnf && !row.mateDnf && row.myFinish != null && row.mateFinish != null) {
    if (row.myFinish < row.mateFinish) rec.raceSelf++
    else if (row.mateFinish < row.myFinish) rec.raceMate++
  }
  rec.pointsSelf += row.myPoints
  rec.pointsMate += row.matePoints
}

function addInto(target: H2HRecord, src: H2HRecord): void {
  target.races += src.races
  target.qualSelf += src.qualSelf; target.qualMate += src.qualMate
  target.raceSelf += src.raceSelf; target.raceMate += src.raceMate
  target.pointsSelf += src.pointsSelf; target.pointsMate += src.pointsMate
}

// Aggregate per-race rows into one record per teammate, with a per-season breakdown.
export function aggregateTeammateH2H(rows: H2HRaceRow[]): TeammateH2H[] {
  const byMate = new Map<string, { name: string; seasons: Map<number, TeammateH2HSeason> }>()

  for (const row of rows) {
    let entry = byMate.get(row.teammateId)
    if (!entry) { entry = { name: row.teammateName, seasons: new Map() }; byMate.set(row.teammateId, entry) }
    entry.name = row.teammateName
    let season = entry.seasons.get(row.year)
    if (!season) { season = { year: row.year, teamName: row.teamName, ...blank() }; entry.seasons.set(row.year, season) }
    season.teamName = row.teamName
    applyRow(season, row)
  }

  const out: TeammateH2H[] = []
  for (const [teammateId, entry] of byMate) {
    const seasons = [...entry.seasons.values()].sort((a, b) => b.year - a.year)
    const totals = blank()
    for (const s of seasons) addInto(totals, s)
    out.push({ teammateId, teammateName: entry.name, seasons, ...totals })
  }
  // Most-raced teammates first.
  return out.sort((a, b) => b.races - a.races)
}

// Merge two aggregated lists (archived + live). Their seasons never overlap in year, so
// concatenating season lists and summing totals is sufficient.
export function combineTeammateH2H(a: TeammateH2H[], b: TeammateH2H[]): TeammateH2H[] {
  const byId = new Map<string, TeammateH2H>()
  for (const list of [a, b]) {
    for (const t of list) {
      const existing = byId.get(t.teammateId)
      if (!existing) { byId.set(t.teammateId, { ...t, seasons: [...t.seasons] }); continue }
      existing.teammateName = t.teammateName || existing.teammateName
      existing.seasons = [...existing.seasons, ...t.seasons].sort((x, y) => y.year - x.year)
      addInto(existing, t)
    }
  }
  return [...byId.values()].sort((x, y) => y.races - x.races)
}
