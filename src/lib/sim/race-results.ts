import type { RaceState, Driver, Team, RaceResult } from './types'
import { getPoints, hasFastestLapPoint } from './points'
import { summarizeRaceWeather } from './race-weather'

// Default confidence for drivers without a stored value (new drivers / pre-#58 saves).
export const CONFIDENCE_DEFAULT = 5

// Form-roll mean for a given confidence: c=0 -> 2, c=5 -> 5, c=10 -> 8 (issue #58).
export function confidenceFormMean(confidence: number | undefined): number {
  return 2 + 0.6 * (confidence ?? CONFIDENCE_DEFAULT)
}

// Per-race confidence update (issue #58). Run once after a race's results finalize, for
// every driver. Confidence rises/falls on how a driver finishes versus their teammate
// across qualifying + race; a signed streak counter amplifies repeated swings. Returns a
// new drivers array — drivers who didn't race (or have no teammate) are returned unchanged.
export function applyConfidenceUpdate(drivers: Driver[], results: RaceResult[]): Driver[] {
  const resultById = new Map(results.map((r) => [r.driverId, r]))
  // Group all results (including DNFs) by team so each driver's single teammate is
  // findable — the teammate-DNF branch below needs the retired teammate's row too.
  const byTeam = new Map<string, RaceResult[]>()
  for (const r of results) {
    if (!r.teamId) continue
    const list = byTeam.get(r.teamId)
    if (list) list.push(r)
    else byTeam.set(r.teamId, [r])
  }

  return drivers.map((driver) => {
    const me = resultById.get(driver.id)
    if (!me || !me.teamId) return driver // didn't race this round -> no change
    const teammates = (byTeam.get(me.teamId) ?? []).filter((r) => r.driverId !== driver.id)
    if (teammates.length !== 1) return driver // single-car entry / no teammate -> no change
    const mate = teammates[0]

    const c = driver.confidence ?? CONFIDENCE_DEFAULT
    const streak = driver.confidenceStreak ?? 0

    // Over/underperformance this race. A DNF is always an underperformance; if only the
    // teammate DNFs, the classified driver overperforms; otherwise compare the margin.
    let over: boolean
    if (me.dnf) {
      over = false
    } else if (mate.dnf) {
      over = true
    } else {
      // Positions gained on the teammate across qualifying + race (lower position = better).
      const margin =
        (mate.gridPosition - me.gridPosition) +
        ((mate.finishPosition ?? 0) - (me.finishPosition ?? 0))
      // The (c - 5) bar makes high confidence hard to hold and low confidence recoverable.
      over = margin >= c - 5
    }

    // Extend the streak if same direction, else reset it to a length-1 streak the new way.
    const dir = over ? 1 : -1
    const nextStreak = Math.sign(streak) === dir ? streak + dir : dir
    const n = Math.abs(nextStreak)

    // Cliff: underperforming from a perfect 10 (DNF included) drops straight to 0; otherwise
    // step by 0.5 * n in the streak's direction. Clamp to [0, 10].
    let nextC: number
    if (!over && c >= 10) {
      nextC = 0
    } else {
      nextC = Math.min(10, Math.max(0, c + dir * 0.5 * n))
    }

    return { ...driver, confidence: nextC, confidenceStreak: nextStreak }
  })
}

// Build the persisted RaceResult[] from a finished race state. Shared by the live
// race screen and the headless "simulate ahead" path so both produce identical rows.
// `year` selects the era points table and whether a fastest-lap point applies (issue #63).
export function buildRaceResults(raceState: RaceState, drivers: Driver[], teams: Team[], year: number): RaceResult[] {
  // Fastest lap = the single quickest lap among classified finishers (DNFs excluded). The +1 point
  // is awarded only in eras that have it, and only if the FL setter finished in the top 10.
  let flDriverId: string | null = null
  let flBest = Infinity
  for (const ds of raceState.drivers) {
    if (ds.retired || ds.lapTimes.length === 0) continue
    const best = Math.min(...ds.lapTimes)
    if (best < flBest) { flBest = best; flDriverId = ds.driverId }
  }
  const flPointEra = hasFastestLapPoint(year)

  // One weather summary for the whole race, attached to every row so it survives the live store and
  // the DB round-trip (persisted once on the races table; see actionFlushRaceResult / actionGetSeasonNews).
  const weather = summarizeRaceWeather(raceState, drivers)

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
      const isFastestLap = ds.driverId === flDriverId
      // Era base points + the fastest-lap bonus (only in FL eras, only for a top-10 finisher).
      const flBonus = isFastestLap && flPointEra && !ds.retired && ds.position <= 10 ? 1 : 0
      return {
        driverId: ds.driverId, driverName: driver?.name ?? ds.driverId,
        teamId: driver?.teamId ?? '', teamName: team?.name ?? '',
        gridPosition: qr?.gridPosition ?? 0,
        finishPosition: ds.retired ? null : ds.position,
        points: getPoints(ds.retired ? null : ds.position, year) + flBonus,
        fastestLap: isFastestLap,
        form: ds.form,
        lapsCompleted: ds.lapTimes.length, totalTime: ds.retired ? null : ds.totalTime,
        dnf: ds.retired, stints,
        q1Time: qr?.q1Time ?? null, q2Time: qr?.q2Time ?? null, q3Time: qr?.q3Time ?? null,
        // Consistency-mistake stats (issue #59): count, worst single time loss, and whether the
        // DNF was a crash. retirementReason is null while classified.
        mistakes: ds.mistakeCount,
        worstMistakeLoss: ds.worstMistakeLoss,
        crashed: ds.retired && ds.retirementReason === 'collision-damage',
        retirementReason: ds.retired ? ds.retirementReason : null,
        weather,
      } satisfies RaceResult
    })
}
