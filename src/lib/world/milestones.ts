import type { DriverCareer } from './types'
import { getPoints } from '@/lib/sim/points'

// Career milestones derived purely from the chronological per-race finish matrix on
// DriverCareer.seasons. Poles aren't in this DTO (only finish positions are), so pole
// milestones are intentionally left to the Honours panel.

export type MilestoneKind = 'start' | 'win' | 'podium' | 'points' | 'title' | 'season'

export interface MilestoneEvent {
  id: string
  label: string
  year: number
  round: number | null // null for season-level milestones (titles, season counts)
  kind: MilestoneKind
}

const WIN_COUNTS = [1, 10, 25, 50, 100]
const PODIUM_COUNTS = [1, 25, 50, 100, 150, 200]
const START_COUNTS = [1, 50, 100, 150, 200, 250, 300]
const POINTS_COUNTS = [100, 500, 1000, 2500, 5000, 10000]
const SEASON_COUNTS = [5, 10, 15, 20]

function ordinalLabel(n: number, singular: string): string {
  if (n === 1) return `First ${singular}`
  return `${n}th ${singular}`
}

export function buildMilestones(career: DriverCareer): MilestoneEvent[] {
  // Chronological, de-duplicated by year (a mid-season team switch can yield two
  // same-year season rows carrying the same full-season results matrix).
  const seenYears = new Set<number>()
  const seasons = [...career.seasons]
    .sort((a, b) => a.year - b.year)
    .filter((s) => (seenYears.has(s.year) ? false : (seenYears.add(s.year), true)))

  const events: MilestoneEvent[] = []
  let starts = 0, wins = 0, podiums = 0, points = 0, firstPoints = false
  let seasonCount = 0

  for (const s of seasons) {
    seasonCount++
    for (const c of SEASON_COUNTS) {
      if (seasonCount === c) {
        events.push({ id: `season-${c}`, label: `${c} seasons in the sport`, year: s.year, round: null, kind: 'season' })
      }
    }

    s.results.forEach((finish, i) => {
      const round = i + 1
      starts++
      for (const c of START_COUNTS) if (starts === c) events.push({ id: `start-${c}`, label: ordinalLabel(c, 'Grand Prix start'), year: s.year, round, kind: 'start' })

      const pts = getPoints(finish)
      if (pts > 0 && !firstPoints) { firstPoints = true; events.push({ id: 'points-first', label: 'First points finish', year: s.year, round, kind: 'points' }) }
      const before = points
      points += pts
      for (const c of POINTS_COUNTS) if (before < c && points >= c) events.push({ id: `points-${c}`, label: `${c.toLocaleString()} career points`, year: s.year, round, kind: 'points' })

      if (finish != null && finish <= 3) {
        podiums++
        for (const c of PODIUM_COUNTS) if (podiums === c) events.push({ id: `podium-${c}`, label: ordinalLabel(c, 'podium'), year: s.year, round, kind: 'podium' })
      }
      if (finish === 1) {
        wins++
        for (const c of WIN_COUNTS) if (wins === c) events.push({ id: `win-${c}`, label: ordinalLabel(c, 'win'), year: s.year, round, kind: 'win' })
      }
    })

    // A title counts once finished or mathematically clinched; mid-season P1 that isn't
    // yet secured is only the current leader, not a champion.
    if (s.championshipFinish === 1 && (!s.inProgress || s.clinched)) {
      events.push({ id: `title-${s.year}`, label: 'World Champion', year: s.year, round: null, kind: 'title' })
    }
  }

  return events
}
