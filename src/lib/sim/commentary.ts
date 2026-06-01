import type { CommentaryEntry, DriverRaceState } from './types'

export function generateCommentary(
  lap: number,
  prevStates: DriverRaceState[],
  newStates: DriverRaceState[],
  driverNames: Record<string, string>,
  totalLaps: number,
  prevMoisture: number,
  currentMoisture: number,
): CommentaryEntry[] {
  const entries: CommentaryEntry[] = []

  const prevMap = new Map<string, DriverRaceState>(prevStates.map((d) => [d.driverId, d]))

  // 1. Retirements
  for (const newState of newStates) {
    const prev = prevMap.get(newState.driverId)
    if (newState.retired && prev && !prev.retired) {
      const name = driverNames[newState.driverId] ?? newState.driverId
      entries.push({
        lap,
        text: `${name} is out! Mechanical failure on lap ${lap}.`,
        type: 'retirement',
      })
    }
  }

  // 2. Pits: stintLap dropped to 0 or 1 (or lastPitLap == currentLap)
  for (const newState of newStates) {
    if (newState.retired) continue
    const prev = prevMap.get(newState.driverId)
    if (!prev) continue

    const pitted =
      newState.lastPitLap === lap ||
      (newState.stintLap <= 1 && prev.stintLap > 1)

    if (pitted) {
      const name = driverNames[newState.driverId] ?? newState.driverId
      const compound = newState.currentTyre.compound.toUpperCase()
      entries.push({
        lap,
        text: `${name} pits! Back out on ${compound} tyres.`,
        type: 'pit',
      })
    }
  }

  // 3. Overtakes: position improved AND not due to pit (lastPitLap != lap)
  for (const newState of newStates) {
    if (newState.retired) continue
    const prev = prevMap.get(newState.driverId)
    if (!prev) continue

    const positionImproved = newState.position < prev.position
    const notDueToPit = newState.lastPitLap !== lap

    if (positionImproved && notDueToPit) {
      const name = driverNames[newState.driverId] ?? newState.driverId
      // Find who was overtaken (driver now in the position this driver moved into)
      const displaced = newStates.find(
        (d) => d.driverId !== newState.driverId && d.position === newState.position + 1,
      )
      const displacedName = displaced
        ? (driverNames[displaced.driverId] ?? displaced.driverId)
        : 'the car ahead'

      entries.push({
        lap,
        text: `${name} makes the move on ${displacedName}! Up to P${newState.position}.`,
        type: 'overtake',
      })
    }
  }

  // 4. Closing gap: gap decreased by >0.1s vs prev and gap is between 0.3s and 3s
  for (const newState of newStates) {
    if (newState.retired) continue
    const prev = prevMap.get(newState.driverId)
    if (!prev) continue

    const gapDecreased = prev.gap - newState.gap > 0.1
    const gapInRange = newState.gap >= 0.3 && newState.gap <= 3

    if (gapDecreased && gapInRange) {
      const name = driverNames[newState.driverId] ?? newState.driverId
      // Find car ahead
      const carAhead = newStates.find((d) => d.position === newState.position - 1)
      const aheadName = carAhead
        ? (driverNames[carAhead.driverId] ?? carAhead.driverId)
        : 'the leader'

      entries.push({
        lap,
        text: `${name} is closing in on ${aheadName}!`,
        type: 'closing',
      })
    }
  }

  // 5. Weather change
  const moistureDelta = currentMoisture - prevMoisture
  if (Math.abs(moistureDelta) > 0.10) {
    entries.push({
      lap,
      text: moistureDelta > 0 ? 'Rain is intensifying!' : 'The track is drying!',
      type: 'weather',
    })
  }

  // 6. Finish commentary (lap == totalLaps)
  if (lap === totalLaps) {
    const allSorted = [...newStates].sort((a, b) => a.position - b.position)

    for (const state of allSorted) {
      const name = driverNames[state.driverId] ?? state.driverId
      let text: string

      if (state.position === 1) {
        text = `${name} takes the victory!`
      } else if (state.position === 2) {
        text = `${name} finishes second!`
      } else if (state.position === 3) {
        text = `${name} completes the podium!`
      } else {
        text = `${name} crosses the line in P${state.position}.`
      }

      entries.push({ lap, text, type: 'finish' })
    }
  }

  return entries
}
