import type { DriverCareer } from './types'
import { getPoints } from '@/lib/sim/points'
import { milestonesReached, type MilestoneCat } from '@/lib/stats/milestone-defs'

// Career milestones derived from the chronological per-race finish matrix (and per-season pole totals)
// on DriverCareer.seasons, using the SAME thresholds as the newsroom (src/lib/stats/milestone-defs.ts)
// so the two never drift. Wins/podiums/points/starts are pinned to the exact round; poles are
// attributed to the season (the career DTO carries only season pole totals, not per-round grid slots).

export type MilestoneKind = 'start' | 'win' | 'podium' | 'pole' | 'points' | 'title'

export interface MilestoneEvent {
  id: string
  label: string
  year: number
  round: number | null // null for season-level milestones (titles, poles)
  kind: MilestoneKind
}

const KIND_OF: Record<MilestoneCat, MilestoneKind> = {
  starts: 'start', wins: 'win', podiums: 'podium', poles: 'pole', points: 'points',
}

function label(cat: MilestoneCat, v: number): string {
  switch (cat) {
    case 'starts': return v === 1 ? 'Formula 1 debut' : `${v} Grand Prix starts`
    case 'wins': return v === 1 ? 'First win' : `${v} career wins`
    case 'podiums': return v === 1 ? 'First podium' : `${v} career podiums`
    case 'poles': return v === 1 ? 'First pole' : `${v} career poles`
    case 'points': return v === 1 ? 'First points finish' : `${v.toLocaleString()} career points`
    default: return ''
  }
}

export function buildMilestones(career: DriverCareer): MilestoneEvent[] {
  // Chronological, de-duplicated by year (a mid-season team switch can yield two same-year season
  // rows carrying the same full-season results matrix).
  const seenYears = new Set<number>()
  const seasons = [...career.seasons]
    .sort((a, b) => a.year - b.year)
    .filter((s) => (seenYears.has(s.year) ? false : (seenYears.add(s.year), true)))

  const events: MilestoneEvent[] = []
  const total: Record<MilestoneCat, number> = { starts: 0, wins: 0, podiums: 0, poles: 0, points: 0 }

  // Emit a milestone for every threshold newly reached as a running total moves from `before` to `after`.
  const emit = (cat: MilestoneCat, before: number, after: number, year: number, round: number | null) => {
    const had = new Set(milestonesReached(cat, before))
    for (const v of milestonesReached(cat, after)) {
      if (!had.has(v)) events.push({ id: `${KIND_OF[cat]}-${v}`, label: label(cat, v), year, round, kind: KIND_OF[cat] })
    }
  }

  for (const s of seasons) {
    s.results.forEach((finish, i) => {
      const round = i + 1
      emit('starts', total.starts, total.starts + 1, s.year, round); total.starts += 1
      const pts = getPoints(finish)
      emit('points', total.points, total.points + pts, s.year, round); total.points += pts
      if (finish != null && finish <= 3) { emit('podiums', total.podiums, total.podiums + 1, s.year, round); total.podiums += 1 }
      if (finish === 1) { emit('wins', total.wins, total.wins + 1, s.year, round); total.wins += 1 }
    })
    // Poles are season-attributed (the DTO has no per-round grid), so a season's poles land at round null.
    emit('poles', total.poles, total.poles + s.poles, s.year, null); total.poles += s.poles
    // A title counts once finished or mathematically clinched; mid-season P1 that isn't yet secured is
    // only the current leader, not a champion.
    if (s.championshipFinish === 1 && (!s.inProgress || s.clinched)) {
      events.push({ id: `title-${s.year}`, label: 'World Champion', year: s.year, round: null, kind: 'title' })
    }
  }

  return events
}
