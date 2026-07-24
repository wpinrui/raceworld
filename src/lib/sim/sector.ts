import type { Circuit, Driver, GodModeAction, RaceState, Team } from './types'
import { simulateSlice } from './slice'

// The played-race sector tick (#sector-engine): one lap = 8 equal time-fraction slices through the
// shared core, so positions, gaps, commentary and player commands are at most 1/8 lap stale. Headless
// racing (sim-ahead, probes) stays on simulateLap — statistically equivalent by construction (the
// scaling rules in slice.ts/engine.ts preserve per-lap rates; scripts/sector-parity.ts measures it).

export const SECTORS_PER_LAP = 8
export const SECTOR_FRAC = 1 / SECTORS_PER_LAP
// Strategy replan + pit decision + pit execution run in the lap's FINAL sector — the pit entry sits at
// 0.93 of the lap (track-path.ts PIT_ENTRY_FRAC), inside sector 7's [0.875, 1) span.
export const PIT_SECTOR = SECTORS_PER_LAP - 1

export function simulateSector(
  state: RaceState,
  drivers: Driver[],
  teams: Team[],
  circuit: Circuit,
  year: number,
  godModeActions?: GodModeAction[],
  playerControlledIds?: string[],
): RaceState {
  const s = state.currentSector ?? 0
  const next = simulateSlice(
    state,
    drivers,
    teams,
    circuit,
    year,
    { frac: SECTOR_FRAC, lapStart: s === 0, lapEnd: s === SECTORS_PER_LAP - 1, pitSlice: s === PIT_SECTOR },
    godModeActions,
    false,
    playerControlledIds,
  )
  return { ...next, currentSector: s === SECTORS_PER_LAP - 1 ? 0 : s + 1 }
}
