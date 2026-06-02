import type { CommentaryEntry, DriverRaceState } from './types'

// At most this many non-finish commentary lines surface per lap. Candidates are scored
// and the most newsworthy (biased toward the front of the field) win the slots.
const MAX_PER_LAP = 3

interface Candidate {
  entry: CommentaryEntry
  priority: number
}

// Field position → leader-bias weight. Leader carries the most weight, backmarkers ~0.
function posWeight(position: number): number {
  return Math.max(0, 22 - position)
}

export function generateCommentary(
  lap: number,
  prevStates: DriverRaceState[],
  newStates: DriverRaceState[],
  driverNames: Record<string, string>,
  totalLaps: number,
  prevMoisture: number,
  currentMoisture: number,
): CommentaryEntry[] {
  const prevMap = new Map<string, DriverRaceState>(prevStates.map((d) => [d.driverId, d]))

  // Finish lap is handled separately — only the podium is narrated (full results live in
  // the results panel), so it never floods the feed.
  if (lap === totalLaps) {
    const podium = [...newStates].filter((s) => !s.retired).sort((a, b) => a.position - b.position).slice(0, 3)
    return podium.map((state) => {
      const name = driverNames[state.driverId] ?? state.driverId
      const text =
        state.position === 1 ? `${name} takes the victory!`
        : state.position === 2 ? `${name} finishes second!`
        : `${name} completes the podium!`
      return { lap, text, type: 'finish' as const }
    })
  }

  const candidates: Candidate[] = []

  // Retirements — always the biggest story, leader retirements bigger still.
  for (const newState of newStates) {
    const prev = prevMap.get(newState.driverId)
    if (newState.retired && prev && !prev.retired) {
      const name = driverNames[newState.driverId] ?? newState.driverId
      candidates.push({
        entry: { lap, text: `${name} is out! Mechanical failure on lap ${lap}.`, type: 'retirement' },
        priority: 1000 + posWeight(prev.position),
      })
    }
  }

  // Overtakes — weighted heavily toward the front (a move for the lead trumps a midfield swap).
  for (const newState of newStates) {
    if (newState.retired) continue
    const prev = prevMap.get(newState.driverId)
    if (!prev) continue
    if (newState.position < prev.position && newState.lastPitLap !== lap) {
      const name = driverNames[newState.driverId] ?? newState.driverId
      const displaced = newStates.find(
        (d) => d.driverId !== newState.driverId && d.position === newState.position + 1,
      )
      const displacedName = displaced ? (driverNames[displaced.driverId] ?? displaced.driverId) : 'the car ahead'
      candidates.push({
        entry: { lap, text: `${name} makes the move on ${displacedName}! Up to P${newState.position}.`, type: 'overtake' },
        priority: 500 + posWeight(newState.position) * 10,
      })
    }
  }

  // Pits.
  for (const newState of newStates) {
    if (newState.retired) continue
    const prev = prevMap.get(newState.driverId)
    if (!prev) continue
    if (newState.lastPitLap === lap || (newState.stintLap <= 1 && prev.stintLap > 1)) {
      const name = driverNames[newState.driverId] ?? newState.driverId
      const compound = newState.currentTyre.compound.toUpperCase()
      candidates.push({
        entry: { lap, text: `${name} pits! Back out on ${compound} tyres.`, type: 'pit' },
        priority: 200 + posWeight(newState.position) * 5,
      })
    }
  }

  // Closing the gap.
  for (const newState of newStates) {
    if (newState.retired) continue
    const prev = prevMap.get(newState.driverId)
    if (!prev) continue
    if (prev.gap - newState.gap > 0.1 && newState.gap >= 0.3 && newState.gap <= 3) {
      const name = driverNames[newState.driverId] ?? newState.driverId
      const carAhead = newStates.find((d) => d.position === newState.position - 1)
      const aheadName = carAhead ? (driverNames[carAhead.driverId] ?? carAhead.driverId) : 'the leader'
      candidates.push({
        entry: { lap, text: `${name} is closing in on ${aheadName}!`, type: 'closing' },
        priority: 100 + posWeight(newState.position) * 3,
      })
    }
  }

  // Take the top MAX_PER_LAP scored candidates.
  const top = candidates.sort((a, b) => b.priority - a.priority).slice(0, MAX_PER_LAP).map((c) => c.entry)

  // Weather changes are infrequent and always worth surfacing — add on top of the cap.
  const moistureDelta = currentMoisture - prevMoisture
  if (Math.abs(moistureDelta) > 0.1) {
    top.push({ lap, text: moistureDelta > 0 ? 'Rain is intensifying!' : 'The track is drying!', type: 'weather' })
  }

  return top
}
