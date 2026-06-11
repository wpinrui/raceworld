import type { NewsContext, NewsArticle, RecordMetric, SeasonRecordMark } from './engine'
import type { RaceResult } from '@/lib/sim/types'
import { circuit } from './lookups'
import { ordinal, fill, pick, compose } from './util'
import recordsCopy from './records-copy.json'

// TRIGGER (live only; the archived snapshot captures the output): records-driven journalism.
//  - Part F: a driver/team passing another in a CAREER all-time ranking (wins/poles/podiums/points),
//    newsworthy when it reaches the top-K and clears a value floor; a new outright #1 is the big story.
//  - Part G: a SINGLE-SEASON record (drivers: wins/poles/podiums/points/retirements; teams:
//    wins/podiums/points) being broken mid-season, fired at the round it falls. Season one has no
//    prior records, so nothing fires.
export function recordNews(ctx: NewsContext): NewsArticle[] {
  if (!ctx.live || ctx.completedRounds < 1 || ctx.teams.length === 0) return []
  const N = ctx.completedRounds
  const LABEL: Record<RecordMetric, string> = { wins: 'race wins', poles: 'pole positions', podiums: 'podium finishes', points: 'points', dnfs: 'retirements' }
  const careers = ctx.careers ?? {}
  const teamCareers = ctx.teamCareers ?? {}
  const recs = ctx.records
  const driverName = (id: string) => ctx.drivers.find((d) => d.id === id)?.name ?? recs?.driverNames[id] ?? id
  const teamNameOf = (id: string) => ctx.teams.find((t) => t.id === id)?.name ?? recs?.teamNames[id] ?? id
  // One result row's contribution to a metric (a team sums both cars).
  const gain = (res: RaceResult, key: RecordMetric): number =>
    key === 'wins' ? (res.finishPosition === 1 ? 1 : 0)
      : key === 'poles' ? (res.gridPosition === 1 ? 1 : 0)
        : key === 'podiums' ? (res.finishPosition != null && res.finishPosition <= 3 ? 1 : 0)
          : key === 'dnfs' ? (res.dnf ? 1 : 0)
            : res.points

  type Ev = { round: number; sig: number; type: 'careerLeader' | 'careerClimb' | 'seasonRecord'; slots: Record<string, string | number>; key: string }
  const events: Ev[] = []

  // ===== Part F: career all-time rank overtakes =====
  // Raise the bar in a young world (the issue's "records churn early" concern): a new all-time #1 needs
  // at least one completed prior season to mean anything; a climb into the top few needs deeper history
  // and a higher value floor. `depth` = completed prior seasons.
  const depth = recs?.archivedSeasons ?? 0
  const CLIMB_K = 5
  const CAREER: { key: RecordMetric; leaderFloor: number; climbFloor: number }[] = [
    { key: 'wins', leaderFloor: 5, climbFloor: 12 },
    { key: 'poles', leaderFloor: 5, climbFloor: 12 },
    { key: 'podiums', leaderFloor: 15, climbFloor: 30 },
    { key: 'points', leaderFloor: 200, climbFloor: 600 },
  ]
  const scanOvertakes = (
    ids: string[],
    careerTotal: (id: string, key: RecordMetric) => number,
    roundGain: (id: string, round: number, key: RecordMetric) => number,
    nameOf: (id: string) => string,
    scope: 'd' | 't',
  ) => {
    if (ids.length === 0) return
    ids = [...ids].sort() // deterministic order so rank/selection tie-breaks don't depend on DB/insertion order
    for (const { key, leaderFloor, climbFloor } of CAREER) {
      // cumulative live gain per id through each round, then total-through-r = prior + cum[r].
      const cum = new Map<string, number[]>()
      const prior = new Map<string, number>()
      for (const id of ids) {
        const arr = [0]
        for (let r = 1; r <= N; r++) arr.push(arr[r - 1] + roundGain(id, r, key))
        cum.set(id, arr)
        prior.set(id, careerTotal(id, key) - arr[N])
      }
      const totalAt = (id: string, r: number) => prior.get(id)! + cum.get(id)![r]
      // Precompute, per round, the descending order and a ties-share rank map (1 + count strictly greater).
      const orderAt: string[][] = []
      const rankAt: Map<string, number>[] = []
      for (let r = 0; r <= N; r++) {
        const order = [...ids].sort((a, b) => totalAt(b, r) - totalAt(a, r))
        const m = new Map<string, number>()
        let rank = 0, prevVal = Infinity, seen = 0
        for (const id of order) { seen++; const v = totalAt(id, r); if (v < prevVal) { rank = seen; prevVal = v }; m.set(id, rank) }
        orderAt.push(order); rankAt.push(m)
      }
      for (let r = 1; r <= N; r++) {
        for (const id of ids) {
          if (roundGain(id, r, key) <= 0) continue // only an entity that gained this round can rise
          const newRank = rankAt[r].get(id)!
          if (newRank >= rankAt[r - 1].get(id)!) continue // didn't actually rise this round
          const after = totalAt(id, r)
          let type: 'careerLeader' | 'careerClimb'
          if (newRank === 1) {
            if (depth < 1 || after < leaderFloor) continue
            type = 'careerLeader'
          } else {
            if (depth < 2 || newRank > CLIMB_K || after < climbFloor) continue
            type = 'careerClimb'
          }
          const displaced = orderAt[r - 1][newRank - 1] // who held this rank before the round
          if (!displaced || displaced === id) continue
          if (after <= totalAt(displaced, r)) continue // a tie is not a pass; only strictly exceeding is news
          events.push({
            round: r,
            sig: type === 'careerLeader' ? 1000 + after : 200 + (CLIMB_K - newRank) * 5,
            type,
            slots: { name: nameOf(id), metric: LABEL[key], value: after, rank: ordinal(newRank), passed: nameOf(displaced), prev: totalAt(displaced, r) },
            key: `record-${scope}-career-${key}-${id}-${r}`,
          })
        }
      }
    }
  }
  scanOvertakes(
    Object.keys(careers),
    (id, key) => (careers[id] as unknown as Record<string, number>)[key] ?? 0,
    (id, r, key) => { const res = (ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === id); return res ? gain(res, key) : 0 },
    driverName, 'd',
  )
  scanOvertakes(
    Object.keys(teamCareers),
    (id, key) => (teamCareers[id] as unknown as Record<string, number>)[key] ?? 0,
    (id, r, key) => (ctx.raceResults[r - 1] ?? []).filter((x) => x.teamId === id).reduce((s, res) => s + gain(res, key), 0),
    teamNameOf, 't',
  )

  // ===== Part G: single-season record breaks =====
  if (recs) {
    const scanSeason = (
      ids: string[], metrics: RecordMetric[], baseline: Partial<Record<RecordMetric, SeasonRecordMark>>,
      roundGain: (id: string, round: number, key: RecordMetric) => number, nameOf: (id: string) => string, scope: 'd' | 't',
    ) => {
      ids = [...ids].sort() // deterministic order so a same-round tie picks the same breaker every time
      for (const key of metrics) {
        const base = baseline[key]
        if (!base) continue // no prior record (e.g. season one) -> nothing to break
        let recValue = base.value, recHolderName = base.holderName, recHolderId: string | null = null, recYear = base.year
        const cum = new Map<string, number>(ids.map((id) => [id, 0]))
        for (let r = 1; r <= N; r++) {
          let bestId = '', bestVal = -1
          for (const id of ids) { const v = cum.get(id)! + roundGain(id, r, key); cum.set(id, v); if (v > bestVal) { bestVal = v; bestId = id } }
          if (bestVal > recValue) {
            // Only news when a DIFFERENT entity takes the record, not when the holder extends it. Compare
            // by id (the archived holder has no live id, so the first live break always fires).
            if (bestId !== recHolderId) {
              events.push({
                round: r, sig: 500 + bestVal, type: 'seasonRecord',
                slots: { name: nameOf(bestId), metric: LABEL[key], value: bestVal, old: recValue, old_holder: recHolderName, old_year: recYear, circuit: circuit(ctx, r) },
                key: `record-${scope}-season-${key}-${bestId}-${r}`,
              })
            }
            recValue = bestVal; recHolderName = nameOf(bestId); recHolderId = bestId; recYear = ctx.year
          }
        }
      }
    }
    scanSeason(
      Object.keys(careers), ['wins', 'poles', 'podiums', 'points', 'dnfs'], recs.seasonDriver,
      (id, r, key) => { const res = (ctx.raceResults[r - 1] ?? []).find((x) => x.driverId === id); return res ? gain(res, key) : 0 },
      driverName, 'd',
    )
    scanSeason(
      Object.keys(teamCareers), ['wins', 'podiums', 'points'], recs.seasonTeam,
      (id, r, key) => (ctx.raceResults[r - 1] ?? []).filter((x) => x.teamId === id).reduce((s, res) => s + gain(res, key), 0),
      teamNameOf, 't',
    )
  }

  // Cap to the two most significant record stories per round so a record-heavy round doesn't flood.
  const byRound = new Map<number, Ev[]>()
  for (const e of events) { const a = byRound.get(e.round) ?? []; a.push(e); byRound.set(e.round, a) }
  const out: NewsArticle[] = []
  for (const [round, evs] of byRound) {
    evs.sort((a, b) => (b.sig - a.sig) || a.key.localeCompare(b.key)) // stable, deterministic top-2
    for (const e of evs.slice(0, 2)) {
      const c = recordsCopy[e.type]
      const seed = e.key
      out.push({
        id: seed, category: 'record', round,
        priority: e.type === 'careerLeader' ? 60 : e.type === 'seasonRecord' ? 56 : 52,
        headline: fill(pick(c.headline, `${seed}|h`), e.slots),
        dek: fill(pick(c.dek, `${seed}|d`), e.slots),
        body: compose(seed, e.slots, ...c.body),
      })
    }
  }
  return out
}
