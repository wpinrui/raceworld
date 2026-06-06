// Schema for the real-world 1996-2026 timeline. The player can start a sim from any year with data;
// from then on the engine sim diverges from history, EXCEPT real team changes (joins/leaves/rebrands)
// still happen at each season-end with the player's approval, and real rookies enter the market on
// schedule. See src/lib/history/compose.ts (build a season) and transitions.ts (per-year real changes).

// A driver defined ONCE, at the point they enter the driver market. The engine evolves them from
// here (and the composer fast-forwards mid-career drivers to a later chosen start year). Ratings are
// "as of market entry"; peakPotential/primeEnd drive the development curve thereafter.
export interface HistoricalDriver {
  id: string
  name: string
  nationality: string        // ISO 3166-1 alpha-2
  gender: 'male' | 'female'
  marketEntryYear: number    // the year they first enter the driver market (typically debut year - 1)
  ageAtEntry: number         // age in marketEntryYear
  // Ratings as of market entry (0-100), suggested separately and signed off; optional so bios can be
  // encoded first. The composer applies a neutral placeholder for any field still missing.
  primeEnd?: number          // peak age; decline begins after this
  pace?: number
  wetWeatherPace?: number
  overtaking?: number
  smoothness?: number
  consistency?: number       // race-craft consistency (issue #59): lap-noise + mistake-rate scaler
  peakPotential?: number     // overall ceiling reached before prime ends
  narrativeModifier?: number // -20..+20 media halo/deficit at entry
}

// A constructor's identity in a given season. Rebrands (Jordan -> Midland -> Spyker -> Force India ->
// Racing Point -> Aston Martin) keep the SAME id across years so the constructor stays continuous;
// only the display fields change. A new id means a genuinely new entry on the grid.
export interface HistoricalTeam {
  id: string
  name: string
  shortName: string          // <=4 chars
  nationality: string        // constructor licence country, ISO alpha-2; '' = rest of world
  color: string              // primary hex
}

// One season's real grid. `teams` are listed in that year's constructors' championship finishing
// order (best first) so the start-year car pace ranking matches reality. `lineup` maps each seat.
export interface HistoricalSeasonGrid {
  year: number
  teams: HistoricalTeam[]
  lineup: { driverId: string; teamId: string }[]
}
