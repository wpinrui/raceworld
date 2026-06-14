import { useSeasonStore } from '@/lib/store/season-store'
import { pendingRealWorldChanges } from '@/lib/history/transitions'
import { computeNextStop, type ContinueSettings } from './continue-loop'
import { runOffSeasonEvent } from './offseason-flow'
import { simulateUntilRound } from './sim-ahead'

// Nothing interrupts: we are fast-forwarding, not reading. With an empty article feed and no interrupt
// categories, computeNextStop only ever yields race / off-season / idle, never a news stop.
const NO_INTERRUPTS: ContinueSettings = { interruptCategories: [], followedDriverIds: [], followedTeamIds: [], interruptOnFollowed: false }

// Blast the FM clock forward to the very start of `targetYear`: auto-sim every race, run every off-season
// beat, and auto-accept every real-world team change along the way (the same payload the changes modal
// sends untouched, including the target year's own grid). It stops the moment the new season has rolled
// over to `targetYear` with no rounds run yet, leaving the player at a clean season start. No-op if already
// at or past that point. Pass `shouldStop` to bail early; the game is left consistent at wherever it halts.
export async function simUntilYear(targetYear: number, shouldStop?: () => boolean): Promise<void> {
  // Already in or past the target year: there is no future "start of targetYear" to reach, so no-op rather
  // than sim out the current season and overshoot. (The Settings control also blocks target <= current.)
  if (useSeasonStore.getState().year >= targetYear) return
  // Guard is a runaway backstop only; the year/round break below is the real terminator. ~30 iterations a
  // season comfortably covers centuries of fast-forward.
  for (let guard = 0; guard < 20000; guard++) {
    if (shouldStop?.()) return
    const s = useSeasonStore.getState()

    // Grid changes would otherwise block the loop; accept the full proposed set and carry on.
    const pendingRW = pendingRealWorldChanges({ realWorldMode: s.realWorldMode, phase: s.phase, resolved: s.realWorldChangesResolved, year: s.year, teams: s.teams, completedRounds: s.raceResults.length })
    if (pendingRW) {
      s.applyRealWorldChanges({
        joins: pendingRW.teamJoins,
        leaves: pendingRW.teamLeaves.map((l) => l.id),
        rebrands: pendingRW.teamRebrands.map((r) => ({ id: r.id, name: r.to.name, shortName: r.to.shortName, color: r.to.color, nationality: r.to.nationality })),
      })
      continue
    }

    // Rolled over into the target year with nothing raced yet: the clean start we were aiming for.
    if (s.year >= targetYear && s.raceResults.length === 0) return

    const stop = computeNextStop({ currentDate: s.currentDate, completedRounds: s.raceResults.length, year: s.year, articles: [], settings: NO_INTERRUPTS, readIds: s.readNewsIds })
    if (stop.reason === 'idle') return
    useSeasonStore.getState().setCurrentDate(stop.date)
    if (stop.reason === 'offseason') { await runOffSeasonEvent(stop.event); continue }
    if (stop.reason === 'race') { await simulateUntilRound(stop.round + 1); continue }
    return // 'news' is unreachable with no interrupts; bail rather than spin.
  }
}

// Driver mode escape hatch: a free agent who went unsigned skips ahead to the NEXT signing day in one
// click. From just past this off-season's signing day, blast the clock forward at max speed — auto-sim
// the next full season and run every off-season beat — and stop the instant the next signing day runs.
// That beat (runContractNegotiations) either parks an offer for the player (pendingDriverOffer set) or
// resolves them unsigned again; either way we halt right after it so the player picks up on the board.
export async function simToNextSigningDay(shouldStop?: () => boolean): Promise<void> {
  for (let guard = 0; guard < 20000; guard++) {
    if (shouldStop?.()) return
    const s = useSeasonStore.getState()
    if (s.pendingDriverOffer) return // an offer is already on the table — nothing to fast-forward through

    const pendingRW = pendingRealWorldChanges({ realWorldMode: s.realWorldMode, phase: s.phase, resolved: s.realWorldChangesResolved, year: s.year, teams: s.teams, completedRounds: s.raceResults.length })
    if (pendingRW) {
      s.applyRealWorldChanges({
        joins: pendingRW.teamJoins,
        leaves: pendingRW.teamLeaves.map((l) => l.id),
        rebrands: pendingRW.teamRebrands.map((r) => ({ id: r.id, name: r.to.name, shortName: r.to.shortName, color: r.to.color, nationality: r.to.nationality })),
      })
      continue
    }

    const stop = computeNextStop({ currentDate: s.currentDate, completedRounds: s.raceResults.length, year: s.year, articles: [], settings: NO_INTERRUPTS, readIds: s.readNewsIds })
    if (stop.reason === 'idle') return
    useSeasonStore.getState().setCurrentDate(stop.date)
    if (stop.reason === 'offseason') {
      await runOffSeasonEvent(stop.event)
      if (stop.event === 'signing-day') return // ran the next signing day — halt for the player to react
      continue
    }
    if (stop.reason === 'race') { await simulateUntilRound(stop.round + 1); continue }
    return
  }
}
